"""
Akara Canteen — ค่าอาหารโรงอาหารคิดเป็นหัว · ใบแจ้งยอดร้านค้ารายวันส่งสหกรณ์ (/canteen) · user 2026-11-26
กติกา/อ่านไฟล์อยู่ใน js/canteen-calc.js (เทส test/canteen.test.js) — ไฟล์นี้เก็บข้อมูล ตรวจสิทธิ์ ออกเลข ลงนาม ส่งเมล

หน่วย (unit) = ใบแจ้งยอด 1 ใบต่อวัน: A1 Canteen 1 (CTS1…) · A2 Canteen 2 (CTS2…) · CN Chatree North (กล่อง N1+N2 ใบเดียว)
ตาราง Azure-only สร้างเองตอนใช้ครั้งแรก ไม่เปิด REST:
  cn_meals    คนที่ทานต่อวันต่อกล่อง: จากไฟล์สแกน (src scan) หรือ HR คีย์จากใบลงชื่อ (src sheet: ลืมบัตร/ผู้ติดต่อ/รับแทนกลุ่ม)
              billed = อิ่มที่เรียกเก็บ · แตะซ้ำ (AKR/SUB scans > 1) = billed 1 + dup 'pending' จน HR ยืนยัน (one/two)
              ยืนยัน two หลังออกใบวันนั้นแล้ว → extra 1 → ไปขึ้นบรรทัด "ยกยอดจากวันก่อน" ในใบถัดไปของหน่วยเดียวกัน (extra_notice)
  cn_days     ไฟล์สแกนที่นำเข้าต่อวันต่อกล่อง (Total ท้ายไฟล์ vs ผลรวมจริง)
  cn_notices  ใบแจ้งยอดที่ลงนามแล้ว (snapshot บรรทัด/รายชื่อ/ผู้ลงนาม/ยอดสะสมรอบ) · ยกเลิกแล้วออกใหม่ = เลขเดิม version + 1
  cn_links    ลิงก์ให้สหกรณ์เปิดดู/พิมพ์ใบของวันนั้น (ไม่ต้อง login, 120 วัน)
  cn_settings units / mail (ผู้รับ) / last:<series>:<ปี> (เลขล่าสุดก่อนใช้ระบบ)
สิทธิ์: page.canteen (← page.expense) · data.canteen.write (← data.expense.write) — ลงนามต้องมีลายเซ็นใน letter_signers
"""
from __future__ import annotations

import base64
import json
import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone

from hooks import HookError as E, new_token

FUNCS = {}
PUBLIC = {"cn_link_get", "cn_order_link_get", "cn_order_link_decide"}


def fn(f):
    FUNCS[f.__name__] = f
    return f


_DDL = {
    "cn_meals": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, d DATE NOT NULL, box NVARCHAR(4) NOT NULL, code NVARCHAR(40) NULL,
        reg_code NVARCHAR(40) NULL, name NVARCHAR(200) NULL, cat NVARCHAR(10) NOT NULL, src NVARCHAR(10) NOT NULL, scans INT NOT NULL,
        billed INT NOT NULL, note NVARCHAR(400) NULL, dup NVARCHAR(10) NULL, dup_reason NVARCHAR(400) NULL, dup_by NVARCHAR(200) NULL,
        dup_at DATETIMEOFFSET NULL, extra INT NOT NULL DEFAULT 0, extra_notice BIGINT NULL, by_name NVARCHAR(200) NULL, at DATETIMEOFFSET NULL""",
    "cn_days": """d DATE NOT NULL, box NVARCHAR(4) NOT NULL, file_name NVARCHAR(300) NULL, file_total INT NULL, scans INT NULL, people INT NULL,
        by_name NVARCHAR(200) NULL, at DATETIMEOFFSET NULL, PRIMARY KEY (d, box)""",
    "cn_notices": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, unit NVARCHAR(4) NOT NULL, d DATE NOT NULL, series NVARCHAR(20) NOT NULL,
        yr INT NOT NULL, seq INT NOT NULL, version INT NOT NULL, doc_no NVARCHAR(40) NOT NULL, status NVARCHAR(10) NOT NULL,
        shop NVARCHAR(200) NULL, label NVARCHAR(100) NULL, price DECIMAL(10,2) NOT NULL, meals INT NOT NULL, amount DECIMAL(14,2) NOT NULL,
        lines NVARCHAR(MAX) NULL, people NVARCHAR(MAX) NULL, cum NVARCHAR(400) NULL, signer NVARCHAR(1000) NULL, signed_by NVARCHAR(64) NULL,
        signed_at DATETIMEOFFSET NULL, verify NVARCHAR(20) NULL, void_reason NVARCHAR(400) NULL, void_by NVARCHAR(200) NULL,
        void_at DATETIMEOFFSET NULL""",
    "cn_links": """token NVARCHAR(80) NOT NULL PRIMARY KEY, d DATE NOT NULL, created_at DATETIMEOFFSET NOT NULL, expires_at DATETIMEOFFSET NOT NULL,
        by_name NVARCHAR(200) NULL, sent_at DATETIMEOFFSET NULL, sent_to NVARCHAR(1000) NULL""",
    "cn_settings": "k NVARCHAR(80) NOT NULL PRIMARY KEY, v NVARCHAR(MAX) NULL",
    "cn_groups": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, name NVARCHAR(120) NOT NULL, en_name NVARCHAR(120) NULL, depts NVARCHAR(MAX) NULL,
        kinds NVARCHAR(100) NULL, coord NVARCHAR(200) NULL, token NVARCHAR(80) NOT NULL, active BIT NOT NULL, sort INT NULL,
        updated_at DATETIMEOFFSET NULL""",
    "cn_service": """d DATE NOT NULL PRIMARY KEY, cook_id BIGINT NULL, menu_aft NVARCHAR(1000) NULL, menu_night NVARCHAR(1000) NULL,
        closed NVARCHAR(40) NULL, note NVARCHAR(400) NULL, by_name NVARCHAR(200) NULL, at DATETIMEOFFSET NULL""",
    "cn_orders": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, d DATE NOT NULL, group_id BIGINT NOT NULL, kind NVARCHAR(6) NOT NULL,
        emp_code NVARCHAR(40) NULL, name NVARCHAR(200) NOT NULL, qty INT NOT NULL, note NVARCHAR(300) NULL, src NVARCHAR(6) NOT NULL,
        by_name NVARCHAR(200) NULL, at DATETIMEOFFSET NULL""",
    "cn_bills": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, grp NVARCHAR(40) NOT NULL, p_from DATE NOT NULL, p_to DATE NOT NULL,
        invoice_id BIGINT NULL, meals INT NULL, amount DECIMAL(14,2) NULL, shop_count INT NULL, ref_no NVARCHAR(100) NULL,
        note NVARCHAR(600) NULL, by_name NVARCHAR(200) NULL, at DATETIMEOFFSET NULL""",
    "cn_log": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, at DATETIMEOFFSET NOT NULL, by_name NVARCHAR(200) NULL, d DATE NULL,
        action NVARCHAR(40) NOT NULL, detail NVARCHAR(2000) NULL""",
}
PERMS = [("page.canteen", "page", "ค่าอาหารโรงอาหาร", "นำเข้าไฟล์สแกนบัตร ใบลงชื่อ และดูใบแจ้งยอดร้านค้า (/canteen)", "page.expense"),
         ("data.canteen.write", "data", "ออกใบแจ้งยอดโรงอาหาร", "นำเข้า/แก้รายการ ยืนยันแตะซ้ำ ลงนามและส่งใบแจ้งยอดให้สหกรณ์", "data.expense.write")]
UNITS_DEFAULT = [
    {"key": "A1", "label": "Canteen 1", "site": "Akara", "shop": "ร้านอาหารสุนิสา", "price": 65, "series": "CTS1", "boxes": ["A1"]},
    {"key": "A2", "label": "Canteen 2", "site": "Akara", "shop": "", "price": 65, "series": "CTS2", "boxes": ["A2"]},
    {"key": "CN", "label": "Chatree North", "site": "Chatree North", "shop": "NAVAPUSPHANIT LIMITED PARTNERSHIP", "price": 60, "series": "CTN",
     "boxes": ["N1", "N2"]},
]
BOXES = {"A1", "A2", "N1", "N2"}
CATS = ["akr", "sub", "tem", "unk", "forgot", "visit", "group"]
LINE = [("akr", "สแกนบัตร — พนักงานอัครา", "", "#1d4a8f"), ("sub", "สแกนบัตร — ผู้รับเหมา (SUB)", "", "#3b7fd9"),
        ("forgot", "ลืมบัตร", "ลงชื่อแทน", "#e7a51c"), ("visit", "ผู้ติดต่อ / บัตรชั่วคราว", "", "#9b6bd3"),
        ("group", "รับแทนเป็นกลุ่ม", "ตามใบรับอาหาร", "#14a37f"), ("carry", "ยกยอดจากวันก่อน", "HR ยืนยันทาน 2 มื้อ", "#8a93aa")]
PUBLIC_URL = (os.environ.get("PUBLIC_URL") or "https://ep-akarahr2-dwh8h3axhdbharbt.a01.azurefd.net").rstrip("/")
_ready = False


