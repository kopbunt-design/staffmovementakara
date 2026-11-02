"""
Request guard — per-IP limits, bans and a security log (user 2026-11-02: another of the company's Azure apps was
brute-forced from Hong Kong / Cameroon: curl / python scripts trying hundreds of codes, ~700 IPs on the default
*.azurewebsites.net host).

This app has no passwords of its own (login = Microsoft) and every link token is 64 random hex characters, so
guessing can't succeed — the guard is there so that a flood is cut off early, costs no database work, and is
written down where HR/IT can see it.

  • only requests WITHOUT a Microsoft login are counted or banned — everyone in the office shares one public IP,
    and a signed-in page that keeps polling must never get that IP banned. OFFICE and App Setting ALLOW_IPS
    (comma list) are never limited or banned.
  • signed-in visits  → security_logins (who, which IP, first/last time per day); first-ever login of an account
                       and accounts outside the company domain also go to security_events
  • blocked IPs      → 403 on every path. Sources: BLOCK_SEED below, App Service setting BLOCK_IPS (comma list),
                       table security_ip_block (auto-bans + admin blocks; re-read every 60 s by each worker)
  • any path per IP   → 300 requests / minute without a login, then 429
  • no-login /api/*   → 30 refused (401/403) or public calls that fail (wrong / expired link, wrong fund code)
                       within 15 minutes → banned for 1 hour
  • public calls      → 30 / minute per IP (approval links, fund form), then 429

Counters live in memory per worker (gunicorn runs 2), so a limit can stretch to ~2× before it bites; bans are
written to the table, so every worker enforces them within a minute. Events go to security_events, at most one
row per IP and kind per minute, so a flood can't flood the database too.
"""
from __future__ import annotations

import ipaddress
import os
import threading
import time
from collections import defaultdict, deque

import db

# IPs another company system saw attacking on 31 Oct – 1 Nov 2026 (shared by IT)
BLOCK_SEED = {"202.61.72.13", "191.223.44.53", "102.244.78.57"}
OFFICE = {"110.49.4.228"}                     # head-office internet (2026-11-02) — never banned, labelled in the log
_env = lambda k: {x.strip() for x in (os.environ.get(k) or "").split(",") if x.strip()}
BLOCK_ENV, ALLOW = _env("BLOCK_IPS"), _env("ALLOW_IPS") | OFFICE
COMPANY_DOMAIN = "@akararesources.com"
LOGIN_EVERY = 10 * 60                         # a signed-in user+IP is written at most every 10 minutes

API_PER_MIN = 300
PUBLIC_PER_MIN = 30
FAIL_LIMIT, FAIL_WINDOW = 30, 15 * 60
BAN_SECONDS = 60 * 60
CACHE_SECONDS = 60

_lock = threading.Lock()
_hits: dict[tuple[str, str], deque] = defaultdict(deque)   # (ip, bucket) → timestamps
_logged: dict[tuple[str, str], float] = {}                  # (ip, kind) → last time written
_seen: dict[tuple[str, str], float] = {}                    # (email, ip) → last login row written
_blocks: dict[str, float] = {}                              # ip → until (epoch); 0 = permanent
_loaded = 0.0
_tables_ok = False


def client_ip(request) -> str:
    """App Service's front end appends the real client to X-Forwarded-For ("1.2.3.4:5678"); anything before it
    was sent by the client and can be forged, so take the last entry."""
    xff = request.headers.get("x-forwarded-for") or ""
    ip = xff.split(",")[-1].strip() if xff else (request.client.host if request.client else "")
    if ip.startswith("["):                       # [ipv6]:port
        ip = ip[1:ip.find("]")] if "]" in ip else ip
    elif ip.count(":") == 1:                     # ipv4:port
        ip = ip.split(":")[0]
    try:
        return str(ipaddress.ip_address(ip))
    except ValueError:
        return ip[:64]


def _tables(cur):
    global _tables_ok
    if _tables_ok:
        return
    cur.execute("""IF OBJECT_ID('dbo.security_events') IS NULL
                   CREATE TABLE dbo.security_events (id BIGINT IDENTITY PRIMARY KEY, at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
                     ip NVARCHAR(64) NOT NULL, kind NVARCHAR(40) NOT NULL, path NVARCHAR(300) NULL, detail NVARCHAR(500) NULL,
                     user_agent NVARCHAR(300) NULL)""")
    cur.execute("""IF OBJECT_ID('dbo.security_ip_block') IS NULL
                   CREATE TABLE dbo.security_ip_block (ip NVARCHAR(64) NOT NULL PRIMARY KEY, reason NVARCHAR(300) NULL,
                     until DATETIMEOFFSET NULL, created_by NVARCHAR(320) NULL, created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET())""")
    cur.execute("""IF OBJECT_ID('dbo.security_logins') IS NULL
                   CREATE TABLE dbo.security_logins (day DATE NOT NULL, email NVARCHAR(320) NOT NULL, ip NVARCHAR(64) NOT NULL,
                     name NVARCHAR(200) NULL, user_agent NVARCHAR(300) NULL, first_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
                     last_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(), PRIMARY KEY (day, email, ip))""")
    _tables_ok = True


