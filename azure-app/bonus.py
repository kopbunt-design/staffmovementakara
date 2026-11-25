"""
Akara Bonus — สรุปการลา/เวลา และคำนวณโบนัสประจำปี (/bonus) · ประกาศ HR-152-2026 · user 2026-11-25
กติกาทั้งหมดอยู่ใน js/bonus-calc.js (มีเทส test/bonus.test.js) — ไฟล์นี้เก็บ/อ่านข้อมูลและตรวจสิทธิ์

ตาราง Azure-only สร้างเองตอนใช้ครั้งแรก ไม่เปิดให้ REST (แก้ผ่านฟังก์ชันในไฟล์นี้เท่านั้น · ทุกการแก้มีประวัติใน bonus_log)
  bonus_cal     ข้อมูลเวลารายคนรายเดือนจาก TigerSoft (วันละแถวแบบย่อเป็น JSON + ยอดสาย/ออกก่อน) — ใช้ดูปฏิทินรายคน
  bonus_events  วันที่ลา/ขาด/พักงาน (เฉพาะวันที่มีเรื่อง) — ใช้คำนวณ
  bonus_adj     ใบลา/การแก้ที่ HR บันทึกเอง (ช่วงวันที่ → แทนที่ข้อมูล TigerSoft ช่วงนั้น) เช่น ใบลากระดาษช่วงก่อนใช้ TigerSoft
  bonus_months  เดือนที่นำเข้าแล้ว + ปิดการนับ "ขาดงาน" ของเดือนที่ยังไม่ได้ตั้งกะ
  bonus_settings ประเภทการลา→น้ำหนัก (types) · ตัวเลขประกาศ (params:<ปี>) · กำหนดสิทธิ์รายคน (ovr:<ปี>)
สิทธิ์: page.bonus = ดูสรุปลา/เวลา · data.bonus.write = นำเข้า/แก้ · เงินรายคนต้องมี field.salary.read เพิ่ม
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone

from hooks import HookError as E

FUNCS = {}


def fn(f):
    FUNCS[f.__name__] = f
    return f


_DDL = {
    "bonus_cal": """ym NVARCHAR(7) NOT NULL, emp_code NVARCHAR(40) NOT NULL, name NVARCHAR(200) NULL, data NVARCHAR(MAX) NULL,
        late_n INT NULL, late_min INT NULL, early_n INT NULL, early_min INT NULL, work_days INT NULL, PRIMARY KEY (ym, emp_code)""",
    "bonus_events": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, ym NVARCHAR(7) NOT NULL, emp_code NVARCHAR(40) NOT NULL, d DATE NOT NULL,
        kind NVARCHAR(200) NOT NULL, days DECIMAL(6,2) NOT NULL, note NVARCHAR(400) NULL""",
    "bonus_adj": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, yr INT NOT NULL, emp_code NVARCHAR(40) NOT NULL, d_from DATE NOT NULL,
        d_to DATE NOT NULL, kind NVARCHAR(200) NOT NULL, days DECIMAL(7,2) NOT NULL, note NVARCHAR(1000) NULL,
        by_name NVARCHAR(200) NULL, at DATETIMEOFFSET NULL""",
    "bonus_months": """ym NVARCHAR(7) NOT NULL PRIMARY KEY, file_name NVARCHAR(300) NULL, people INT NULL, events INT NULL,
        absent_off BIT NULL, saved_at DATETIMEOFFSET NULL, saved_by_name NVARCHAR(200) NULL""",
    "bonus_settings": "k NVARCHAR(60) NOT NULL PRIMARY KEY, v NVARCHAR(MAX) NULL",
    "bonus_log": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, at DATETIMEOFFSET NOT NULL, by_name NVARCHAR(200) NULL,
        emp_code NVARCHAR(40) NULL, action NVARCHAR(40) NOT NULL, detail NVARCHAR(2000) NULL""",
}
PERMS = [("page.bonus", "page", "โบนัสประจำปี", "ดูสรุปการลา/เวลา และผลคำนวณวันที่มีสิทธิ (/bonus)", "page.payroll"),
         ("data.bonus.write", "data", "จัดการโบนัสประจำปี", "นำเข้าไฟล์เวลา TigerSoft บันทึกใบลา แก้ประเภทการลาและสิทธิ์รายคน", "data.payroll.write")]
