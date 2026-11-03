"""
เทสระบบสารบรรณ (azure-app/dms.py + dms_core.py) บน SQLite ในหน่วยความจำ — ไม่แตะฐานจริง
    python3 -I test/dms_test.py
ครอบคลุมเกณฑ์ตรวจรับ: ออกเลขพร้อมกันไม่ซ้ำ · สิทธิ์ (รายการ/API/ไฟล์/Export/Dashboard) · ข้ามขั้น/เกินสิทธิ์ไม่ได้ ·
ส่งกลับแก้ไขแล้วประวัติครบ · ฉบับจริงไม่ถูกเขียนทับ · แยกอนุมัติ/ลงนาม/ส่ง/รับทราบ · รายการเก่ายังเปิดได้ ·
ระงับทำลายไม่เข้าการทำลาย
"""
import os
import sqlite3
import sys
import threading
import types
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "azure-app"))

# ---- โมดูลที่ dms เรียกแบบ lazy: hooks (HookError) · rpc (_doc_issue)
hooks = types.ModuleType("hooks")


class HookError(Exception):
    pass


hooks.HookError = HookError
sys.modules["hooks"] = hooks

import dms  # noqa: E402
import dms_core as C  # noqa: E402

PASS = FAIL = 0


def ok(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("FAIL", msg)


def raises(f, contains=""):
    try:
        f()
    except (HookError, C.Denied) as e:
        return contains in str(e)
    return False


# ---------------------------------------------------------------- ฐานจำลอง
SCHEMA = """
CREATE TABLE doc_series (code TEXT PRIMARY KEY, label TEXT, prefix TEXT, sort_order INT, is_active INT, direction TEXT);
CREATE TABLE doc_types (id INTEGER PRIMARY KEY, series_code TEXT, label TEXT, template_key TEXT, sort_order INT, is_active INT, confidential INT, form_code TEXT);
CREATE TABLE doc_register (id INTEGER PRIMARY KEY AUTOINCREMENT, series_code TEXT, year INT, seq INT, doc_no TEXT UNIQUE, type_id INT,
  type_label TEXT, subject TEXT, emp_code TEXT, person_name TEXT, issued_date TEXT, ref_doc_no TEXT, note TEXT, batch_id TEXT,
  status TEXT DEFAULT 'active', void_reason TEXT, voided_at TEXT, voided_by TEXT, imported INT DEFAULT 0, created_at TEXT,
  created_by TEXT, updated_at TEXT, confidential INT DEFAULT 0, form_code TEXT, sender TEXT, received_date TEXT,
  UNIQUE (series_code, year, seq));
CREATE TABLE doc_files (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INT, name TEXT, path TEXT UNIQUE, size INT, mime TEXT, note TEXT,
  uploaded_by TEXT, uploaded_name TEXT, uploaded_at TEXT);
CREATE TABLE user_roles (user_id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, created_at TEXT);
CREATE TABLE permissions (key TEXT PRIMARY KEY, category TEXT, label TEXT, description TEXT, sort_order INT);
CREATE TABLE role_permissions (role_key TEXT, perm_key TEXT, PRIMARY KEY (role_key, perm_key));
CREATE TABLE hr_letters (id INTEGER PRIMARY KEY, doc_id INT, status TEXT, approved_at TEXT);
CREATE TABLE paf_forms (id INTEGER PRIMARY KEY, doc_id INT, status TEXT, approved_at TEXT);
CREATE TABLE employees (emp_code TEXT PRIMARY KEY, end_date TEXT);
CREATE TABLE movements (id TEXT PRIMARY KEY, emp_code TEXT, name TEXT, type TEXT, date TEXT, attachment_path TEXT, attachment_name TEXT, created_at TEXT);
CREATE TABLE emp_contracts (id INTEGER PRIMARY KEY, status TEXT, contract_date TEXT, title_th TEXT, name_th TEXT, name_en TEXT,
  position_th TEXT, position_en TEXT, emp_code TEXT, signed_at TEXT, witnessed_at TEXT);
"""


def fresh_db():
    cn = sqlite3.connect(":memory:", check_same_thread=False)
    cn.executescript(SCHEMA)
    cn.executescript("""
      INSERT INTO doc_series VALUES ('HR','หนังสือ HR','HR',1,1,'out'), ('IN','หนังสือรับเข้า','RCV',9,1,'in'), ('MEMO','Memo','Memo-HR',2,1,'out');
      INSERT INTO doc_types VALUES (1,'HR','หนังสือรับรองการทำงาน (ภาษาไทย)',NULL,10,1,0,NULL),
        (2,'HR','หนังสือเลิกจ้าง (Terminate)',NULL,40,1,1,NULL), (3,'IN','หนังสือจากหน่วยงานราชการ',NULL,10,1,0,NULL),
        (4,'HR','หนังสือปรับเงินเดือน',NULL,51,1,1,NULL), (5,'MEMO','บันทึกภายใน',NULL,10,1,0,NULL);
      INSERT INTO permissions VALUES ('page.docregister','page','',NULL,1), ('data.docregister.write','data','',NULL,2), ('data.doc.confidential','data','',NULL,3);
      INSERT INTO role_permissions VALUES ('hr','page.docregister'), ('hr','data.docregister.write'), ('viewer','page.docregister'),
        ('hrm','page.docregister'), ('hrm','data.docregister.write'), ('hrm','data.doc.confidential');
    """)
    dms._ready = False
    dms.ensure(cn.cursor())
    return cn


class R:
    """เหมือน rpc.R ส่วนที่ dms ใช้: cur, uid, has_perm, user_has_perm"""
    def __init__(self, cn, uid, perms, name="ผู้ใช้"):
        self.cn, self.cur, self.uid, self.perms = cn, cn.cursor(), uid, set(perms)
        cn.execute("INSERT OR IGNORE INTO user_roles (user_id, name, email, role) VALUES (?, ?, ?, 'x')", (uid, name, name))

    def has_perm(self, p):
        return p in self.perms

    def user_has_perm(self, uid, p):
        return True


def call(r, name, **kw):
    out = dms.FUNCS[name](r, **kw)
    r.cn.commit()
    return out


def add_doc(cn, series="HR", seq=1, type_id=1, label="หนังสือรับรองการทำงาน (ภาษาไทย)", conf=0, imported=0, created_by=None, **extra):
    cols = {"series_code": series, "year": 2026, "seq": seq, "doc_no": f"{series}-{seq:03d}-2026", "type_id": type_id, "type_label": label,
            "subject": "เรื่องทดสอบ", "issued_date": "2026-11-01", "confidential": conf, "imported": imported, "status": "active",
            "created_by": created_by, **extra}
    c = cn.execute(f"INSERT INTO doc_register ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", list(cols.values()))
    cn.commit()
    return c.lastrowid


def add_file(cn, doc_id, name="scan.pdf"):
    c = cn.execute("INSERT INTO doc_files (doc_id, name, path, size) VALUES (?, ?, ?, 10)", (doc_id, name, f"{doc_id}/{uuid.uuid4().hex}-{name}"))
    cn.commit()
    return c.lastrowid


HR = {"page.docregister", "data.docregister.write", "doc.files.open", "doc.export", "doc.review", "doc.official", "doc.cancel"}
APPROVER = {"page.docregister", "doc.approve", "doc.sign"}
VIEWER = {"page.docregister", "doc.files.open"}
CONF = HR | {"data.doc.confidential", "doc.cat.salary", "doc.cat.discipline", "doc.cat.health"}


# ---------------------------------------------------------------- 1. กติกาล้วน
def t_core():
    rule = C.type_rule("out", "หนังสือรับรองการทำงาน (ภาษาไทย)")
    ok(C.flow_after("draft", rule) == "approval", "รับรองการทำงาน: ร่าง → อนุมัติ (ไม่มีตรวจทาน)")
    ok(C.flow_after("approval", rule) == "signing" and C.flow_after("signing", rule) == "to_issue", "อนุมัติ → ลงนาม → รอออก")
    memo = C.type_rule("out", "บันทึกภายใน")
    ok(C.flow_after("approval", memo) == "to_issue", "Memo ไม่ต้องลงนาม → ข้ามขั้นลงนาม")
    inn = C.type_rule("in", "หนังสือจากหน่วยงานราชการ")
    ok(inn["flow"] == "in" and not inn["need_approval"], "หนังสือรับเข้าไม่ผ่านอนุมัติ")
    ok(C.type_rule("out", "หนังสือเลิกจ้าง (Terminate)")["need_ack"], "หนังสือเลิกจ้างต้องมีผู้รับทราบ")
    ok(not C.type_rule("out", "หนังสือรับรองการทำงาน (ภาษาไทย)")["need_ack"], "หนังสือรับรองไม่ต้องรับทราบ")
    ok(C.add_months(C.date(2024, 2, 29), 12) == C.date(2025, 2, 28), "อายุเก็บนับเดือนถูกในปีอธิกสุรทิน")
    ok(C.retention_until({"status": "draft", "years": 5}, C.date(2020, 1, 1)) is None, "นโยบายร่าง → ไม่คำนวณวันครบ (ไม่เปิดใช้เอง)")
    ok(C.retention_until({"status": "active", "years": 5, "months": 0}, C.date(2020, 1, 1)) == C.date(2025, 1, 1), "นโยบายที่เปิดใช้ → คำนวณได้")
    ok(C.disposal_block({"hold": True, "stage": "closed"}, C.date(2020, 1, 1), C.date(2026, 1, 1)) == "ระงับทำลาย", "ระงับทำลายชนะทุกเงื่อนไข")
    ok(C.disposal_block({"stage": "issued"}, C.date(2020, 1, 1), C.date(2026, 1, 1)) == "เรื่องยังไม่ปิด", "เรื่องที่ยังไม่ปิดทำลายไม่ได้")
    # เรื่องเก่า
    ok(C.derive_meta({"id": 1, "imported": True, "status": "active"}, "out", None, 0)["stage"] == "issued", "ข้อมูล Excel เดิม = ออกแล้ว")
    ok(C.derive_meta({"id": 1, "status": "void"}, "out", None, 0)["stage"] == "cancelled", "เลขยกเลิก = ยกเลิก")
    m = C.derive_meta({"id": 1, "status": "active"}, "out", {"kind": "letter", "status": "approved"}, 0)
    ok(m["stage"] == "issued" and m["origin"] == "system" and m["sign_method"] == "image", "หนังสือ HR อนุมัติแล้ว = ออกแล้ว · ลายเซ็นภาพ (ไม่อ้างเป็น e-signature)")
    ok(C.derive_meta({"id": 1, "status": "active", "batch_id": "b"}, "out", None, 0)["stage"] == "reserved", "เลขชุดที่ยังไม่ใส่เรื่อง = จองไว้")
    fs = C.file_state({"imported": True}, {"stage": "issued", "legacy": True}, rule, [], None)
    ok(fs == "unknown", "ไม่มีไฟล์ของข้อมูลเดิม = ยังไม่สำรวจ (ไม่ใช่สูญหาย)")
    fs = C.file_state({}, {"stage": "issued"}, rule, [], {"kind": "letter", "status": "approved"})
    ok(fs == "in_module", "หนังสือจากระบบ = ฉบับอยู่ในระบบออกหนังสือ")
    ok(C.file_state({}, {"stage": "issued"}, rule, ["signed"], None) == "complete", "มีฉบับลงนาม = ครบ")
    ok(C.file_state({}, {"stage": "issued"}, rule, ["attachment"], None) == "need_signed", "มีแต่เอกสารประกอบ = ยังไม่ครบ (ไม่นับแค่จำนวนไฟล์)")
    ok(C.file_state({}, {"stage": "issued", "file_note": "ส่งทางอีเมลอย่างเดียว"}, rule, [], None) == "not_required", "ไม่ต้องแนบพร้อมเหตุผล")


# ---------------------------------------------------------------- 2. ออกเลขพร้อมกันไม่ซ้ำ (อัลกอริทึม _doc_issue: ล็อกชุด+ปี แล้ว MAX+1)
def t_concurrent_numbers():
    sys.modules.pop("rpc", None)
    for m in ("db", "rest"):
        sys.modules[m] = types.ModuleType(m)
    sys.modules["rest"].Ctx = object
    src = open(os.path.join(HERE, "..", "azure-app", "rpc.py"), encoding="utf-8").read()
    start = src.index("def _doc_issue(")
    end = src.index("\n@fn", start)
    ns = {"E": HookError, "nz": lambda s: (s or "").strip() or None if isinstance(s, str) or s is None else s,
          "datetime": __import__("datetime").datetime, "timezone": __import__("datetime").timezone,
          "timedelta": __import__("datetime").timedelta, "today": lambda: "2026-11-03"}
    exec(src[start:end], ns)
    issue = ns["_doc_issue"]
    path = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"dms_num_{uuid.uuid4().hex}.db")
    base = sqlite3.connect(path)
    base.executescript(SCHEMA + "INSERT INTO doc_series VALUES ('HR','หนังสือ HR','HR',1,1,'out');")
    base.commit(); base.close()
    locks: dict = {}
    guard = threading.Lock()

    class FakeR:
        def __init__(self):
            self.cn = sqlite3.connect(path, timeout=30, check_same_thread=False)
            self.uid = None
            self.held = []

        def val(self, sql, *a):
            row = self.cn.execute(sql.replace("dbo.", "").replace("is_active = 1", "is_active = 1"), a).fetchone()
            return row[0] if row else None

        def lock(self, name):            # = sp_getapplock แบบ Transaction: ถือจนจบธุรกรรม
            with guard:
                lk = locks.setdefault(name, threading.Lock())
            lk.acquire()
            self.held.append(lk)

        def ins(self, table, row):
            cols = list(row)
            self.cn.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", [row[c] for c in cols])
            return row

        def commit(self):
            self.cn.commit()
            for lk in self.held:
                lk.release()
            self.held = []

    got, errs = [], []

    def worker():
        r = FakeR()
        try:
            for _ in range(5):
                out = issue(r, "HR", 2, None, "x", "2026-11-03", None, None, None)
                r.commit()
                got.extend(o["doc_no"] for o in out)
        except Exception as e:
            errs.append(repr(e))
            r.commit()

    ts = [threading.Thread(target=worker) for _ in range(12)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    ok(not errs, f"ออกเลขพร้อมกันไม่มีข้อผิดพลาด {errs[:2]}")
    ok(len(got) == 120 and len(set(got)) == 120, f"12 คน × 5 ครั้ง × 2 เลข = 120 เลขไม่ซ้ำ (ได้ {len(set(got))}/{len(got)})")
    seqs = sorted(int(x.split("-")[1]) for x in got)
    ok(seqs == list(range(1, 121)), "เลขต่อเนื่อง ไม่มีช่องว่าง")
    os.remove(path)


# ---------------------------------------------------------------- 3. เส้นทางหลัก + สิทธิ์ + ประวัติ
def t_flow():
    cn = fresh_db()
    hr = R(cn, "u-hr", HR, "HR ผู้ออกเลข")
    boss = R(cn, "u-boss", APPROVER, "ผู้อนุมัติ")
    other = R(cn, "u-other", APPROVER, "ผู้อนุมัติอีกคน")
    view = R(cn, "u-view", VIEWER, "ผู้ดูอย่างเดียว")
    d = add_doc(cn, created_by="u-hr")
    doc = call(hr, "dms_doc", p_doc_id=d)
    ok(doc["meta"]["stage"] == "draft" and doc["meta"]["legacy"], "เลขที่ออกเองยังไม่มีไฟล์ = ร่าง (อนุมาน ยังไม่เขียนฐาน)")
    ok(cn.execute("SELECT COUNT(*) FROM doc_meta").fetchone()[0] == 0, "เปิดดูอย่างเดียวไม่เขียนฐาน")
    ok(raises(lambda: call(hr, "dms_act", p_doc_id=d, p_action="approve")), "ข้ามขั้น: ร่าง → อนุมัติ ไม่ได้")
    ok(raises(lambda: call(view, "dms_act", p_doc_id=d, p_action="submit"), "ไม่มีสิทธิ์"), "ผู้ดูอย่างเดียวส่งต่อไม่ได้")
    call(hr, "dms_act", p_doc_id=d, p_action="submit", p_opts={"assignee_id": "u-boss", "assignee_name": "ผู้อนุมัติ"})
    ok(call(hr, "dms_doc", p_doc_id=d)["meta"]["stage"] == "approval", "ส่งต่อ → รออนุมัติ")
    ok(raises(lambda: call(hr, "dms_act", p_doc_id=d, p_action="approve"), "ไม่มีสิทธิ์"), "HR ไม่มีสิทธิ์อนุมัติ")
    ok(raises(lambda: call(other, "dms_act", p_doc_id=d, p_action="approve"), "มอบหมายให้"), "มอบหมายให้คนหนึ่งแล้ว คนอื่นอนุมัติแทนไม่ได้")
    ok(raises(lambda: call(boss, "dms_act", p_doc_id=d, p_action="return")), "ส่งกลับต้องมีเหตุผล")
    call(boss, "dms_act", p_doc_id=d, p_action="return", p_reason="แก้ชื่อบริษัทผู้รับ")
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["meta"]["stage"] == "draft" and m["meta"]["returned"], "ส่งกลับแก้ไข → ร่าง (มีธงส่งกลับ)")
    call(hr, "dms_act", p_doc_id=d, p_action="submit", p_opts={"assignee_id": "u-boss", "assignee_name": "ผู้อนุมัติ"})
    call(boss, "dms_act", p_doc_id=d, p_action="approve")
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["meta"]["stage"] == "signing" and m["meta"]["approved_at"] and not m["meta"]["signed_at"], "อนุมัติแล้ว ≠ ลงนามแล้ว")
    ok(raises(lambda: call(boss, "dms_act", p_doc_id=d, p_action="sign", p_opts={"sign_method": "wet_ink"}), "แนบไฟล์ฉบับลงนาม"),
       "บันทึกลงนามต้องมีฉบับลงนามก่อน")
    f1 = add_file(cn, d, "signed.pdf")
    call(hr, "dms_file_set", p_file_id=f1, p_kind="signed")
    call(boss, "dms_act", p_doc_id=d, p_action="sign", p_opts={"sign_method": "wet_ink"})
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["meta"]["stage"] == "to_issue" and m["meta"]["signed_at"] and not m["meta"]["issued_at"], "ลงนามแล้ว ≠ ออกฉบับจริงแล้ว")
    call(hr, "dms_act", p_doc_id=d, p_action="issue", p_opts={"official_file_id": f1})
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["meta"]["stage"] == "issued" and m["file_state"] == "complete", "ออกฉบับจริง · ไฟล์ครบ")
    ok(m["delivery"] == "none" and "บันทึกการส่งมอบ" in m["next"], "ออกแล้วแต่ยังไม่ส่ง → ขั้นต่อไปคือส่งมอบ")
    ok(raises(lambda: call(hr, "dms_act", p_doc_id=d, p_action="close"), "ยังไม่ได้บันทึกการส่งมอบ"), "ยังไม่ส่ง ปิดเรื่องไม่ได้")
    call(hr, "dms_delivery_add", p_doc_id=d, p_d={"recipient": "พนักงาน ก", "channel": "hand", "need_ack": True})
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["delivery"] == "wait_ack", "ส่งแล้ว ≠ รับทราบแล้ว")
    ok(raises(lambda: call(hr, "dms_act", p_doc_id=d, p_action="close"), "รอหลักฐานรับทราบ"), "ยังไม่รับทราบ ปิดไม่ได้")
    did = m["deliveries"][0]["id"]
    ok(raises(lambda: call(hr, "dms_delivery_ack", p_delivery_id=did, p_a={"ack_method": "signature"}), "หลักฐาน"),
       "รับทราบแบบลงชื่อต้องมีหลักฐาน")
    ev = add_file(cn, d, "ack.pdf")
    call(hr, "dms_delivery_ack", p_delivery_id=did, p_a={"ack_method": "signature", "evidence_file_id": ev})
    ok(call(hr, "dms_doc", p_doc_id=d)["delivery"] == "acked", "รับทราบแล้วพร้อมหลักฐาน")
    call(hr, "dms_act", p_doc_id=d, p_action="close")
    ok(raises(lambda: call(hr, "dms_act", p_doc_id=d, p_action="archive"), "ที่เก็บต้นฉบับ"), "จัดเก็บต้องระบุที่เก็บต้นฉบับ")
    call(hr, "dms_act", p_doc_id=d, p_action="archive", p_opts={"paper_location": "ตู้ HR-2 แฟ้ม 2569/11"})
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["meta"]["stage"] == "archived", "จัดเก็บแล้ว")
    acts = [e["action"] for e in reversed(m["events"])]
    want = ["migrate", "submit", "return", "submit", "approve", "file_kind", "sign", "issue", "deliver", "ack", "close", "archive"]
    ok([a for a in acts if a in want] == want, f"ประวัติครบตามลำดับ {acts}")
    ret = next(e for e in m["events"] if e["action"] == "return")
    ok(ret["reason"] == "แก้ชื่อบริษัทผู้รับ" and ret["actor_name"] == "ผู้อนุมัติ", "ประวัติมีผู้กระทำและเหตุผล")
    ok(not any(k.startswith("dms_event") for k in dms.FUNCS), "ไม่มีฟังก์ชันแก้/ลบประวัติ")
    # ผู้สร้างอนุมัติเรื่องตัวเองไม่ได้
    d2 = add_doc(cn, seq=2, created_by="u-self")
    selfr = R(cn, "u-self", HR | APPROVER)
    call(selfr, "dms_act", p_doc_id=d2, p_action="submit")
    ok(raises(lambda: call(selfr, "dms_act", p_doc_id=d2, p_action="approve"), "ตัวเอง"), "แบ่งแยกหน้าที่: ผู้สร้างอนุมัติเองไม่ได้")
    # ชนกัน: สองคนกดพร้อมกัน
    d3 = add_doc(cn, seq=3)
    call(hr, "dms_act", p_doc_id=d3, p_action="submit")
    v = call(hr, "dms_doc", p_doc_id=d3)["meta"]["ver"]
    call(boss, "dms_act", p_doc_id=d3, p_action="approve", p_ver=v)
    ok(raises(lambda: call(other, "dms_act", p_doc_id=d3, p_action="reject", p_ver=v, p_reason="x"), "ผู้อื่นเปลี่ยน"),
       "กดพร้อมกัน: คนที่สองถูกปฏิเสธ ไม่เขียนทับ")


