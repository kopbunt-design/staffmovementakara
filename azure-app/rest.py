"""
Supabase-style table access for the site: the browser keeps writing supabase.from("t").select().eq()… and
js/azure-client.js sends the same query here as JSON. This module turns it into parameterised T-SQL.

Safety
  • table and column names are checked against tables.json — nothing from the request is pasted into SQL
    except those checked names; every value is a ? parameter
  • the connection carries the caller's user id, so Azure SQL row security (security.sql) decides what is visible
  • UPDATE / DELETE touch only rows the caller may change (same as Postgres, which silently skips the others)
  • every write runs the ported triggers (hooks.py) inside the same transaction

Request  {table, method: GET|POST|PATCH|DELETE, select, filters, or, order, limit, offset, single, count, head,
          values, upsert: {onConflict, ignoreDuplicates}, returning}
Response {data, error, count}   — error = {message, code, details, hint} like PostgREST
"""
from __future__ import annotations

import json
import re

import db
import hooks
from db import TABLES


# the one view the site reads (uniform stock balance) — read-only
VIEWS = {"uniform_balance": {"cols": [{"name": n, "udt": u} for n, u in (
    ("id", "int8"), ("item_type", "text"), ("size", "text"), ("min_qty", "int4"), ("is_active", "bool"),
    ("remark", "text"), ("sort_order", "int4"), ("qty", "int4"), ("issued_total", "int4"), ("last_move", "date"))],
    "pk": ["id"], "fks": [], "identity": None}}


class ApiError(Exception):
    def __init__(self, message, code="PGRST000", details=None, hint=None):
        super().__init__(message)
        self.body = {"message": message, "code": code, "details": details, "hint": hint}


def meta(table):
    m = TABLES.get(table) or VIEWS.get(table)
    if not m:
        raise ApiError(f'relation "public.{table}" does not exist', "42P01")
    return m


def colnames(table):
    return [c["name"] for c in meta(table)["cols"]]


def check_col(table, col):
    if col not in colnames(table):
        raise ApiError(f"column {table}.{col} does not exist", "42703")
    return f"[{col}]"


class Ctx:
    """Who is acting, their role and permissions (read once per request), and flags that server functions switch on
    for their own writes. bypass=True = server functions that ran as SECURITY DEFINER in Supabase (no row rules)."""
    def __init__(self, cur, uid, flags=None, bypass=False):
        self.cur, self.uid, self.flags, self.bypass = cur, uid, set(flags or ()), bypass
        self.role, self.perms = None, set()
        if uid:
            r = cur.execute("SELECT TOP 1 [role] FROM dbo.user_roles WHERE user_id = ?", uid).fetchone()
            self.role = r[0] if r else None
            if self.role:
                self.perms = {x[0] for x in cur.execute("SELECT perm_key FROM dbo.role_permissions WHERE role_key = ?", self.role).fetchall()}

    def flag(self, name):
        return name in self.flags

    def has_perm(self, p):
        return bool(self.uid) and (self.role == "admin" or p in self.perms)


# ------------------------------------------------------------------------------------------- select parsing

def split_top(s):
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip()); cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def parse_select(table, sel):
    """'*,master_departments(name)' → (plain columns, [(relation, [columns])])"""
    cols, rels = [], []
    for item in split_top(re.sub(r"\s+", "", sel or "*")):
        m = re.fullmatch(r"(\w+)\((.*)\)", item)
        if m:
            rels.append((m.group(1), m.group(2)))
        elif item == "*":
            cols = ["*"] + [c for c in cols if c != "*"]
        else:
            check_col(table, item)
            cols.append(item)
    return cols or ["*"], rels


# ------------------------------------------------------------------------------------------- filters

def like_value(v):
    return str(v).replace("[", "[[]")


