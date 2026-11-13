"""
กองทุนสำรองเลี้ยงชีพ (PVD) — ทะเบียนสมาชิก + ยอดรายเดือน · หน้า pvd (js/pvd.js) เรียกผ่าน supabase.rpc("pvd_…") · user 2026-11-13
กติกา (เพดานสมทบตามอายุงาน สิทธิ์เงินสมทบ ตรวจยอด ไฟล์ส่งกองทุน) อยู่ใน js/pvd-calc.js (มีเทส) — ไฟล์นี้เก็บ/อ่านข้อมูลและตรวจสิทธิ์

ตาราง Azure-only สร้างเองตอนใช้ครั้งแรก ไม่เปิดให้ REST: แก้ได้ผ่านฟังก์ชันในไฟล์นี้เท่านั้น ทุกการแก้มีประวัติใน pvd_log
สิทธิ์: page.pvd = ดูทะเบียน (ไม่เห็นเลขบัตรเต็ม) · data.pvd.write = แก้ทะเบียน/นำเข้า/เห็นเลขบัตร
         ยอดเงินรายคน = เดาเงินเดือนได้ → ต้องมี field.salary.read เพิ่ม (ทั้งดูและบันทึก)
"""
from __future__ import annotations

from datetime import date, datetime, timezone  # noqa: F401

from hooks import HookError as E

FUNCS = {}


def fn(f):
    FUNCS[f.__name__] = f
    return f


_DDL = {
    "pvd_members": """emp_code NVARCHAR(40) NOT NULL PRIMARY KEY, member_code NVARCHAR(20) NULL, id_card NVARCHAR(13) NULL,
        dob NVARCHAR(8) NULL, title_th NVARCHAR(40) NULL, first_th NVARCHAR(100) NULL, last_th NVARCHAR(150) NULL,
        sec_code NVARCHAR(20) NULL, member_date DATE NULL, left_date DATE NULL, emp_rate DECIMAL(6,4) NULL,
        policy NVARCHAR(20) NULL, status NVARCHAR(20) NOT NULL, note NVARCHAR(1000) NULL,
        updated_at DATETIMEOFFSET NULL, updated_by_name NVARCHAR(200) NULL""",
    "pvd_log": """id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, emp_code NVARCHAR(40) NULL, at DATETIMEOFFSET NOT NULL,
        by_name NVARCHAR(200) NULL, action NVARCHAR(40) NOT NULL, detail NVARCHAR(2000) NULL""",
    "pvd_sections": "sec_code NVARCHAR(20) NOT NULL PRIMARY KEY, name NVARCHAR(200) NULL",
    "pvd_runs": """ym NVARCHAR(7) NOT NULL PRIMARY KEY, pay_date DATE NULL, file_name NVARCHAR(300) NULL, source NVARCHAR(20) NULL,
        members INT NULL, emp_total DECIMAL(14,2) NULL, er_total DECIMAL(14,2) NULL, saved_at DATETIMEOFFSET NULL,
        saved_by_name NVARCHAR(200) NULL""",
    "pvd_items": """ym NVARCHAR(7) NOT NULL, emp_code NVARCHAR(40) NOT NULL, member_code NVARCHAR(20) NULL,
        base DECIMAL(14,2) NULL, emp_amt DECIMAL(14,2) NULL, er_amt DECIMAL(14,2) NULL, emp_rate DECIMAL(6,4) NULL,
        er_cap DECIMAL(6,4) NULL, note NVARCHAR(500) NULL, PRIMARY KEY (ym, emp_code)""",
}
PERMS = [("page.pvd", "page", "กองทุนสำรองเลี้ยงชีพ", "ดูทะเบียนสมาชิก PVD และแจ้งเตือน", "page.fundforms"),
         ("data.pvd.write", "data", "จัดการทะเบียนกองทุนสำรองเลี้ยงชีพ", "แก้ทะเบียน นำเข้า บันทึกยอดรายเดือน เห็นเลขบัตรประชาชน", "data.fundforms.write")]
