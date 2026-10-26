"""
Translate the live Supabase structure (inventory.sql → CSV/JSON) into Azure SQL (T-SQL) DDL.

    python3 -I azure-app/tools/gen_schema.py <inventory.json|csv> > azure-app/schema_full.sql

Covers tables, defaults, primary/unique/check/foreign keys, indexes and the one view.
Row security, triggers and functions are written by hand (security.sql / app code) — they are logic, not structure.
Each statement is separated by a blank line (the app's setup runner splits on blank lines).
"""
from __future__ import annotations

import csv
import json
import re
import sys

src = sys.argv[1]
if src.endswith(".csv"):
    csv.field_size_limit(10**9)
    rows = list(csv.reader(open(src, encoding="utf-8")))
    inv = json.loads(rows[1][0])
else:
    inv = json.load(open(src, encoding="utf-8"))

cols_by_table: dict[str, list[dict]] = {}
for c in inv["columns"]:
    cols_by_table.setdefault(c["table"], []).append(c)
cons_by_table: dict[str, list[dict]] = {}
for c in inv["constraints"]:
    cons_by_table.setdefault(c["table"], []).append(c)

def cols_of(defn: str) -> list[str]:
    m = re.search(r"\(([^()]*)\)", defn)
    return [x.strip().strip('"') for x in m.group(1).split(",")] if m else []

# Text columns used in keys/indexes need a bounded length (SQL Server index key limit)
key_len: dict[tuple[str, str], int] = {}
def mark(table, cols):
    n = 450 if len(cols) == 1 else 200
    for c in cols:
        key_len[(table, c)] = min(key_len.get((table, c), 9999), n)
for t, cs in cons_by_table.items():
    for c in cs:
        if c["type"] in ("p", "u", "f"):
            mark(t, cols_of(c["def"]))
        if c["type"] == "f":
            m = re.search(r"REFERENCES (\w+)\(([^)]*)\)", c["def"])
            if m:
                mark(m.group(1), [x.strip() for x in m.group(2).split(",")])
for i in inv["indexes"]:
    m = re.search(r" ON public\.(\w+) USING \w+ \((.*?)\)(?: WHERE|$)", i["def"])
    if m:
        mark(m.group(1), [re.sub(r"\s+(DESC|ASC)$", "", x.strip()).strip('"') for x in m.group(2).split(",") if "(" not in x])

def q(name: str) -> str:
    return f"[{name}]"

def sql_type(t, c) -> str:
    u = c["udt"]
    if u == "text":
        n = key_len.get((t, c["column"]))
        return f"NVARCHAR({n})" if n else "NVARCHAR(MAX)"
    return {
        "int4": "INT", "int8": "BIGINT", "uuid": "UNIQUEIDENTIFIER", "bool": "BIT", "date": "DATE",
        "timestamptz": "DATETIMEOFFSET", "numeric": "DECIMAL(19,4)", "jsonb": "NVARCHAR(MAX)", "_text": "NVARCHAR(MAX)",
    }[u]

def lit(s: str) -> str:
    return "N'" + s.replace("'", "''") + "'"

def sql_default(d: str | None) -> str | None:
    if d is None:
        return None
    if d.startswith("nextval("):
        return "IDENTITY"
    m = re.fullmatch(r"'(.*)'::(text|jsonb)", d, re.S)
    if m:
        return lit(m.group(1).replace("''", "'"))
    return {
        "now()": "SYSDATETIMEOFFSET()",
        "true": "1", "false": "0",
        "auth.uid()": "TRY_CAST(SESSION_CONTEXT(N'uid') AS UNIQUEIDENTIFIER)",
        "CURRENT_DATE": "CAST(SYSUTCDATETIME() AS DATE)",
        "gen_random_uuid()": "NEWID()",
        "replace((gen_random_uuid())::text, '-'::text, ''::text)": "REPLACE(LOWER(CONVERT(NVARCHAR(36), NEWID())), N'-', N'')",
        "(now() + '30 days'::interval)": "DATEADD(day, 30, SYSDATETIMEOFFSET())",
    }.get(d) or (d if re.fullmatch(r"-?\d+(\.\d+)?", d) else f"/*?{d}*/NULL")

