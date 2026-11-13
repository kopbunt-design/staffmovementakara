"""
ทะเบียนรายได้และภาษีพนักงาน (เว็บ /tax) — เก็บรายได้/ภาษี/ประกันสังคม/PVD รายคนรายเดือน · 50 ทวิ ปีละใบ (ภ.ง.ด.1ก)
· กระทบยอดกับ ภ.ง.ด.1 รายเดือนและ ภ.ง.ด.1ก · user 2026-11-13
อ่านไฟล์/คำนวณอยู่ใน js/tax-calc.js (มีเทส) — ไฟล์นี้เก็บ/อ่านข้อมูล ตรวจสิทธิ์ และขั้นตอนลงนาม

ตาราง Azure-only สร้างเองตอนใช้ครั้งแรก ไม่เปิดให้ REST: แก้ได้ผ่านฟังก์ชันในไฟล์นี้เท่านั้น ทุกการแก้มีประวัติใน tax_log
สิทธิ์: page.tax = เข้าเว็บ · data.tax.write = นำเข้า/แก้/เตรียมและส่งใบ/เห็นเลขผู้เสียภาษีเต็ม · data.tax.sign = ลงนาม 50 ทวิ
         ยอดเงินรายคน = เงินเดือน → ต้องมี field.salary.read ด้วย (ผู้ลงนามเห็นเฉพาะใบที่ส่งถึงตัวเอง)
ลงนาม: HR เตรียมใบ (draft) → ส่งให้ผู้ลงนาม (pending · ได้เลขที่) → ผู้ลงนามเลือกลงทีละใบหรือทั้งหมดในครั้งเดียว (signed)
        หรือส่งกลับ (draft) · ตัวเลขเปลี่ยนหลังลงนาม → HR ยกเลิก (void) แล้วเตรียมใหม่ (version + 1 · เลขที่เดิม)
พนักงานโหลดใบของตัวเองที่ /tax/my.html ด้วยรหัสพนักงาน + เลขประจำตัวผู้เสียภาษี 13 หลัก (ผิด 8 ครั้งใน 30 นาที ล็อกรหัสนั้น)
"""
from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timedelta, timezone

from hooks import HookError as E

FUNCS = {}
PUBLIC = {"tax_my_certs"}


def fn(f):
    FUNCS[f.__name__] = f
    return f