# ---------------------------------------------------------------- 4. ฉบับจริงไม่ถูกเขียนทับ · ฉบับแก้ไข
def t_official():
    cn = fresh_db()
    hr = R(cn, "u-hr", HR)
    d = add_doc(cn)
    f1, f2 = add_file(cn, d, "v1.pdf"), add_file(cn, d, "v2.pdf")
    call(hr, "dms_act", p_doc_id=d, p_action="register_official", p_opts={"sign_method": "external", "official_file_id": f1})
    ok(call(hr, "dms_doc", p_doc_id=d)["meta"]["stage"] == "issued", "ลงทะเบียนฉบับที่ลงนามจากภายนอกแล้ว → ออกฉบับจริง")
    ok(dms.file_locked(cn.cursor(), file_id=f1), "ฉบับจริงถูกล็อก")
    path = cn.execute("SELECT path FROM doc_files WHERE id = ?", (f1,)).fetchone()[0]
    ok(dms.file_locked(cn.cursor(), path=path), "ล็อกตรวจได้จาก path (กันลบ blob ตรง)")
    ok(raises(lambda: dms.block_locked_delete(cn.cursor(), None, {"id": f1}), "ล็อก"), "ลบแถวไฟล์ฉบับจริงไม่ได้")
    ok(raises(lambda: call(hr, "dms_file_set", p_file_id=f1, p_kind="draft"), "ล็อก"), "เปลี่ยนชนิดฉบับจริงไม่ได้")
    ok(raises(lambda: call(hr, "dms_file_supersede", p_doc_id=d, p_new_file_id=f2, p_reason="")), "แทนที่ฉบับจริงต้องมีเหตุผล")
    call(hr, "dms_file_supersede", p_doc_id=d, p_new_file_id=f2, p_reason="แก้คำผิดในวรรคสอง")
    fm = {x["file_id"]: x for x in [dict(zip(["file_id", "is_official", "locked", "replaced_by", "version"], r))
                                      for r in cn.execute("SELECT file_id, is_official, locked, replaced_by, version FROM doc_file_meta")]}
    ok(fm[f1]["locked"] == 1 and fm[f1]["is_official"] == 0 and fm[f1]["replaced_by"] == f2, "ฉบับเดิมยังอยู่ ล็อก และชี้ไปฉบับใหม่")
    ok(fm[f2]["is_official"] == 1 and fm[f2]["version"] == 2, "ฉบับใหม่เป็นรุ่นที่ 2")
    # ฉบับแก้ไขเป็นเลขใหม่
    rpc = types.ModuleType("rpc")

    def _doc_issue(r, series, n, type_id, subject, issued, ref, note, people):
        seq = cn.execute("SELECT COALESCE(MAX(seq),0)+1 FROM doc_register WHERE series_code = ?", (series,)).fetchone()[0]
        nid = add_doc(cn, series=series, seq=seq, type_id=type_id, ref_doc_no=ref)
        return [dict(zip([c[0] for c in cn.execute("SELECT * FROM doc_register WHERE id = ?", (nid,)).description],
                         cn.execute("SELECT * FROM doc_register WHERE id = ?", (nid,)).fetchone()))]
    rpc._doc_issue = _doc_issue
    sys.modules["rpc"] = rpc
    new = call(hr, "dms_revise", p_doc_id=d, p_reason="เปลี่ยนวันที่มีผล")
    old = call(hr, "dms_doc", p_doc_id=d)
    ok(old["meta"]["superseded_by"] == new["id"], "ฉบับเดิมชี้ไปฉบับแก้ไข")
    nd = call(hr, "dms_doc", p_doc_id=new["id"])
    ok(any(l["kind"] == "supersedes" and l["other"]["id"] == d for l in nd["links"]), "ฉบับใหม่มีลิงก์ “แทนที่” ฉบับเดิม")
    ok(raises(lambda: call(hr, "dms_revise", p_doc_id=d, p_reason="อีกรอบ"), "มีฉบับแก้ไขแล้ว"), "ออกฉบับแก้ไขซ้ำไม่ได้")


