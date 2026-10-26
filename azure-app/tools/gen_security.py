"""
Translate Supabase row-level-security policies into Azure SQL row-level security.

    python3 -I azure-app/tools/gen_security.py <inventory.json> > azure-app/security.sql

How the Postgres rules map
  • who is calling: SESSION_CONTEXT('uid') set by the app per request  → dbo.auth_uid()
  • has_perm / get_my_role / doc_visible                                → same-named scalar functions
  • FILTER predicate (rows you can see, also limits UPDATE/DELETE)       = OR of SELECT + ALL "using"
  • BLOCK AFTER INSERT                                                  = OR of INSERT "check" + ALL "check" (or "using")
  • BLOCK BEFORE UPDATE / AFTER UPDATE / BEFORE DELETE                  = same idea per command
  • no policy for a command                                             = denied (as in Postgres)
  • SESSION_CONTEXT('bypass') = 1                                        = server-side functions that Supabase ran as
                                                                          SECURITY DEFINER (approval flows, link pages)
Storage policies (table "objects") are enforced in the app's file endpoints, not here.
"""
from __future__ import annotations

import json
import re
import sys

inv = json.load(open(sys.argv[1], encoding="utf-8"))
cols = {}
for c in inv["columns"]:
    cols.setdefault(c["table"], {})[c["column"]] = c["udt"]

TYPE = {"text": "NVARCHAR(4000)", "int4": "INT", "int8": "BIGINT", "uuid": "UNIQUEIDENTIFIER", "bool": "BIT",
        "date": "DATE", "timestamptz": "DATETIMEOFFSET", "numeric": "DECIMAL(19,4)", "jsonb": "NVARCHAR(MAX)", "_text": "NVARCHAR(MAX)"}

FUNCS = r"""CREATE OR ALTER FUNCTION dbo.auth_uid() RETURNS UNIQUEIDENTIFIER WITH SCHEMABINDING AS
BEGIN RETURN TRY_CAST(CAST(SESSION_CONTEXT(N'uid') AS NVARCHAR(64)) AS UNIQUEIDENTIFIER) END;

CREATE OR ALTER FUNCTION dbo.rls_bypass() RETURNS BIT WITH SCHEMABINDING AS
BEGIN RETURN CASE WHEN TRY_CAST(SESSION_CONTEXT(N'bypass') AS INT) = 1 THEN 1 ELSE 0 END END;

CREATE OR ALTER FUNCTION dbo.my_role() RETURNS NVARCHAR(200) WITH SCHEMABINDING AS
BEGIN RETURN (SELECT TOP 1 [role] FROM dbo.user_roles WHERE user_id = dbo.auth_uid()) END;

CREATE OR ALTER FUNCTION dbo.has_perm(@p NVARCHAR(200)) RETURNS BIT WITH SCHEMABINDING AS
BEGIN
  IF dbo.auth_uid() IS NULL RETURN 0;
  IF dbo.my_role() = N'admin' RETURN 1;
  IF EXISTS (SELECT 1 FROM dbo.user_roles ur JOIN dbo.role_permissions rp ON rp.role_key = ur.[role]
             WHERE ur.user_id = dbo.auth_uid() AND rp.perm_key = @p) RETURN 1;
  RETURN 0;
END;

CREATE OR ALTER FUNCTION dbo.user_has_perm(@uid UNIQUEIDENTIFIER, @p NVARCHAR(200)) RETURNS BIT WITH SCHEMABINDING AS
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.user_roles ur WHERE ur.user_id = @uid AND (ur.[role] = N'admin'
             OR EXISTS (SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_key = ur.[role] AND rp.perm_key = @p))) RETURN 1;
  RETURN 0;
END;

CREATE OR ALTER FUNCTION dbo.doc_visible(@confidential BIT) RETURNS BIT WITH SCHEMABINDING AS
BEGIN
  RETURN CASE WHEN dbo.has_perm(N'page.docregister') = 1
               AND (ISNULL(@confidential, 0) = 0 OR dbo.has_perm(N'data.doc.confidential') = 1) THEN 1 ELSE 0 END;
END;"""