# ---------- CHECK expressions ----------
REGEX = {
    r"'^\d{4}-\d{2}$'": lambda col: f"({col} LIKE N'[0-9][0-9][0-9][0-9]-[0-9][0-9]')",
    r"'^\d{13}$'": lambda col: f"(LEN({col}) = 13 AND {col} NOT LIKE N'%[^0-9]%')",
    r"'^\d{5}$'": lambda col: f"(LEN({col}) = 5 AND {col} NOT LIKE N'%[^0-9]%')",
    r"'^[0-9]{5}$'": lambda col: f"(LEN({col}) = 5 AND {col} NOT LIKE N'%[^0-9]%')",
}
# keys compared with outer brackets removed. SQL Server allows no subquery in CHECK, so the forms list
# (only 'pvd'/'wef', at least one) is checked as text instead
HAND = {
    "(break_start IS NULL) = (break_end IS NULL)": "(([break_start] IS NULL AND [break_end] IS NULL) OR ([break_start] IS NOT NULL AND [break_end] IS NOT NULL))",
    "(forms <@ ARRAY['pvd'::text, 'wef'::text]) AND (cardinality(forms) > 0)":
        "(ISJSON([forms]) = 1 AND [forms] <> N'[]' AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE([forms], N'\"pvd\"', N''), N'\"wef\"', N''), N',', N''), N' ', N''), N'[', N''), N']', N'') = N'')",
}

def unwrap(e: str) -> str:
    e = e.strip()
    while e.startswith("(") and e.endswith(")"):
        depth = 0
        for i, ch in enumerate(e):
            depth += ch == "("
            depth -= ch == ")"
            if depth == 0 and i < len(e) - 1:
                return e
        e = e[1:-1].strip()
    return e

def bracket_cols(expr: str, cols: set[str]) -> str:
    parts = re.split(r"(N?'(?:[^']|'')*')", expr)
    for i in range(0, len(parts), 2):
        parts[i] = re.sub(r"(?<![\w\[.])([a-z_][a-z0-9_]*)\b(?!\s*\()", lambda m: f"[{m.group(1)}]" if m.group(1) in cols else m.group(1), parts[i])
    return "".join(parts)

def tsql_expr(e: str, cols: set[str]) -> str:
    if unwrap(e) in HAND:
        return HAND[unwrap(e)]
    for pat, fn in REGEX.items():
        m = re.search(r"\(?(\w+) ~ " + re.escape(pat) + r"::text\)?", e)
        if m:
            e = e.replace(m.group(0), fn(f"[{m.group(1)}]"))
    e = re.sub(r"'((?:[^']|'')*)'::text", lambda m: "N'" + m.group(1) + "'", e)
    e = re.sub(r"\((-?\d+(?:\.\d+)?)\)::(numeric|integer|bigint)", r"\1", e)
    e = re.sub(r"= ANY \(ARRAY\[(.*?)\]\)", r"IN (\1)", e)
    e = re.sub(r"\bbtrim\(([^)]*)\)", r"LTRIM(RTRIM(\1))", e)
    return bracket_cols(e, cols)

out: list[str] = []
emit = out.append

emit("-- Generated by azure-app/tools/gen_schema.py from the live Supabase structure. Do not edit by hand.")

fks: list[str] = []
for t in sorted(cols_by_table):
    cols = sorted(cols_by_table[t], key=lambda c: c["pos"])
    names = {c["column"] for c in cols}
    cons = cons_by_table.get(t, [])
    pk = next((cols_of(c["def"]) for c in cons if c["type"] == "p"), [])
    lines = []
    for c in cols:
        typ = sql_type(t, c)
        d = sql_default(c["default"])
        ident = d == "IDENTITY" or (c["column"] == "id" and c["udt"] in ("int8", "int4") and c["default"] is None and pk == ["id"])
        line = f"  {q(c['column'])} {typ}"
        if ident:
            line += " IDENTITY(1,1)"
        line += " NOT NULL" if c["nullable"] == "NO" else " NULL"
        if d and d != "IDENTITY":
            line += f" CONSTRAINT [df_{t}_{c['column']}] DEFAULT {d}"
        if c["udt"] in ("jsonb", "_text"):
            line += f" CONSTRAINT [ck_{t}_{c['column']}_json] CHECK ({q(c['column'])} IS NULL OR ISJSON({q(c['column'])}) = 1)"
        lines.append(line)
    if pk:
        lines.append(f"  CONSTRAINT [pk_{t}] PRIMARY KEY ({', '.join(map(q, pk))})")
    for n, c in enumerate(x for x in cons if x["type"] == "c"):
        body = re.sub(r"^CHECK ", "", c["def"])
        lines.append(f"  CONSTRAINT [ck_{t}_{n}] CHECK {tsql_expr(body, names)}")
    emit(f"IF OBJECT_ID('dbo.{t}') IS NULL\nCREATE TABLE dbo.{q(t)} (\n" + ",\n".join(lines) + "\n);")
    # UNIQUE → filtered unique index when a column is nullable (Postgres allows many NULLs, SQL Server only one)
    for c in cons:
        if c["type"] != "u":
            continue
        ucols = cols_of(c["def"])
        nullable = [u for u in ucols if next(x for x in cols if x["column"] == u)["nullable"] == "YES"]
        where = (" WHERE " + " AND ".join(f"{q(u)} IS NOT NULL" for u in nullable)) if nullable else ""
        emit(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_{c['name']}')\n"
             f"CREATE UNIQUE INDEX [uq_{c['name']}] ON dbo.{q(t)} ({', '.join(map(q, ucols))}){where};")
    for c in cons:
        if c["type"] != "f" or "auth.users" in c["def"]:
            continue   # auth.users doesn't exist on Azure — user ids are kept as plain values
        m = re.match(r"FOREIGN KEY \((.*?)\) REFERENCES (\w+)\((.*?)\)(.*)", c["def"])
        a, rt, b, rest = m.groups()
        act = ""
        for kind in ("DELETE", "UPDATE"):
            mm = re.search(rf"ON {kind} (CASCADE|SET NULL|RESTRICT)", rest)
            if mm and mm.group(1) != "RESTRICT":
                act += f" ON {kind} {mm.group(1)}"
        fks.append(f"IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_{c['name']}')\n"
                   f"ALTER TABLE dbo.{q(t)} ADD CONSTRAINT [fk_{c['name']}] FOREIGN KEY ({', '.join(q(x.strip().strip(chr(34))) for x in a.split(','))}) "
                   f"REFERENCES dbo.{q(rt)} ({', '.join(q(x.strip()) for x in b.split(','))}){act};")