def cond(table, col, op, val, params):
    c = check_col(table, col)
    neg = False
    if op.startswith("not."):
        neg, op = True, op[4:]
    if op == "is":
        s = {None: "IS NULL", "null": "IS NULL", True: "= 1", "true": "= 1", False: "= 0", "false": "= 0"}.get(val)
        if s is None:
            raise ApiError(f"bad is value {val!r}", "PGRST100")
        out = f"{c} {s}"
    elif op == "in":
        vals = val if isinstance(val, list) else [x.strip().strip('"') for x in str(val).strip("()").split(",") if x.strip()]
        if not vals:
            out = "1 = 0"
        else:
            out = f"{c} IN ({', '.join('?' for _ in vals)})"
            params += [db.in_value(table, col, v) for v in vals]
    elif op in ("like", "ilike"):
        out = f"{c} LIKE ?"
        params.append(like_value(val).replace("*", "%"))
    elif op in ("eq", "neq", "gt", "gte", "lt", "lte"):
        sym = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
        out = f"{c} {sym} ?"
        params.append(db.in_value(table, col, val))
    elif op == "cs":   # contains — JSON arrays only
        vals = val if isinstance(val, list) else json.loads(val)
        out = " AND ".join(f"EXISTS (SELECT 1 FROM OPENJSON({c}) WHERE [value] = ?)" for _ in vals) or "1 = 1"
        params += vals
    else:
        raise ApiError(f"operator {op} is not supported", "PGRST100")
    return f"NOT ({out})" if neg else out


def parse_logic(table, s, params, joiner="OR"):
    """PostgREST or/and string: 'and(status.eq.review,reviewer_id.eq.X),status.eq.draft'"""
    parts = []
    for item in split_top(s):
        m = re.fullmatch(r"(and|or)\((.*)\)", item)
        if m:
            parts.append("(" + parse_logic(table, m.group(2), params, m.group(1).upper()) + ")")
            continue
        m = re.fullmatch(r"(\w+)\.((?:not\.)?\w+)\.(.*)", item)
        if not m:
            raise ApiError(f"bad filter {item}", "PGRST100")
        col, op, v = m.groups()
        val = None if (op.endswith("is") and v == "null") else v
        parts.append(cond(table, col, op, val, params))
    return f" {joiner} ".join(parts) or "1 = 1"


def where_clause(ctx, table, req, params, rules=("read",)):
    conds = [cond(table, f[0], f[1], f[2] if len(f) > 2 else None, params) for f in req.get("filters") or []]
    for o in req.get("or") or []:
        conds.append("(" + parse_logic(table, o, params) + ")")
    conds += [rf for rf in (rule_filter(ctx, table, k) for k in rules) if rf]
    return (" WHERE " + " AND ".join(conds)) if conds else ""


def check_rule(ctx, cur, table, row, kind):
    """After a write: the stored row must satisfy the INSERT / UPDATE check rule, else roll back (Postgres 42501)."""
    rf = rule_filter(ctx, table, kind)
    if not rf:
        return
    w, p = _pk_where(table, row)
    if not cur.execute(f"SELECT 1 FROM dbo.[{table}] WHERE {w} AND {rf}", *p).fetchone():
        raise ApiError(f'new row violates row-level security policy for table "{table}"', "42501")


RULES: dict = json.loads((db.HERE / "security_rules.json").read_text(encoding="utf-8"))
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def rule_filter(ctx, table, kind, alias=None):
    """The row-security rule generated from the Supabase policies (security_rules.json), as a SQL condition with
    the caller filled in: has_perm / role / user id / document visibility become constants computed here, so the
    database needs no functions or policies of its own. All data access goes through this module.
    read = rows the caller may see; upd_before / del = rows they may change (others are skipped, as in Postgres);
    ins / upd_after = what a written row must satisfy."""
    if ctx is None or ctx.bypass or table not in RULES:
        return ""
    body = RULES[table][kind]
    yes, no = "(1 = 1)", "(1 = 0)"
    body = re.sub(r"\(dbo\.has_perm\(N'([^']+)'\) = 1\)", lambda m: yes if ctx.has_perm(m.group(1)) else no, body)
    page, conf = ctx.has_perm("page.docregister"), ctx.has_perm("data.doc.confidential")
    body = re.sub(r"\(dbo\.doc_visible\(([@\w.]+)\) = 1\)",
                  lambda m: f"({yes if page else no} AND (ISNULL({m.group(1)}, 0) = 0 OR {yes if conf else no}))", body)
    role = ("N'" + ctx.role.replace("'", "''") + "'") if ctx.role else "CAST(NULL AS NVARCHAR(200))"
    body = body.replace("dbo.my_role()", role)
    uid = f"CAST(N'{ctx.uid}' AS UNIQUEIDENTIFIER)" if ctx.uid and UUID_RE.match(str(ctx.uid)) else "CAST(NULL AS UNIQUEIDENTIFIER)"
    body = body.replace("dbo.auth_uid()", uid)
    q = alias if alias is not None else f"[{table}]."   # qualify outer columns — rules may contain sub-queries
    body = re.sub(r"@(\w+)", lambda m: f"{q}[{m.group(1)}]", body)
    return f"({body})"