MONEY = ["inc401", "inc402", "sev", "tax", "sev_tax", "sso", "pvd", "co_tax", "wef"]
CERT_MONEY = ["inc401", "inc402", "sev", "tax", "sev_tax", "sso", "pvd", "co_tax"]
_M = ", ".join(f"{f} DECIMAL(14,2) NULL" for f in MONEY)
_CM = ", ".join(f"{f} DECIMAL(14,2) NULL" for f in CERT_MONEY)
_DDL = {
    "tax_income": f"""ym NVARCHAR(7) NOT NULL, emp_code NVARCHAR(40) NOT NULL, name NVARCHAR(200) NULL, {_M},
        edited_note NVARCHAR(500) NULL, PRIMARY KEY (ym, emp_code)""",
    "tax_months": """ym NVARCHAR(7) NOT NULL PRIMARY KEY, format NVARCHAR(20) NULL, file_name NVARCHAR(300) NULL, people INT NULL,
        income DECIMAL(16,2) NULL, tax DECIMAL(16,2) NULL, saved_at DATETIMEOFFSET NULL, saved_by_name NVARCHAR(200) NULL""",
    "tax_people": """emp_code NVARCHAR(40) NOT NULL PRIMARY KEY, tax_id NVARCHAR(13) NULL, title NVARCHAR(40) NULL, first_th NVARCHAR(100) NULL,
        last_th NVARCHAR(150) NULL, address NVARCHAR(400) NULL, zip NVARCHAR(10) NULL, source NVARCHAR(20) NULL,
        updated_at DATETIMEOFFSET NULL, updated_by_name NVARCHAR(200) NULL""",
    "tax_pnd": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, k NVARCHAR(10) NOT NULL, tax_id NVARCHAR(13) NULL, emp_code NVARCHAR(40) NULL,
        title NVARCHAR(40) NULL, first_th NVARCHAR(100) NULL, last_th NVARCHAR(150) NULL, type NVARCHAR(4) NULL,
        income DECIMAL(14,2) NULL, tax DECIMAL(14,2) NULL""",
    "tax_pnd_files": """k NVARCHAR(10) NOT NULL PRIMARY KEY, file_name NVARCHAR(300) NULL, rows_n INT NULL, income DECIMAL(16,2) NULL,
        tax DECIMAL(16,2) NULL, saved_at DATETIMEOFFSET NULL, saved_by_name NVARCHAR(200) NULL""",
    "tax_certs": f"""year INT NOT NULL, emp_code NVARCHAR(40) NOT NULL, [no] INT NULL, version INT NOT NULL, status NVARCHAR(12) NOT NULL,
        payer NVARCHAR(2) NULL, {_CM}, months NVARCHAR(200) NULL,
        person NVARCHAR(MAX) NULL, signer_id NVARCHAR(64) NULL, signer NVARCHAR(MAX) NULL, requested_by_name NVARCHAR(200) NULL,
        requested_at DATETIMEOFFSET NULL, signed_at DATETIMEOFFSET NULL, issue_date DATE NULL, reason NVARCHAR(500) NULL,
        updated_at DATETIMEOFFSET NULL, PRIMARY KEY (year, emp_code)""",
    "tax_log": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, at DATETIMEOFFSET NOT NULL, by_name NVARCHAR(200) NULL,
        emp_code NVARCHAR(40) NULL, action NVARCHAR(40) NOT NULL, detail NVARCHAR(2000) NULL""",
    "tax_my_attempt": "id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, emp_code NVARCHAR(40) NOT NULL, at DATETIMEOFFSET NOT NULL",
}
PERMS = [("page.tax", "page", "ทะเบียนรายได้และภาษี", "เว็บ /tax: รายได้และภาษีรายคน กระทบยอด ภ.ง.ด.1 / 1ก และ 50 ทวิ", "page.payroll"),
         ("data.tax.write", "data", "จัดการทะเบียนรายได้และภาษี", "นำเข้าไฟล์เงินเดือน/ภ.ง.ด. แก้ยอด เตรียมและส่ง 50 ทวิ เห็นเลขผู้เสียภาษีเต็ม", "data.payroll.write"),
         ("data.tax.sign", "data", "ลงนาม 50 ทวิ พนักงาน", "ลงนามหนังสือรับรองการหักภาษี ณ ที่จ่าย ที่ส่งถึงตัวเอง", "data.contract.approve")]
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
    try:
        r.cur.execute("IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tax_pnd_k') CREATE INDEX ix_tax_pnd_k ON dbo.tax_pnd (k)")
    except Exception:
        pass
    for key, cat, label, desc, grant in PERMS:
        if r.val("SELECT COUNT(*) FROM dbo.permissions WHERE [key] = ?", key):
            continue
        r.cur.execute("INSERT INTO dbo.permissions ([key], category, label, description, sort_order) VALUES (?, ?, ?, ?, ?)",
                      key, cat, label, desc, 26 if cat == "page" else 45)
        for (role,) in r.cur.execute("SELECT role_key FROM dbo.role_permissions WHERE perm_key = ?", grant).fetchall():
            r.cur.execute("INSERT INTO dbo.role_permissions (role_key, perm_key) VALUES (?, ?)", role, key)
    _ready = True


# ---------------------------------------------------------------- เครื่องมือ
def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _today_bkk():
    return (datetime.now(timezone.utc) + timedelta(hours=7)).date().isoformat()


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


def _n(v):
    if v in (None, ""):
        return 0.0
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        raise E(f"ตัวเลขไม่ถูกต้อง: {v}")


def _ym(v):
    v = _s(v, 7)
    if not v or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", v):
        raise E("เดือนไม่ถูกต้อง")
    return v


def _year(v):
    try:
        y = int(v)
    except (TypeError, ValueError):
        raise E("ปีไม่ถูกต้อง")
    if not 2020 <= y <= 2100:
        raise E("ปีไม่ถูกต้อง")
    return y


def valid_tax_id(t):
    t = str(t or "")
    if not re.fullmatch(r"\d{13}", t):
        return False
    s = sum(int(t[i]) * (13 - i) for i in range(12))
    return (11 - s % 11) % 10 == int(t[12])


def _log(r, code, action, detail, who=None):
    r.cur.execute("INSERT INTO dbo.tax_log (at, by_name, emp_code, action, detail) VALUES (?, ?, ?, ?, ?)",
                  _now(), who if who is not None else _me(r), code, action, (detail or "")[:2000])


def _mask(t):
    return ("•" * 8 + t[-5:]) if t else None


def _j(v):
    if not v:
        return None
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return None


def _cert_out(c, money):
    c = dict(c)
    c["person"], c["signer"] = _j(c.get("person")), _j(c.get("signer"))
    if c["signer"]:
        c["signer"] = {k: c["signer"].get(k) for k in ("name_th", "title_th", "signature_path", "seal_path")}
    if not money:
        for f in CERT_MONEY:
            c[f] = None
        if c["person"]:
            c["person"]["tax_id"] = _mask(c["person"].get("tax_id"))
    return c


def _settings(r):
    s = r.rows(None, "SELECT company_name_th, company_tax_id, company_address FROM dbo.contract_settings WHERE id = 1")
    st = r.rows(None, "SELECT seal_path FROM dbo.letter_settings WHERE id = 1")
    out = s[0] if s else {}
    out["seal_path"] = st[0]["seal_path"] if st else None
    return out


