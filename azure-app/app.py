"""
HR System on Azure App Service (akarahr2).

Now
  • serves the existing static site (same files as the Vercel deploy)
  • /api/me, /api/me/access  → who is signed in (Microsoft login via App Service Authentication / "Easy Auth")
  • /api/health              → can the app reach Azure SQL
  • /api/admin/*             → full migration: create all tables (schema_full.sql), copy every table from Supabase,
                               dump for the row-by-row compare, reset

Secrets
  Nothing secret lives in this code or in the repo (IT rule). The SQL password comes from the App Service
  setting AZURE_SQL_PWD, a Key Vault reference to AZURESQLPWD.
"""
from __future__ import annotations

import base64
import json
import os
import re
import urllib.parse
import uuid
from contextlib import closing
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from a2wsgi import ASGIMiddleware

import db
from db import TABLES, HERE

# The static site is copied next to this file at deploy time (see README). Locally it is the repo root.
SITE_DIR = HERE / "site"
if not SITE_DIR.exists():
    SITE_DIR = HERE.resolve().parent

api = FastAPI(title="Akara HR System", docs_url=None, redoc_url=None, openapi_url=None)


def current_user(request: Request) -> dict | None:
    """App Service Authentication puts the signed-in user in X-MS-CLIENT-PRINCIPAL (base64 JSON).
    The header is set by the platform, not the browser — App Service strips any client-sent copy."""
    raw = request.headers.get("x-ms-client-principal")
    if not raw:
        return None
    try:
        p = json.loads(base64.b64decode(raw))
    except Exception:
        return None
    claims = {c.get("typ"): c.get("val") for c in p.get("claims", [])}
    return {
        "name": claims.get("name"),
        "email": claims.get("preferred_username") or request.headers.get("x-ms-client-principal-name"),
        "oid": claims.get("http://schemas.microsoft.com/identity/claims/objectidentifier"),
        "provider": p.get("auth_typ"),
    }


@api.get("/api/me")
def me(request: Request):
    u = current_user(request)
    if not u:
        raise HTTPException(401, "not signed in")
    return u


@api.get("/api/health")
def health(request: Request):
    if not current_user(request):
        raise HTTPException(401, "not signed in")
    missing = [k for k in ("AZURE_SQL_SERVER", "AZURE_SQL_DB", "AZURE_SQL_USER", "AZURE_SQL_PWD") if not os.environ.get(k)]
    if missing:
        return JSONResponse({"ok": False, "error": f"missing app settings: {', '.join(missing)}"}, 500)
    with closing(db.connect()) as cn:
        row = cn.cursor().execute("SELECT 1, @@SERVERNAME, DB_NAME()").fetchone()
    return {"ok": row[0] == 1, "server": row[1], "database": row[2]}


# ---------- who is calling ----------
# Users are the same as in Supabase (user_roles.user_id keeps the old Supabase id, so every created_by / signer id
# in the data still points at the right person). The Microsoft login is matched to user_roles by e-mail.

def _email(request: Request) -> str:
    u = current_user(request)
    if not u or not u.get("email"):
        raise HTTPException(401, "not signed in")
    return u["email"].strip().lower()


def _bootstrap_admins() -> set[str]:
    # Before user_roles is copied, only these addresses may run setup/import (App Service setting, not a secret)
    return {e.strip().lower() for e in os.environ.get("HR_ADMIN_EMAILS", "").split(",") if e.strip()}


