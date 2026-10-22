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
import base64
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# The static site is copied next to this file at deploy time (see README). Locally it is the repo root.
SITE_DIR = Path(os.environ.get("SITE_DIR") or (Path(__file__).parent / "site"))
if not SITE_DIR.exists():
    SITE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="Akara HR System", docs_url=None, redoc_url=None, openapi_url=None)


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


@app.get("/api/me")
def me(request: Request):
    u = current_user(request)
    if not u:
        raise HTTPException(401, "not signed in")
    return u


def sql_connect():
    import pyodbc  # imported lazily so the site still serves if the driver is missing

    server = os.environ["AZURE_SQL_SERVER"]
    if not server.endswith(".database.windows.net"):
        server += ".database.windows.net"
    return pyodbc.connect(
        "Driver={ODBC Driver 18 for SQL Server};"
        f"Server=tcp:{server},1433;Database={os.environ['AZURE_SQL_DB']};"
        f"Uid={os.environ['AZURE_SQL_USER']};Pwd={os.environ['AZURE_SQL_PWD']};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=15;",
        timeout=15,
    )


@app.get("/api/health")
def health(request: Request):
    if not current_user(request):
        raise HTTPException(401, "not signed in")
    missing = [k for k in ("AZURE_SQL_SERVER", "AZURE_SQL_DB", "AZURE_SQL_USER", "AZURE_SQL_PWD") if not os.environ.get(k)]
    if missing:
        return JSONResponse({"ok": False, "error": f"missing app settings: {', '.join(missing)}"}, 500)
    try:
        with sql_connect() as cn:
            row = cn.cursor().execute("SELECT 1, @@SERVERNAME, DB_NAME()").fetchone()
        return {"ok": row[0] == 1, "server": row[1], "database": row[2]}
    except Exception as e:  # never echo the connection string
        return JSONResponse({"ok": False, "error": type(e).__name__, "detail": str(e)[:300]}, 500)


# ---------- static site (same files as the Vercel deploy) ----------
app.mount("/", StaticFiles(directory=SITE_DIR, html=True), name="site")


@app.exception_handler(404)
async def spa_fallback(request: Request, exc):
    # Same idea as vercel.json: unknown paths go to the app's index.html (sub-apps have their own)
    path = request.url.path
    if path.startswith("/api/"):
        return JSONResponse({"detail": "not found"}, 404)
    for sub in ("expense", "uniform", "contract", "sub", "docs"):
        if path == f"/{sub}" or path.startswith(f"/{sub}/"):
            return FileResponse(SITE_DIR / sub / "index.html")
    return FileResponse(SITE_DIR / "index.html")