STATUS = {"active", "left", "declined", "pending"}
FIELDS = ["member_code", "id_card", "dob", "title_th", "first_th", "last_th", "sec_code", "member_date", "left_date", "emp_rate",
          "policy", "status", "note"]
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
    for key, cat, label, desc, grant in PERMS:
        if r.val("SELECT COUNT(*) FROM dbo.permissions WHERE [key] = ?", key):
            continue
        r.cur.execute("INSERT INTO dbo.permissions ([key], category, label, description, sort_order) VALUES (?, ?, ?, ?, ?)",
                      key, cat, label, desc, 25 if cat == "page" else 44)
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
    v = str(v).strip()
    return (v[:n] if n else v) or None


def _d(v):
    v = _s(v)
    if not v:
        return None
    try:
        return date.fromisoformat(v[:10]).isoformat()
    except ValueError:
        raise E(f"วันที่ไม่ถูกต้อง: {v}")


def _rate(v):
    if v in (None, ""):
        return None
    x = float(v)
    if x > 1:
        x = x / 100
    if not 0 <= x <= 0.15:
        raise E("อัตราเงินสะสมต้องอยู่ระหว่าง 2–15%")
    return round(x, 4)


def _clean(x):
    out = {"member_code": _s(x.get("member_code"), 20), "id_card": _s(x.get("id_card"), 13), "dob": _s(x.get("dob"), 8),
           "title_th": _s(x.get("title_th"), 40), "first_th": _s(x.get("first_th"), 100), "last_th": _s(x.get("last_th"), 150),
           "sec_code": _s(x.get("sec_code"), 20), "member_date": _d(x.get("member_date")), "left_date": _d(x.get("left_date")),
           "emp_rate": _rate(x.get("emp_rate")), "policy": _s(x.get("policy"), 20), "status": _s(x.get("status")) or "active",
           "note": _s(x.get("note"), 1000)}
    if out["status"] not in STATUS:
        raise E("สถานะไม่ถูกต้อง")
    if out["id_card"] and (len(out["id_card"]) != 13 or not out["id_card"].isdigit()):
        raise E("เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก")
    if out["member_code"]:
        out["member_code"] = out["member_code"].upper()
    return out


def _log(r, code, action, detail, who):
    r.cur.execute("INSERT INTO dbo.pvd_log (emp_code, at, by_name, action, detail) VALUES (?, ?, ?, ?, ?)",
                  code, _now(), who, action, (detail or "")[:2000])


def _upsert(r, code, row, who, action="edit", reason=None):
    """คืนรายการช่องที่เปลี่ยน (ไม่บันทึกค่าเลขบัตรลงประวัติ)"""
    old = r.rows(None, "SELECT * FROM dbo.pvd_members WHERE emp_code = ?", code)
    old = old[0] if old else None
    if old:
        def same(a, b):                              # db.rows ให้วันที่เป็นข้อความ ISO และตัวเลขเป็น int/float แล้ว
            if isinstance(a, str) and len(a) >= 10 and a[4:5] == "-" and isinstance(b, str):
                a = a[:10]
            if isinstance(a, (int, float)) or isinstance(b, (int, float)):
                try:
                    return a is not None and b is not None and abs(float(a) - float(b)) < 1e-9 or (a in (None, "") and b in (None, ""))
                except (TypeError, ValueError):
                    return False
            return (a or None) == (b or None)
        changed = [f for f in FIELDS if not same(old.get(f), row[f])]
        if not changed:
            return []
        r.cur.execute(f"UPDATE dbo.pvd_members SET {', '.join(f'{f} = ?' for f in FIELDS)}, updated_at = ?, updated_by_name = ? WHERE emp_code = ?",
                      *[row[f] for f in FIELDS], _now(), who, code)
        def show(f, v):
            if f == "id_card":
                return "•••" if v else "-"
            return "-" if v in (None, "") else str(v)[:10] if f in ("member_date", "left_date") else str(v)
        detail = "; ".join(f"{f}: {show(f, old.get(f))} → {show(f, row[f])}" for f in changed)
    else:
        r.cur.execute(f"INSERT INTO dbo.pvd_members (emp_code, {', '.join(FIELDS)}, updated_at, updated_by_name) VALUES (?, {', '.join('?' * len(FIELDS))}, ?, ?)",
                      code, *[row[f] for f in FIELDS], _now(), who)
        changed, detail = FIELDS, "เพิ่มในทะเบียน"
    _log(r, code, action if old else ("import" if action == "import" else "add"), detail + (f" · เหตุผล: {reason}" if reason else ""), who)
    return changed