def user_access(cn, email: str) -> dict:
    cur = cn.cursor()
    uid = role = None
    if db.table_exists(cn, "user_roles") and "email" in {c["name"] for c in TABLES["user_roles"]["cols"]}:
        try:
            r = None
            if db.table_exists(cn, "ms_accounts"):
                r = cur.execute("""SELECT ur.user_id, ur.role FROM dbo.ms_accounts m JOIN dbo.user_roles ur ON ur.user_id = m.user_id
                                   WHERE m.ms_email = ?""", email).fetchone()
            r = r or cur.execute("SELECT TOP 1 user_id, role FROM dbo.user_roles WHERE LOWER(LTRIM(RTRIM(email))) = ?", email).fetchone()
            if r:
                uid, role = str(r[0]), r[1]
        except Exception:   # step-2 table shape (no user_id) — treat as not found until the reset
            cn.rollback()
    admin = role == "admin" or email in _bootstrap_admins()
    perms = set()
    if role and db.table_exists(cn, "role_permissions"):
        perms = {r[0] for r in cur.execute("SELECT perm_key FROM dbo.role_permissions WHERE role_key = ?", role).fetchall()}
    return {"uid": uid, "role": role or ("admin" if admin else None), "perms": perms, "admin": admin}


def require(request: Request, perm: str | None = None, admin: bool = False):
    email = _email(request)
    cn = db.connect()
    acc = user_access(cn, email)
    if admin and not acc["admin"]:
        cn.close(); raise HTTPException(403, "admin only")
    if perm and not (acc["admin"] or perm in acc["perms"]):
        cn.close(); raise HTTPException(403, f"missing permission {perm}")
    return cn, email, acc


@api.get("/api/me/access")
def my_access(request: Request):
    cn, email, acc = require(request)
    with closing(cn):
        return {"email": email, "uid": acc["uid"], "role": acc["role"], "admin": acc["admin"], "perms": sorted(acc["perms"])}


# ---------- admin: full migration ----------

def _admin(request: Request):
    """Admin connection that bypasses row security (copy/compare must see every row)."""
    cn, email, acc = require(request, admin=True)
    cn.close()
    return db.connect(acc["uid"], bypass=True), email


@api.get("/api/admin/status")
def admin_status(request: Request):
    cn, _ = _admin(request)
    with closing(cn):
        cur = cn.cursor()
        out = {t: (cur.execute(f"SELECT COUNT(*) FROM dbo.[{t}]").fetchone()[0] if db.table_exists(cn, t) else None) for t in TABLES}
        # tables left from step 2 have a different shape and must be reset before the full setup
        old = db.table_exists(cn, "user_roles") and not cur.execute(
            "SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.user_roles') AND name = 'user_id'").fetchone()
    return {"tables": out, "needs_reset": bool(old)}


@api.post("/api/admin/setup")
def admin_setup(request: Request):
    """Run schema_full.sql statement by statement; report every failure instead of stopping at the first."""
    cn, _ = _admin(request)
    # row rules are applied by the app (rest.rule_filter) — the database user may neither create policies nor run functions
    stmts = db.statements((HERE / "schema_full.sql").read_text(encoding="utf-8"))
    errors, skipped = [], 0
    with closing(cn):
        cur = cn.cursor()
        for s in stmts:
            try:
                cur.execute(s)
                cn.commit()
            except Exception as e:
                cn.rollback()
                if "SECURITY POLICY permission denied" in str(e):
                    skipped += 1   # database user can't create policies — the app applies the same rules itself (rest.rule_filter)
                    continue
                errors.append({"sql": s.splitlines()[0][:160] + (" … " + s.splitlines()[1][:100] if len(s.splitlines()) > 1 else ""), "error": str(e)[:400]})
    return {"ok": not errors, "statements": len(stmts), "errors": errors, "app_enforced": skipped}


