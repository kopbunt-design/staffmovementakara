"""
HR System (Staff Movement) on Azure App Service — step 1: prove the path works.

What this does now
  • serves the existing static site (index.html, js/, css/, expense/ ...) unchanged
  • /api/me      → who is logged in (Microsoft login via App Service Authentication / "Easy Auth")
  • /api/health  → can the app reach Azure SQL (akarahr2)? runs SELECT 1, returns server/db name

Secrets
  Nothing secret lives in this code or in the repo (IT rule). The SQL password comes from the
  App Service setting AZURE_SQL_PWD, which is a Key Vault reference to the secret AZURESQLPWD.
  The other settings (AZURE_SQL_SERVER / AZURE_SQL_DB / AZURE_SQL_USER) are plain app settings set by IT.

Later steps add the real API (employees, movements, payroll …) behind the same login + permission check.
"""
from __future__ import annotations

import base64
import json
import os
import struct
from contextlib import closing
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from a2wsgi import ASGIMiddleware

# The static site is copied next to this file at deploy time (see README). Locally it is the repo root.
SITE_DIR = Path(os.environ.get("SITE_DIR") or (Path(__file__).parent / "site"))
if not SITE_DIR.exists():
    SITE_DIR = Path(__file__).resolve().parent.parent

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


def _dto(raw: bytes):
    # pyodbc can't read DATETIMEOFFSET (ODBC type -155) by itself — unpack the driver's struct
    from datetime import datetime, timedelta, timezone
    y, mo, d, h, mi, s, ns, tzh, tzm = struct.unpack("<6hI2h", raw)
    return datetime(y, mo, d, h, mi, s, ns // 1000, tzinfo=timezone(timedelta(hours=tzh, minutes=tzm)))


def sql_connect():
    import pyodbc  # imported lazily so the site still serves if the driver is missing

    pyodbc.native_uuid = True  # UNIQUEIDENTIFIER as uuid.UUID → lower-case text like Supabase (default is upper-case)

    server = os.environ["AZURE_SQL_SERVER"]
    if not server.endswith(".database.windows.net"):
        server += ".database.windows.net"
    cn = pyodbc.connect(
        "Driver={ODBC Driver 18 for SQL Server};"
        f"Server=tcp:{server},1433;Database={os.environ['AZURE_SQL_DB']};"
        f"Uid={os.environ['AZURE_SQL_USER']};Pwd={os.environ['AZURE_SQL_PWD']};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=15;",
        timeout=15,
    )
    cn.add_output_converter(-155, _dto)
    return cn


@api.get("/api/health")
def health(request: Request):
    if not current_user(request):
        raise HTTPException(401, "not signed in")
    missing = [k for k in ("AZURE_SQL_SERVER", "AZURE_SQL_DB", "AZURE_SQL_USER", "AZURE_SQL_PWD") if not os.environ.get(k)]
    if missing:
        return JSONResponse({"ok": False, "error": f"missing app settings: {', '.join(missing)}"}, 500)
    try:
        with closing(sql_connect()) as cn:
            row = cn.cursor().execute("SELECT 1, @@SERVERNAME, DB_NAME()").fetchone()
        return {"ok": row[0] == 1, "server": row[1], "database": row[2]}
    except Exception as e:  # never echo the connection string
        return JSONResponse({"ok": False, "error": type(e).__name__, "detail": str(e)[:300]}, 500)


# =========================== step 2: users / permissions / employees / movements ===========================
# Same permission model as Supabase (user_roles → role_permissions, 'admin' passes everything),
# but the user is the Microsoft login e-mail. Salary is removed from employee rows unless the user has
# field.salary.read — stricter than the old setup, where salary was only hidden in the page.

def _email(request: Request) -> str:
    u = current_user(request)
    if not u or not u.get("email"):
        raise HTTPException(401, "not signed in")
    return u["email"].strip().lower()


def _rows(cur) -> list[dict]:
    cols = [c[0] for c in cur.description]
    out = []
    for r in cur.fetchall():
        d = {}
        for k, v in zip(cols, r):
            if hasattr(v, "isoformat"):
                v = v.isoformat()
            elif v is not None and type(v).__name__ == "Decimal":
                v = float(v)
            elif v is not None and type(v).__name__ == "UUID":
                v = str(v)
            d[k] = v
        out.append(d)
    return out


def _bootstrap_admins() -> set[str]:
    # Before user_roles is imported, only these addresses may run setup/import (App Service setting, not a secret)
    return {e.strip().lower() for e in os.environ.get("HR_ADMIN_EMAILS", "").split(",") if e.strip()}


def user_access(cn, email: str) -> dict:
    """{'role': ..., 'perms': set, 'admin': bool} for this e-mail."""
    cur = cn.cursor()
    role = None
    if _table_exists(cn, "user_roles"):
        r = cur.execute("SELECT role FROM dbo.user_roles WHERE email = ?", email).fetchone()
        role = r[0] if r else None
    admin = role == "admin" or email in _bootstrap_admins()
    perms = set()
    if role and _table_exists(cn, "role_permissions"):
        perms = {r[0] for r in cur.execute("SELECT perm_key FROM dbo.role_permissions WHERE role_key = ?", role).fetchall()}
    return {"role": role or ("admin" if admin else None), "perms": perms, "admin": admin}


def _table_exists(cn, name: str) -> bool:
    return cn.cursor().execute("SELECT OBJECT_ID(?)", f"dbo.{name}").fetchone()[0] is not None


def require(request: Request, perm: str | None = None, admin: bool = False):
    email = _email(request)
    cn = sql_connect()
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
        return {"email": email, "role": acc["role"], "admin": acc["admin"], "perms": sorted(acc["perms"])}


@api.get("/api/employees")
def list_employees(request: Request):
    cn, _, acc = require(request, "data.employee.read")
    with closing(cn):
        rows = _rows(cn.cursor().execute("SELECT * FROM dbo.employees ORDER BY emp_code"))
    if not (acc["admin"] or "field.salary.read" in acc["perms"]):
        for r in rows:
            r.pop("salary", None)
    return rows


@api.get("/api/movements")
def list_movements(request: Request):
    cn, _, acc = require(request, "data.movement.read")
    with closing(cn):
        rows = _rows(cn.cursor().execute("SELECT * FROM dbo.movements ORDER BY date DESC, created_at DESC"))
    see_salary = acc["admin"] or "field.salary.read" in acc["perms"]
    for r in rows:
        for k in ("org_from", "org_to"):
            if r.get(k):
                try: r[k] = json.loads(r[k])
                except Exception: pass
        if not see_salary:
            r.pop("salary", None)
    return rows


# ---------- admin: create tables, copy data from Supabase ----------
# Columns accepted per table — anything else in the posted rows is ignored (no dynamic SQL from input)
IMPORT_COLS = {
    "app_roles": ["key", "label", "description", "is_system", "sort_order", "created_at"],
    "permissions": ["key", "category", "label", "description", "sort_order"],
    "role_permissions": ["role_key", "perm_key"],
    "user_roles": ["email", "name", "role", "supabase_user_id", "created_at"],
    "employees": ["emp_code", "status", "firstname_th", "lastname_th", "firstname_en", "lastname_en", "gender",
                  "nationality", "dob", "phone", "division", "department", "section", "team", "position",
                  "job_level", "site", "contract_type", "join_date", "effective_date", "end_date", "salary",
                  "remark", "manager_code", "dotted_manager_code", "shift_allowance_override", "created_at", "updated_at"],
    "movements": ["id", "emp_code", "name", "type", "date", "from_dept", "to_dept", "reason", "salary", "cost_center",
                  "recorded_by", "created_by", "job_level", "org_from", "org_to", "attachment_name", "attachment_path",
                  "sep_confirmed_at", "sep_confirmed_by", "created_at", "updated_at"],
}


@api.post("/api/admin/setup")
def admin_setup(request: Request):
    cn, email, _ = require(request, admin=True)
    sql = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    # schema.sql = independent statements separated by blank lines; comments stripped
    stmts = [s.strip() for s in "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--")).split("\n\n") if s.strip()]
    with closing(cn):
        cur = cn.cursor()
        for s in stmts:
            cur.execute(s)
        cn.commit()
        tables = {t: cn.cursor().execute(f"SELECT COUNT(*) FROM dbo.{t}").fetchone()[0] for t in IMPORT_COLS}
    return {"ok": True, "statements": len(stmts), "tables": tables}