def ensure(r):
    global _ready
    if _ready:
        return
    for t, body in _DDL.items():
        try:
            r.cur.execute(f"IF OBJECT_ID('dbo.{t}') IS NULL CREATE TABLE dbo.{t} ({body})")
        except Exception as e:                       # อีก worker สร้างพร้อมกัน
            if "already" not in str(e).lower():
                raise
    for ix, sql in (("ix_cn_meals_d", "CREATE INDEX ix_cn_meals_d ON dbo.cn_meals (d, box)"),
                    ("ix_cn_notices_d", "CREATE INDEX ix_cn_notices_d ON dbo.cn_notices (d, unit)"),
                    ("ix_cn_orders_d", "CREATE INDEX ix_cn_orders_d ON dbo.cn_orders (d, group_id, kind)")):
        r.cur.execute(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '{ix}') {sql}")
    for key, cat, label, desc, grant in PERMS:
        if r.val("SELECT COUNT(*) FROM dbo.permissions WHERE [key] = ?", key):
            continue
        r.cur.execute("INSERT INTO dbo.permissions ([key], category, label, description, sort_order) VALUES (?, ?, ?, ?, ?)",
                      key, cat, label, desc, 27 if cat == "page" else 46)
        for (role,) in r.cur.execute("SELECT role_key FROM dbo.role_permissions WHERE perm_key = ?", grant).fetchall():
            r.cur.execute("INSERT INTO dbo.role_permissions (role_key, perm_key) VALUES (?, ?)", role, key)
    _ready = True


# ---------------------------------------------------------------- helpers
def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _bkk_now():
    return datetime.now(timezone.utc) + timedelta(hours=7)


def _me(r):
    return r.val("SELECT TOP 1 COALESCE(NULLIF(name, N''), email) FROM dbo.user_roles WHERE user_id = ?", r.uid) or ""


def _need(r, *perms):
    ensure(r)
    for p in perms:
        if not r.has_perm(p):
            raise E("ไม่มีสิทธิ์")


def _s(v, n=None):
    if v is None:
        return None
    v = re.sub(r"\s+", " ", str(v)).strip()
    return (v[:n] if n else v) or None


def _d(v):
    v = _s(v)
    if not v:
        raise E("ไม่มีวันที่")
    try:
        return date.fromisoformat(v[:10]).isoformat()
    except ValueError:
        raise E(f"วันที่ไม่ถูกต้อง: {v}")


def _j(v, default=None):
    if not v:
        return default
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def _get(r, k, default=None):
    return _j(r.val("SELECT v FROM dbo.cn_settings WHERE k = ?", k), default)


def _put(r, k, v):
    s = json.dumps(v, ensure_ascii=False)
    if r.val("SELECT COUNT(*) FROM dbo.cn_settings WHERE k = ?", k):
        r.cur.execute("UPDATE dbo.cn_settings SET v = ? WHERE k = ?", s, k)
    else:
        r.cur.execute("INSERT INTO dbo.cn_settings (k, v) VALUES (?, ?)", k, s)


def _log(r, d, action, detail, who=None):
    r.cur.execute("INSERT INTO dbo.cn_log (at, by_name, d, action, detail) VALUES (?, ?, ?, ?, ?)",
                  _now(), who if who is not None else _me(r), d, action, (detail or "")[:2000])


def _units(r):
    return _get(r, "units") or UNITS_DEFAULT


def _unit(r, key):
    u = next((x for x in _units(r) if x["key"] == key), None)
    if not u:
        raise E("ไม่มีจุดนี้")
    return u


def _unit_of_box(r, box):
    return next((u for u in _units(r) if box in u["boxes"]), None)


def _signed(r, d, unit):
    return r.rows(None, "SELECT id, doc_no FROM dbo.cn_notices WHERE d = ? AND unit = ? AND status = 'signed'", d, unit)


def _locked(r, d, box):
    u = _unit_of_box(r, box)
    n = _signed(r, d, u["key"]) if u else []
    if n:
        raise E(f"ใบ {n[0]['doc_no']} ของวันนี้ลงนามแล้ว — ยกเลิกใบก่อนถ้าจะแก้รายการ")


def _period(d):
    y, m, day = int(d[:4]), int(d[5:7]), int(d[8:10])
    if day <= 15:
        return f"{d[:7]}-01", f"{d[:7]}-15"
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return f"{d[:7]}-16", (nxt - timedelta(days=1)).isoformat()


def _art(paths):
    """รูปลายเซ็นเป็น data URL — หน้าลิงก์สหกรณ์ไม่มีสิทธิ์อ่าน storage"""
    out = {}
    for p in {x for x in paths if x}:
        try:
            import storage
            data, ctype = storage.get("letter-assets", p)
            out[p] = f"data:{ctype};base64," + base64.b64encode(data).decode()
        except Exception:
            out[p] = ""
    return out


def _notice_out(n, full=True):
    o = {k: n.get(k) for k in ("id", "unit", "series", "yr", "version", "doc_no", "status", "shop", "label", "verify",
                                "void_reason", "void_by")}
    o["d"], o["no"] = str(n["d"])[:10], n["seq"]
    o["price"], o["meals"], o["amount"] = float(n["price"]), n["meals"], float(n["amount"])
    o["signed_at"] = str(n["signed_at"]) if n.get("signed_at") else None
    o["void_at"] = str(n["void_at"]) if n.get("void_at") else None
    o["lines"], o["cum"], o["signer"] = _j(n.get("lines"), []), _j(n.get("cum"), {}), _j(n.get("signer"), {})
    if full:
        o["people"] = _j(n.get("people"), [])
    return o


def _meal_out(m):
    o = dict(m)
    o["d"] = str(m["d"])[:10]
    for k in ("at", "dup_at"):
        o[k] = str(m[k]) if m.get(k) else None
    return o


# ---------------------------------------------------------------- อ่าน
@fn
def cn_boot(r):
    _need(r, "page.canteen")
    s = r.signer(r.uid) or {}
    ms = r.rows(None, "SELECT mode FROM dbo.mail_settings WHERE id = 1")
    subs = r.rows(None, """SELECT w.sub_no, w.ac_no, w.first_name, w.last_name, w.status, w.left_on, c.name AS company
                           FROM dbo.sub_workers w LEFT JOIN dbo.sub_companies c ON c.id = w.company_id WHERE w.sub_no IS NOT NULL""")
    last = {k[5:]: v for k, v in ((x["k"], _j(x["v"])) for x in r.rows(None, "SELECT k, v FROM dbo.cn_settings WHERE k LIKE 'last:%'"))}
    vend = r.rows(None, """SELECT v.id, v.code, v.name, COUNT(i.id) n FROM dbo.exp_vendors v LEFT JOIN dbo.exp_invoices i ON i.vendor_id = v.id
                           AND i.category = 'Canteen' WHERE v.is_active = 1 GROUP BY v.id, v.code, v.name""")
    return {"billing": _billing(r), "vendors": [{"id": v["id"], "code": v["code"], "name": v["name"], "n": v["n"]} for v in vend],
            "can_invoice": r.has_perm("data.expense.write"),
            "units": _units(r), "mail": _get(r, "mail") or {"to": "", "cc": ""}, "last": last,
            "mail_mode": ms[0]["mode"] if ms else None, "write": r.has_perm("data.canteen.write"),
            "me": {"name": s.get("name_th") or s.get("name_en") or _me(r), "title": s.get("title_th") or s.get("title_en"),
                   "has_sig": bool(s.get("signature_path"))},
            "subs": [{"code": x["sub_no"].upper(), "ac": x["ac_no"], "name": f"{x['first_name'] or ''} {x['last_name'] or ''}".strip(),
                      "company": x["company"], "left": x["status"] == "left", "left_on": str(x["left_on"])[:10] if x.get("left_on") else None}
                     for x in subs]}


@fn
def cn_day(r, p_d):
    """ทุกอย่างของวันนั้น: รายการทาน · ไฟล์ที่นำเข้า · ใบที่ออกแล้ว · ยอดยกที่รออยู่ต่อหน่วย"""
    _need(r, "page.canteen")
    d = _d(p_d)
    meals = [_meal_out(m) for m in r.rows(None, "SELECT * FROM dbo.cn_meals WHERE d = ? ORDER BY box, cat, code, id", d)]
    days = r.rows(None, "SELECT * FROM dbo.cn_days WHERE d = ?", d)
    for x in days:
        x["d"], x["at"] = str(x["d"])[:10], str(x["at"]) if x.get("at") else None
    notices = [_notice_out(n, False) for n in r.rows(None, "SELECT * FROM dbo.cn_notices WHERE d = ? ORDER BY unit, version", d)]
    carry = {}
    for u in _units(r):
        rows = _carry_rows(r, u, d)
        carry[u["key"]] = [_meal_out(m) for m in rows]
    link = r.rows(None, "SELECT TOP 1 token, sent_at, sent_to, expires_at FROM dbo.cn_links WHERE d = ? ORDER BY created_at DESC", d)
    return {"d": d, "meals": meals, "days": days, "notices": notices, "carry": carry,
            "link": {"url": f"{PUBLIC_URL}/canteen/r.html?t={link[0]['token']}", "sent_at": str(link[0]["sent_at"]) if link[0]["sent_at"] else None,
                     "sent_to": link[0]["sent_to"]} if link else None,
            "dup_open": r.val("SELECT COUNT(*) FROM dbo.cn_meals WHERE dup = 'pending'")}


def _carry_rows(r, u, d):
    """ยืนยันทาน 2 มื้อหลังออกใบวันนั้นแล้ว ยังไม่ได้ขึ้นใบไหน (ของวันก่อนหน้าวันนี้)"""
    marks = ",".join("?" * len(u["boxes"]))
    return r.rows(None, f"SELECT * FROM dbo.cn_meals WHERE extra > 0 AND extra_notice IS NULL AND d < ? AND box IN ({marks}) ORDER BY d, code",
                  d, *u["boxes"])