@api.post("/api/admin/reset")
async def admin_reset(request: Request):
    """Drop every table/view in dbo. Azure holds only a copy until the switch-over, so this loses nothing."""
    body = await request.json()
    if body.get("confirm") != "RESET":
        raise HTTPException(400, "confirm with RESET")
    cn, _ = _admin(request)
    with closing(cn):
        cur = cn.cursor()
        for (sch, name) in cur.execute("SELECT SCHEMA_NAME(schema_id), name FROM sys.security_policies").fetchall():
            cur.execute(f"DROP SECURITY POLICY [{sch}].[{name}]")
        # predicate + helper functions are schema-bound to the tables — drop them before the tables
        for (sch, name) in cur.execute("""SELECT SCHEMA_NAME(schema_id), name FROM sys.objects
                                          WHERE type IN ('IF', 'FN', 'TF') AND SCHEMA_NAME(schema_id) IN ('sec', 'dbo')
                                          ORDER BY CASE SCHEMA_NAME(schema_id) WHEN 'sec' THEN 0 ELSE 1 END,
                                                   CASE name WHEN 'doc_visible' THEN 0 WHEN 'has_perm' THEN 1 WHEN 'user_has_perm' THEN 1
                                                             WHEN 'my_role' THEN 2 ELSE 3 END""").fetchall():
            cur.execute(f"DROP FUNCTION [{sch}].[{name}]")
        for (t, fk) in cur.execute("SELECT OBJECT_NAME(parent_object_id), name FROM sys.foreign_keys").fetchall():
            cur.execute(f"ALTER TABLE dbo.[{t}] DROP CONSTRAINT [{fk}]")
        for (v,) in cur.execute("SELECT name FROM sys.views WHERE schema_id = SCHEMA_ID('dbo')").fetchall():
            cur.execute(f"DROP VIEW dbo.[{v}]")
        dropped = []
        for (t,) in cur.execute("SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo')").fetchall():
            cur.execute(f"DROP TABLE dbo.[{t}]"); dropped.append(t)
        cn.commit()
    return {"ok": True, "dropped": len(dropped)}


@api.post("/api/admin/constraints")
async def admin_constraints(request: Request):
    """Copy runs with keys/checks/triggers switched off (tables arrive in any order); switching back on re-validates
    every row WITH CHECK, so bad data is reported here rather than slipping in."""
    on = (await request.json()).get("enable")
    cn, _ = _admin(request)
    errors = []
    with closing(cn):
        cur = cn.cursor()
        for t in TABLES:
            if not db.table_exists(cn, t):
                continue
            try:
                cur.execute(f"ALTER TABLE dbo.[{t}] {'WITH CHECK CHECK' if on else 'NOCHECK'} CONSTRAINT ALL")
                cur.execute(f"{'ENABLE' if on else 'DISABLE'} TRIGGER ALL ON dbo.[{t}]")
                cn.commit()
            except Exception as e:
                cn.rollback(); errors.append({"table": t, "error": str(e)[:400]})
    return {"ok": not errors, "errors": errors}


@api.post("/api/admin/import/{table}")
async def admin_import(table: str, request: Request):
    """Body: {"rows": [...], "replace": true|false}. replace=true empties the table first (first chunk).
    Only columns that exist in the table are written (names come from tables.json, never from the request)."""
    if table not in TABLES:
        raise HTTPException(404, "unknown table")
    body = await request.json()
    data = body.get("rows") or []
    known = [c["name"] for c in TABLES[table]["cols"]]
    cols = [c for c in known if any(c in r for r in data)]
    ident = TABLES[table]["identity"]
    cn, email = _admin(request)
    with closing(cn):
        cur = cn.cursor()
        if body.get("replace"):
            cur.execute(f"DELETE FROM dbo.[{table}]")
        if data:
            if ident and ident in cols:
                cur.execute(f"SET IDENTITY_INSERT dbo.[{table}] ON")
            sql = f"INSERT INTO dbo.[{table}] ({', '.join(f'[{c}]' for c in cols)}) VALUES ({', '.join('?' for _ in cols)})"
            try:
                cur.executemany(sql, [[db.in_value(table, c, r.get(c)) for c in cols] for r in data])
            finally:   # pooled connection — don't leave IDENTITY_INSERT on
                if ident and ident in cols:
                    cur.execute(f"SET IDENTITY_INSERT dbo.[{table}] OFF")
        cn.commit()
        total = cur.execute(f"SELECT COUNT(*) FROM dbo.[{table}]").fetchone()[0]
    return {"ok": True, "inserted": len(data), "total": total}


@api.get("/api/admin/dump/{table}")
def admin_dump(table: str, request: Request):
    if table not in TABLES:
        raise HTTPException(404, "unknown table")
    cn, _ = _admin(request)
    with closing(cn):
        return [db.decode_row(table, r) for r in db.rows(cn.cursor().execute(f"SELECT * FROM dbo.[{table}]"))]