# ---------------------------------------------------------------- 5. สิทธิ์และหมวดลับ (รายการ / Dashboard / ไฟล์ / Export)
def t_access():
    cn = fresh_db()
    conf = R(cn, "u-conf", CONF)
    salary_only = R(cn, "u-sal", HR | {"data.doc.confidential", "doc.cat.salary"})
    hr = R(cn, "u-hr", HR)
    view = R(cn, "u-view", {"page.docregister"})
    pub = add_doc(cn, seq=1)
    sec = add_doc(cn, seq=2, type_id=2, label="หนังสือเลิกจ้าง (Terminate)", conf=1)
    call(conf, "dms_update", p_doc_id=sec, p_fields={"sensitivity": "discipline"})
    ids = lambda r: {x["id"] for x in call(r, "dms_overview")["docs"]}
    ok(ids(conf) == {pub, sec}, "ผู้มีสิทธิ์ครบเห็นทั้งสองเรื่อง")
    ok(ids(hr) == {pub}, "HR ไม่มีสิทธิ์ลับ → Dashboard/รายการไม่เห็นเรื่องลับ")
    ok(ids(salary_only) == {pub}, "มีสิทธิ์ลับแต่ไม่มีหมวดวินัย → ไม่เห็นเรื่องหมวดวินัย")
    ok(raises(lambda: call(hr, "dms_doc", p_doc_id=sec), "ไม่พบเอกสาร"), "เรียก API ตรงก็ไม่เห็น (ตอบเหมือนไม่มีเอกสาร)")
    ok(raises(lambda: call(salary_only, "dms_act", p_doc_id=sec, p_action="cancel", p_reason="x"), "ไม่พบเอกสาร"), "สั่งงานเรื่องที่มองไม่เห็นไม่ได้")
    # ตัวกรองของ REST / storage
    class Ctx:
        def __init__(self, r):
            self.cur, self.has_perm = r.cur, r.has_perm
    ok(dms.hidden_filter(Ctx(conf), "x") == "", "สิทธิ์ครบ → ไม่มีตัวกรองเพิ่ม")
    f = dms.hidden_filter(Ctx(salary_only), "[doc_register].[id]")
    ok("discipline" in f and "health" in f and "salary" not in f.split("IN")[1], f"ตัวกรอง REST ซ่อนหมวดที่ไม่มีสิทธิ์: {f}")
    ok(C.visible(view.has_perm, False, None) and not C.visible(view.has_perm, True, None), "กติกาเดียวกับ storage: ลับต้องมีสิทธิ์")
    ok(not C.visible(salary_only.has_perm, True, "health"), "storage: หมวดสุขภาพต้องมีสิทธิ์หมวดนั้น")
    ok(raises(lambda: call(view, "dms_export_log", p_count=3), "Export"), "ไม่มีสิทธิ์ Export → ปฏิเสธ")
    call(hr, "dms_export_log", p_count=3, p_filter="ปี 2026")
    ok(cn.execute("SELECT COUNT(*) FROM doc_events WHERE action = 'export'").fetchone()[0] == 1, "Export ถูกบันทึก")
    ok(raises(lambda: call(hr, "dms_update", p_doc_id=pub, p_fields={"sensitivity": "salary"}), "หมวด"), "ตั้งหมวดที่ตัวเองไม่มีสิทธิ์ไม่ได้")
    call(salary_only, "dms_update", p_doc_id=pub, p_fields={"sensitivity": "salary"})
    ok(cn.execute("SELECT confidential FROM doc_register WHERE id = ?", (pub,)).fetchone()[0] == 1, "ตั้งหมวดลับ → ทะเบียนเป็นลับด้วย")
    ok(ids(hr) == set(), "แล้ว HR ที่ไม่มีสิทธิ์ลับก็มองไม่เห็นทันที")
    ev = cn.execute("SELECT detail FROM doc_events WHERE action = 'update'").fetchall()
    ok(all("เรื่องทดสอบ" not in (e[0] or "") for e in ev), "ประวัติไม่คัดลอกเนื้อหาเอกสาร")
    # ผู้ไม่มีสิทธิ์ใช้งานเลย
    nobody = R(cn, "u-none", set())
    ok(raises(lambda: call(nobody, "dms_overview"), "ไม่มีสิทธิ์"), "ไม่มีสิทธิ์หน้าเอกสาร → เรียก API ไม่ได้")


