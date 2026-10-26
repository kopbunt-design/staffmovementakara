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
from contextlib import closing

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
            r = cur.execute("SELECT TOP 1 user_id, role FROM dbo.user_roles WHERE LOWER(LTRIM(RTRIM(email))) = ?", email).fetchone()
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
    stmts = db.statements((HERE / "schema_full.sql").read_text(encoding="utf-8"))
    errors = []
    with closing(cn):
        cur = cn.cursor()
        for s in stmts:
            try:
                cur.execute(s)
                cn.commit()
            except Exception as e:
                cn.rollback()
                errors.append({"sql": s.splitlines()[0][:160] + (" … " + s.splitlines()[1][:100] if len(s.splitlines()) > 1 else ""), "error": str(e)[:400]})
    return {"ok": not errors, "statements": len(stmts), "errors": errors}


@api.post("/api/admin/reset")
async def admin_reset(request: Request):
    """Drop every table/view in dbo. Azure holds only a copy until the switch-over, so this loses nothing."""
    body = await request.json()
    if body.get("confirm") != "RESET":
        raise HTTPException(400, "confirm with RESET")
    cn, _ = _admin(request)
    with closing(cn):
        cur = cn.cursor()
        for (name,) in cur.execute("SELECT name FROM sys.security_policies").fetchall():
            cur.execute(f"DROP SECURITY POLICY [{name}]")
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
            cur.executemany(sql, [[db.in_value(table, c, r.get(c)) for c in cols] for r in data])
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