# ---------------------------------------------------------------- อ่าน
@fn
def tax_data(r, p_year=None):
    """ภาพรวมของปี: เดือนที่นำเข้า ไฟล์ ภ.ง.ด. ข้อมูลผู้เสียภาษี ใบ 50 ทวิ (ยอดเงินเฉพาะคนที่เห็นเงินเดือนได้)"""
    ensure(r)
    sign = r.has_perm("data.tax.sign")
    if not r.has_perm("page.tax") and not sign:
        raise E("ไม่มีสิทธิ์")
    y = _year(p_year or _today_bkk()[:4])
    page, write, money = r.has_perm("page.tax"), r.has_perm("data.tax.write"), r.has_perm("field.salary.read")
    out = {"year": y, "can_write": write and money, "can_sign": sign, "can_money": money and page, "page": page,
           "settings": _settings(r), "me": r.uid}
    if page:
        out["months"] = r.rows(None, "SELECT * FROM dbo.tax_months WHERE ym LIKE ? ORDER BY ym", f"{y}-%")
        out["pnd"] = r.rows(None, "SELECT * FROM dbo.tax_pnd_files WHERE k LIKE ? ORDER BY k", f"{y}-%")
        out["years"] = [x["y"] for x in r.rows(None, "SELECT DISTINCT LEFT(ym, 4) AS y FROM dbo.tax_months ORDER BY y DESC")]
        people = r.rows(None, "SELECT * FROM dbo.tax_people")
        if not write:
            for p in people:
                p["tax_id"] = _mask(p.get("tax_id"))
        out["people"] = people
        if not money:
            for m in out["months"] + out["pnd"]:
                m["income"] = m["tax"] = None
        out["certs"] = [_cert_out(c, money) for c in r.rows(None, "SELECT * FROM dbo.tax_certs WHERE year = ?", y)]
    else:                                            # ผู้ลงนามที่ไม่ใช่ HR เห็นเฉพาะใบที่ส่งถึงตัวเอง
        out["certs"] = [_cert_out(c, True) for c in r.rows(None, "SELECT * FROM dbo.tax_certs WHERE year = ? AND signer_id = ?", y, str(r.uid))]
    return out


@fn
def tax_year(r, p_year):
    """ยอดรายคนรายเดือนของทั้งปี"""
    _need(r, "page.tax", "field.salary.read")
    return r.rows(None, "SELECT * FROM dbo.tax_income WHERE ym LIKE ? ORDER BY ym, emp_code", f"{_year(p_year)}-%")


@fn
def tax_pnd_rows(r, p_year):
    _need(r, "page.tax", "field.salary.read")
    rows = r.rows(None, "SELECT k, tax_id, emp_code, title, first_th, last_th, type, income, tax FROM dbo.tax_pnd WHERE k LIKE ?", f"{_year(p_year)}-%")
    if not r.has_perm("data.tax.write"):
        for x in rows:
            x["tax_id"] = _mask(x["tax_id"])
    return rows


@fn
def tax_log(r, p_emp_code=None):
    _need(r, "page.tax")
    q = "SELECT TOP 300 at, by_name, emp_code, action, detail FROM dbo.tax_log"
    return r.rows(None, q + (" WHERE emp_code = ? ORDER BY id DESC" if p_emp_code else " ORDER BY id DESC"), *([p_emp_code] if p_emp_code else []))