# ---------------------------------------------------------------- 6. รับเข้า · จองเลข · ยกเลิก · รายการเก่า
def t_misc():
    cn = fresh_db()
    hr = R(cn, "u-hr", HR)
    d = add_doc(cn, series="IN", type_id=3, label="หนังสือจากหน่วยงานราชการ")
    ok(call(hr, "dms_doc", p_doc_id=d)["meta"]["stage"] == "registered", "รับเข้าเริ่มที่ลงทะเบียนรับ")
    call(hr, "dms_act", p_doc_id=d, p_action="accept", p_opts={"owner_id": "u-hr", "owner_name": "HR"})
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["meta"]["stage"] == "in_progress" and m["meta"]["owner_name"] == "HR", "มอบหมายแล้วเริ่มดำเนินการ")
    ok(raises(lambda: call(hr, "dms_act", p_doc_id=d, p_action="close"), "รอสแกน"), "รับเข้าต้องมีสแกนก่อนปิด")
    call(hr, "dms_act", p_doc_id=d, p_action="close", p_reason="ต้นฉบับส่งต่อฝ่ายบัญชีแล้ว ไม่ได้สแกน")
    ok(call(hr, "dms_doc", p_doc_id=d)["meta"]["stage"] == "closed", "ปิดโดยมีข้อยกเว้นพร้อมเหตุผล")
    # จองเลข / ยกเลิก
    r1 = add_doc(cn, seq=5, batch_id="b1", subject=None)
    ok(call(hr, "dms_doc", p_doc_id=r1)["meta"]["stage"] == "reserved", "เลขที่ออกเป็นชุดยังไม่ใส่เรื่อง = จองไว้")
    ok(raises(lambda: call(hr, "dms_act", p_doc_id=r1, p_action="cancel")), "ยกเลิกต้องมีเหตุผล")
    call(hr, "dms_act", p_doc_id=r1, p_action="cancel", p_reason="ไม่ได้ใช้")
    row = cn.execute("SELECT status, void_reason, doc_no FROM doc_register WHERE id = ?", (r1,)).fetchone()
    ok(row[0] == "void" and row[1] == "ไม่ได้ใช้" and row[2] == "HR-005-2026", "ยกเลิก = เลขยังอยู่ในทะเบียน (void) ตรวจย้อนได้")
    ok(raises(lambda: call(hr, "dms_act", p_doc_id=r1, p_action="submit")), "เลขที่ยกเลิกแล้วใช้ต่อไม่ได้")
    # รายการเก่าจาก Excel
    old = add_doc(cn, seq=9, imported=1)
    o = call(hr, "dms_doc", p_doc_id=old)
    ok(o["meta"]["stage"] == "issued" and o["file_state"] == "unknown" and o["meta"]["origin"] == "import",
       "ข้อมูลเดิมเปิดได้ · ออกแล้ว · ไฟล์ = ยังไม่สำรวจ")
    ok(cn.execute("SELECT doc_no FROM doc_register WHERE id = ?", (old,)).fetchone()[0] == "HR-009-2026", "เลขเดิมไม่เปลี่ยน")
    call(hr, "dms_update", p_doc_id=old, p_fields={"file_note": "ต้นฉบับอยู่แฟ้ม HR 2569 ไม่ได้สแกน"})
    ok(call(hr, "dms_doc", p_doc_id=old)["file_state"] == "not_required", "ระบุว่าไม่ต้องแนบพร้อมเหตุผลได้")
    # เปลี่ยนผู้รับผิดชอบต้องมีเหตุผล
    call(hr, "dms_update", p_doc_id=old, p_fields={"owner_id": "u-a", "owner_name": "ก"})
    ok(raises(lambda: call(hr, "dms_update", p_doc_id=old, p_fields={"owner_id": "u-b", "owner_name": "ข"}), "เหตุผล"),
       "โอนเรื่องต่อต้องระบุเหตุผล")
    # เรื่องจากระบบออกหนังสือ: ขั้นก่อนออกทำในระบบต้นทาง · สถานะตามต้นทาง
    lt = add_doc(cn, seq=20)
    cn.execute("INSERT INTO hr_letters (id, doc_id, status) VALUES (1, ?, 'pending')", (lt,)); cn.commit()
    call(hr, "dms_update", p_doc_id=lt, p_fields={"owner_id": "u-hr", "owner_name": "HR"})
    ok(call(hr, "dms_doc", p_doc_id=lt)["meta"]["stage"] == "approval", "หนังสือรออนุมัติในระบบออกหนังสือ = รออนุมัติ")
    ok(raises(lambda: call(R(cn, "u-boss2", APPROVER), "dms_act", p_doc_id=lt, p_action="approve"), "ระบบออกหนังสือ"),
       "อนุมัติซ้ำในสารบรรณไม่ได้ ต้องอนุมัติที่ระบบต้นทาง")
    cn.execute("UPDATE hr_letters SET status = 'approved', approved_at = '2026-11-02T03:00:00+00:00' WHERE id = 1"); cn.commit()
    dl = call(hr, "dms_doc", p_doc_id=lt)
    ok(dl["meta"]["stage"] == "issued" and dl["meta"]["sign_method"] == "image", "อนุมัติที่ต้นทางแล้ว → สารบรรณเห็นเป็นออกแล้วเอง (แม้มีแถวสถานะเดิม)")
    ok("close" in dl["actions"] and "approve" not in dl["actions"], "หลังออกแล้วสารบรรณดูแลต่อ (ส่ง/ปิด)")
    # มอบหมายแทน
    d5 = add_doc(cn, seq=11)
    call(hr, "dms_act", p_doc_id=d5, p_action="submit", p_opts={"assignee_id": "u-boss", "assignee_name": "ผู้อนุมัติ"})
    t = call(hr, "dms_doc", p_doc_id=d5)["tasks"][0]
    ok(raises(lambda: call(hr, "dms_task_delegate", p_task_id=t["id"], p_assignee_id="u-x", p_assignee_name="X", p_reason="ลา"), "เฉพาะผู้รับงาน"),
       "มอบหมายแทนได้เฉพาะผู้รับงาน/ผู้ดูแล")
    boss = R(cn, "u-boss", APPROVER)
    call(boss, "dms_task_delegate", p_task_id=t["id"], p_assignee_id="u-x", p_assignee_name="X", p_reason="ลาพักร้อน")
    ts = call(hr, "dms_doc", p_doc_id=d5)["tasks"]
    ok([x["status"] for x in ts] == ["delegated", "open"] and ts[1]["assignee_id"] == "u-x", "มอบหมายแทนพร้อมประวัติ")


