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
PUBLIC = {"cn_link_get"}


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
                    ("ix_cn_notices_d", "CREATE INDEX ix_cn_notices_d ON dbo.cn_notices (d, unit)")):
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
    return {"units": _units(r), "mail": _get(r, "mail") or {"to": "", "cc": ""}, "last": last,
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
def cn_settings_save(r, p_units=None, p_mail=None, p_last=None):
    _need(r, "page.canteen", "data.canteen.write")
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