# ---------------------------------------------------------------- บันทึกยอดรายเดือน
@fn
def tax_month_save(r, p_ym, p_format, p_file, p_rows):
    """แทนยอดทั้งเดือนด้วยไฟล์ที่อัป (ไฟล์ใหม่ของเดือนเดิม = แทนทั้งหมด) · ชื่อคนที่ยังไม่มีในข้อมูลผู้เสียภาษีถูกเพิ่มให้"""
    _need(r, "page.tax", "data.tax.write", "field.salary.read")
    ym = _ym(p_ym)
    r.lock("tax_month")
    who = _me(r)
    seen, batch, inc_t, tax_t = set(), [], 0.0, 0.0
    for x in p_rows or []:
        code = (_s(x.get("emp_code"), 40) or "").upper()
        if not code or code in seen:
            continue
        seen.add(code)
        vals = [_n(x.get(f)) for f in MONEY]
        inc_t += vals[0] + vals[1] + vals[2]
        tax_t += vals[3] + vals[4]
        batch.append((ym, code, _s(x.get("name"), 200), *vals))
    if not batch:
        raise E("ไม่มีรายการในไฟล์")
    old = r.val("SELECT COUNT(*) FROM dbo.tax_income WHERE ym = ?", ym)
    r.cur.execute("DELETE FROM dbo.tax_income WHERE ym = ?", ym)
    r.cur.executemany(f"INSERT INTO dbo.tax_income (ym, emp_code, name, {', '.join(MONEY)}) VALUES (?, ?, ?, {', '.join('?' * len(MONEY))})", batch)
    vals = (_s(p_format, 20), _s(p_file, 300), len(batch), round(inc_t, 2), round(tax_t, 2), _now(), who)
    if r.val("SELECT COUNT(*) FROM dbo.tax_months WHERE ym = ?", ym):
        r.cur.execute("UPDATE dbo.tax_months SET format = ?, file_name = ?, people = ?, income = ?, tax = ?, saved_at = ?, saved_by_name = ? WHERE ym = ?", *vals, ym)
    else:
        r.cur.execute("INSERT INTO dbo.tax_months (format, file_name, people, income, tax, saved_at, saved_by_name, ym) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", *vals, ym)
    # คนที่ยังไม่มีในข้อมูลผู้เสียภาษี (เช่น รายวัน DAY… ที่ไม่อยู่ในทะเบียนพนักงาน) → เก็บชื่อจากไฟล์ไว้ก่อน
    have = {x["emp_code"] for x in r.rows(None, "SELECT emp_code FROM dbo.tax_people")}
    for (_, code, name, *_) in batch:
        if code in have or not name:
            continue
        first, _, last = name.partition(" ")
        r.cur.execute("INSERT INTO dbo.tax_people (emp_code, first_th, last_th, source, updated_at, updated_by_name) VALUES (?, ?, ?, 'payroll', ?, ?)",
                      code, first, last or None, _now(), who)
    _log(r, None, "month", f"{'แทน' if old else 'บันทึก'}ยอด {ym}: {len(batch)} คน · ไฟล์ {p_file or '-'} ({p_format or '-'})", who)
    return {"people": len(batch), "replaced": bool(old)}


@fn
def tax_month_delete(r, p_ym, p_reason=None):
    _need(r, "page.tax", "data.tax.write", "field.salary.read")
    ym = _ym(p_ym)
    r.cur.execute("DELETE FROM dbo.tax_income WHERE ym = ?", ym)
    r.cur.execute("DELETE FROM dbo.tax_months WHERE ym = ?", ym)
    _log(r, None, "month_delete", f"ลบยอดเดือน {ym}" + (f" · {p_reason}" if p_reason else ""))
    return True


@fn
def tax_income_edit(r, p_ym, p_emp_code, p_row, p_reason):
    """แก้ยอดคนเดียวในเดือนเดียว (เช่น ปรับย้อนหลัง) — ต้องมีเหตุผล · ประวัติเก็บค่าเดิม → ใหม่"""
    _need(r, "page.tax", "data.tax.write", "field.salary.read")
    ym, code, why = _ym(p_ym), (_s(p_emp_code, 40) or "").upper(), _s(p_reason, 500)
    if not code or not why:
        raise E("ต้องระบุรหัสพนักงานและเหตุผล")
    old = r.rows(None, "SELECT * FROM dbo.tax_income WHERE ym = ? AND emp_code = ?", ym, code)
    new = {f: _n((p_row or {}).get(f)) for f in MONEY}
    if old:
        o = old[0]
        ch = [f for f in MONEY if abs(float(o.get(f) or 0) - new[f]) >= 0.005]
        if not ch:
            return {"changed": []}
        r.cur.execute(f"UPDATE dbo.tax_income SET {', '.join(f'{f} = ?' for f in MONEY)}, edited_note = ? WHERE ym = ? AND emp_code = ?",
                      *[new[f] for f in MONEY], why, ym, code)
        detail = "; ".join(f"{f}: {float(o.get(f) or 0):,.2f} → {new[f]:,.2f}" for f in ch)
    else:
        ch = [f for f in MONEY if new[f]]
        name = r.val("SELECT TOP 1 CONCAT(first_th, N' ', last_th) FROM dbo.tax_people WHERE emp_code = ?", code)
        r.cur.execute(f"INSERT INTO dbo.tax_income (ym, emp_code, name, {', '.join(MONEY)}, edited_note) VALUES (?, ?, ?, {', '.join('?' * len(MONEY))}, ?)",
                      ym, code, name, *[new[f] for f in MONEY], why)
        detail = "เพิ่มรายการ " + "; ".join(f"{f}: {new[f]:,.2f}" for f in ch)
    _log(r, code, "edit", f"{ym} · {detail} · เหตุผล: {why}")
    return {"changed": ch}