@fn
def cn_dups(r, p_ym=None):
    """คิวแตะซ้ำรอยืนยัน + คนที่แตะซ้ำบ่อยในเดือน"""
    _need(r, "page.canteen")
    ym = _s(p_ym, 7) or _bkk_now().date().isoformat()[:7]
    pend = [_meal_out(m) for m in r.rows(None, "SELECT * FROM dbo.cn_meals WHERE dup = 'pending' ORDER BY d DESC, box, code")]
    month = [_meal_out(m) for m in r.rows(None, """SELECT * FROM dbo.cn_meals WHERE dup IS NOT NULL AND d >= ? AND d < DATEADD(month, 1, ?)
                                                    ORDER BY d""", f"{ym}-01", f"{ym}-01")]
    return {"pending": pend, "month": month, "ym": ym}


@fn
def cn_notices(r, p_from, p_to):
    _need(r, "page.canteen")
    f, t = _d(p_from), _d(p_to)
    return [_notice_out(n, False) for n in r.rows(None, "SELECT * FROM dbo.cn_notices WHERE d BETWEEN ? AND ? ORDER BY d, unit, version", f, t)]


@fn
def cn_print(r, p_ids):
    _need(r, "page.canteen")
    ids = [int(x) for x in (p_ids or [])][:200]
    if not ids:
        return {"notices": [], "art": {}}
    ns = [_notice_out(n) for n in r.rows(None, f"SELECT * FROM dbo.cn_notices WHERE id IN ({','.join('?' * len(ids))}) ORDER BY d, unit", *ids)]
    return {"notices": ns, "art": _art([n["signer"].get("signature_path") for n in ns])}


@fn
def cn_log_list(r, p_limit=300):
    _need(r, "page.canteen")
    out = r.rows(None, f"SELECT TOP {min(int(p_limit or 300), 2000)} * FROM dbo.cn_log ORDER BY id DESC")
    for x in out:
        x["at"], x["d"] = str(x["at"]), str(x["d"])[:10] if x.get("d") else None
    return out