CLS = {"full", "half", "sick", "mat", "none", "ignore"}
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
    for ix, sql in (("ix_bonus_events_ym", "CREATE INDEX ix_bonus_events_ym ON dbo.bonus_events (ym, emp_code)"),
                    ("ix_bonus_adj_yr", "CREATE INDEX ix_bonus_adj_yr ON dbo.bonus_adj (yr, emp_code)")):
        r.cur.execute(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '{ix}') {sql}")
    for key, cat, label, desc, grant in PERMS:
        if r.val("SELECT COUNT(*) FROM dbo.permissions WHERE [key] = ?", key):
            continue
        r.cur.execute("INSERT INTO dbo.permissions ([key], category, label, description, sort_order) VALUES (?, ?, ?, ?, ?)",
                      key, cat, label, desc, 26 if cat == "page" else 45)
        for (role,) in r.cur.execute("SELECT role_key FROM dbo.role_permissions WHERE perm_key = ?", grant).fetchall():
            r.cur.execute("INSERT INTO dbo.role_permissions (role_key, perm_key) VALUES (?, ?)", role, key)
    _ready = True


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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


def _ym(v):
    v = _s(v) or ""
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", v):
        raise E("เดือนไม่ถูกต้อง")
    return v


def _year(v):
    y = int(str(v)[:4])
    if not 2020 <= y <= 2100:
        raise E("ปีไม่ถูกต้อง")
    return y


def _j(v, default=None):
    if not v:
        return default
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def _get(r, k, default=None):
    return _j(r.val("SELECT v FROM dbo.bonus_settings WHERE k = ?", k), default)


def _put(r, k, v):
    s = json.dumps(v, ensure_ascii=False)
    if r.val("SELECT COUNT(*) FROM dbo.bonus_settings WHERE k = ?", k):
        r.cur.execute("UPDATE dbo.bonus_settings SET v = ? WHERE k = ?", s, k)
    else:
        r.cur.execute("INSERT INTO dbo.bonus_settings (k, v) VALUES (?, ?)", k, s)


def _log(r, code, action, detail):
    r.cur.execute("INSERT INTO dbo.bonus_log (at, by_name, emp_code, action, detail) VALUES (?, ?, ?, ?, ?)",
                  _now(), _me(r), code, action, (detail or "")[:2000])


# ---------------------------------------------------------------- อ่าน
@fn
def bonus_data(r, p_year=None):
    """ทุกอย่างที่หน้า /bonus ใช้คำนวณ: เดือนที่นำเข้า วันลา/ขาด ใบลาที่ HR บันทึก ยอดสายรายเดือน ประเภทการลา ตัวเลขประกาศ
       เงินเดือน (ฐานโบนัส) ส่งเฉพาะคนที่มี field.salary.read"""
    _need(r, "page.bonus")
    y = _year(p_year or datetime.now(timezone.utc).year)
    money = r.has_perm("field.salary.read")
    out = {"year": y, "can_write": r.has_perm("data.bonus.write"), "can_money": money,
           "types": _get(r, "types", {}), "params": _get(r, f"params:{y}", None), "ovr": _get(r, f"ovr:{y}", {}),
           "months": r.rows(None, "SELECT * FROM dbo.bonus_months WHERE ym LIKE ? ORDER BY ym", f"{y}-%"),
           "events": r.rows(None, "SELECT emp_code, d, kind, days FROM dbo.bonus_events WHERE ym LIKE ?", f"{y}-%"),
           "agg": r.rows(None, "SELECT ym, emp_code, name, late_n, late_min, early_n, early_min, work_days FROM dbo.bonus_cal WHERE ym LIKE ?", f"{y}-%"),
           "adj": r.rows(None, "SELECT * FROM dbo.bonus_adj WHERE yr = ? ORDER BY d_from", y)}
    if money:
        out["salary"] = {x["emp_code"]: x["salary"] for x in r.rows(None, "SELECT emp_code, salary FROM dbo.employees WHERE salary IS NOT NULL")}
    return out