def tr(expr: str | None, table: str, used: set[str]) -> str:
    """One Postgres policy expression → a T-SQL predicate. Columns of `table` become @parameters."""
    if expr is None:
        return None
    e = expr
    e = re.sub(r"\(auth\.role\(\) = 'authenticated'::text\)", "(dbo.auth_uid() IS NOT NULL)", e)
    e = re.sub(r"has_perm\('([^']+)'::text\)", r"(dbo.has_perm(N'\1') = 1)", e)
    e = re.sub(r"get_my_role\(\) = ANY \(ARRAY\[(.*?)\]\)", lambda m: "dbo.my_role() IN (" + re.sub(r"'([^']*)'::text", r"N'\1'", m.group(1)) + ")", e)
    e = re.sub(r"get_my_role\(\) = '([^']+)'::text", r"dbo.my_role() = N'\1'", e)
    e = e.replace("auth.uid()", "dbo.auth_uid()")
    e = re.sub(r"doc_visible\((r\.)?confidential\)", lambda m: f"(dbo.doc_visible({'r.' if m.group(1) else '@'}confidential) = 1)", e)
    if "doc_visible(@confidential)" in e:
        used.add("confidential")
    e = re.sub(r"\((\w+) ~~ '([^']*)'::text\)", lambda m: f"(@{m.group(1)} LIKE N'{m.group(2)}' ESCAPE N'\\')", e)
    for m in re.findall(r"@(\w+) LIKE", e):
        used.add(m)
    e = re.sub(r"FROM (\w+) r", r"FROM dbo.\1 r", e)
    e = re.sub(rf"\b{table}\.(\w+)", lambda m: (used.add(m.group(1)), "@" + m.group(1))[1], e)
    # bare column names of this table (outside quotes, not after a dot / @)
    parts = re.split(r"(N?'(?:[^']|'')*')", e)
    for i in range(0, len(parts), 2):
        def col(m):
            name = m.group(1)
            if name in cols[table] and name not in ("r",):
                used.add(name)
                return "@" + name
            return name
        parts[i] = re.sub(r"(?<![\w@.\[])([a-z_][a-z0-9_]*)\b(?![\s]*\()", col, parts[i])
    e = "".join(parts)
    e = re.sub(r"\bfalse\b", "(1 = 0)", e)
    e = re.sub(r"\btrue\b", "(1 = 1)", e)
    e = re.sub(r"'([^']*)'::text", r"N'\1'", e)
    e = re.sub(r"\s+", " ", e)
    return e


def any_of(xs):
    xs = [x for x in xs if x]
    return " OR ".join(f"({x})" for x in xs) if xs else "1 = 0"


# re-runnable: policies and predicate functions are schema-bound to the helpers, so drop them first
DROP_ALL = """DECLARE @s NVARCHAR(MAX) = N'';
SELECT @s += N'DROP SECURITY POLICY ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) + N';' FROM sys.security_policies;
SELECT @s += N'DROP FUNCTION sec.' + QUOTENAME(name) + N';' FROM sys.objects WHERE schema_id = SCHEMA_ID('sec') AND type IN ('IF', 'FN', 'TF');
EXEC sp_executesql @s;"""
PARAMS = {}   # table → predicate columns, used by the app to apply the UPDATE/DELETE rules as a filter (Postgres semantics)
out = ["-- Generated by azure-app/tools/gen_security.py from the live Supabase policies. Do not edit by hand.",
       "IF SCHEMA_ID('sec') IS NULL EXEC('CREATE SCHEMA sec');", DROP_ALL]
out += FUNCS.split("\n\n")

pol = {}
for p in inv["policies"]:
    if p["table"] == "objects":
        continue
    pol.setdefault(p["table"], []).append(p)

for t in sorted(cols):
    ps = pol.get(t, [])
    used: set[str] = set()
    def u(cmds):
        return [tr(p["using"], t, used) for p in ps if p["cmd"] in cmds and p["using"]]
    def c(cmds):
        return [tr(p["check"] if p["check"] else p["using"], t, used) for p in ps if p["cmd"] in cmds and (p["check"] or p["using"])]
    preds = {
        "read": any_of(u(("SELECT", "ALL"))),
        "ins": any_of(c(("INSERT", "ALL"))),
        "upd_before": any_of(u(("UPDATE", "ALL"))),
        "upd_after": any_of(c(("UPDATE", "ALL"))),
        "del": any_of(u(("DELETE", "ALL"))),
    }
    params = sorted(used)
    if not params:   # a predicate takes at least one column — pass the first key column (unused in the body)
        pk = next((re.search(r"\((.*?)\)", c["def"]).group(1).split(",")[0].strip().strip('"')
                   for c in inv["constraints"] if c["table"] == t and c["type"] == "p"))
        params = [pk]
    PARAMS[t] = params
    sig = ", ".join(f"@{n} {TYPE[cols[t][n]]}" for n in params)
    args = ", ".join(f"[{n}]" for n in params)
    for k, body in preds.items():
        out.append(f"CREATE OR ALTER FUNCTION sec.[{t}_{k}]({sig}) RETURNS TABLE WITH SCHEMABINDING AS\n"
                   f"RETURN SELECT 1 AS ok WHERE dbo.rls_bypass() = 1 OR ({body});")
    out.append(f"CREATE SECURITY POLICY sec.[rls_{t}]\n"
               f"  ADD FILTER PREDICATE sec.[{t}_read]({args}) ON dbo.[{t}],\n"
               f"  ADD BLOCK PREDICATE sec.[{t}_ins]({args}) ON dbo.[{t}] AFTER INSERT,\n"
               f"  ADD BLOCK PREDICATE sec.[{t}_upd_before]({args}) ON dbo.[{t}] BEFORE UPDATE,\n"
               f"  ADD BLOCK PREDICATE sec.[{t}_upd_after]({args}) ON dbo.[{t}] AFTER UPDATE,\n"
               f"  ADD BLOCK PREDICATE sec.[{t}_del]({args}) ON dbo.[{t}] BEFORE DELETE\n"
               f"  WITH (STATE = ON);")

print("\n\n".join(out))
if len(sys.argv) > 2:
    json.dump(PARAMS, open(sys.argv[2], "w", encoding="utf-8"), indent=0)