# plain + partial indexes (unique constraints and PKs already covered)
con_names = {c["name"] for c in inv["constraints"]}
for i in inv["indexes"]:
    if i["name"] in con_names or i["name"].endswith("_pkey"):
        continue
    m = re.match(r"CREATE (UNIQUE )?INDEX (\w+) ON public\.(\w+) USING btree \((.*?)\)(?: WHERE (.*))?$", i["def"])
    uniq, name, t, ic, where = m.groups()
    names = {c["column"] for c in cols_by_table[t]}
    if "upper(" in ic:   # case-insensitive unique — SQL Server's default collation is already case-insensitive
        ic = re.sub(r"upper\((\w+)\)", r"\1", ic)
    parts = []
    for x in ic.split(","):
        x = x.strip()
        d = " DESC" if x.endswith(" DESC") else ""
        parts.append(q(x.replace(" DESC", "").strip('"')) + d)
    w = ""
    if where:
        w = " WHERE " + {
            "(NOT cancelled)": "[cancelled] = 0",
            "((status <> 'cancelled'::text) AND (doc_id IS NOT NULL))": "[status] <> N'cancelled' AND [doc_id] IS NOT NULL",
        }[where]
    emit(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '{name}')\n"
         f"CREATE {uniq or ''}INDEX [{name}] ON dbo.{q(t)} ({', '.join(parts)}){w};")

for f in fks:
    emit(f)

emit("""CREATE OR ALTER VIEW dbo.uniform_balance AS
SELECT i.id, i.item_type, i.size, i.min_qty, i.is_active, i.remark, i.sort_order,
       CAST(COALESCE(SUM(m.qty), 0) AS INT) AS qty,
       CAST(COALESCE(SUM(CASE WHEN m.move_type = N'issue' THEN m.qty END), 0) AS INT) * -1 AS issued_total,
       MAX(m.moved_on) AS last_move
FROM dbo.uniform_item i LEFT JOIN dbo.uniform_move m ON m.item_id = i.id
GROUP BY i.id, i.item_type, i.size, i.min_qty, i.is_active, i.remark, i.sort_order;""")

print("\n\n".join(out))

# column list per table for the API (which columns exist, which are JSON) — written next to the schema
def pk_of(t):
    return next((cols_of(c["def"]) for c in cons_by_table.get(t, []) if c["type"] == "p"), [])
meta = {t: {"pk": pk_of(t),
            "identity": next((c["column"] for c in cs if (c["default"] or "").startswith("nextval(")
                              or (c["column"] == "id" and c["udt"] in ("int8", "int4") and c["default"] is None and pk_of(t) == ["id"])), None),
            "cols": [{"name": c["column"], "udt": c["udt"], "null": c["nullable"] == "YES"} for c in sorted(cs, key=lambda c: c["pos"])]}
        for t, cs in sorted(cols_by_table.items())}
json.dump(meta, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=0) if len(sys.argv) > 2 else None