@fn
def bonus_cal(r, p_emp_code, p_year=None):
    """ปฏิทินเวลารายคนทั้งปี (แสดงแบบหน้า 'ข้อมูลหลังประมวล' ของ TigerSoft)"""
    _need(r, "page.bonus")
    y = _year(p_year or datetime.now(timezone.utc).year)
    rows = r.rows(None, "SELECT ym, data FROM dbo.bonus_cal WHERE emp_code = ? AND ym LIKE ? ORDER BY ym", _s(p_emp_code, 40), f"{y}-%")
    return [{"ym": x["ym"], "days": _j(x["data"], [])} for x in rows]


@fn
def bonus_log(r, p_emp_code=None):
    _need(r, "page.bonus")
    if p_emp_code:
        return r.rows(None, "SELECT TOP 200 * FROM dbo.bonus_log WHERE emp_code = ? ORDER BY id DESC", _s(p_emp_code, 40))
    return r.rows(None, "SELECT TOP 300 * FROM dbo.bonus_log ORDER BY id DESC")


# ---------------------------------------------------------------- นำเข้าไฟล์เวลา TigerSoft (อ่านในเบราว์เซอร์ ส่งมาเป็นรายคน)
@fn
def bonus_month_save(r, p_ym, p_rows, p_file=None, p_first=True, p_last=True):
    """แทนที่ข้อมูลเดือนนั้นทั้งเดือน (นำเข้าซ้ำได้เมื่อ TigerSoft แก้ข้อมูล) — หน้าเว็บส่งทีละชุด:
       ชุดแรก (p_first) ล้างของเดิมของเดือน · ทุกชุดแทนที่รายคนที่ส่งมา · ชุดสุดท้าย (p_last) บันทึกสรุปเดือน"""
    _need(r, "page.bonus", "data.bonus.write")
    ym = _ym(p_ym)
    if not isinstance(p_rows, list) or not p_rows:
        raise E("ไม่มีข้อมูลในไฟล์")
    if len(p_rows) > 200:
        raise E("ส่งได้ครั้งละไม่เกิน 200 คน")
    r.lock(f"bonus_month:{ym}")
    if p_first:
        r.cur.execute("DELETE FROM dbo.bonus_cal WHERE ym = ?", ym)
        r.cur.execute("DELETE FROM dbo.bonus_events WHERE ym = ?", ym)
    cal, ev, seen = [], [], set()
    for p in p_rows:
        code = (_s(p.get("code"), 40) or "").upper()
        if not code or code in seen:
            continue
        seen.add(code)
        r.cur.execute("DELETE FROM dbo.bonus_cal WHERE ym = ? AND emp_code = ?", ym, code)
        r.cur.execute("DELETE FROM dbo.bonus_events WHERE ym = ? AND emp_code = ?", ym, code)
        a = p.get("agg") or {}
        days = p.get("cal") or []
        cal.append((ym, code, _s(p.get("name"), 200), json.dumps(days, ensure_ascii=False), int(a.get("late_n") or 0), int(a.get("late_min") or 0),
                    int(a.get("early_n") or 0), int(a.get("early_min") or 0), int(a.get("work") or 0)))
        for e in p.get("events") or []:
            d = _d(e.get("d"))
            if d[:7] != ym:
                continue
            ev.append((ym, code, d, _s(e.get("kind"), 200) or "ขาดงาน", round(float(e.get("days") or 0), 2), _s(e.get("note"), 400)))
    for i in range(0, len(cal), 200):
        r.cur.executemany("INSERT INTO dbo.bonus_cal (ym, emp_code, name, data, late_n, late_min, early_n, early_min, work_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", cal[i:i + 200])
    for i in range(0, len(ev), 500):
        r.cur.executemany("INSERT INTO dbo.bonus_events (ym, emp_code, d, kind, days, note) VALUES (?, ?, ?, ?, ?, ?)", ev[i:i + 500])
    if not p_last:
        return {"ym": ym, "part": len(cal)}
    people = r.val("SELECT COUNT(*) FROM dbo.bonus_cal WHERE ym = ?", ym)
    events = r.val("SELECT COUNT(*) FROM dbo.bonus_events WHERE ym = ?", ym)
    old = r.rows(None, "SELECT absent_off FROM dbo.bonus_months WHERE ym = ?", ym)
    r.cur.execute("DELETE FROM dbo.bonus_months WHERE ym = ?", ym)
    r.cur.execute("INSERT INTO dbo.bonus_months (ym, file_name, people, events, absent_off, saved_at, saved_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  ym, _s(p_file, 300), people, events, (old[0]["absent_off"] if old else 0) or 0, _now(), _me(r))
    _log(r, None, "import", f"นำเข้าเวลา {ym}: {people} คน · ลา/ขาด {events} รายการ · {_s(p_file, 200) or ''}")
    return {"ym": ym, "people": people, "events": events}


@fn
def bonus_month_off(r, p_ym, p_off):
    """ไม่นับ 'ขาดงาน' จากไฟล์ของเดือนนี้ (ช่วงที่ยังไม่ได้ตั้งกะใน TigerSoft ระบบขึ้นขาดงานทั้งที่มาทำงาน)"""
    _need(r, "page.bonus", "data.bonus.write")
    ym = _ym(p_ym)
    if not r.val("SELECT COUNT(*) FROM dbo.bonus_months WHERE ym = ?", ym):
        raise E("ยังไม่ได้นำเข้าเดือนนี้")
    r.cur.execute("UPDATE dbo.bonus_months SET absent_off = ? WHERE ym = ?", 1 if p_off else 0, ym)
    _log(r, None, "month_off", f"{ym}: {'ไม่นับ' if p_off else 'นับ'}ขาดงานจากไฟล์")
    return {"ok": True}


@fn
def bonus_month_delete(r, p_ym):
    _need(r, "page.bonus", "data.bonus.write")
    ym = _ym(p_ym)
    for t in ("bonus_cal", "bonus_events", "bonus_months"):
        r.cur.execute(f"DELETE FROM dbo.{t} WHERE ym = ?", ym)
    _log(r, None, "month_delete", f"ลบข้อมูลเวลา {ym}")
    return {"ok": True}


# ---------------------------------------------------------------- ใบลา / การแก้ของ HR
@fn
def bonus_adj_save(r, p_row):
    """เพิ่ม/แก้ใบลาที่ HR บันทึกเอง — ช่วงวันที่นี้ของคนนี้จะใช้ข้อมูลนี้แทน TigerSoft"""
    _need(r, "page.bonus", "data.bonus.write")
    p = p_row or {}
    code = (_s(p.get("emp_code"), 40) or "").upper()
    if not code:
        raise E("ไม่มีรหัสพนักงาน")
    d1, d2 = _d(p.get("d_from")), _d(p.get("d_to") or p.get("d_from"))
    if d2 < d1:
        raise E("วันที่สิ้นสุดก่อนวันเริ่ม")
    kind = _s(p.get("kind"), 200)
    if not kind:
        raise E("เลือกประเภทการลา")
    try:
        days = round(float(p.get("days")), 2)
    except (TypeError, ValueError):
        raise E("ใส่จำนวนวัน")
    if days < 0 or days > 400:
        raise E("จำนวนวันไม่ถูกต้อง")
    note = _s(p.get("note"), 1000)
    y = int(d1[:4])
    if p.get("id"):
        old = r.rows(None, "SELECT * FROM dbo.bonus_adj WHERE id = ?", int(p["id"]))
        if not old:
            raise E("ไม่พบรายการ")
        r.cur.execute("UPDATE dbo.bonus_adj SET emp_code = ?, d_from = ?, d_to = ?, kind = ?, days = ?, note = ?, yr = ?, by_name = ?, at = ? WHERE id = ?",
                      code, d1, d2, kind, days, note, y, _me(r), _now(), int(p["id"]))
        o = old[0]
        _log(r, code, "adj_edit", f"แก้ใบลา {o['kind']} {o['d_from']}–{o['d_to']} {o['days']} วัน → {kind} {d1}–{d2} {days} วัน" + (f" · {note}" if note else ""))
    else:
        r.cur.execute("INSERT INTO dbo.bonus_adj (yr, emp_code, d_from, d_to, kind, days, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      y, code, d1, d2, kind, days, note, _me(r), _now())
        _log(r, code, "adj_add", f"บันทึกใบลา {kind} {d1}–{d2} {days} วัน" + (f" · {note}" if note else ""))
    return {"ok": True}


@fn
def bonus_adj_delete(r, p_id):
    _need(r, "page.bonus", "data.bonus.write")
    old = r.rows(None, "SELECT * FROM dbo.bonus_adj WHERE id = ?", int(p_id))
    if not old:
        raise E("ไม่พบรายการ")
    o = old[0]
    r.cur.execute("DELETE FROM dbo.bonus_adj WHERE id = ?", int(p_id))
    _log(r, o["emp_code"], "adj_delete", f"ลบใบลา {o['kind']} {o['d_from']}–{o['d_to']} {o['days']} วัน")
    return {"ok": True}


# ---------------------------------------------------------------- ตั้งค่า
@fn
def bonus_types_save(r, p_types):
    """ประเภทการลา → น้ำหนัก (full/half/sick/mat/none/ignore) — ใช้ทุกปี"""
    _need(r, "page.bonus", "data.bonus.write")
    cur = _get(r, "types", {})
    ch = []
    for k, v in (p_types or {}).items():
        k = _s(k, 200)
        if not k:
            continue
        if v in (None, ""):
            if k in cur:
                cur.pop(k)
                ch.append(f"{k} → ล้าง")
            continue
        if v not in CLS:
            raise E(f"น้ำหนักไม่ถูกต้อง: {v}")
        if cur.get(k) != v:
            cur[k] = v
            ch.append(f"{k} → {v}")
    _put(r, "types", cur)
    if ch:
        _log(r, None, "types", "ประเภทการลา: " + " · ".join(ch))
    return cur


@fn
def bonus_params_save(r, p_year, p_params):
    """ตัวเลขตามประกาศของปีนั้น (อัตรา เงินพิเศษ ช่วงเก็บสถิติ วันจ่าย ฯลฯ)"""
    _need(r, "page.bonus", "data.bonus.write")
    y = _year(p_year)
    p = p_params or {}
    out = {}
    for k in ("mult", "special", "sick_free", "mat_free", "probation_days"):
        try:
            out[k] = float(p[k]) if k in ("mult", "special") else int(p[k])
        except (KeyError, TypeError, ValueError):
            raise E(f"ค่าไม่ถูกต้อง: {k}")
    for k in ("stat_from", "stat_to", "join_by", "pay_date", "base_date"):
        out[k] = _d(p.get(k))
    out["year"] = y
    out["doc_no"] = _s(p.get("doc_no"), 60)
    _put(r, f"params:{y}", out)
    _log(r, None, "params", f"ตั้งค่าปี {y}: " + json.dumps(out, ensure_ascii=False)[:1500])
    return out


@fn
def bonus_override_save(r, p_year, p_emp_code, p_elig, p_note=None):
    """กำหนดสิทธิ์รายคนทับผลของระบบ: yes = มีสิทธิ์ · no = ไม่มีสิทธิ์ · ว่าง = ตามระบบ (ต้องมีเหตุผล)"""
    _need(r, "page.bonus", "data.bonus.write")
    y, code = _year(p_year), (_s(p_emp_code, 40) or "").upper()
    if p_elig not in ("yes", "no", None, ""):
        raise E("ค่าไม่ถูกต้อง")
    note = _s(p_note, 500)
    if p_elig and not note:
        raise E("ใส่เหตุผล")
    ov = _get(r, f"ovr:{y}", {})
    if p_elig:
        ov[code] = {"elig": p_elig, "note": note, "by": _me(r), "at": _now()}
    else:
        ov.pop(code, None)
    _put(r, f"ovr:{y}", ov)
    _log(r, code, "override", {"yes": "กำหนดให้มีสิทธิ์", "no": "กำหนดให้ไม่มีสิทธิ์"}.get(p_elig, "กลับไปใช้ผลของระบบ") + (f" · {note}" if note else ""))
    return ov