@api.get("/api/admin/tables")
def admin_tables(request: Request):
    _email(request)
    return {t: {"pk": m["pk"], "identity": m["identity"]} for t, m in TABLES.items()}


# ---------- the site's data access (replaces Supabase) ----------
import rest
import rpc
import mail
import storage
from fastapi.responses import Response


def caller(request: Request, need=True):
    """(uid, email) of the signed-in Microsoft user, creating their user_roles row on first visit
    (role from pending_roles, like the old first-login flow). need=False → (None, None) when not signed in."""
    u = current_user(request)
    if not u or not u.get("email"):
        if need:
            raise HTTPException(401, "not signed in")
        return None, None, None
    email = u["email"].strip().lower()
    with closing(db.connect(None, bypass=True)) as cn:
        cur = cn.cursor()
        _ms_table(cur)
        # 1) Microsoft account linked by an admin to an existing user (their old login was e.g. Gmail)
        r = cur.execute("""SELECT m.user_id FROM dbo.ms_accounts m JOIN dbo.user_roles ur ON ur.user_id = m.user_id
                           WHERE m.ms_email = ?""", email).fetchone()
        if r:
            return str(r[0]), email, u
        # 2) same e-mail as before
        r = cur.execute("SELECT TOP 1 user_id FROM dbo.user_roles WHERE LOWER(LTRIM(RTRIM(email))) = ?", email).fetchone()
        if r:
            return str(r[0]), email, u
        key = re.sub(r"[.#$\[\]]", "_", email)
        p = cur.execute("SELECT [role] FROM dbo.pending_roles WHERE email_key = ?", key).fetchone()
        uid = str(uuid.uuid4())
        cur.execute("INSERT INTO dbo.user_roles (user_id, name, email, [role]) VALUES (?, ?, ?, ?)",
                    uid, u.get("name") or email.split("@")[0], email, p[0] if p else "user")
        if p:
            cur.execute("DELETE FROM dbo.pending_roles WHERE email_key = ?", key)
        cn.commit()
        return uid, email, u


def _ms_table(cur):
    # kept apart from user_roles so re-copying user_roles from Supabase doesn't lose the links
    cur.execute("""IF OBJECT_ID('dbo.ms_accounts') IS NULL
                   CREATE TABLE dbo.ms_accounts (ms_email NVARCHAR(320) NOT NULL PRIMARY KEY, user_id UNIQUEIDENTIFIER NOT NULL,
                                                 linked_by NVARCHAR(320) NULL, linked_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET())""")
    cur.connection.commit()


@api.get("/api/admin/users")
def admin_users(request: Request):
    cn, _ = _admin(request)
    with closing(cn):
        cur = cn.cursor()
        _ms_table(cur)
        users = db.rows(cur.execute("SELECT user_id, name, email, [role], created_at FROM dbo.user_roles ORDER BY name"))
        links = db.rows(cur.execute("SELECT ms_email, user_id FROM dbo.ms_accounts"))
    for x in users:
        x["ms_email"] = next((l["ms_email"] for l in links if l["user_id"] == x["user_id"]), None)
    return users


@api.post("/api/admin/link")
async def admin_link(request: Request):
    """Link a Microsoft e-mail to an existing user (keeps their id, so their role, signature and history follow).
    Removes the empty account that was auto-created when that Microsoft e-mail first signed in."""
    body = await request.json()
    uid, ms = body.get("user_id"), (body.get("ms_email") or "").strip().lower()
    cn, admin_email = _admin(request)
    with closing(cn):
        cur = cn.cursor()
        _ms_table(cur)
        cur.execute("DELETE FROM dbo.ms_accounts WHERE user_id = ? OR ms_email = ?", uid, ms)
        if ms:
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", ms):
                raise HTTPException(400, "อีเมลไม่ถูกต้อง")
            cur.execute("INSERT INTO dbo.ms_accounts (ms_email, user_id, linked_by) VALUES (?, ?, ?)", ms, uid, admin_email)
            # the auto-created placeholder for this Microsoft e-mail (not the linked user) has no history — remove it
            cur.execute("""DELETE FROM dbo.user_roles WHERE LOWER(LTRIM(RTRIM(email))) = ? AND user_id <> ?
                             AND user_id NOT IN (SELECT user_id FROM dbo.letter_signers)""", ms, uid)
        cn.commit()
    return {"ok": True}