# ---------------------------------------------------------------- 7. อายุเก็บ · ระงับทำลาย · การทำลาย
def t_retention():
    cn = fresh_db()
    hr = R(cn, "u-hr", HR)
    rec = R(cn, "u-rec", HR | {"doc.retention"})
    appr = R(cn, "u-appr", {"page.docregister", "doc.dispose.approve", "doc.retention"})
    ok(raises(lambda: call(hr, "dms_retention_save", p_policy={"name": "x", "years": 1, "start_event": "doc_date"}), "ไม่มีสิทธิ์"),
       "ตั้งนโยบายต้องมีสิทธิ์อายุเก็บ")
    pid = call(rec, "dms_retention_save", p_policy={"name": "หนังสือรับรอง 1 ปี", "years": 1, "start_event": "doc_date"})["id"]
    ok(cn.execute("SELECT status FROM doc_retention WHERE id = ?", (pid,)).fetchone()[0] == "draft", "นโยบายใหม่เป็นร่าง ไม่เปิดใช้เอง")
    ok(raises(lambda: call(rec, "dms_retention_save", p_policy={"id": pid, "name": "x", "years": 1, "start_event": "doc_date", "status": "active"}),
              "ผู้อนุมัตินโยบาย"), "เปิดใช้ต้องมีผู้อนุมัตินโยบาย")
    ok(raises(lambda: call(rec, "dms_retention_save", p_policy={"id": pid, "name": "x", "years": 1, "start_event": "doc_date", "status": "active",
                                                                   "approved_by_name": "MD", "approved_on": "2026-11-01", "basis": "ระเบียบบริษัท"}),
              "สิทธิ์อนุมัติทำลาย"), "เปิดใช้ได้เฉพาะผู้มีสิทธิ์อนุมัติทำลาย")
    mgr = R(cn, "u-mgr", HR | {"doc.manage"})
    call(mgr, "dms_rule_save", p_type_id=1, p_rule={**C.type_rule("out", "หนังสือรับรองการทำงาน (ภาษาไทย)"), "retention_id": pid})
    a = add_doc(cn, seq=1, issued_date="2024-01-10", imported=1)
    b = add_doc(cn, seq=2, issued_date="2024-02-10", imported=1)
    c = add_doc(cn, seq=3, issued_date="2026-10-01")
    for d in (a, b):
        call(hr, "dms_act", p_doc_id=d, p_action="close", p_reason="ข้อมูลเดิม")
    ok(call(rec, "dms_disposal_candidates")["items"] == [], "นโยบายยังเป็นร่าง → ไม่มีรายการเข้าเกณฑ์")
    call(appr, "dms_retention_save", p_policy={"id": pid, "name": "หนังสือรับรอง 1 ปี", "years": 1, "start_event": "doc_date", "status": "active",
                                             "approved_by_name": "MD", "approved_on": "2026-11-01", "basis": "ระเบียบบริษัท"})
    items = {x["id"]: x for x in call(rec, "dms_disposal_candidates")["items"]}
    ok(items[a]["block"] is None and items[b]["block"] is None, "ครบอายุและปิดเรื่องแล้ว → เข้าเกณฑ์")
    ok(items[c]["block"], "ยังไม่ครบ/ยังไม่ปิด → ไม่เข้าเกณฑ์")
    call(rec, "dms_hold", p_doc_id=b, p_on=True, p_reason="คดีแรงงาน 123/2569")
    ok(raises(lambda: call(rec, "dms_disposal_propose", p_title="ทำลาย", p_doc_ids=[a, b]), "ยังไม่เข้าเกณฑ์"), "เรื่องที่ระงับเสนอทำลายไม่ได้")
    ok(raises(lambda: call(rec, "dms_disposal_propose", p_title="ทำลาย", p_doc_ids=[c]), "ยังไม่เข้าเกณฑ์"), "เรื่องที่ยังไม่ครบอายุเสนอทำลายไม่ได้")
    x = call(rec, "dms_disposal_propose", p_title="ทำลาย 2567", p_doc_ids=[a], p_files_action="delete")["id"]
    ok(raises(lambda: call(rec, "dms_disposal_decide", p_id=x, p_approve=True), "ไม่มีสิทธิ์"), "ผู้เสนอไม่มีสิทธิ์อนุมัติ")
    self_appr = R(cn, "u-rec", HR | {"doc.retention", "doc.dispose.approve"})
    ok(raises(lambda: call(self_appr, "dms_disposal_decide", p_id=x, p_approve=True), "ของตัวเอง"), "ผู้เสนออนุมัติรายการตัวเองไม่ได้")
    ok(raises(lambda: call(appr, "dms_disposal_execute", p_id=x, p_evidence_ref="x", p_paper_done=True), "ยังไม่ได้รับอนุมัติ"),
       "ยังไม่อนุมัติ ทำลายไม่ได้")
    call(appr, "dms_disposal_decide", p_id=x, p_approve=True)
    # ระหว่างรอทำลาย มีคนสั่งระงับ → ตอนทำลายต้องข้าม
    call(rec, "dms_hold", p_doc_id=a, p_on=True, p_reason="ฝ่ายกฎหมายขอระงับ")
    removed = []
    dms.REMOVE_BLOB = lambda p: removed.append(p) or True
    add_file(cn, a, "old.pdf")
    call(appr, "dms_disposal_execute", p_id=x, p_evidence_ref="บันทึกทำลาย 01/2569", p_paper_done=True)
    ok(call(rec, "dms_doc", p_doc_id=a)["meta"]["stage"] != "disposed" and not removed, "ระงับทำลายระหว่างทาง → ไม่ถูกทำลาย ไม่ลบไฟล์")
    res = cn.execute("SELECT result FROM doc_disposal_items WHERE disposal_id = ?", (x,)).fetchone()[0]
    ok(res == "skipped", "ผลรายการ = ข้าม (ระงับ)")
    # ปลดระงับ แล้วทำลายจริง
    call(rec, "dms_hold", p_doc_id=a, p_on=False, p_reason="คดีจบแล้ว")
    x2 = call(rec, "dms_disposal_propose", p_title="ทำลายรอบ 2", p_doc_ids=[a], p_files_action="delete")["id"]
    call(appr, "dms_disposal_decide", p_id=x2, p_approve=True)
    call(appr, "dms_disposal_execute", p_id=x2, p_evidence_ref="บันทึกทำลาย 02/2569", p_paper_done=True)
    da = call(rec, "dms_doc", p_doc_id=a)
    note = cn.execute("SELECT result_note FROM doc_disposal_items WHERE disposal_id = ?", (x2,)).fetchone()[0]
    ok(da["meta"]["stage"] == "disposed" and len(removed) == 1, "ทำลายแล้ว · ลบไฟล์ในระบบ")
    ok("สำเนาสำรอง" in note and "1/1" in note, f"ผลบอกตามจริงว่าสำเนาสำรองยังอยู่: {note}")
    ok(cn.execute("SELECT doc_no FROM doc_register WHERE id = ?", (a,)).fetchone()[0] == "HR-001-2026", "ทะเบียนยังเก็บเลขที่ถูกทำลายไว้เป็นหลักฐาน")
    dms.REMOVE_BLOB = None