# ---------------------------------------------------------------- นำเข้า / คีย์ / ยืนยันแตะซ้ำ
@fn
def cn_upload(r, p_d, p_box, p_file, p_total, p_unknown, p_rows):
    """ไฟล์สแกน 1 กล่อง 1 วัน (อ่านในเบราว์เซอร์แล้ว) → แทนรายการสแกนเดิมของวัน/กล่องนั้น
    การยืนยันแตะซ้ำเดิมของคนเดิมเก็บไว้ · แถวไม่มีรหัส = ผู้ติดต่อ นับตามจำนวนครั้ง"""
    _need(r, "page.canteen", "data.canteen.write")
    d, box = _d(p_d), _s(p_box, 4)
    if box not in BOXES:
        raise E("ไม่รู้ว่าเป็นกล่องไหน")
    _locked(r, d, box)
    r.lock(f"cn_day:{d}")
    old = {m["code"]: m for m in r.rows(None, "SELECT * FROM dbo.cn_meals WHERE d = ? AND box = ? AND src = 'scan' AND code IS NOT NULL", d, box)}
    r.cur.execute("DELETE FROM dbo.cn_meals WHERE d = ? AND box = ? AND src = 'scan'", d, box)
    who, now, n, scans = _me(r), _now(), 0, 0
    for x in (p_rows or [])[:5000]:
        code = (_s(x.get("code"), 40) or "").upper()
        k = int(x.get("scans") or 0)
        if not code or k <= 0:
            continue
        cat = "akr" if code.startswith("AKR") else "sub" if code.startswith("SUB") else "tem"
        o = old.get(code) or {}
        if cat in ("akr", "sub"):
            dup = None if k == 1 else (o.get("dup") if o.get("dup") in ("one", "two") else "pending")
            billed = 1 if dup != "two" else 2
        else:
            dup, billed = None, k
        r.cur.execute("""INSERT INTO dbo.cn_meals (d, box, code, reg_code, name, cat, src, scans, billed, note, dup, dup_reason, dup_by, dup_at, extra,
                         by_name, at) VALUES (?, ?, ?, ?, ?, ?, 'scan', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)""",
                      d, box, code, (_s(x.get("reg_code"), 40) or "").upper() or None, _s(x.get("name"), 200), cat, k, billed,
                      _s(x.get("note"), 400), dup, o.get("dup_reason") if dup else None, o.get("dup_by") if dup else None,
                      (str(o["dup_at"]) if o.get("dup_at") else None) if dup else None, who, now)
        n, scans = n + 1, scans + k
    unk = int(p_unknown or 0)
    if unk > 0:
        r.cur.execute("""INSERT INTO dbo.cn_meals (d, box, code, name, cat, src, scans, billed, note, extra, by_name, at)
                         VALUES (?, ?, NULL, N'บัตรไม่มีรหัสในไฟล์', 'unk', 'scan', ?, ?, N'นับตามจำนวนครั้งที่แตะ', 0, ?, ?)""", d, box, unk, unk, who, now)
        scans += unk
    tot = int(p_total) if p_total not in (None, "") else None
    r.cur.execute("DELETE FROM dbo.cn_days WHERE d = ? AND box = ?", d, box)
    r.cur.execute("INSERT INTO dbo.cn_days (d, box, file_name, file_total, scans, people, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                  d, box, _s(p_file, 300), tot, scans, n, who, now)
    _log(r, d, "upload", f"ไฟล์สแกน {box}: {n} คน แตะ {scans} ครั้ง" + (f" · Total ท้ายไฟล์ {tot}" if tot is not None and tot != scans else "")
         + f" · {_s(p_file, 200) or ''}")
    return {"people": n, "scans": scans}


@fn
def cn_upload_del(r, p_d, p_box):
    """ลบไฟล์สแกนที่อัปผิด (วัน/กล่อง) — รายการจากไฟล์นั้นหายทั้งหมด รวมการยืนยันแตะซ้ำ · รายการจากใบลงชื่อไม่แตะ"""
    _need(r, "page.canteen", "data.canteen.write")
    d, box = _d(p_d), _s(p_box, 4)
    if box not in BOXES:
        raise E("ไม่รู้ว่าเป็นกล่องไหน")
    _locked(r, d, box)
    f = r.rows(None, "SELECT file_name, people, scans FROM dbo.cn_days WHERE d = ? AND box = ?", d, box)
    if not f:
        raise E("ไม่มีไฟล์ของวัน/กล่องนี้")
    if r.val("SELECT COUNT(*) FROM dbo.cn_meals WHERE d = ? AND box = ? AND src = 'scan' AND extra_notice IS NOT NULL", d, box):
        raise E("มีรายการจากไฟล์นี้ยกยอดขึ้นใบวันอื่นแล้ว — ลบไม่ได้")
    r.cur.execute("DELETE FROM dbo.cn_meals WHERE d = ? AND box = ? AND src = 'scan'", d, box)
    r.cur.execute("DELETE FROM dbo.cn_days WHERE d = ? AND box = ?", d, box)
    _log(r, d, "upload_del", f"ลบไฟล์สแกน {box}: {f[0]['people']} คน แตะ {f[0]['scans']} ครั้ง · {f[0]['file_name'] or ''}")
    return True


@fn
def cn_files(r):
    """ไฟล์สแกนที่อัปแล้วทั้งหมด + ใบของวันนั้นลงนามแล้วหรือยัง"""
    _need(r, "page.canteen")
    out = []
    for x in r.rows(None, "SELECT d, box, file_name, people, scans, by_name, at FROM dbo.cn_days ORDER BY d DESC, box"):
        d = str(x["d"])[:10]
        u = _unit_of_box(r, x["box"])
        out.append({"d": d, "box": x["box"], "file_name": x["file_name"], "people": x["people"], "scans": x["scans"], "by_name": x["by_name"],
                    "at": str(x["at"]) if x.get("at") else None, "signed": bool(_signed(r, d, u["key"])) if u else False})
    return out


@fn
def cn_upload_del_many(r, p_items):
    """ลบไฟล์สแกนหลายไฟล์ [{d, box}] — ข้ามวันที่ลงนามแล้ว/ยกยอดแล้ว แล้วบอกว่าข้ามอะไร"""
    _need(r, "page.canteen", "data.canteen.write")
    done, skipped = 0, []
    for it in (p_items or [])[:500]:
        try:
            cn_upload_del(r, it.get("d"), it.get("box"))
            done += 1
        except E as e:
            skipped.append({"d": it.get("d"), "box": it.get("box"), "why": str(e)})
    return {"done": done, "skipped": skipped}


@fn
def cn_entry_add(r, p_d, p_box, p_cat, p_code=None, p_name=None, p_count=1, p_note=None):
    """คีย์จากใบลงชื่อ: forgot (ลืมบัตร — 1 อิ่ม · มีสแกนแล้วในวันนั้น = 0 อิ่ม) · visit (ผู้ติดต่อ) · group (รับแทนกลุ่ม)"""
    _need(r, "page.canteen", "data.canteen.write")
    d, box, cat = _d(p_d), _s(p_box, 4), _s(p_cat, 10)
    if box not in BOXES or cat not in ("forgot", "visit", "group"):
        raise E("ข้อมูลไม่ครบ")
    _locked(r, d, box)
    code, name = (_s(p_code, 40) or "").upper() or None, _s(p_name, 200)
    k = int(p_count or 1)
    if cat == "forgot":
        if not code:
            raise E("ใส่รหัส")
        k = 1
    elif not name or k <= 0 or k > 500:
        raise E("ใส่ชื่อ/รายการ และจำนวน")
    billed, note = k, _s(p_note, 400)
    if cat == "forgot":
        hit = r.rows(None, """SELECT TOP 1 box, cat FROM dbo.cn_meals WHERE d = ? AND (code = ? OR reg_code = ?) AND billed > 0""", d, code, code)
        if hit:
            billed = 0
            note = ((note + " · ") if note else "") + (f"มีสแกนบัตรแล้วที่ {hit[0]['box']} — ไม่นับซ้ำ" if hit[0]["cat"] != "forgot"
                                                       else f"ลงชื่อซ้ำแล้วที่ {hit[0]['box']} — ไม่นับซ้ำ")
    r.cur.execute("""INSERT INTO dbo.cn_meals (d, box, code, reg_code, name, cat, src, scans, billed, note, extra, by_name, at)
                     VALUES (?, ?, ?, ?, ?, ?, 'sheet', ?, ?, ?, 0, ?, ?)""", d, box, code, code, name, cat, k, billed, note, _me(r), _now())
    _log(r, d, "entry", f"{box} {cat} {code or ''} {name or ''} × {k}" + (" (ไม่นับซ้ำ)" if billed == 0 and k else ""))
    # ใบลงชื่อลืมบัตรแต่สแกนทีหลังในวันเดียวกันก็ต้องไม่นับซ้ำ → ตรวจจากหน้าเว็บ (dayChecks.forgotScanned)
    return {"billed": billed, "note": note}


@fn
def cn_entry_del(r, p_id):
    _need(r, "page.canteen", "data.canteen.write")
    m = r.rows(None, "SELECT * FROM dbo.cn_meals WHERE id = ? AND src = 'sheet'", int(p_id))
    if not m:
        raise E("ไม่พบรายการ")
    m = m[0]
    _locked(r, str(m["d"])[:10], m["box"])
    r.cur.execute("DELETE FROM dbo.cn_meals WHERE id = ?", m["id"])
    _log(r, str(m["d"])[:10], "entry_del", f"ลบ {m['box']} {m['cat']} {m['code'] or ''} {m['name'] or ''} × {m['scans']}")
    return True


@fn
def cn_billed_set(r, p_id, p_billed, p_reason):
    """HR แก้จำนวนอิ่มของแถว (เช่น ลืมบัตรแต่สแกนด้วย → 0 · ทานสองกล่องในกะเดียว) — ต้องมีเหตุผล"""
    _need(r, "page.canteen", "data.canteen.write")
    m = r.rows(None, "SELECT * FROM dbo.cn_meals WHERE id = ?", int(p_id))
    why = _s(p_reason, 300)
    if not m or not why:
        raise E("ใส่เหตุผล")
    m = m[0]
    _locked(r, str(m["d"])[:10], m["box"])
    b = int(p_billed)
    if b < 0 or b > max(m["scans"], 1):
        raise E("จำนวนไม่ถูกต้อง")
    note = f"{m['note'] + ' · ' if m.get('note') else ''}HR แก้ {m['billed']}→{b}: {why}"[:400]
    r.cur.execute("UPDATE dbo.cn_meals SET billed = ?, note = ?, dup = CASE WHEN dup = 'pending' THEN 'one' ELSE dup END WHERE id = ?", b, note, m["id"])
    _log(r, str(m["d"])[:10], "billed", f"{m['box']} {m['code'] or m['name']} {m['billed']}→{b} · {why}")
    return True


@fn
def cn_dup_decide(r, p_ids, p_dec, p_reason=None):
    """แตะซ้ำ: one = นับ 1 (ร้านแตะซ้ำ/ไม่อนุญาต) · two = ทานจริง 2 มื้อ (ต้องมีเหตุผล)
    ใบของวันนั้นออกแล้ว → two ไปเป็นยอดยกในใบถัดไป · ยกไปแล้วเปลี่ยนไม่ได้"""
    _need(r, "page.canteen", "data.canteen.write")
    dec, why = _s(p_dec, 5), _s(p_reason, 400)
    if dec not in ("one", "two"):
        raise E("เลือก นับ 1 หรือ นับ 2")
    if dec == "two" and not why:
        raise E("ใส่เหตุผลที่ให้ทาน 2 มื้อ")
    n = 0
    for i in [int(x) for x in (p_ids or [])][:500]:
        m = r.rows(None, "SELECT * FROM dbo.cn_meals WHERE id = ? AND dup IS NOT NULL", i)
        if not m:
            continue
        m = m[0]
        if m["extra_notice"]:
            raise E(f"{m['code']} วันที่ {str(m['d'])[:10]} ยกยอดขึ้นใบแล้ว — เปลี่ยนไม่ได้")
        d = str(m["d"])[:10]
        u = _unit_of_box(r, m["box"])
        signed = bool(_signed(r, d, u["key"])) if u else False
        if signed:      # ยอดในใบเดิมคงที่ (1) — ส่วนเพิ่มไปเป็นยอดยก
            billed, extra = m["billed"], (1 if dec == "two" and m["billed"] < 2 else 0)
        else:
            billed, extra = (2 if dec == "two" else 1), 0
        r.cur.execute("UPDATE dbo.cn_meals SET dup = ?, dup_reason = ?, dup_by = ?, dup_at = ?, billed = ?, extra = ? WHERE id = ?",
                      dec, why, _me(r), _now(), billed, extra, i)
        _log(r, d, "dup", f"{m['box']} {m['code']} แตะ {m['scans']} ครั้ง → {'นับ 2' if dec == 'two' else 'นับ 1'}"
             + (" (ยกไปใบถัดไป)" if extra else "") + (f" · {why}" if why else ""))
        n += 1
    return {"done": n}


# ---------------------------------------------------------------- ลงนาม / ยกเลิก / ส่ง
@fn
def cn_sign(r, p_d, p_units):
    """ลงนามออกใบแจ้งยอดของวันนั้น (หน่วยละ 1 ใบ) ด้วยลายเซ็นของผู้กด · เลขต่อจากเลขล่าสุดของชุดในปีนั้น"""
    _need(r, "page.canteen", "data.canteen.write")
    d = _d(p_d)
    s = r.signer(r.uid) or {}
    if not s.get("signature_path"):
        raise E("ยังไม่มีลายเซ็นของคุณในระบบ — ตั้งลายเซ็นที่หน้า ตั้งค่าลายเซ็น ของระบบ HR ก่อน")
    signer = {"name": s.get("name_th") or s.get("name_en") or _me(r), "title": s.get("title_th") or s.get("title_en") or "HR",
              "signature_path": s["signature_path"]}
    r.lock("cn_notice_no")
    out = []
    for key in [_s(x, 4) for x in (p_units or [])]:
        u = _unit(r, key)
        if _signed(r, d, key):
            continue
        marks = ",".join("?" * len(u["boxes"]))
        meals = r.rows(None, f"SELECT * FROM dbo.cn_meals WHERE d = ? AND box IN ({marks}) ORDER BY cat, code, id", d, *u["boxes"])
        carry = _carry_rows(r, u, d)
        if not any(m["billed"] for m in meals) and not carry:
            raise E(f"{u['label']}: ยังไม่มีรายการของวันนี้")
        cnt = {k: 0 for k, *_ in LINE}
        for m in meals:
            cnt["visit" if m["cat"] in ("tem", "unk", "visit") else m["cat"]] += m["billed"]
        cnt["carry"] = sum(m["extra"] for m in carry)
        lines = [{"k": k, "label": lab, "sub": sub, "n": cnt[k], "color": col} for k, lab, sub, col in LINE if cnt[k] or k in ("akr", "sub")]
        total = sum(l["n"] for l in lines)
        price = float(u["price"])
        # ใบเคยออกแล้วยกเลิก = เลขเดิม version + 1
        prev = r.rows(None, "SELECT TOP 1 series, yr, seq, version FROM dbo.cn_notices WHERE d = ? AND unit = ? ORDER BY version DESC", d, key)
        yr = int(d[:4])
        if prev:
            series, yr, no, ver = prev[0]["series"], prev[0]["yr"], prev[0]["seq"], prev[0]["version"] + 1
        else:
            series = u["series"]
            mx = r.val("SELECT MAX(seq) FROM dbo.cn_notices WHERE series = ? AND yr = ?", series, yr) or 0
            no, ver = max(mx, int(_get(r, f"last:{series}:{yr}") or 0)) + 1, 1
        doc = f"{series}{yr}/{no:03d}"
        people = []
        for m in meals:
            if m["billed"] <= 0:
                continue
            c = "visit" if m["cat"] in ("tem", "unk", "visit") else m["cat"]
            people.append({"c": c, "code": m["reg_code"] or m["code"] or "", "name": m["name"] or "", "n": m["billed"],
                           "box": m["box"] if len(u["boxes"]) > 1 else None})
        for m in carry:
            people.append({"c": "carry", "code": m["reg_code"] or m["code"] or "", "name": m["name"] or "", "n": m["extra"], "from": str(m["d"])[:10]})
        pf, pt = _period(d)
        cum_m = r.val("SELECT COALESCE(SUM(meals), 0) FROM dbo.cn_notices WHERE unit = ? AND status = 'signed' AND d BETWEEN ? AND ?", key, pf, d)
        cum = {"from": pf, "to": pt, "meals": cum_m + total, "amount": round((cum_m + total) * price, 2),
               "days": r.val("SELECT COUNT(DISTINCT d) FROM dbo.cn_notices WHERE unit = ? AND status = 'signed' AND d BETWEEN ? AND ?", key, pf, d) + 1}
        verify = "-".join(secrets.token_hex(2).upper() for _ in range(2))
        r.cur.execute("""INSERT INTO dbo.cn_notices (unit, d, series, yr, seq, version, doc_no, status, shop, label, price, meals, amount, lines, people, cum,
                         signer, signed_by, signed_at, verify) OUTPUT INSERTED.id
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                      key, d, series, yr, no, ver, doc, u.get("shop") or "", u["label"], price, total, round(total * price, 2),
                      json.dumps(lines, ensure_ascii=False), json.dumps(people, ensure_ascii=False), json.dumps(cum, ensure_ascii=False),
                      json.dumps(signer, ensure_ascii=False), str(r.uid), _now(), verify)
        nid = int(r.cur.fetchone()[0])
        if carry:
            r.cur.execute(f"UPDATE dbo.cn_meals SET extra_notice = ? WHERE id IN ({','.join('?' * len(carry))})", nid, *[m["id"] for m in carry])
        _log(r, d, "sign", f"ลงนาม {doc}{f' (ครั้งที่ {ver})' if ver > 1 else ''} · {u['label']} {total} อิ่ม × {price:g} = {total * price:,.2f}")
        out.append({"id": nid, "doc_no": doc, "unit": key, "meals": total})
    return out


@fn
def cn_void(r, p_id, p_reason):
    _need(r, "page.canteen", "data.canteen.write")
    why = _s(p_reason, 400)
    if not why:
        raise E("ใส่เหตุผลที่ยกเลิก")
    n = r.rows(None, "SELECT * FROM dbo.cn_notices WHERE id = ? AND status = 'signed'", int(p_id))
    if not n:
        raise E("ไม่พบใบ หรือยกเลิกไปแล้ว")
    n = n[0]
    b = _live_bill(r, n["unit"], str(n["d"])[:10])
    if b:
        raise E(f"รอบนี้ออก {b['inv_no'] or 'ร่าง HRIN'} แล้ว — ยกเลิกใบใน Invoice Hub ก่อนถ้าจะแก้ใบแจ้งยอด")
    r.cur.execute("UPDATE dbo.cn_notices SET status = 'void', void_reason = ?, void_by = ?, void_at = ? WHERE id = ?", why, _me(r), _now(), n["id"])
    r.cur.execute("UPDATE dbo.cn_meals SET extra_notice = NULL WHERE extra_notice = ?", n["id"])     # ยอดยกกลับไปรอใบใหม่
    _log(r, str(n["d"])[:10], "void", f"ยกเลิก {n['doc_no']} (ครั้งที่ {n['version']}) · {why}")
    return True


MAIL_SUBJ = "ใบแจ้งยอดร้านค้า (Report Food for Canteen) วันที่ {date}"


def _mail_html(d, ns, link, who):
    rows = "".join(f"""<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">{n['doc_no']}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">{n['label']}{(' · ' + n['shop']) if n['shop'] else ''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">{n['meals']:,}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">{n['amount']:,.2f}</td></tr>""" for n in ns)
    return f"""<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#101828">
<p>เรียน ร้านค้าสหกรณ์</p><p>ฝ่ายบุคคลขอนำส่งใบแจ้งยอดร้านค้า วันที่ทานอาหาร <b>{_th_date(d)}</b> ดังนี้</p>
<table style="border-collapse:collapse;font-size:13px"><tr style="background:#1d4a8f;color:#fff"><th style="padding:6px 10px;text-align:left">เลขที่</th>
<th style="padding:6px 10px;text-align:left">จุดสแกน / ร้าน</th><th style="padding:6px 10px">อิ่ม</th><th style="padding:6px 10px">บาท</th></tr>{rows}</table>
<p style="margin-top:16px"><a href="{link}" style="display:inline-block;background:#1d4a8f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
เปิดใบแจ้งยอด · พิมพ์ / PDF / Excel รายชื่อ</a></p>
<p>ขอบคุณค่ะ<br>{who}</p>
<p style="color:#667085;font-size:12px;margin-top:18px">ส่งจากระบบ Akara Canteen · ลิงก์เปิดได้ 120 วัน · ใบลงนามอิเล็กทรอนิกส์โดยฝ่ายบุคคล</p></div>"""


_TH_M = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]


def _th_date(d):
    return f"{int(d[8:10])} {_TH_M[int(d[5:7]) - 1]} {int(d[:4]) + 543}"


@fn
def cn_send(r, p_d):
    """ส่งใบของวันนั้นให้สหกรณ์: ลิงก์เปิดดู/พิมพ์ (ไม่ต้อง login) · โหมด Outlook = คืนหัวเรื่อง/เนื้อหาให้ทำ .eml"""
    _need(r, "page.canteen", "data.canteen.write")
    d = _d(p_d)
    ns = [_notice_out(n, False) for n in r.rows(None, "SELECT * FROM dbo.cn_notices WHERE d = ? AND status = 'signed' ORDER BY unit", d)]
    if not ns:
        raise E("ยังไม่มีใบที่ลงนามของวันนี้")
    mc = _get(r, "mail") or {}
    lst = lambda s: [x for x in re.split(r"[,;\s]+", s or "") if x]
    to, cc = lst(mc.get("to")), lst(mc.get("cc"))
    if not to:
        raise E("ยังไม่ได้ตั้งอีเมลสหกรณ์ — ไปที่ ตั้งค่า")
    t = r.rows(None, "SELECT TOP 1 token FROM dbo.cn_links WHERE d = ? AND expires_at > SYSDATETIMEOFFSET() ORDER BY created_at DESC", d)
    exp = (datetime.now(timezone.utc) + timedelta(days=120)).isoformat(timespec="seconds")
    if t:
        tok = t[0]["token"]
        r.cur.execute("UPDATE dbo.cn_links SET expires_at = ? WHERE token = ?", exp, tok)
    else:
        tok = new_token()
        r.cur.execute("INSERT INTO dbo.cn_links (token, d, created_at, expires_at, by_name) VALUES (?, ?, ?, ?, ?)", tok, d, _now(), exp, _me(r))
    link = f"{PUBLIC_URL}/canteen/r.html?t={tok}"
    who = (r.signer(r.uid) or {}).get("name_th") or _me(r)
    subject, html = MAIL_SUBJ.format(date=_th_date(d)), _mail_html(d, ns, link, who)
    r.cn.commit()
    import mail
    ms = r.rows(None, "SELECT * FROM dbo.mail_settings WHERE id = 1")
    try:
        res = mail.deliver(ms[0] if ms else {}, to, cc, subject, html)
    except Exception as e:
        res = {"sent": False, "reason": "server_error", "detail": f"{type(e).__name__}: {str(e)[:200]}"}
    if res.get("sent"):
        r.cur.execute("UPDATE dbo.cn_links SET sent_at = ?, sent_to = ? WHERE token = ?", _now(), res.get("to"), tok)
    _log(r, d, "send", f"ส่งสหกรณ์ {', '.join(n['doc_no'] for n in ns)} · " + (f"ส่งแล้ว {res.get('to')}" if res.get("sent") else f"ไม่ได้ส่ง ({res.get('reason')})"))
    return {"link": link, "result": res, "to": ", ".join(to), "cc": ", ".join(cc), "subject": subject, "html": html}


@fn
def cn_link_get(r, p_token):
    """หน้าสหกรณ์ (ไม่ต้อง login): ใบที่ลงนามของวันนั้น + รูปลายเซ็น"""
    ensure(r)
    tok = _s(p_token, 80)
    t = r.rows(None, "SELECT * FROM dbo.cn_links WHERE token = ?", tok) if tok else []
    if not t:
        return {"error": "ลิงก์ไม่ถูกต้อง"}
    if datetime.fromisoformat(str(t[0]["expires_at"])) <= datetime.now(timezone.utc):
        return {"error": "ลิงก์หมดอายุ — ขอใหม่จากฝ่ายบุคคล"}
    d = str(t[0]["d"])[:10]
    ns = [_notice_out(n) for n in r.rows(None, "SELECT * FROM dbo.cn_notices WHERE d = ? AND status = 'signed' ORDER BY unit", d)]
    for n in ns:
        n.pop("void_reason", None), n.pop("void_by", None)
    return {"d": d, "notices": ns, "art": _art([n["signer"].get("signature_path") for n in ns])}


# ---------------------------------------------------------------- ตั้งค่า
@fn
def cn_settings_save(r, p_units=None, p_mail=None, p_last=None, p_billing=None):
    _need(r, "page.canteen", "data.canteen.write")
    if p_billing is not None:
        cur = _billing(r)
        for k in ("unit_vendor", "unit_text", "prices", "cutoff", "vat", "wht"):
            if isinstance(p_billing.get(k), dict):
                cur[k].update({a: b for a, b in p_billing[k].items()})
        for k in ("night_vendor", "cost_code", "category"):
            if p_billing.get(k) is not None:
                cur[k] = _s(p_billing[k], 60)
        for k, v in cur["cutoff"].items():
            if not re.fullmatch(r"\d{1,2}:\d\d", str(v)):
                raise E("เวลาปิดรับต้องเป็น ชั่วโมง:นาที เช่น 10:30")
        _put(r, "billing", cur)
        _log(r, None, "settings", "แก้ราคา/เวลาปิดรับ/ผู้ขายในใบแจ้งหนี้")
    if p_units is not None:
        units = []
        for u in p_units:
            key = _s(u.get("key"), 4)
            boxes = [b for b in (u.get("boxes") or []) if b in BOXES]
            series = re.sub(r"[^A-Za-z0-9]", "", str(u.get("series") or ""))[:12]
            price = float(u.get("price") or 0)
            if not key or not boxes or not series or not 0 < price < 10000:
                raise E("ข้อมูลจุดสแกนไม่ครบ (ชุดเลขที่/ราคา)")
            units.append({"key": key, "label": _s(u.get("label"), 60) or key, "site": _s(u.get("site"), 60) or "", "shop": _s(u.get("shop"), 200) or "",
                          "price": price, "series": series, "boxes": boxes})
        _put(r, "units", units)
        _log(r, None, "settings", "แก้จุดสแกน/ร้าน/ราคา/ชุดเลขที่: " + " · ".join(f"{u['label']} {u['price']:g} {u['series']}" for u in units))
    if p_mail is not None:
        _put(r, "mail", {"to": _s(p_mail.get("to"), 1000) or "", "cc": _s(p_mail.get("cc"), 1000) or ""})
        _log(r, None, "settings", f"ผู้รับใบแจ้งยอด: {_s(p_mail.get('to'), 300) or '-'}")
    for k, v in (p_last or {}).items():
        m = re.fullmatch(r"([A-Za-z0-9]{1,12}):(20\d\d)", str(k))
        if m and str(v).strip().isdigit():
            _put(r, f"last:{k}", int(v))
            _log(r, None, "settings", f"เลขล่าสุดก่อนใช้ระบบ {m.group(1)} ปี {m.group(2)} = {int(v)}")
    return True


# ================================================================ สั่งอาหารกะบ่าย / OT / กะดึก ผ่านลิงก์ของกลุ่ม (user 2026-11-26)
# กลุ่มผู้สั่ง (cn_groups) = แผนก/ส่วนงานที่สั่ง เช่น Supply, Process, Gold Room · ลิงก์ถาวรต่อกลุ่ม /canteen/o.html?t= (เปลี่ยนลิงก์ได้)
# kind: aft = อาหารกะบ่าย (แม่ครัวเวรของวันนั้น) · ot = อาหาร OT (แม่ครัวเวร, 50) · night = ชุดอาหารแห้งกะดึก (สหกรณ์)
# ปิดรับตามเวลา (billing.cutoff) ของวันนั้น · HR แก้ได้เสมอจนออก HRIN ของรอบนั้น
KINDS = {"aft": "อาหารกะบ่าย", "ot": "อาหาร OT", "night": "ชุดอาหารแห้งกะดึก"}
BILLING_DEFAULT = {"unit_vendor": {"A1": "T0009", "A2": "T0009", "CN": "N0009"}, "unit_text": {"A1": "Canteen 1", "A2": "Canteen 2", "CN": "Chatree North"},
                   "night_vendor": "T0009", "prices": {"aft": 65, "ot": 50, "night": 65}, "cutoff": {"aft": "10:30", "ot": "15:00", "night": "15:00"},
                   "cost_code": "506005051500", "category": "Canteen", "vat": {"unit": 7, "night": 7, "cook": 0}, "wht": {"unit": 3, "night": 3, "cook": 0}}


def _billing(r):
    b = _get(r, "billing") or {}
    out = json.loads(json.dumps(BILLING_DEFAULT))
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def _vendor(r, code=None, vid=None):
    v = r.rows(None, "SELECT id, code, name, address, bank, tax_id FROM dbo.exp_vendors WHERE " + ("code = ?" if code else "id = ?"), code or vid)
    return v[0] if v else None


def _group_out(g):
    return {"id": g["id"], "name": g["name"], "en_name": g.get("en_name") or g["name"], "depts": _j(g.get("depts"), []),
            "kinds": _j(g.get("kinds"), ["aft", "ot", "night"]), "coord": g.get("coord"), "active": bool(g["active"]), "sort": g.get("sort"),
            "url": f"{PUBLIC_URL}/canteen/o.html?t={g['token']}"}


def _live_bill(r, grp, d):
    """ใบ HRIN ที่ออกจากรอบที่ครอบวันนี้และยังไม่ยกเลิก/ไม่ถูกลบ"""
    b = r.rows(None, """SELECT TOP 1 b.id, i.inv_no, i.status FROM dbo.cn_bills b JOIN dbo.exp_invoices i ON i.id = b.invoice_id
                        WHERE b.grp = ? AND ? BETWEEN b.p_from AND b.p_to AND i.status <> 'cancelled' ORDER BY b.id DESC""", grp, d)
    return b[0] if b else None


def _cook_of(r, d):
    v = r.val("SELECT cook_id FROM dbo.cn_service WHERE d = ?", d)
    return int(v) if v else None


def _order_locked(r, d, kind):
    grp = "night" if kind == "night" else (f"cook:{_cook_of(r, d)}" if _cook_of(r, d) else None)
    b = _live_bill(r, grp, d) if grp else None
    if b:
        raise E(f"รอบนี้ออก {b['inv_no'] or 'ร่าง HRIN'} แล้ว — ยกเลิกใบใน Invoice Hub ก่อนถ้าจะแก้")


def _cutoff_passed(r, d, kind):
    t = (_billing(r)["cutoff"].get(kind) or "23:59").split(":")
    limit = datetime.fromisoformat(d) + timedelta(hours=int(t[0]), minutes=int(t[1]) if len(t) > 1 else 0)
    closed = (r.val("SELECT closed FROM dbo.cn_service WHERE d = ?", d) or "")
    return _bkk_now().replace(tzinfo=None) > limit or kind in closed.split(",")


def _put_orders(r, d, gid, kind, rows, src, who):
    r.cur.execute("DELETE FROM dbo.cn_orders WHERE d = ? AND group_id = ? AND kind = ?", d, gid, kind)
    n = 0
    for x in (rows or [])[:400]:
        name = _s(x.get("name"), 200)
        q = int(x.get("qty") or 1)
        if not name or not 0 < q <= 200:
            continue
        r.cur.execute("""INSERT INTO dbo.cn_orders (d, group_id, kind, emp_code, name, qty, note, src, by_name, at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", d, gid, kind, (_s(x.get("emp_code"), 40) or "").upper() or None, name, q,
                      _s(x.get("note"), 300), src, who, _now())
        n += q
    return n


@fn
def cn_groups(r):
    _need(r, "page.canteen")
    return [_group_out(g) for g in r.rows(None, "SELECT * FROM dbo.cn_groups ORDER BY active DESC, COALESCE(sort, 999), name")]


@fn
def cn_group_save(r, p_row, p_new_link=False):
    _need(r, "page.canteen", "data.canteen.write")
    x = p_row or {}
    name = _s(x.get("name"), 120)
    if not name:
        raise E("ใส่ชื่อกลุ่ม")
    kinds = [k for k in (x.get("kinds") or []) if k in KINDS] or ["aft", "ot", "night"]
    vals = (name, _s(x.get("en_name"), 120) or name, json.dumps([_s(d, 120) for d in (x.get("depts") or []) if _s(d)], ensure_ascii=False),
            json.dumps(kinds), _s(x.get("coord"), 200), 1 if x.get("active", True) else 0, int(x.get("sort") or 0) or None, _now())
    if x.get("id"):
        r.cur.execute("UPDATE dbo.cn_groups SET name = ?, en_name = ?, depts = ?, kinds = ?, coord = ?, active = ?, sort = ?, updated_at = ? WHERE id = ?",
                      *vals, int(x["id"]))
        if p_new_link:
            r.cur.execute("UPDATE dbo.cn_groups SET token = ? WHERE id = ?", new_token(), int(x["id"]))
        _log(r, None, "group", f"แก้กลุ่มผู้สั่ง {name}" + (" · เปลี่ยนลิงก์ใหม่ (ลิงก์เดิมใช้ไม่ได้)" if p_new_link else ""))
    else:
        r.cur.execute("""INSERT INTO dbo.cn_groups (name, en_name, depts, kinds, coord, active, sort, updated_at, token)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", *vals, new_token())
        _log(r, None, "group", f"เพิ่มกลุ่มผู้สั่ง {name}")
    return True


@fn
def cn_month(r, p_ym):
    """ปฏิทินเดือน: แม่ครัวเวร เมนู ยอดสั่งต่อวัน/ประเภท"""
    _need(r, "page.canteen")
    ym = _s(p_ym, 7)
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", ym or ""):
        raise E("เดือนไม่ถูกต้อง")
    f = f"{ym}-01"
    svc = r.rows(None, "SELECT * FROM dbo.cn_service WHERE d >= ? AND d < DATEADD(month, 1, ?)", f, f)
    for x in svc:
        x["d"], x["at"] = str(x["d"])[:10], str(x["at"]) if x.get("at") else None
    cnt = r.rows(None, """SELECT d, kind, SUM(qty) n FROM dbo.cn_orders WHERE d >= ? AND d < DATEADD(month, 1, ?) GROUP BY d, kind""", f, f)
    return {"service": svc, "counts": [{"d": str(c["d"])[:10], "kind": c["kind"], "n": c["n"]} for c in cnt]}


@fn
def cn_service_save(r, p_days, p_row):
    """ตั้งแม่ครัวเวร/เมนู/ปิดรับ ของหลายวันพร้อมกัน — ส่งเฉพาะช่องที่จะแก้"""
    _need(r, "page.canteen", "data.canteen.write")
    x = p_row or {}
    days = sorted({_d(d) for d in (p_days or [])})[:62]
    for d in days:
        if not r.val("SELECT COUNT(*) FROM dbo.cn_service WHERE d = ?", d):
            r.cur.execute("INSERT INTO dbo.cn_service (d, by_name, at) VALUES (?, ?, ?)", d, _me(r), _now())
        if "cook_id" in x:
            new = int(x["cook_id"]) if x["cook_id"] else None
            old = _cook_of(r, d)
            if old != new and old and _live_bill(r, f"cook:{old}", d):
                raise E(f"{d}: ออก HRIN ของแม่ครัวเดิมแล้ว — เปลี่ยนแม่ครัวไม่ได้")
            r.cur.execute("UPDATE dbo.cn_service SET cook_id = ? WHERE d = ?", new, d)
        for k in ("menu_aft", "menu_night", "note"):
            if k in x:
                r.cur.execute(f"UPDATE dbo.cn_service SET {k} = ? WHERE d = ?", _s(x[k], 1000), d)
        if "closed" in x:
            r.cur.execute("UPDATE dbo.cn_service SET closed = ? WHERE d = ?", ",".join(k for k in (x["closed"] or []) if k in KINDS) or None, d)
        r.cur.execute("UPDATE dbo.cn_service SET by_name = ?, at = ? WHERE d = ?", _me(r), _now(), d)
    if days:
        _log(r, days[0] if len(days) == 1 else None, "service", f"ตั้ง {', '.join(k for k in x)} {len(days)} วัน ({days[0]}{' – ' + days[-1] if len(days) > 1 else ''})")
    return len(days)


@fn
def cn_orders_day(r, p_d):
    _need(r, "page.canteen")
    d = _d(p_d)
    svc = r.rows(None, "SELECT * FROM dbo.cn_service WHERE d = ?", d)
    o = r.rows(None, "SELECT * FROM dbo.cn_orders WHERE d = ? ORDER BY group_id, kind, id", d)
    for x in o:
        x["d"], x["at"] = str(x["d"])[:10], str(x["at"]) if x.get("at") else None
    s = svc[0] if svc else {}
    if s:
        s["d"], s["at"] = str(s["d"])[:10], str(s["at"]) if s.get("at") else None
    return {"d": d, "service": s, "orders": o, "passed": {k: _cutoff_passed(r, d, k) for k in KINDS}}


@fn
def cn_orders_span(r, p_from, p_to):
    """ยอดสั่งต่อวัน/ประเภท ในช่วงวัน (แถบวันในหน้าสั่งอาหาร + เลขที่เมนู)"""
    _need(r, "page.canteen")
    f, t = _d(p_from), _d(p_to)
    return [{"d": str(x["d"])[:10], "kind": x["kind"], "n": x["n"]}
            for x in r.rows(None, "SELECT d, kind, SUM(qty) n FROM dbo.cn_orders WHERE d BETWEEN ? AND ? GROUP BY d, kind", f, t)]


@fn
def cn_order_hr(r, p_d, p_group, p_kind, p_rows):
    """HR แก้รายชื่อของกลุ่ม (ทับทั้งชุดของวัน/ประเภทนั้น) — ได้แม้เลยเวลาปิดรับ"""
    _need(r, "page.canteen", "data.canteen.write")
    d, kind = _d(p_d), _s(p_kind, 6)
    if kind not in KINDS:
        raise E("ประเภทไม่ถูกต้อง")
    _order_locked(r, d, kind)
    g = r.rows(None, "SELECT id, name FROM dbo.cn_groups WHERE id = ?", int(p_group))
    if not g:
        raise E("ไม่พบกลุ่ม")
    n = _put_orders(r, d, g[0]["id"], kind, p_rows, "hr", _me(r))
    _log(r, d, "order", f"HR แก้ {KINDS[kind]} {g[0]['name']}: {n} ที่")
    return n


def _group_by_token(r, tok):
    tok = _s(tok, 80)
    g = r.rows(None, "SELECT * FROM dbo.cn_groups WHERE token = ? AND active = 1", tok) if tok else []
    return g[0] if g else None


@fn
def cn_order_link_get(r, p_token):
    """หน้าสั่งอาหารของกลุ่ม (ไม่ต้อง login): เมื่อวาน … อีก 7 วัน · เมนู · เวลาปิดรับ · รายชื่อที่สั่งแล้ว · รายชื่อแนะนำของกลุ่ม"""
    ensure(r)
    g = _group_by_token(r, p_token)
    if not g:
        return {"error": "ลิงก์ไม่ถูกต้อง หรือ HR เปลี่ยนลิงก์ใหม่แล้ว"}
    t = _bkk_now().date()
    days = [(t + timedelta(days=i)).isoformat() for i in range(-1, 8)]
    svc = {str(x["d"])[:10]: x for x in r.rows(None, "SELECT d, menu_aft, menu_night, closed, note FROM dbo.cn_service WHERE d BETWEEN ? AND ?", days[0], days[-1])}
    o = r.rows(None, "SELECT d, kind, emp_code, name, qty, note FROM dbo.cn_orders WHERE group_id = ? AND d BETWEEN ? AND ? ORDER BY id",
               g["id"], days[0], days[-1])
    b = _billing(r)
    out_days = [{"d": d, "menu_aft": (svc.get(d) or {}).get("menu_aft"), "menu_night": (svc.get(d) or {}).get("menu_night"),
                 "note": (svc.get(d) or {}).get("note"), "open": {k: not _cutoff_passed(r, d, k) for k in KINDS}} for d in days]
    depts = _j(g.get("depts"), [])
    ppl = []
    if depts:
        marks = ",".join("?" * len(depts))
        ppl = [{"code": p["emp_code"], "name": f"{p['firstname_th'] or ''} {p['lastname_th'] or ''}".strip()}
               for p in r.rows(None, f"""SELECT emp_code, firstname_th, lastname_th FROM dbo.employees WHERE status = 'Active'
                                        AND (department IN ({marks}) OR section IN ({marks})) ORDER BY firstname_th""", *depts, *depts)]
    return {"group": {"name": g["name"], "coord": g.get("coord"), "kinds": _j(g.get("kinds"), list(KINDS))}, "days": out_days,
            "orders": [{"d": str(x["d"])[:10], "kind": x["kind"], "emp_code": x["emp_code"], "name": x["name"], "qty": x["qty"], "note": x["note"]} for x in o],
            "cutoff": b["cutoff"], "prices": b["prices"], "people": ppl, "kinds": KINDS}


@fn
def cn_order_link_decide(r, p_token, p_d, p_kind, p_rows, p_by=None):
    ensure(r)
    g = _group_by_token(r, p_token)
    if not g:
        raise E("ลิงก์ไม่ถูกต้อง")
    d, kind = _d(p_d), _s(p_kind, 6)
    if kind not in _j(g.get("kinds"), list(KINDS)):
        raise E("กลุ่มนี้สั่งประเภทนี้ไม่ได้")
    if _cutoff_passed(r, d, kind):
        raise E(f"ปิดรับ{KINDS[kind]}ของวันนี้แล้ว — ติดต่อ HR")
    if d > (_bkk_now().date() + timedelta(days=14)).isoformat():
        raise E("สั่งล่วงหน้าได้ไม่เกิน 14 วัน")
    _order_locked(r, d, kind)
    who = (_s(p_by, 100) or "ผู้ประสานงาน") + f" ({g['name']})"
    n = _put_orders(r, d, g["id"], kind, p_rows, "link", who)
    _log(r, d, "order", f"{who} สั่ง{KINDS[kind]} {n} ที่", who)
    return {"n": n}


# ================================================================ รอบบิล → ร่าง HRIN ใน Invoice Hub
# grp: A1 / A2 / CN (ใบแจ้งยอดที่ลงนาม) · night (ชุดกะดึก → สหกรณ์) · cook:<vendor id> (กะบ่าย + OT ของแม่ครัวคนนั้น)
_EN_M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _p_en(f, t):
    return f"{int(f[8:10])}-{int(t[8:10])} {_EN_M[int(f[5:7]) - 1]} {f[:4]}"


def _d_en(d):
    return f"{int(d[8:10])} {_EN_M[int(d[5:7]) - 1]} {d[:4]}"


def _r2(v):
    from decimal import Decimal, ROUND_HALF_UP
    return float(Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _period_data(r, f, t):
    b = _billing(r)
    units = {u["key"]: u for u in _units(r)}
    out = []
    for key, u in units.items():
        ns = r.rows(None, "SELECT d, doc_no, meals, amount FROM dbo.cn_notices WHERE unit = ? AND status = 'signed' AND d BETWEEN ? AND ? ORDER BY d",
                    key, f, t)
        meals = sum(n["meals"] for n in ns)
        text = (f"Meal for Employee Chatree North {_p_en(f, t)} ({meals:,}*{u['price']:g})" if key == "CN"
                else f"Meal for Employees: {_p_en(f, t)} ({meals:,}*{u['price']:g}) {b['unit_text'].get(key, u['label'])}")
        out.append({"grp": key, "title": f"{u['label']} · ใบแจ้งยอดรายวัน", "vendor_code": b["unit_vendor"].get(key), "vat": b["vat"]["unit"],
                    "wht": b["wht"]["unit"], "meals": meals, "days": len(ns),
                    "lines": [{"detail": text, "qty": meals, "price": float(u["price"])}] if meals else []})
    night = r.rows(None, "SELECT d, SUM(qty) n FROM dbo.cn_orders WHERE kind = 'night' AND d BETWEEN ? AND ? GROUP BY d", f, t)
    nn = sum(x["n"] for x in night)
    out.append({"grp": "night", "title": "ชุดอาหารแห้งกะดึก", "vendor_code": b["night_vendor"], "vat": b["vat"]["night"], "wht": b["wht"]["night"],
                "meals": nn, "days": len(night),
                "lines": [{"detail": f"Meal for Employees (Night Shift) : {_p_en(f, t)} ({nn:,}*{b['prices']['night']:g})", "qty": nn,
                           "price": float(b["prices"]["night"])}] if nn else []})
    rows = r.rows(None, """SELECT o.d, o.kind, o.group_id, g.en_name, g.name, SUM(o.qty) n, s.cook_id FROM dbo.cn_orders o
                           JOIN dbo.cn_groups g ON g.id = o.group_id LEFT JOIN dbo.cn_service s ON s.d = o.d
                           WHERE o.kind IN ('aft', 'ot') AND o.d BETWEEN ? AND ? GROUP BY o.d, o.kind, o.group_id, g.en_name, g.name, s.cook_id
                           ORDER BY o.d""", f, t)
    cooks = {}
    for x in rows:
        cooks.setdefault(x["cook_id"], []).append(x)
    for cid, xs in cooks.items():
        aft = sum(x["n"] for x in xs if x["kind"] == "aft")
        lines = [{"detail": f"Meal for Afternoon shift: {_p_en(f, t)} ({aft:,}*{b['prices']['aft']:g})", "qty": aft, "price": float(b["prices"]["aft"])}] if aft else []
        for x in xs:
            if x["kind"] == "ot":
                d = str(x["d"])[:10]
                lines.append({"detail": f"Meal for Overtime work ({x['en_name'] or x['name']}): {_d_en(d)} ({x['n']:,}*{b['prices']['ot']:g})",
                              "qty": x["n"], "price": float(b["prices"]["ot"]), "d": d})
        v = _vendor(r, vid=cid) if cid else None
        out.append({"grp": f"cook:{cid}" if cid else "cook:none", "title": "อาหารกะบ่าย + OT · " + (v["name"] if v else "ยังไม่ได้ระบุแม่ครัวเวร"),
                    "vendor_code": v["code"] if v else None, "vat": b["vat"]["cook"], "wht": b["wht"]["cook"],
                    "meals": sum(x["n"] for x in xs), "days": len({str(x["d"]) for x in xs}), "lines": lines})
    for g in out:
        g["amount"] = _r2(sum(l["qty"] * l["price"] for l in g["lines"]))
        bill = r.rows(None, """SELECT TOP 1 b.*, i.inv_no, i.status FROM dbo.cn_bills b LEFT JOIN dbo.exp_invoices i ON i.id = b.invoice_id
                               WHERE b.grp = ? AND b.p_from = ? AND b.p_to = ? ORDER BY b.id DESC""", g["grp"], f, t)
        g["bill"] = ({"id": bill[0]["id"], "invoice_id": bill[0]["invoice_id"], "inv_no": bill[0]["inv_no"], "status": bill[0]["status"] or "deleted",
                      "meals": bill[0]["meals"], "amount": float(bill[0]["amount"] or 0), "shop_count": bill[0]["shop_count"], "ref_no": bill[0]["ref_no"],
                      "at": str(bill[0]["at"]), "by_name": bill[0]["by_name"]} if bill else None)
    return out


@fn
def cn_period(r, p_from, p_to):
    _need(r, "page.canteen")
    f, t = _d(p_from), _d(p_to)
    ns = [_notice_out(n, False) for n in r.rows(None, "SELECT * FROM dbo.cn_notices WHERE d BETWEEN ? AND ? ORDER BY d, unit, version", f, t)]
    return {"groups": _period_data(r, f, t), "notices": ns, "billing": _billing(r)}


@fn
def cn_period_detail(r, p_from, p_to, p_grp):
    """ข้อมูลทำไฟล์แนบ: รายวัน + รายชื่อ ของกลุ่มบิลนั้น"""
    _need(r, "page.canteen")
    f, t, grp = _d(p_from), _d(p_to), _s(p_grp, 40)
    if grp in ("A1", "A2", "CN"):
        ns = [_notice_out(n) for n in r.rows(None, "SELECT * FROM dbo.cn_notices WHERE unit = ? AND status = 'signed' AND d BETWEEN ? AND ? ORDER BY d",
                                             grp, f, t)]
        return {"notices": ns}
    if grp == "night":
        where, args = "o.kind = 'night'", []
    else:
        cid = grp.split(":", 1)[1]
        where, args = ("o.kind IN ('aft','ot') AND " + ("s.cook_id IS NULL" if cid in ("none", "None") else "s.cook_id = ?"),
                       [] if cid in ("none", "None") else [int(cid)])
    o = r.rows(None, f"""SELECT o.d, o.kind, g.name grp, g.en_name, o.emp_code, o.name, o.qty, o.note FROM dbo.cn_orders o JOIN dbo.cn_groups g ON g.id = o.group_id
                        LEFT JOIN dbo.cn_service s ON s.d = o.d WHERE {where} AND o.d BETWEEN ? AND ? ORDER BY o.d, o.kind, g.name, o.id""", *args, f, t)
    for x in o:
        x["d"] = str(x["d"])[:10]
    return {"orders": o}


@fn
def cn_invoice_make(r, p_from, p_to, p_grp, p_shop_count=None, p_ref_no=None, p_note=None):
    """สร้างร่าง HRIN ใน Invoice Hub จากยอดของรอบ · ใบแจ้งยอดรายวันต้องเท่ากับใบเรียกเก็บเงินของร้าน (ต่างได้ถ้าใส่เหตุผล)
    แล้วเดินตามขั้นตอนเดิมของ Invoice Hub (ส่งตรวจ → อนุมัติจากลิงก์เมล) · ไฟล์สรุปแนบจากหน้าเว็บหลังสร้าง"""
    _need(r, "page.canteen", "data.canteen.write", "data.expense.write")
    f, t, grp = _d(p_from), _d(p_to), _s(p_grp, 40)
    r.lock(f"cn_bill:{grp}:{f}")
    g = next((x for x in _period_data(r, f, t) if x["grp"] == grp), None)
    if not g or not g["lines"]:
        raise E("ไม่มียอดของรอบนี้")
    if g["bill"] and g["bill"]["status"] not in ("cancelled", "deleted"):
        raise E(f"รอบนี้สร้าง {g['bill']['inv_no'] or 'ร่าง HRIN'} ไปแล้ว")
    if not g["vendor_code"]:
        raise E("ยังไม่ได้ระบุผู้ขาย (แม่ครัวเวร) ของวันเหล่านี้ — ตั้งที่หน้า สั่งอาหาร")
    v = _vendor(r, code=g["vendor_code"])
    if not v:
        raise E(f"ไม่พบผู้ขายรหัส {g['vendor_code']} ใน Invoice Hub")
    shop = int(p_shop_count) if str(p_shop_count or "").strip().isdigit() else None
    note = _s(p_note, 400)
    if grp in ("A1", "A2", "CN") and shop is not None and shop != g["meals"] and not note:
        raise E(f"ยอดตามใบเรียกเก็บของร้าน {shop:,} ≠ ใบแจ้งยอดรายวัน {g['meals']:,} — ใส่เหตุผลก่อน")
    b = _billing(r)
    lines, tot = [], {"amount": 0.0, "vat": 0.0, "wht": 0.0, "net": 0.0}
    for i, l in enumerate(g["lines"], 1):
        amt = _r2(l["qty"] * l["price"])
        vat, wht = _r2(amt * g["vat"] / 100), _r2(amt * g["wht"] / 100)
        lines.append({"line_no": i, "cost_code": b["cost_code"], "detail": l["detail"], "amount": amt, "vat_rate": 7 if g["vat"] == 7 else 0,
                      "vat": vat, "wht": wht, "net": _r2(amt + vat - wht)})
        for k, val in (("amount", amt), ("vat", vat), ("wht", wht), ("net", amt + vat - wht)):
            tot[k] += val
    tot = {k: _r2(v_) for k, v_ in tot.items()}
    today = _bkk_now().date().isoformat()
    head = {"inv_date": today, "vendor_id": v["id"], "vendor": {k: v.get(k) for k in ("code", "name", "address", "bank", "tax_id")},
            "category": b["category"], "ref_no": _s(p_ref_no, 100), "wht_rate": g["wht"], "status": "draft", "imported": False,
            "note": f"สร้างจาก Akara Canteen · {g['title']} · รอบ {f} ถึง {t}" + (f" · ใบเรียกเก็บของร้าน {shop:,} อิ่ม" if shop is not None else "")
                    + (f" · {note}" if note else ""),
            "created_by": r.uid, **tot}
    inv = r.ins("exp_invoices", head)
    for l in lines:
        r.ins("exp_invoice_lines", {"invoice_id": inv["id"], **l})
    r.cur.execute("""INSERT INTO dbo.cn_bills (grp, p_from, p_to, invoice_id, meals, amount, shop_count, ref_no, note, by_name, at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", grp, f, t, inv["id"], g["meals"], tot["net"], shop, _s(p_ref_no, 100), note, _me(r), _now())
    _log(r, None, "invoice", f"สร้างร่าง HRIN ({g['title']}) รอบ {f} – {t}: {len(lines)} บรรทัด สุทธิ {tot['net']:,.2f} · ผู้ขาย {v['code']} {v['name']}")
    return {"invoice_id": inv["id"], "net": tot["net"], "vendor": v["name"]}