@api.get("/api/selftest")
def selftest(request: Request):
    """Runs, as the signed-in user, the same calls the HR app makes when it opens — shows the first error of each."""
    uid, email, _ = caller(request)
    tests = [
        ("user_roles", {"table": "user_roles", "select": "role", "filters": [["user_id", "eq", uid]], "single": "one"}),
        ("app_roles", {"table": "app_roles", "select": "label", "filters": [["key", "eq", "admin"]], "single": "maybe"}),
        ("employees", {"table": "employees", "select": "*", "limit": 3}),
        ("movements", {"table": "movements", "select": "*", "limit": 3}),
        ("master_sections+embed", {"table": "master_sections", "select": "*,master_departments(name)", "limit": 2}),
        ("notifications", {"table": "notifications", "select": "*", "order": [["created_at", False, None]], "limit": 2}),
        ("position_quota", {"table": "position_quota", "select": "*", "limit": 2}),
        ("uniform_balance", {"table": "uniform_balance", "select": "*", "limit": 2}),
    ]
    out = {"uid": uid, "email": email}
    for name, q in tests:
        with closing(db.connect(uid)) as cn:
            r = rest.handle(cn, uid, {"method": "GET", **q})
        d = r["data"]
        out[name] = {"error": r["error"]} if r["error"] else {"ok": True, "rows": (len(d) if isinstance(d, list) else (1 if d else 0)),
                                                              "sample": (d if isinstance(d, dict) else None)}
    with closing(db.connect(uid, bypass=True)) as cn:
        try:
            out["rpc my_permissions"] = {"ok": True, "count": len(rpc.call(cn, uid, "my_permissions", {}))}
        except Exception as e:
            out["rpc my_permissions"] = {"error": str(e)[:300]}
    return out


@api.get("/api/auth/session")
def auth_session(request: Request):
    uid, email, u = caller(request)
    return {"user": {"id": uid, "email": email, "aud": "authenticated",
                     "user_metadata": {"full_name": u.get("name") or email.split("@")[0]},
                     "app_metadata": {"provider": "azuread", "providers": ["azuread"]}}}


@api.post("/api/rest")
async def rest_call(request: Request):
    uid, _, _ = caller(request)
    body = await request.json()
    with closing(db.connect(uid)) as cn:
        return rest.handle(cn, uid, body)


@api.post("/api/rpc/{name}")
async def rpc_call(name: str, request: Request):
    public = name in rpc.PUBLIC
    uid, _, _ = caller(request, need=not public)
    args = await request.json() if (await request.body()) else {}
    with closing(db.connect(uid, bypass=True)) as cn:
        try:
            return {"data": rpc.call(cn, uid, name, args), "error": None}
        except rpc.E as e:
            cn.rollback(); return {"data": None, "error": {"message": str(e), "code": "P0001"}}
        except rest.ApiError as e:
            cn.rollback(); return {"data": None, "error": e.body}
        except TypeError as e:
            cn.rollback(); return {"data": None, "error": {"message": f"bad arguments for {name}: {e}", "code": "PGRST202"}}
        except Exception as e:
            cn.rollback(); return {"data": None, "error": rest.map_sql_error(e)}