# ---------------------------------------------------------------- 8. ประเภทใหม่ + สัญญาจ้างได้เลขในทะเบียน
def stub_rpc(cn):
    rpc = types.ModuleType("rpc")

    def _doc_issue(r, series, n, type_id, subject, issued, ref, note, people):
        seq = cn.execute("SELECT COALESCE(MAX(seq),0)+1 FROM doc_register WHERE series_code = ?", (series,)).fetchone()[0]
        label = (cn.execute("SELECT label FROM doc_types WHERE id = ?", (type_id,)).fetchone() or [None])[0]
        nid = add_doc(cn, series=series, seq=seq, type_id=type_id, label=label, subject=subject, issued_date=issued,
                      person_name=(people or [{}])[0].get("person_name"), note=note)
        c = cn.execute("SELECT * FROM doc_register WHERE id = ?", (nid,))
        return [dict(zip([d[0] for d in c.description], c.fetchone()))]
    rpc._doc_issue = _doc_issue
    sys.modules["rpc"] = rpc


def t_types_contract():
    cn = fresh_db()
    labels = {r[0]: (r[1], r[2]) for r in cn.execute("SELECT label, confidential, form_code FROM doc_types")}
    for series, label, conf, form, _ in C.NEW_TYPES:
        if series in ("HR", "IN"):
            ok(label in labels and bool(labels[label][0]) == conf, f"เพิ่มประเภท {label}")
    ok(labels["สัญญาจ้างงาน"][1] == "AKR-OHR-FM-006 Rev. 00", "สัญญาจ้างมีรหัสแบบฟอร์ม")
    dms._ready = False
    dms.ensure(cn.cursor())
    ok(cn.execute("SELECT COUNT(*) FROM doc_types WHERE label = 'หนังสือตักเตือน'").fetchone()[0] == 1, "รันซ้ำไม่เพิ่มซ้ำ")
    ok(C.type_rule("out", "หนังสือตักเตือน")["sensitivity"] == "discipline" and C.type_rule("out", "หนังสือตักเตือน")["need_ack"],
       "ตักเตือน = หมวดวินัย + ต้องรับทราบ")
    ok(C.type_rule("in", "ใบรับรองแพทย์ / เอกสารสุขภาพ")["sensitivity"] == "health", "ใบรับรองแพทย์ = หมวดสุขภาพ")
    ok(not C.type_rule("out", "หนังสือรับรองผ่านงาน / ตอบรับการลาออก")["need_ack"], "หนังสือรับรองผ่านงานไม่ต้องรับทราบ")
    # สัญญาจ้าง
    stub_rpc(cn)
    cn.execute("INSERT INTO emp_contracts (id, status, contract_date, title_th, name_th, position_th) VALUES (7, 'pending', '2026-11-02', 'นาย', 'ทดสอบ ระบบ', 'วิศวกร')")
    cn.commit()
    hr = R(cn, "u-hr", CONF)
    d = dms.contract_register(hr, {"id": 7, "contract_date": "2026-11-02", "title_th": "นาย", "name_th": "ทดสอบ ระบบ", "position_th": "วิศวกร"})
    cn.commit()
    ok(dms.contract_register(hr, {"id": 7}) == d, "ส่งลงนามใหม่ใช้เลขเดิม")
    row = cn.execute("SELECT confidential, type_label, person_name FROM doc_register WHERE id = ?", (d,)).fetchone()
    ok(row == (1, "สัญญาจ้างงาน", "นาย ทดสอบ ระบบ"), f"เลขสัญญาเป็นเอกสารลับ ประเภทสัญญาจ้าง {row}")
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["meta"]["stage"] == "signing" and m["source"]["kind"] == "contract", "สัญญารอลงนาม = รอลงนาม (ตามหน้าสัญญาจ้าง)")
    ok("sign" not in m["actions"] and "หน้าสัญญาจ้าง" in m["next"], "ลงนามสัญญาต้องทำที่หน้าสัญญาจ้าง")
    ok(not ids_of(R(cn, "u-hr2", HR)) & {d}, "คนไม่มีสิทธิ์ลับไม่เห็นเลขสัญญา (มีเงินเดือน)")
    cn.execute("UPDATE emp_contracts SET status = 'signed', signed_at = '2026-11-03T02:00:00+00:00', witnessed_at = '2026-11-03T03:00:00+00:00' WHERE id = 7")
    cn.commit()
    m = call(hr, "dms_doc", p_doc_id=d)
    ok(m["meta"]["stage"] == "issued" and m["file_state"] == "need_signed" and m["rule"]["need_ack"],
       "ลงนามครบ → ออกแล้ว · รอสแกนฉบับที่พนักงานเซ็น · ต้องรับทราบ")
    # backfill
    cn.execute("INSERT INTO emp_contracts (id, status, contract_date, name_th) VALUES (8, 'signed', '2026-10-20', 'คนเก่า'), (9, 'cancelled', '2026-10-21', 'ยกเลิก')")
    cn.commit()
    ok(call(hr, "dms_contract_pending")["count"] == 1, "สัญญาเก่าที่ยังไม่มีเลข 1 ฉบับ (ไม่นับที่ยกเลิก)")
    ok(raises(lambda: call(R(cn, "u-hr2", HR), "dms_contract_backfill"), "ลับ"), "ออกเลขย้อนหลังต้องมีสิทธิ์เอกสารลับ")
    ok(call(hr, "dms_contract_backfill")["count"] == 1 and call(hr, "dms_contract_pending")["count"] == 0, "ออกเลขย้อนหลังครั้งเดียว")
    # ยกเลิกสัญญา → ยกเลิกเลข
    class Ctx:
        uid = "u-hr"
    dms.contract_cancelled(cn.cursor(), Ctx, {"status": "pending"}, {"id": 7, "status": "cancelled"})
    cn.commit()
    ok(cn.execute("SELECT status, void_reason FROM doc_register WHERE id = ?", (d,)).fetchone() == ("void", "ยกเลิกสัญญาจ้าง"), "ยกเลิกสัญญา → เลขถูกยกเลิก")