# ---------------------------------------------------------------- ภ.ง.ด.1 / ภ.ง.ด.1ก
@fn
def tax_pnd_save(r, p_key, p_file, p_rows):
    """เก็บไฟล์ที่ยื่นจริง: k = YYYY-MM (ภ.ง.ด.1 รายเดือน) หรือ YYYY-1K (ภ.ง.ด.1ก) · เลขผู้เสียภาษี/ที่อยู่ของคนที่จับคู่ได้
    ใช้เติมข้อมูลผู้เสียภาษี (ไม่ทับที่ HR แก้เอง)"""
    _need(r, "page.tax", "data.tax.write", "field.salary.read")
    k = _s(p_key, 10) or ""
    if not re.fullmatch(r"\d{4}-((0[1-9]|1[0-2])|1K)", k):
        raise E("รอบไม่ถูกต้อง")
    r.lock("tax_pnd")
    who = _me(r)
    batch, inc_t, tax_t, filled = [], 0.0, 0.0, 0
    people = {x["emp_code"]: x for x in r.rows(None, "SELECT emp_code, tax_id, source FROM dbo.tax_people")}
    for x in p_rows or []:
        tid = _s(x.get("tax_id"), 13)
        if not tid:
            continue
        code = (_s(x.get("emp_code"), 40) or "").upper() or None
        inc, tax = _n(x.get("income")), _n(x.get("tax"))
        inc_t += inc
        tax_t += tax
        batch.append((k, tid, code, _s(x.get("title"), 40), _s(x.get("first"), 100), _s(x.get("last"), 150), _s(x.get("type"), 4), inc, tax))
        if not code:
            continue
        p = people.get(code)
        addr = " ".join(v for v in (_s(x.get("addr1")), _s(x.get("addr2"))) if v)[:400] or None
        vals = (tid, _s(x.get("title"), 40), _s(x.get("first"), 100), _s(x.get("last"), 150), addr, _s(x.get("zip"), 10), _now(), who)
        if not p:
            r.cur.execute("""INSERT INTO dbo.tax_people (tax_id, title, first_th, last_th, address, zip, source, updated_at, updated_by_name, emp_code)
                             VALUES (?, ?, ?, ?, ?, ?, 'pnd', ?, ?, ?)""", *vals, code)
            people[code] = {"emp_code": code, "tax_id": tid, "source": "pnd"}
            filled += 1
        elif p.get("source") != "manual" and (p.get("tax_id") != tid or p.get("source") != "pnd"):
            r.cur.execute("""UPDATE dbo.tax_people SET tax_id = ?, title = ?, first_th = ?, last_th = ?, address = ?, zip = ?, source = 'pnd',
                             updated_at = ?, updated_by_name = ? WHERE emp_code = ?""", *vals, code)
            p.update(tax_id=tid, source="pnd")
            filled += 1
    if not batch:
        raise E("ไม่มีรายการในไฟล์")
    r.cur.execute("DELETE FROM dbo.tax_pnd WHERE k = ?", k)
    r.cur.executemany("INSERT INTO dbo.tax_pnd (k, tax_id, emp_code, title, first_th, last_th, type, income, tax) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", batch)
    vals = (_s(p_file, 300), len(batch), round(inc_t, 2), round(tax_t, 2), _now(), who)
    if r.val("SELECT COUNT(*) FROM dbo.tax_pnd_files WHERE k = ?", k):
        r.cur.execute("UPDATE dbo.tax_pnd_files SET file_name = ?, rows_n = ?, income = ?, tax = ?, saved_at = ?, saved_by_name = ? WHERE k = ?", *vals, k)
    else:
        r.cur.execute("INSERT INTO dbo.tax_pnd_files (file_name, rows_n, income, tax, saved_at, saved_by_name, k) VALUES (?, ?, ?, ?, ?, ?, ?)", *vals, k)
    _log(r, None, "pnd", f"บันทึก {'ภ.ง.ด.1ก ' + k[:4] if k.endswith('1K') else 'ภ.ง.ด.1 ' + k}: {len(batch)} รายการ · ไฟล์ {p_file or '-'} · เติมข้อมูลผู้เสียภาษี {filled} คน", who)
    return {"rows": len(batch), "filled": filled}


@fn
def tax_person_save(r, p_emp_code, p_row, p_reason=None):
    """HR แก้เลขผู้เสียภาษี/ชื่อ/ที่อยู่เอง → source manual (ไฟล์ ภ.ง.ด. ที่อัปทีหลังไม่ทับ)"""
    _need(r, "page.tax", "data.tax.write")
    code = (_s(p_emp_code, 40) or "").upper()
    if not code:
        raise E("ไม่มีรหัสพนักงาน")
    x = p_row or {}
    tid = _s(x.get("tax_id"), 13)
    if tid and not re.fullmatch(r"\d{13}", tid):
        raise E("เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก")
    if tid and not valid_tax_id(tid) and not x.get("force"):
        raise E("เลขประจำตัวผู้เสียภาษีไม่ผ่านเลขตรวจสอบ — ตรวจอีกครั้ง")
    row = {"tax_id": tid, "title": _s(x.get("title"), 40), "first_th": _s(x.get("first_th"), 100), "last_th": _s(x.get("last_th"), 150),
           "address": _s(x.get("address"), 400), "zip": _s(x.get("zip"), 10)}
    old = r.rows(None, "SELECT * FROM dbo.tax_people WHERE emp_code = ?", code)
    who = _me(r)
    if old:
        ch = [f for f in row if (old[0].get(f) or None) != row[f]]
        if not ch:
            return {"changed": []}
        r.cur.execute(f"UPDATE dbo.tax_people SET {', '.join(f'{f} = ?' for f in row)}, source = 'manual', updated_at = ?, updated_by_name = ? WHERE emp_code = ?",
                      *row.values(), _now(), who, code)
    else:
        ch = [f for f in row if row[f]]
        r.cur.execute(f"INSERT INTO dbo.tax_people (emp_code, {', '.join(row)}, source, updated_at, updated_by_name) VALUES (?, {', '.join('?' * len(row))}, 'manual', ?, ?)",
                      code, *row.values(), _now(), who)
    _log(r, code, "person", "แก้ข้อมูลผู้เสียภาษี: " + ", ".join(ch) + (f" · {_s(p_reason, 300)}" if p_reason else ""), who)
    return {"changed": ch}