def order_clause(table, req):
    parts = []
    for o in req.get("order") or []:
        col, asc = o[0], o[1] if len(o) > 1 else True
        nulls_first = o[2] if len(o) > 2 and o[2] is not None else (not asc)   # Postgres default: NULLS LAST asc, FIRST desc
        c = check_col(table, col)
        parts.append(f"CASE WHEN {c} IS NULL THEN {0 if nulls_first else 1} ELSE {1 if nulls_first else 0} END")
        parts.append(f"{c} {'ASC' if asc else 'DESC'}")
    if not parts:
        pk = meta(table)["pk"]
        parts = [f"[{k}]" for k in pk] or ["(SELECT NULL)"]
    return " ORDER BY " + ", ".join(parts)


# ------------------------------------------------------------------------------------------- read

def out_rows(table, rs):
    return [db.decode_row(table, r) for r in rs]


def embed(ctx, cur, table, rows, rels):
    for rel, sub in rels:
        fk = next((f for f in meta(table)["fks"] if f["table"] == rel), None)
        if not fk:
            raise ApiError(f"Could not find a relationship between '{table}' and '{rel}'", "PGRST200")
        subcols, _ = parse_select(rel, sub)
        keys = sorted({r.get(fk["cols"][0]) for r in rows if r.get(fk["cols"][0]) is not None}, key=str)
        found = {}
        for i in range(0, len(keys), 500):
            chunk = keys[i:i + 500]
            sel = "*" if "*" in subcols else ", ".join({f"[{c}]" for c in subcols + fk["ref"]})
            rf = rule_filter(ctx, rel, "read")
            for r in db.rows(cur.execute(f"SELECT {sel} FROM dbo.[{rel}] WHERE [{fk['ref'][0]}] IN ({', '.join('?' for _ in chunk)})"
                                         + (f" AND {rf}" if rf else ""), *chunk)):
                found[str(r[fk["ref"][0]])] = db.decode_row(rel, r)
        for r in rows:
            v = found.get(str(r.get(fk["cols"][0])))
            r[rel] = ({k: v[k] for k in subcols} if v and "*" not in subcols else v)
    return rows


def do_select(ctx, cur, table, req):
    cols, rels = parse_select(table, req.get("select"))
    params = []
    where = where_clause(ctx, table, req, params)
    count = None
    if req.get("count"):
        count = cur.execute(f"SELECT COUNT(*) FROM dbo.[{table}]{where}", *params).fetchone()[0]
    if req.get("head"):
        return None, count
    need = set(cols) | {f["cols"][0] for rel, _ in rels for f in meta(table)["fks"] if f["table"] == rel}
    sel = "*" if "*" in cols else ", ".join(f"[{c}]" for c in need)
    sql = f"SELECT {sel} FROM dbo.[{table}]{where}{order_clause(table, req)}"
    limit, offset = req.get("limit"), req.get("offset") or 0
    if limit is not None or offset:
        sql += f" OFFSET {int(offset)} ROWS" + (f" FETCH NEXT {int(limit)} ROWS ONLY" if limit is not None else "")
    rows = out_rows(table, db.rows(cur.execute(sql, *params)))
    if rels:
        embed(ctx, cur, table, rows, rels)
    if "*" not in cols:
        keep = set(cols) | {r for r, _ in rels}
        rows = [{k: v for k, v in r.items() if k in keep} for r in rows]
    return rows, count