def t_resign_paf():
    cn = fresh_db()
    stub_rpc(cn)
    hr = R(cn, "u-hr", HR | {"data.movement.create"})
    copied = []
    dms.COPY_BLOB = lambda src, dst: copied.append((src, dst)) or (1234, "application/pdf")
    cn.execute("INSERT INTO movements VALUES ('m-1', 'AKR1', 'สมหญิง ลาออก', 'Resignation', '2026-12-01', 'AKR1/1-letter.pdf', 'ใบลาออก สมหญิง.pdf', '2026-11-03T03:00:00+00:00')")
    cn.execute("INSERT INTO movements VALUES ('m-2', 'AKR2', 'โอน', 'Transfer', '2026-12-01', 'AKR2/x.pdf', 'x.pdf', '2026-11-03')")
    cn.commit()
    ok(call(hr, "dms_movement_pending")["count"] == 1, "นับเฉพาะ Movement ลาออกที่มีไฟล์")
    x = call(hr, "dms_from_movement", p_path="AKR1/1-letter.pdf")
    ok(x["doc_no"].startswith("IN-"), f"ได้เลขรับ {x}")
    d = call(hr, "dms_doc", p_doc_id=x["doc_id"])
    row = cn.execute("SELECT type_label, sender, person_name, emp_code FROM doc_register WHERE id = ?", (x["doc_id"],)).fetchone()
    ok(row[0] == "ใบลาออก" and row[1] == "สมหญิง ลาออก", f"ประเภทใบลาออก จากพนักงาน {row}")
    ok(d["meta"]["stage"] == "closed" and d["file_state"] == "complete" and d["files"][0]["kind"] == "received", "ลงรับ + ไฟล์ + ปิดเรื่อง (ดำเนินการใน Movement แล้ว)")
    ok(copied and copied[0][0] == "AKR1/1-letter.pdf" and copied[0][1].startswith(f"{x['doc_id']}/"), "คัดลอกไฟล์ไปที่เก็บของสารบรรณ")
    ok(call(hr, "dms_from_movement", p_path="AKR1/1-letter.pdf")["doc_id"] == x["doc_id"] and len(copied) == 1, "บันทึกซ้ำไม่ออกเลขใหม่/ไม่คัดลอกซ้ำ")
    cn.execute("UPDATE movements SET attachment_path = 'AKR1/2-new.pdf', attachment_name = 'ใบลาออกฉบับแก้.pdf' WHERE id = 'm-1'"); cn.commit()
    ok(call(hr, "dms_from_movement", p_path="AKR1/2-new.pdf")["doc_id"] == x["doc_id"] and len(call(hr, "dms_doc", p_doc_id=x["doc_id"])["files"]) == 2,
       "เปลี่ยนไฟล์ = เพิ่มไฟล์ในเรื่องเดิม")
    ok(call(hr, "dms_from_movement", p_path="AKR2/x.pdf") is None, "Movement ประเภทอื่นไม่ลงรับ")
    ok(call(hr, "dms_movement_pending")["count"] == 0, "ไม่มีค้าง")
    dms.COPY_BLOB = None
    # ยกเลิกเลข PAF ในสารบรรณ → PAF ถูกยกเลิกด้วย
    p = add_doc(cn, series="HR", seq=50, label="Personnel Action Form")
    cn.execute("INSERT INTO paf_forms (id, doc_id, status, approved_at) VALUES (1, ?, 'approved', '2026-10-16T04:46:00+00:00')", (p,)); cn.commit()
    pm = call(hr, "dms_doc", p_doc_id=p)
    ok(pm["meta"]["stage"] == "issued" and "signing" not in [s for s in ("signing",) if pm["rule"]["need_sign"]], "PAF ไม่มีขั้นลงนาม (อนุมัติเป็นบันทึกในระบบ)")
    call(hr, "dms_act", p_doc_id=p, p_action="cancel", p_reason="เอกสารทดสอบ เลขซ้ำกับฉบับกระดาษ")
    ok(cn.execute("SELECT status FROM paf_forms WHERE id = 1").fetchone()[0] == "cancelled" and
       cn.execute("SELECT status FROM doc_register WHERE id = ?", (p,)).fetchone()[0] == "void", "ยกเลิกเลข PAF → PAF ยกเลิกด้วย เลขเป็น void")


def ids_of(r):
    return {x["id"] for x in dms.FUNCS["dms_overview"](r)["docs"]}


if __name__ == "__main__":
    for t in (t_core, t_concurrent_numbers, t_flow, t_official, t_access, t_misc, t_retention, t_types_contract, t_resign_paf):
        try:
            t()
        except Exception:
            import traceback
            FAIL += 1
            print("ERROR in", t.__name__)
            traceback.print_exc()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