# ---------------------------------------------------------------- 50 ทวิ
def _totals(r, y, code):
    rows = r.rows(None, f"SELECT ym, {', '.join(CERT_MONEY)} FROM dbo.tax_income WHERE ym LIKE ? AND emp_code = ? ORDER BY ym", f"{y}-%", code)
    t = {f: round(sum(float(x.get(f) or 0) for x in rows), 2) for f in CERT_MONEY}
    t["months"] = ",".join(x["ym"][5:] for x in rows)
    return t, len(rows)


@fn
def tax_signers(r):
    _need(r, "page.tax")
    out = []
    for g in r.rows("letter_signers", "SELECT * FROM dbo.letter_signers WHERE signature_path IS NOT NULL"):
        if r.user_has_perm(g["user_id"], "data.tax.sign"):
            out.append({"user_id": g["user_id"], "name": g.get("name_th") or g.get("name_en"), "title": g.get("title_th") or g.get("title_en")})
    return sorted(out, key=lambda x: x["name"] or "")


@fn
def tax_certs_prepare(r, p_year, p_codes, p_payer=None):
    """สร้าง/ปรับร่างจากยอดในทะเบียน (ใบที่รอลงนามหรือลงนามแล้วไม่แตะ — ต้องยกเลิกก่อน)"""
    _need(r, "page.tax", "data.tax.write", "field.salary.read")
    y = _year(p_year)
    r.lock("tax_certs")
    done, skipped = [], []
    for code in {(_s(c, 40) or "").upper() for c in (p_codes or [])} - {""}:
        p = r.rows(None, "SELECT * FROM dbo.tax_people WHERE emp_code = ?", code)
        p = p[0] if p else {}
        if not p.get("tax_id"):
            skipped.append({"emp_code": code, "why": "ไม่มีเลขประจำตัวผู้เสียภาษี"})
            continue
        t, n = _totals(r, y, code)
        if not n:
            skipped.append({"emp_code": code, "why": "ไม่มียอดในปีนี้"})
            continue
        person = json.dumps({k: p.get(k) for k in ("tax_id", "title", "first_th", "last_th", "address", "zip")}, ensure_ascii=False)
        old = r.rows(None, "SELECT status, version, payer FROM dbo.tax_certs WHERE year = ? AND emp_code = ?", y, code)
        payer = _s(p_payer, 2) or (old[0]["payer"] if old else None) or "1"
        if payer not in ("1", "2", "3"):
            raise E("ผู้จ่ายเงินไม่ถูกต้อง")
        vals = [t[f] for f in CERT_MONEY]
        if old and old[0]["status"] in ("pending", "signed"):
            skipped.append({"emp_code": code, "why": "รอลงนาม/ลงนามแล้ว — ยกเลิกก่อนถ้าจะออกใหม่"})
            continue
        if old:
            ver = old[0]["version"] + (1 if old[0]["status"] == "void" else 0)
            r.cur.execute(f"""UPDATE dbo.tax_certs SET status = 'draft', version = ?, payer = ?, {', '.join(f'{f} = ?' for f in CERT_MONEY)}, months = ?,
                              person = ?, signer_id = NULL, signer = NULL, signed_at = NULL, issue_date = NULL, reason = NULL, updated_at = ?
                              WHERE year = ? AND emp_code = ?""", ver, payer, *vals, t["months"], person, _now(), y, code)
        else:
            r.cur.execute(f"""INSERT INTO dbo.tax_certs (year, emp_code, version, status, payer, {', '.join(CERT_MONEY)}, months, person, updated_at)
                              VALUES (?, ?, 1, 'draft', ?, {', '.join('?' * len(CERT_MONEY))}, ?, ?, ?)""", y, code, payer, *vals, t["months"], person, _now())
        done.append(code)
    if done:
        _log(r, None, "prepare", f"เตรียม 50 ทวิ ปี {y}: {len(done)} ใบ" + (f" · ข้าม {len(skipped)}" if skipped else ""))
    return {"prepared": done, "skipped": skipped}