# ------------------------------------------------------------------------------------------- write

def _run(registry, table, *args):
    for fn in registry.get(table, []):
        fn(*args)


def _pk_where(table, row):
    pk = meta(table)["pk"]
    return " AND ".join(f"[{k}] = ?" for k in pk), [db.in_value(table, k, row[k]) for k in pk]


def _fetch_by_pk(cur, table, row):
    w, p = _pk_where(table, row)
    r = db.rows(cur.execute(f"SELECT * FROM dbo.[{table}] WHERE {w}", *p))
    return db.decode_row(table, r[0]) if r else None


def insert_row(cur, ctx, table, row):
    known = colnames(table)
    unknown = [k for k in row if k not in known]
    if unknown:
        raise ApiError(f"Could not find the '{unknown[0]}' column of '{table}'", "PGRST204")
    _run(hooks.BEFORE_INSERT, table, cur, ctx, row)
    cols = list(row)
    ident = meta(table)["identity"]
    explicit_id = bool(ident and ident in cols)
    if explicit_id:
        cur.execute(f"SET IDENTITY_INSERT dbo.[{table}] ON")
    sql = (f"INSERT INTO dbo.[{table}] ({', '.join(f'[{c}]' for c in cols)}) OUTPUT INSERTED.* VALUES ({', '.join('?' for _ in cols)})"
           if cols else f"INSERT INTO dbo.[{table}] OUTPUT INSERTED.* DEFAULT VALUES")
    try:
        out = db.decode_row(table, db.rows(cur.execute(sql, *[db.in_value(table, c, row[c]) for c in cols]))[0])
    finally:   # connections are pooled — never leave IDENTITY_INSERT on for the next request
        if explicit_id:
            cur.execute(f"SET IDENTITY_INSERT dbo.[{table}] OFF")
    check_rule(ctx, cur, table, out, "ins")
    _run(hooks.AFTER_INSERT, table, cur, ctx, out)
    return out


def update_row(cur, ctx, table, old, values):
    new = {**old, **values}
    _run(hooks.BEFORE_UPDATE, table, cur, ctx, old, new)
    changed = [k for k in new if k in colnames(table) and k not in meta(table)["pk"]
               and (k in values or hooks._distinct(new[k], old.get(k)))]
    if changed:
        w, p = _pk_where(table, old)
        cur.execute(f"UPDATE dbo.[{table}] SET {', '.join(f'[{k}] = ?' for k in changed)} WHERE {w}",
                    *[db.in_value(table, k, new[k]) for k in changed], *p)
    out = _fetch_by_pk(cur, table, {**old, **{k: new[k] for k in meta(table)['pk'] if k in new}}) or new
    check_rule(ctx, cur, table, out, "upd_after")
    _run(hooks.AFTER_UPDATE, table, cur, ctx, old, out)
    return out


def do_insert(cur, ctx, table, req):
    rows = req["values"] if isinstance(req["values"], list) else [req["values"]]
    up = req.get("upsert")
    out = []
    for r in rows:
        if up:
            keys = [k.strip() for k in (up.get("onConflict") or ",".join(meta(table)["pk"])).split(",")]
            for k in keys:
                check_col(table, k)
            if all(r.get(k) is not None for k in keys):
                w = " AND ".join(f"[{k}] = ?" for k in keys)
                ex = db.rows(cur.execute(f"SELECT * FROM dbo.[{table}] WITH (UPDLOCK, HOLDLOCK) WHERE {w}",
                                         *[db.in_value(table, k, r[k]) for k in keys]))
                if ex:
                    if up.get("ignoreDuplicates"):
                        continue
                    old = db.decode_row(table, ex[0])
                    rules = " AND ".join(x for x in (rule_filter(ctx, table, "read", "t."), rule_filter(ctx, table, "upd_before", "t.")) if x) or "1 = 1"
                    allowed = cur.execute(f"SELECT 1 FROM dbo.[{table}] t WHERE {rules} AND "
                                          + " AND ".join(f"t.[{k}] = ?" for k in meta(table)['pk']),
                                          *[db.in_value(table, k, old[k]) for k in meta(table)["pk"]]).fetchone()
                    if not allowed:
                        raise ApiError('new row violates row-level security policy for table "' + table + '"', "42501")
                    out.append(update_row(cur, ctx, table, old, {k: v for k, v in r.items() if k not in meta(table)["pk"]}))
                    continue
        out.append(insert_row(cur, ctx, table, r))
    return out


