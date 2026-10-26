"""
Azure SQL access shared by every endpoint.

Secrets: the connection comes only from App Service settings (AZURE_SQL_PWD is a Key Vault reference) — nothing in code.
Session context: each request's connection carries the caller's user id (`uid`) so row security, defaults like
created_by and triggers can see who is acting — the Azure equivalent of Supabase's auth.uid().
"""
from __future__ import annotations

import json
import os
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).parent
TABLES: dict = json.loads((HERE / "tables.json").read_text(encoding="utf-8"))   # from tools/gen_schema.py


def _dto(raw: bytes):
    # pyodbc can't read DATETIMEOFFSET (ODBC type -155) by itself — unpack the driver's struct
    y, mo, d, h, mi, s, ns, tzh, tzm = struct.unpack("<6hI2h", raw)
    return datetime(y, mo, d, h, mi, s, ns // 1000, tzinfo=timezone(timedelta(hours=tzh, minutes=tzm)))


def connect(uid: str | None = None, bypass: bool = False):
    import pyodbc  # imported lazily so the site still serves if the driver is missing

    pyodbc.native_uuid = True  # UNIQUEIDENTIFIER as uuid.UUID → lower-case text like Supabase (default is upper-case)
    server = os.environ["AZURE_SQL_SERVER"]
    if not server.endswith(".database.windows.net"):
        server += ".database.windows.net"
    cn = pyodbc.connect(
        "Driver={ODBC Driver 18 for SQL Server};"
        f"Server=tcp:{server},1433;Database={os.environ['AZURE_SQL_DB']};"
        f"Uid={os.environ['AZURE_SQL_USER']};Pwd={os.environ['AZURE_SQL_PWD']};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;",
        timeout=30, autocommit=False,
    )
    cn.add_output_converter(-155, _dto)
    cur = cn.cursor()
    cur.execute("EXEC sp_set_session_context N'uid', ?", uid)
    cur.execute("EXEC sp_set_session_context N'bypass', ?", 1 if bypass else 0)
    return cn


def rows(cur) -> list[dict]:
    if not cur.description:
        return []
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, map(out_value, r))) for r in cur.fetchall()]


def out_value(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if hasattr(v, "isoformat"):            # date
        return v.isoformat()
    n = type(v).__name__
    if n == "Decimal":
        f = float(v)
        return int(f) if f.is_integer() else f
    if n == "UUID":
        return str(v)
    return v


def decode_row(table: str, r: dict) -> dict:
    """JSON / array columns are stored as text — give them back as objects like Supabase did; bits as booleans."""
    meta = TABLES.get(table)
    if not meta:
        return r
    for c in meta["cols"]:
        k, u = c["name"], c["udt"]
        if k not in r or r[k] is None:
            continue
        if u in ("jsonb", "_text") and isinstance(r[k], str):
            try:
                r[k] = json.loads(r[k])
            except ValueError:
                pass
        elif u == "bool":
            r[k] = bool(r[k])
    return r


def in_value(table: str, col: str, v):
    """A value from the browser → what pyodbc should send for that column."""
    if v is None:
        return None
    udt = next((c["udt"] for c in TABLES[table]["cols"] if c["name"] == col), None)
    if udt in ("jsonb", "_text"):
        return json.dumps(v, ensure_ascii=False)
    if udt == "bool":
        return 1 if v else 0
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


def table_exists(cn, name: str) -> bool:
    return cn.cursor().execute("SELECT OBJECT_ID(?)", f"dbo.{name}").fetchone()[0] is not None


def statements(sql: str) -> list[str]:
    """Statement files are blank-line separated; full-line comments dropped."""
    body = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
    return [s.strip() for s in body.split("\n\n") if s.strip()]