@fn
def tax_certs_send(r, p_year, p_codes, p_signer):
    """ส่งร่างให้ผู้ลงนาม — ได้เลขที่ตอนส่งครั้งแรก (เรียงรหัสพนักงาน ต่อจากเลขสุดท้ายของปี) · ส่งใหม่หลังยกเลิกใช้เลขเดิม"""
    _need(r, "page.tax", "data.tax.write", "field.salary.read")
    y = _year(p_year)
    sid = _s(p_signer, 64)
    s = r.signer(sid) if sid else None
    if not s or not s.get("signature_path") or not r.user_has_perm(sid, "data.tax.sign"):
        raise E("ผู้ลงนามต้องมีสิทธิ์ลงนาม 50 ทวิ และมีลายเซ็นในระบบ")
    r.lock("tax_certs")
    who = _me(r)
    codes = sorted({(_s(c, 40) or "").upper() for c in (p_codes or [])} - {""})
    nxt = (r.val("SELECT MAX([no]) FROM dbo.tax_certs WHERE year = ?", y) or 0) + 1
    sent = []
    for code in codes:
        c = r.rows(None, "SELECT status, [no] FROM dbo.tax_certs WHERE year = ? AND emp_code = ?", y, code)
        if not c or c[0]["status"] != "draft":
            continue
        no = c[0]["no"]
        if not no:
            no, nxt = nxt, nxt + 1
        r.cur.execute("""UPDATE dbo.tax_certs SET status = 'pending', [no] = ?, signer_id = ?, requested_by_name = ?, requested_at = ?, reason = NULL,
                         updated_at = ? WHERE year = ? AND emp_code = ?""", no, sid, who, _now(), _now(), y, code)
        sent.append(code)
    if not sent:
        raise E("ไม่มีร่างที่ส่งได้")
    _log(r, None, "send", f"ส่ง 50 ทวิ ปี {y} ให้ {s.get('name_th') or s.get('name_en')} ลงนาม: {len(sent)} ใบ", who)
    try:
        r.notify(f"50 ทวิ ปี {y + 543} รอลงนาม {len(sent)} ใบ", f"ส่งโดย {who}", r.uid, "/tax/#/sign")
    except Exception:
        pass
    return {"sent": sent}


def _mine_pending(r, y, codes):
    out = []
    for code in sorted({(_s(c, 40) or "").upper() for c in (codes or [])} - {""}):
        c = r.rows(None, "SELECT * FROM dbo.tax_certs WITH (UPDLOCK, ROWLOCK) WHERE year = ? AND emp_code = ?", y, code)
        if c and c[0]["status"] == "pending" and str(c[0]["signer_id"]) == str(r.uid):
            out.append(c[0])
    return out


@fn
def tax_certs_sign(r, p_year, p_codes):
    """ผู้ลงนามลงทีละใบหรือหลายใบในครั้งเดียว — เฉพาะใบที่ส่งถึงตัวเอง · วันที่ออก = วันนี้ (เวลาไทย)"""
    _need(r, "data.tax.sign")
    y = _year(p_year)
    s = r.signer(r.uid) or {}
    if not s.get("signature_path"):
        raise E("ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ “ลายเซ็นของฉัน” ในระบบ HR ก่อน")
    st = r.rows(None, "SELECT seal_path FROM dbo.letter_settings WHERE id = 1")
    snap = json.dumps({"name_th": s.get("name_th") or s.get("name_en"), "title_th": s.get("title_th") or s.get("title_en"),
                       "signature_path": s["signature_path"], "seal_path": st[0]["seal_path"] if st else None}, ensure_ascii=False)
    certs = _mine_pending(r, y, p_codes)
    if not certs:
        raise E("ไม่มีใบที่รอคุณลงนาม")
    day = _today_bkk()
    for c in certs:
        r.cur.execute("UPDATE dbo.tax_certs SET status = 'signed', signer = ?, signed_at = ?, issue_date = ?, updated_at = ? WHERE year = ? AND emp_code = ?",
                      snap, _now(), day, _now(), y, c["emp_code"])
    _log(r, None, "sign", f"ลงนาม 50 ทวิ ปี {y}: {len(certs)} ใบ (" + ", ".join(f"#{c['no']}" for c in certs[:30]) + (" …" if len(certs) > 30 else "") + ")")
    return {"signed": [c["emp_code"] for c in certs], "date": day}


@fn
def tax_certs_return(r, p_year, p_codes, p_reason):
    _need(r, "data.tax.sign")
    y, why = _year(p_year), _s(p_reason, 500)
    if not why:
        raise E("ระบุเหตุผลที่ส่งกลับ")
    certs = _mine_pending(r, y, p_codes)
    for c in certs:
        r.cur.execute("UPDATE dbo.tax_certs SET status = 'draft', reason = ?, updated_at = ? WHERE year = ? AND emp_code = ?", why, _now(), y, c["emp_code"])
    _log(r, None, "return", f"ส่งกลับ 50 ทวิ ปี {y}: {len(certs)} ใบ · {why}")
    return {"returned": [c["emp_code"] for c in certs]}