def _members(r, full_id):
    rows = r.rows(None, "SELECT * FROM dbo.pvd_members")
    for m in rows:
        for k in ("member_date", "left_date"):
            m[k] = m[k][:10] if m[k] else None
        if not full_id and m.get("id_card"):
            m["id_card"] = "•" * 8 + m["id_card"][-5:]
    return rows


@fn
def pvd_data(r):
    """ทะเบียน + รหัสสังกัด + รายการเดือนที่บันทึก (+ เดือนแรกที่แต่ละคนส่งเงิน ไว้ตัดสินใจใส่แผนการลงทุน)"""
    _need(r, "page.pvd")
    write, money = r.has_perm("data.pvd.write"), r.has_perm("field.salary.read")
    runs = r.rows(None, "SELECT ym, pay_date, file_name, source, members, emp_total, er_total, saved_at, saved_by_name FROM dbo.pvd_runs ORDER BY ym DESC")
    for x in runs:
        if not money:
            x["emp_total"] = x["er_total"] = None
    first = {x["emp_code"]: x["ym"] for x in r.rows(None, "SELECT emp_code, MIN(ym) AS ym FROM dbo.pvd_items GROUP BY emp_code")}
    return {"members": _members(r, write), "sections": r.rows(None, "SELECT * FROM dbo.pvd_sections ORDER BY sec_code"),
            "runs": runs, "first": first, "can_write": write, "can_money": money}


@fn
def pvd_log(r, p_emp_code=None):
    _need(r, "page.pvd")
    q = "SELECT TOP 300 emp_code, at, by_name, action, detail FROM dbo.pvd_log"
    rows = r.rows(None, q + (" WHERE emp_code = ? ORDER BY id DESC" if p_emp_code else " ORDER BY id DESC"), *([p_emp_code] if p_emp_code else []))
    return rows


@fn
def pvd_member_save(r, p_emp_code, p_row, p_reason=None):
    _need(r, "page.pvd", "data.pvd.write")
    code = _s(p_emp_code, 40)
    if not code:
        raise E("ไม่มีรหัสพนักงาน")
    code = code.upper()
    row = _clean(p_row or {})
    if row["status"] == "active" and row["emp_rate"] is not None and row["emp_rate"] < 0.02:
        raise E("อัตราเงินสะสมต้องอยู่ระหว่าง 2–15%")
    if row["member_code"] and r.val("SELECT COUNT(*) FROM dbo.pvd_members WHERE member_code = ? AND emp_code <> ?", row["member_code"], code):
        raise E(f"รหัสสมาชิก {row['member_code']} มีคนอื่นใช้แล้ว")
    # คนที่ไม่มีสิทธิ์เห็นเลขบัตรเต็มส่งค่าที่ปิดไว้กลับมา → คงค่าเดิม
    if p_row and str(p_row.get("id_card") or "").startswith("•"):
        row["id_card"] = r.val("SELECT id_card FROM dbo.pvd_members WHERE emp_code = ?", code)
    changed = _upsert(r, code, row, _me(r), "edit", _s(p_reason, 500))
    return {"changed": changed}


@fn
def pvd_import(r, p_members, p_sections=None, p_history=None, p_file=None):
    """นำเข้าไฟล์ทะเบียนเดิม (PVD Master): สมาชิก + รหัสสังกัด + ประวัติยอดรายเดือน (เฉพาะเดือนที่ยังไม่มีในระบบ)"""
    _need(r, "page.pvd", "data.pvd.write")
    r.lock("pvd_import")
    who = _me(r)
    added = updated = 0
    for x in p_sections or []:
        c = _s(x.get("sec_code"), 20)
        if not c:
            continue
        if r.val("SELECT COUNT(*) FROM dbo.pvd_sections WHERE sec_code = ?", c):
            r.cur.execute("UPDATE dbo.pvd_sections SET name = ? WHERE sec_code = ?", _s(x.get("name"), 200), c)
        else:
            r.cur.execute("INSERT INTO dbo.pvd_sections (sec_code, name) VALUES (?, ?)", c, _s(x.get("name"), 200))
    for x in p_members or []:
        code = (_s(x.get("emp_code"), 40) or "").upper()
        if not code:
            continue
        existed = r.val("SELECT COUNT(*) FROM dbo.pvd_members WHERE emp_code = ?", code)
        row = _clean(x)
        if row["emp_rate"] is not None and row["emp_rate"] < 0.02 and row["status"] == "active":
            row["note"] = ((row["note"] or "") + " · อัตราสะสมในไฟล์ต่ำกว่า 2%").strip(" ·")
        if _upsert(r, code, row, who, "import", f"ไฟล์ {p_file}" if p_file else None):
            if existed:
                updated += 1
            else:
                added += 1
    months = {}
    if p_history and r.has_perm("field.salary.read"):
        have = {x["ym"] for x in r.rows(None, "SELECT ym FROM dbo.pvd_runs")}
        for h in p_history:
            ym = _s(h.get("ym"), 7)
            if ym and ym not in have:
                months.setdefault(ym, []).append(h)
        for ym, items in months.items():
            _save_items(r, ym, items, None, p_file, "import", who)
    _log(r, None, "import", f"นำเข้า {p_file or ''}: เพิ่ม {added} แก้ {updated} คน · ประวัติ {', '.join(sorted(months)) or '-'}", who)
    return {"added": added, "updated": updated, "months": sorted(months)}