def _db(fn):
    """Run fn(cur) on its own connection and commit; the guard must never break a request."""
    try:
        cn = db.connect(None, bypass=True)
        try:
            cur = cn.cursor()
            _tables(cur)
            out = fn(cur)
            cn.commit()
            return out
        finally:
            cn.close()
    except Exception:
        return None


def _reload():
    global _loaded
    now = time.time()
    if now - _loaded < CACHE_SECONDS:
        return
    _loaded = now
    rows = _db(lambda cur: cur.execute(
        "SELECT ip, DATEDIFF_BIG(second, '1970-01-01', until) FROM dbo.security_ip_block WHERE until IS NULL OR until > SYSDATETIMEOFFSET()").fetchall())
    if rows is None:
        return
    fresh = {}
    for ip, until in rows:
        fresh[ip] = float(until or 0)
    with _lock:
        _blocks.clear(); _blocks.update(fresh)


def blocked(ip: str) -> bool:
    if ip in ALLOW:
        return False
    if ip in BLOCK_SEED or ip in BLOCK_ENV:
        return True
    _reload()
    with _lock:
        until = _blocks.get(ip)
    return until is not None and (until == 0 or until > time.time())


def _count(ip: str, bucket: str, window: float) -> int:
    now = time.time()
    with _lock:
        q = _hits[(ip, bucket)]
        q.append(now)
        while q and q[0] < now - window:
            q.popleft()
        if len(_hits) > 50000:                   # keep memory bounded under a wide spray of IPs
            for k in [k for k, v in _hits.items() if not v or v[-1] < now - FAIL_WINDOW]:
                del _hits[k]
        return len(q)


def log(ip: str, kind: str, request=None, detail: str = ""):
    now = time.time()
    with _lock:
        if now - _logged.get((ip, kind), 0) < 60:
            return
        _logged[(ip, kind)] = now
    path = request.url.path[:300] if request is not None else None
    ua = (request.headers.get("user-agent") or "")[:300] if request is not None else None
    _db(lambda cur: cur.execute("INSERT INTO dbo.security_events (ip, kind, path, detail, user_agent) VALUES (?, ?, ?, ?, ?)",
                                ip, kind, path, detail[:500], ua))


def ban(ip: str, reason: str, request=None, seconds: int = BAN_SECONDS):
    with _lock:
        _blocks[ip] = time.time() + seconds
    _db(lambda cur: cur.execute("""MERGE dbo.security_ip_block AS t USING (SELECT ? AS ip) AS s ON t.ip = s.ip
                                   WHEN MATCHED AND t.until IS NOT NULL THEN UPDATE SET until = DATEADD(second, ?, SYSDATETIMEOFFSET()), reason = ?
                                   WHEN NOT MATCHED THEN INSERT (ip, reason, until, created_by) VALUES (?, ?, DATEADD(second, ?, SYSDATETIMEOFFSET()), N'guard');""",
                                ip, seconds, reason, ip, reason, seconds))
    log(ip, "ban", request, reason)


def signed_in(request) -> bool:
    # set by App Service Authentication only (it strips a client-sent copy)
    return bool(request.headers.get("x-ms-client-principal"))


def seen(request, user: dict | None):
    """Who signed in, from where: one row per day + account + IP (Bangkok day), refreshed at most every
    10 minutes. An account outside the company domain is also written as an event so it stands out."""
    email = ((user or {}).get("email") or "").strip().lower()
    if not email:
        return
    ip, now = client_ip(request), time.time()
    with _lock:
        if now - _seen.get((email, ip), 0) < LOGIN_EVERY:
            return
        _seen[(email, ip)] = now
        if len(_seen) > 20000:
            _seen.clear()
    ua = (request.headers.get("user-agent") or "")[:300]
    _db(lambda cur: cur.execute("""DECLARE @d DATE = CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+07:00') AS DATE);
        MERGE dbo.security_logins AS t USING (SELECT @d AS day, ? AS email, ? AS ip) AS s
          ON t.day = s.day AND t.email = s.email AND t.ip = s.ip
        WHEN MATCHED THEN UPDATE SET last_at = SYSDATETIMEOFFSET(), user_agent = ?, name = ?
        WHEN NOT MATCHED THEN INSERT (day, email, ip, name, user_agent) VALUES (@d, ?, ?, ?, ?);""",
        email, ip, ua, (user.get("name") or "")[:200], email, ip, (user.get("name") or "")[:200], ua))
    if not email.endswith(COMPANY_DOMAIN):
        log(ip, "foreign_account", request, email)