def do_update(cur, ctx, table, req):
    params = []
    where = where_clause(ctx, table, req, params, rules=("read", "upd_before"))
    olds = out_rows(table, db.rows(cur.execute(f"SELECT * FROM dbo.[{table}] WITH (UPDLOCK){where}", *params)))
    values = {k: v for k, v in (req.get("values") or {}).items()}
    for k in values:
        check_col(table, k)
    return [update_row(cur, ctx, table, o, values) for o in olds]


def do_delete(cur, ctx, table, req):
    params = []
    where = where_clause(ctx, table, req, params, rules=("read", "del"))
    olds = out_rows(table, db.rows(cur.execute(f"SELECT * FROM dbo.[{table}] WITH (UPDLOCK){where}", *params)))
    for o in olds:
        _run(hooks.BEFORE_DELETE, table, cur, ctx, o)
        w, p = _pk_where(table, o)
        cur.execute(f"DELETE FROM dbo.[{table}] WHERE {w}", *p)
        _run(hooks.AFTER_DELETE, table, cur, ctx, o)
    return olds


# ------------------------------------------------------------------------------------------- entry

SQL_ERRORS = [   # SQL Server message → Postgres-like code the pages may look at
    (r"duplicate key|UNIQUE KEY|unique index", "23505", "duplicate key value violates unique constraint"),
    (r"FOREIGN KEY constraint", "23503", "violates foreign key constraint"),
    (r"CHECK constraint", "23514", "violates check constraint"),
    (r"block predicate", "42501", "new row violates row-level security policy"),
    (r"Cannot insert the value NULL", "23502", "null value violates not-null constraint"),
    (r"Conversion failed|converting|Error converting", "22P02", "invalid input syntax"),
]


def map_sql_error(e: Exception) -> dict:
    msg = str(e)
    for pat, code, text in SQL_ERRORS:
        if re.search(pat, msg, re.I):
            return {"message": f"{text} ({msg[msg.find('[SQL Server]') + 12:][:200] if '[SQL Server]' in msg else msg[:200]})",
                    "code": code, "details": None, "hint": None}
    return {"message": msg[:400], "code": "XX000", "details": None, "hint": None}


def handle(cn, uid, req) -> dict:
    table = req.get("table") or ""
    meta(table)
    method = (req.get("method") or "GET").upper()
    cur = cn.cursor()
    ctx = Ctx(cur, uid)
    try:
        if method == "GET":
            data, count = do_select(ctx, cur, table, req)
        else:
            if table in VIEWS:
                raise ApiError(f"cannot write to view {table}", "42809")
            data = {"POST": do_insert, "PATCH": do_update, "DELETE": do_delete}[method](cur, ctx, table, req)
            count = len(data) if req.get("count") else None
            cn.commit()
            if not req.get("returning"):
                data = None
        if req.get("single") and data is not None:
            if len(data) == 1:
                data = data[0]
            elif len(data) == 0 and req["single"] == "maybe":
                data = None
            else:
                raise ApiError("JSON object requested, multiple (or no) rows returned", "PGRST116",
                               f"The result contains {len(data)} rows")
        return {"data": data, "error": None, "count": count}
    except hooks.HookError as e:
        cn.rollback()
        return {"data": None, "error": {"message": str(e), "code": "P0001", "details": None, "hint": None}, "count": None}
    except ApiError as e:
        cn.rollback()
        return {"data": None, "error": e.body, "count": None}
    except Exception as e:
        cn.rollback()
        return {"data": None, "error": map_sql_error(e), "count": None}