@api.get("/api/admin/status")
def admin_status(request: Request):
    cn, email, _ = require(request, admin=True)
    with closing(cn):
        out = {}
        for t in IMPORT_COLS:
            out[t] = cn.cursor().execute(f"SELECT COUNT(*) FROM dbo.{t}").fetchone()[0] if _table_exists(cn, t) else None
        log = _rows(cn.cursor().execute("SELECT TOP 20 * FROM dbo.migration_log ORDER BY id DESC")) if _table_exists(cn, "migration_log") else []
    return {"tables": out, "log": log}


@api.post("/api/admin/import/{table}")
async def admin_import(table: str, request: Request):
    """Body: {"rows": [...], "replace": true|false}. replace=true empties the table first (first chunk)."""
    if table not in IMPORT_COLS:
        raise HTTPException(404, "unknown table")
    cn, email, _ = require(request, admin=True)
    body = await request.json()
    rows = body.get("rows") or []
    cols = IMPORT_COLS[table]
    def val(r, c):
        v = r.get(c)
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        if isinstance(v, bool):
            return 1 if v else 0
        if v == "":
            return None
        return v
    qcols = ", ".join(f"[{c}]" for c in cols)
    ph = ", ".join("?" for _ in cols)
    with closing(cn):
        cur = cn.cursor()
        if body.get("replace"):
            cur.execute(f"DELETE FROM dbo.{table}")
        if rows:
            cur.executemany(f"INSERT INTO dbo.{table} ({qcols}) VALUES ({ph})", [[val(r, c) for c in cols] for r in rows])
        cur.execute("INSERT INTO dbo.migration_log (table_name, row_count, imported_by) VALUES (?, ?, ?)", table, len(rows), email)
        cn.commit()
        total = cur.execute(f"SELECT COUNT(*) FROM dbo.{table}").fetchone()[0]
    return {"ok": True, "inserted": len(rows), "total": total}


@api.exception_handler(Exception)
async def sql_errors(request: Request, exc: Exception):
    # Show the database's message (e.g. missing CREATE TABLE permission) instead of a bare 500.
    # pyodbc messages never contain the password; the connection string is not echoed.
    return JSONResponse({"detail": f"{type(exc).__name__}: {str(exc)[:400]}"}, 500)


# ---------- static site (same files as the Vercel deploy) ----------
api.mount("/", StaticFiles(directory=SITE_DIR, html=True), name="site")


@api.exception_handler(404)
async def spa_fallback(request: Request, exc):
    # Same idea as vercel.json: unknown paths go to the app's index.html (sub-apps have their own)
    path = request.url.path
    if path.startswith("/api/"):
        return JSONResponse({"detail": "not found"}, 404)
    for sub in ("expense", "uniform", "contract", "sub", "docs"):
        if path == f"/{sub}" or path.startswith(f"/{sub}/"):
            return FileResponse(SITE_DIR / sub / "index.html")
    return FileResponse(SITE_DIR / "index.html")


# App Service (Python) starts `gunicorn app:app` by itself when app.py exists, with plain WSGI workers —
# wrapping the ASGI app means no custom Startup Command is needed.
app = ASGIMiddleware(api)