def _save_items(r, ym, items, pay_date, file_name, source, who):
    r.cur.execute("DELETE FROM dbo.pvd_items WHERE ym = ?", ym)
    seen, emp_t, er_t, batch = set(), 0.0, 0.0, []
    num = lambda v, n: None if v is None or v == "" else round(float(v), n)   # noqa: E731
    for i in items:
        code = (_s(i.get("emp_code"), 40) or "").upper()
        if not code or code in seen:
            continue
        seen.add(code)
        e, c = num(i.get("emp_amt"), 2) or 0.0, num(i.get("er_amt"), 2) or 0.0
        emp_t += e
        er_t += c
        batch.append((ym, code, _s(i.get("member_code"), 20), num(i.get("base"), 2), e, c, num(i.get("emp_rate"), 4), num(i.get("er_cap"), 4),
                      _s(i.get("note"), 500)))
    if batch:
        r.cur.executemany("""INSERT INTO dbo.pvd_items (ym, emp_code, member_code, base, emp_amt, er_amt, emp_rate, er_cap, note)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", batch)
    vals = (pay_date, _s(file_name, 300), source, len(seen), round(emp_t, 2), round(er_t, 2), _now(), who)
    if r.val("SELECT COUNT(*) FROM dbo.pvd_runs WHERE ym = ?", ym):
        r.cur.execute("""UPDATE dbo.pvd_runs SET pay_date = ?, file_name = ?, source = ?, members = ?, emp_total = ?, er_total = ?,
                         saved_at = ?, saved_by_name = ? WHERE ym = ?""", *vals, ym)
    else:
        r.cur.execute("""INSERT INTO dbo.pvd_runs (pay_date, file_name, source, members, emp_total, er_total, saved_at, saved_by_name, ym)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", *vals, ym)
    return len(seen), round(emp_t, 2), round(er_t, 2)


@fn
def pvd_month_save(r, p_ym, p_pay_date, p_file, p_items):
    _need(r, "page.pvd", "data.pvd.write", "field.salary.read")
    ym = _s(p_ym, 7)
    if not ym or len(ym) != 7:
        raise E("ไม่มีเดือน")
    r.lock("pvd_month")
    who = _me(r)
    n, e, c = _save_items(r, ym, p_items or [], _d(p_pay_date), p_file, "payroll", who)
    _log(r, None, "month", f"บันทึกยอด {ym}: {n} คน · สะสม {e:,.2f} · สมทบ {c:,.2f} · ไฟล์ {p_file or '-'}", who)
    return {"members": n, "emp_total": e, "er_total": c}


@fn
def pvd_month(r, p_ym):
    _need(r, "page.pvd", "field.salary.read")
    rows = r.rows(None, "SELECT * FROM dbo.pvd_items WHERE ym = ?", _s(p_ym, 7))
    return rows


@fn
def pvd_person(r, p_emp_code):
    """ยอดรายเดือนของคนเดียว (ทุกเดือนที่บันทึก)"""
    _need(r, "page.pvd", "field.salary.read")
    rows = r.rows(None, "SELECT ym, base, emp_amt, er_amt, emp_rate, er_cap FROM dbo.pvd_items WHERE emp_code = ? ORDER BY ym", _s(p_emp_code, 40))
    return rows