def check(request) -> tuple[int, str] | None:
    """Before the request: (status, message) to refuse it, or None to let it through."""
    ip = client_ip(request)
    if blocked(ip):
        log(ip, "blocked", request)
        return 403, "blocked"
    if ip not in ALLOW and not signed_in(request) and _count(ip, "any", 60) > API_PER_MIN:
        log(ip, "rate", request, f">{API_PER_MIN}/min")
        return 429, "too many requests"
    return None


def public_call(request) -> tuple[int, str] | None:
    ip = client_ip(request)
    if ip in ALLOW or signed_in(request):
        return None
    if _count(ip, "public", 60) > PUBLIC_PER_MIN:
        log(ip, "rate_public", request, f">{PUBLIC_PER_MIN}/min")
        return 429, "too many requests"
    return None


def failed(request, kind: str, detail: str = ""):
    """A refused or failed call without a login. Too many → ban."""
    ip = client_ip(request)
    if ip in ALLOW or signed_in(request):
        return
    log(ip, kind, request, detail)
    if _count(ip, "fail", FAIL_WINDOW) >= FAIL_LIMIT:
        ban(ip, f"{FAIL_LIMIT} failed calls in {FAIL_WINDOW // 60} min (last: {kind})", request)


# ---- admin view / manual blocks
def overview(days: int = 7):
    def q(cur):
        ev = cur.execute("""SELECT TOP 500 at, ip, kind, path, detail, user_agent FROM dbo.security_events
                            WHERE at > DATEADD(day, ?, SYSDATETIMEOFFSET()) ORDER BY at DESC""", -days).fetchall()
        top = cur.execute("""SELECT TOP 50 e.ip, COUNT(*) n, MIN(e.at), MAX(e.at),
                               (SELECT STRING_AGG(k.kind, ',') FROM (SELECT DISTINCT kind FROM dbo.security_events
                                  WHERE ip = e.ip AND at > DATEADD(day, ?, SYSDATETIMEOFFSET())) k),
                               (SELECT TOP 1 user_agent FROM dbo.security_events WHERE ip = e.ip ORDER BY at DESC)
                             FROM dbo.security_events e WHERE e.at > DATEADD(day, ?, SYSDATETIMEOFFSET())
                             GROUP BY e.ip ORDER BY COUNT(*) DESC""", -days, -days).fetchall()
        bl = cur.execute("SELECT ip, reason, until, created_by, created_at FROM dbo.security_ip_block ORDER BY created_at DESC").fetchall()
        lg = cur.execute("""SELECT TOP 1000 day, email, ip, name, user_agent, first_at, last_at FROM dbo.security_logins
                            WHERE day > DATEADD(day, ?, CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+07:00') AS DATE))
                            ORDER BY last_at DESC""", -days).fetchall()
        return ev, top, bl, lg
    r = _db(q)
    if r is None:
        return {"error": "security tables unavailable"}
    out = lambda v: db.out_value(v)
    ev, top, bl, lg = r
    return {"seed": sorted(BLOCK_SEED | BLOCK_ENV), "allow": sorted(ALLOW), "office": sorted(OFFICE),
            "events": [dict(at=out(a), ip=i, kind=k, path=p, detail=d, user_agent=u) for a, i, k, p, d, u in ev],
            "top_ips": [dict(ip=i, events=n, first=out(f), last=out(l), kinds=sorted(set((ks or "").split(","))), user_agent=u)
                        for i, n, f, l, ks, u in top],
            "logins": [dict(day=out(d), email=e, ip=i, name=n, user_agent=u, first=out(f), last=out(l)) for d, e, i, n, u, f, l in lg],
            "blocks": [dict(ip=i, reason=r_, until=out(u), created_by=c, created_at=out(t)) for i, r_, u, c, t in bl]}


def set_block(ip: str, on: bool, who: str, reason: str = "", hours: float | None = None):
    ip = str(ipaddress.ip_address(ip.strip()))
    if on:
        _db(lambda cur: cur.execute("""MERGE dbo.security_ip_block AS t USING (SELECT ? AS ip) AS s ON t.ip = s.ip
                                       WHEN MATCHED THEN UPDATE SET until = ?, reason = ?, created_by = ?
                                       WHEN NOT MATCHED THEN INSERT (ip, reason, until, created_by) VALUES (?, ?, ?, ?);""",
                                    ip, None if not hours else _until(hours), reason, who, ip, reason, None if not hours else _until(hours), who))
    else:
        _db(lambda cur: cur.execute("DELETE FROM dbo.security_ip_block WHERE ip = ?", ip))
    global _loaded
    _loaded = 0.0
    return ip


def _until(hours: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + hours * 3600))