@api.post("/api/changes")
async def changes(request: Request):
    """Cheap stand-in for realtime: a signature per table (row count + latest change) and new notifications."""
    uid, _, _ = caller(request)
    body = await request.json()
    out, ins = {}, {}
    with closing(db.connect(uid)) as cn:
        cur = cn.cursor()
        ctx = rest.Ctx(cur, uid)
        for t in body.get("tables") or []:
            if t not in TABLES:
                continue
            cols = {c["name"] for c in TABLES[t]["cols"]}
            stamp = "updated_at" if "updated_at" in cols else ("created_at" if "created_at" in cols else None)
            rf = rest.rule_filter(ctx, t, "read")
            r = cur.execute(f"SELECT COUNT(*), {'MAX([' + stamp + '])' if stamp else 'NULL'} FROM dbo.[{t}]" + (f" WHERE {rf}" if rf else "")).fetchone()
            out[t] = f"{r[0]}|{db.out_value(r[1])}"
            if t == "notifications" and body.get("since"):
                ins[t] = [db.decode_row(t, x) for x in db.rows(cur.execute(
                    "SELECT * FROM dbo.notifications WHERE created_at > ? AND " + (rest.rule_filter(ctx, "notifications", "read") or "1 = 1") + " ORDER BY created_at", body["since"]))]
        now_ = db.out_value(cur.execute("SELECT SYSDATETIMEOFFSET()").fetchone()[0])
    return {"data": {"sigs": out, "inserted": ins, "now": now_}, "error": None}


@api.post("/api/fn/{name}")
async def fn_call(name: str, request: Request):
    body = await request.json() if (await request.body()) else {}
    app_url = str(request.base_url).rstrip("/").replace("http://", "https://")
    if name == "letter-notify":
        uid, email, _ = caller(request, need=False)
        with closing(db.connect(None, bypass=True)) as acn:
            ucn = db.connect(uid) if uid else None
            try:
                return {"data": mail.handle(acn, ucn, uid, email, body, app_url), "error": None}
            except mail.Fail as e:
                return {"data": {"error": str(e)}, "error": {"message": str(e), "status": e.status}}
            finally:
                if ucn:
                    ucn.close()
    uid, email, _ = caller(request)
    with closing(db.connect(uid, bypass=True)) as cn:
        cur = cn.cursor()
        if rest.Ctx(cur, uid).role != "admin":
            return {"data": {"error": "เฉพาะ admin"}, "error": {"message": "เฉพาะ admin"}}
        if name == "admin-create-user":
            em = (body.get("email") or "").strip().lower()
            if not em or "@" not in em:
                return {"data": {"error": "กรุณากรอกอีเมล"}, "error": {"message": "กรุณากรอกอีเมล"}}
            if cur.execute("SELECT COUNT(*) FROM dbo.user_roles WHERE LOWER(email) = ?", em).fetchone()[0]:
                return {"data": {"error": "อีเมลนี้มีในระบบแล้ว"}, "error": {"message": "อีเมลนี้มีในระบบแล้ว"}}
            cur.execute("INSERT INTO dbo.user_roles (user_id, name, email, [role]) VALUES (?, ?, ?, ?)",
                        str(uuid.uuid4()), body.get("name") or em.split("@")[0], em, body.get("role") or "user")
            cn.commit()
            return {"data": {"ok": True, "note": "เข้าด้วยบัญชี Microsoft ของบริษัท — ไม่ต้องใช้รหัสผ่าน"}, "error": None}
        if name == "admin-reset-password":
            msg = "รหัสผ่านจัดการที่บัญชี Microsoft ของบริษัท (ติดต่อ IT)"
            return {"data": {"error": msg}, "error": {"message": msg}}
    raise HTTPException(404, "unknown function")


# ---------- files ----------

def _file_ctx(uid):
    cn = db.connect(uid, bypass=True)
    return cn, rest.Ctx(cn.cursor(), uid)


@api.put("/api/storage/{bucket}/{path:path}")
async def file_put(bucket: str, path: str, request: Request):
    uid, _, _ = caller(request)
    cn, ctx = _file_ctx(uid)
    with closing(cn):
        if not storage.allowed(ctx, cn.cursor(), bucket, path, "write"):
            raise HTTPException(403, "new row violates row-level security policy")
        data = await request.body()
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(413, "ไฟล์ใหญ่เกิน 25 MB")
        try:
            storage.put(bucket, path, data, request.headers.get("content-type") or "application/octet-stream",
                        overwrite=request.query_params.get("upsert") == "1")
        except Exception as e:
            if "BlobAlreadyExists" in str(e):
                raise HTTPException(409, "The resource already exists")
            raise
    return {"path": path}