@fn
def tax_certs_void(r, p_year, p_codes, p_reason):
    """ยกเลิกใบที่รอลงนาม/ลงนามแล้ว (เช่น ตัวเลขเปลี่ยน) → เตรียมใหม่ได้ เลขที่เดิม version + 1"""
    _need(r, "page.tax", "data.tax.write")
    y, why = _year(p_year), _s(p_reason, 500)
    if not why:
        raise E("ระบุเหตุผลที่ยกเลิก")
    n = 0
    for code in {(_s(c, 40) or "").upper() for c in (p_codes or [])} - {""}:
        c = r.rows(None, "SELECT status, [no], version FROM dbo.tax_certs WHERE year = ? AND emp_code = ?", y, code)
        if not c or c[0]["status"] not in ("pending", "signed", "draft"):
            continue
        r.cur.execute("UPDATE dbo.tax_certs SET status = 'void', reason = ?, updated_at = ? WHERE year = ? AND emp_code = ?", why, _now(), y, code)
        _log(r, code, "void", f"ยกเลิก 50 ทวิ ปี {y} เลขที่ {c[0]['no'] or '-'} ครั้งที่ {c[0]['version']} · {why}")
        n += 1
    return {"voided": n}


def _art(r, paths):
    """รูปลายเซ็น/ตราประทับเป็น data URL — หน้าพนักงานไม่มีสิทธิ์อ่าน storage เอง"""
    out = {}
    for p in {x for x in paths if x}:
        try:
            import storage
            data, ctype = storage.get("letter-assets", p)
            out[p] = f"data:{ctype};base64," + base64.b64encode(data).decode()
        except Exception:
            out[p] = ""
    return out


@fn
def tax_print(r, p_year, p_codes):
    """ใบสำหรับพิมพ์/พรีวิว: HR ที่เห็นเงินเดือน · หรือผู้ลงนามของใบนั้น"""
    ensure(r)
    y = _year(p_year)
    hr = r.has_perm("page.tax") and r.has_perm("field.salary.read")
    out = []
    for code in sorted({(_s(c, 40) or "").upper() for c in (p_codes or [])} - {""}):
        c = r.rows(None, "SELECT * FROM dbo.tax_certs WHERE year = ? AND emp_code = ?", y, code)
        if not c:
            continue
        if not hr and str(c[0].get("signer_id")) != str(r.uid):
            continue
        out.append(_cert_out(c[0], True))
    st = _settings(r)
    return {"certs": out, "settings": st, "art": _art(r, [(c["signer"] or {}).get("signature_path") for c in out] + [(c["signer"] or {}).get("seal_path") for c in out])}


@fn
def tax_my_certs(r, p_emp_code, p_tax_id):
    """หน้าพนักงาน /tax/my.html (ไม่ต้อง login): รหัสพนักงาน + เลขผู้เสียภาษี 13 หลักต้องตรงกับที่ HR มี
    ผิดเกิน 8 ครั้งใน 30 นาที → ล็อกรหัสนั้น · ไม่บอกว่ารหัสไหนมีอยู่ (คืน None เหมือนกัน)"""
    ensure(r)
    code, tid = (_s(p_emp_code, 40) or "").upper(), re.sub(r"\D", "", str(p_tax_id or ""))
    if not code or len(tid) != 13:
        return None
    if r.val("SELECT COUNT(*) FROM dbo.tax_my_attempt WHERE emp_code = ? AND at > DATEADD(minute, -30, SYSDATETIMEOFFSET())", code) >= 8:
        raise E("LOCKED")
    p = r.rows(None, "SELECT tax_id, title, first_th, last_th FROM dbo.tax_people WHERE emp_code = ?", code)
    if not p or p[0]["tax_id"] != tid:
        r.cur.execute("INSERT INTO dbo.tax_my_attempt (emp_code, at) VALUES (?, ?)", code, _now())
        r.cn.commit()
        return None
    certs = [_cert_out(c, True) for c in r.rows(None, "SELECT * FROM dbo.tax_certs WHERE emp_code = ? AND status = 'signed' ORDER BY year DESC", code)]
    for c in certs:
        for k in ("signer_id", "requested_by_name", "reason"):
            c.pop(k, None)
    _log(r, code, "my_view", f"พนักงานเปิดดู 50 ทวิ ของตัวเอง ({len(certs)} ใบ)", "พนักงาน")
    return {"name": f"{p[0].get('title') or ''}{p[0].get('first_th') or ''} {p[0].get('last_th') or ''}".strip(), "certs": certs, "settings": _settings(r),
            "art": _art(r, [(c["signer"] or {}).get("signature_path") for c in certs] + [(c["signer"] or {}).get("seal_path") for c in certs])}