@api.get("/api/storage/{bucket}/{path:path}")
def file_get(bucket: str, path: str, request: Request):
    uid, _, _ = caller(request)
    cn, ctx = _file_ctx(uid)
    with closing(cn):
        if not storage.allowed(ctx, cn.cursor(), bucket, path, "read"):
            raise HTTPException(403, "ไม่มีสิทธิ์")
    data, ctype = storage.get(bucket, path)
    return Response(data, media_type=ctype, headers={"Cache-Control": "private, no-store"})


@api.post("/api/storage-sign/{bucket}")
async def file_sign(bucket: str, request: Request):
    uid, _, _ = caller(request)
    body = await request.json()
    cn, ctx = _file_ctx(uid)
    with closing(cn):
        if not storage.allowed(ctx, cn.cursor(), bucket, body.get("path") or "", "read"):
            return {"data": None, "error": {"message": "ไม่มีสิทธิ์"}}
        return {"data": {"url": storage.sign_url(cn.cursor(), bucket, body["path"], download=body.get("download"))}, "error": None}


@api.post("/api/storage-remove/{bucket}")
async def file_remove(bucket: str, request: Request):
    uid, _, _ = caller(request)
    body = await request.json()
    cn, ctx = _file_ctx(uid)
    out = []
    with closing(cn):
        for p in body.get("paths") or []:
            if storage.allowed(ctx, cn.cursor(), bucket, p, "delete") and storage.remove(bucket, p):
                out.append({"name": p})
    return {"data": out, "error": None}


@api.get("/api/file")
def file_signed(request: Request, b: str, p: str, e: int, s: str, d: Optional[str] = None):
    """Temporary link (no login) made by sign_url — used by the approval pages and <img> tags."""
    with closing(db.connect(None, bypass=True)) as cn:
        if not storage.check_signed(cn.cursor(), b, p, e, s):
            raise HTTPException(403, "ลิงก์ไฟล์หมดอายุ")
    data, ctype = storage.get(b, p)
    headers = {"Cache-Control": "private, max-age=600"}
    if d:
        headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + urllib.parse.quote(d)
    return Response(data, media_type=ctype, headers=headers)


@api.put("/api/admin/blob/{bucket}/{path:path}")
async def admin_blob(bucket: str, path: str, request: Request):
    """Migration: copy one file from Supabase Storage (the page downloads it with the user's session)."""
    _admin(request)[0].close()
    storage.put(bucket, path, await request.body(), request.headers.get("content-type") or "application/octet-stream", overwrite=True)
    return {"ok": True}


@api.exception_handler(Exception)
async def sql_errors(request: Request, exc: Exception):
    # Show the database's message instead of a bare 500. pyodbc messages never contain the password.
    return JSONResponse({"detail": f"{type(exc).__name__}: {str(exc)[:400]}"}, 500)


# ---------- static site (same files as the Vercel deploy) ----------
api.mount("/", StaticFiles(directory=SITE_DIR, html=True), name="site")


@api.exception_handler(404)
async def spa_fallback(request: Request, exc):
    # Same idea as vercel.json: unknown paths go to the app's index.html (sub-apps have their own)
    path = request.url.path
    if path.startswith("/api/"):
        return JSONResponse({"detail": getattr(exc, "detail", "not found")}, 404)
    for sub in ("expense", "uniform", "contract", "sub", "docs"):
        if path == f"/{sub}" or path.startswith(f"/{sub}/"):
            return FileResponse(SITE_DIR / sub / "index.html")
    return FileResponse(SITE_DIR / "index.html")


# App Service (Python) starts `gunicorn app:app` by itself when app.py exists, with plain WSGI workers —
# wrapping the ASGI app means no custom Startup Command is needed.
app = ASGIMiddleware(api)
