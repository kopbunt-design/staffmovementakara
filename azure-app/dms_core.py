"""
ระบบสารบรรณและควบคุมเอกสาร HR — กติกาล้วน (ไม่แตะฐานข้อมูล · เทส test/dms_test.py) · user 2026-11-03

ต่อยอดจากสารบัญเอกสาร (/docs): ทะเบียนเลข doc_register เดิมไม่เปลี่ยน — ข้อมูลกระบวนการอยู่ในตารางแยก (dms.py)
แยกมิติที่เคยปนกันในคอลัมน์ "ที่มา · สถานะ" เดิม:
  ที่มา (origin)        system = สร้างจากโมดูลอื่น (หนังสือ HR / PAF) · manual = ออกเลข/ลงทะเบียนเอง · import = Excel เดิม
  ขั้นตอน (stage)       ร่าง → ตรวจทาน → อนุมัติ → ลงนาม → ออกฉบับจริง → ปิดเรื่อง → จัดเก็บ → ทำลาย (ข้ามขั้นตามประเภท)
  อนุมัติ / ลงนาม / ส่ง / รับทราบ = คนละข้อมูล (approved_at, signed_at, ตาราง doc_deliveries)
  ไฟล์ (file state)     ตามประเภทและขั้นตอน ไม่ใช่นับจำนวนไฟล์
  ชั้นข้อมูล (sensitivity) general / personal / confidential / salary / discipline / health
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

BKK = timezone(timedelta(hours=7))


def today_bkk() -> date:
    return datetime.now(BKK).date()


# ---------------------------------------------------------------- ขั้นตอน
STAGES = {
    "reserved":    "จองเลขไว้",
    "registered":  "ลงทะเบียนรับ",
    "draft":       "ร่าง",
    "review":      "รอตรวจทาน",
    "approval":    "รออนุมัติ",
    "signing":     "รอลงนาม",
    "to_issue":    "รอออกฉบับจริง",
    "issued":      "ออกฉบับจริงแล้ว",
    "in_progress": "กำลังดำเนินการ",
    "closed":      "ปิดเรื่อง",
    "archived":    "จัดเก็บแล้ว",
    "disposed":    "ทำลายแล้ว",
    "rejected":    "ไม่อนุมัติ",
    "cancelled":   "ยกเลิก",
}
OPEN_STAGES = {"reserved", "registered", "draft", "review", "approval", "signing", "to_issue", "issued", "in_progress"}
TERMINAL = {"disposed", "cancelled"}
FLOW_OUT = ["draft", "review", "approval", "signing", "to_issue", "issued"]

# ---------------------------------------------------------------- ชั้นข้อมูล
SENS = {
    "general":      "ทั่วไป",
    "personal":     "ข้อมูลส่วนบุคคล",
    "confidential": "ลับ",
    "salary":       "ลับ · เงินเดือน/ค่าตอบแทน",
    "discipline":   "ลับ · วินัย/เลิกจ้าง",
    "health":       "ลับ · สุขภาพ",
}
CAT_PERM = {"salary": "doc.cat.salary", "discipline": "doc.cat.discipline", "health": "doc.cat.health"}
CONFIDENTIAL_SENS = {"confidential", "salary", "discipline", "health"}

# ---------------------------------------------------------------- สิทธิ์ (ต่อจาก page.docregister / data.docregister.write / data.doc.confidential เดิม)
# grant = ให้บทบาทที่มีสิทธิ์เดิมตัวนี้อยู่แล้วตอนติดตั้งครั้งแรก (คงพฤติกรรมเดิม) · None = Admin เท่านั้นจนกว่าจะตั้ง
PERMS = [
    ("doc.files.open",      "เปิด/ดาวน์โหลดไฟล์เอกสาร", "เปิดไฟล์แนบในสารบรรณ (ทุกครั้งถูกบันทึก)", "page.docregister"),
    ("doc.export",          "Export ทะเบียนเอกสาร",      "ดาวน์โหลด Excel ทะเบียน (บันทึกทุกครั้ง)", "page.docregister"),
    ("doc.review",          "ตรวจทานเอกสาร",            "ผ่านตรวจทาน / ส่งกลับแก้ไข", "data.docregister.write"),
    ("doc.official",        "ออก/ลงทะเบียนฉบับจริง",     "กำหนดฉบับจริง ลงทะเบียนเอกสารที่ลงนามจากภายนอกแล้ว", "data.docregister.write"),
    ("doc.cancel",          "ยกเลิกเอกสาร/เลข",          "ยกเลิกเรื่องและเลขที่ (เลขไม่ถูกนำกลับมาใช้)", "data.docregister.write"),
    ("doc.approve",         "อนุมัติเอกสาร",             "อนุมัติ / ไม่อนุมัติ / ส่งกลับแก้ไข", None),
    ("doc.sign",            "บันทึกการลงนาม",            "บันทึกว่าลงนามแล้วพร้อมวิธีลงนามและฉบับลงนาม", None),
    ("doc.manage",          "ผู้ดูแลสารบรรณ",            "มอบหมายแทน เปิดเรื่องใหม่ ตั้งค่าขั้นตอนตามประเภท", None),
    ("doc.retention",       "อายุเก็บและการระงับทำลาย",  "ตั้งนโยบายอายุเก็บ ระงับทำลาย เสนอรายการทำลาย", None),
    ("doc.dispose.approve", "อนุมัติทำลายเอกสาร",        "อนุมัติ/ไม่อนุมัติรายการทำลาย และบันทึกผลการทำลาย", None),
    ("doc.cat.salary",      "ดูเอกสารหมวดเงินเดือน",      "เอกสารลับหมวดเงินเดือน/ค่าตอบแทน", "data.doc.confidential"),
    ("doc.cat.discipline",  "ดูเอกสารหมวดวินัย",          "เอกสารลับหมวดวินัย/เลิกจ้าง", "data.doc.confidential"),
    ("doc.cat.health",      "ดูเอกสารหมวดสุขภาพ",         "เอกสารลับหมวดสุขภาพ", "data.doc.confidential"),
]


def hidden_cats(has_perm) -> list[str]:
    """หมวดลับที่ผู้ใช้นี้ไม่มีสิทธิ์ดู"""
    return [c for c, p in CAT_PERM.items() if not has_perm(p)]


def visible(has_perm, confidential, sensitivity) -> bool:
    """กติกาเดียวกับ rule_filter (rest.py) และ storage.py — ใช้กับทุกช่องทาง: รายการ ค้นหา Dashboard ไฟล์ Export"""
    if not has_perm("page.docregister"):
        return False
    if confidential and not has_perm("data.doc.confidential"):
        return False
    return sensitivity not in CAT_PERM or has_perm(CAT_PERM[sensitivity])


# ---------------------------------------------------------------- ขั้นตอนตามประเภท
DEFAULT_RULE = {"flow": "out", "need_review": False, "need_approval": True, "need_sign": True, "need_delivery": True,
                "need_ack": False, "need_draft_file": False, "need_signed_file": True, "sensitivity": "general",
                "retention_id": None, "due_days": None}

# ค่าเริ่มต้นตามประเภทเดิม (แก้ได้ในหน้าตั้งค่า) — เป็นค่าตั้งทางงาน ไม่ใช่นโยบายอายุเก็บ
TYPE_DEFAULTS = [
    ("รับรองการทำงาน", {"sensitivity": "personal", "due_days": 3}),
    ("รับรองเงินเดือน", {"sensitivity": "salary", "due_days": 3}),
    ("Offer Letter",   {"sensitivity": "salary", "need_ack": True}),
    ("เลิกจ้าง",        {"sensitivity": "discipline", "need_review": True, "need_ack": True}),
    ("ปรับตำแหน่ง",     {"sensitivity": "personal", "need_ack": True}),
    ("ปรับเงินเดือน",   {"sensitivity": "salary", "need_ack": True}),
    ("ฝึกงาน",          {"sensitivity": "personal"}),
    ("ประกาศ",          {"need_review": True, "need_delivery": False}),
    ("บันทึกภายใน",     {"flow": "internal", "need_sign": False, "need_delivery": False}),
    ("Personnel Action Form", {"sensitivity": "salary", "need_sign": False, "need_ack": True}),   # อนุมัติเป็นบันทึกในระบบ ไม่มีลายเซ็น
    # เพิ่ม 2026-11-03 (user: ตรวจประเภทแล้วให้เพิ่ม)
    ("สัญญาจ้าง",        {"sensitivity": "salary", "need_approval": False, "need_ack": True}),   # ลงนามในหน้าสัญญาจ้าง · พนักงานเซ็นรับบนกระดาษ
    ("หน่วยงานราชการ",   {}),
    ("ตักเตือน",         {"sensitivity": "discipline", "need_review": True, "need_ack": True}),
    ("พักงาน",           {"sensitivity": "discipline", "need_review": True, "need_ack": True}),
    ("ทดลองงาน",         {"sensitivity": "personal", "need_ack": True}),
    ("แต่งตั้ง",          {"need_ack": True}),
    ("โยกย้าย",          {"sensitivity": "personal", "need_ack": True}),
    ("ผ่านงาน",          {"sensitivity": "personal", "due_days": 3}),
]
IN_DEFAULTS = [("ใบลาออก", {"sensitivity": "personal"}), ("ใบรับรองแพทย์", {"sensitivity": "health"}),
               ("บังคับคดี", {"sensitivity": "salary"})]

# ประเภทที่ระบบเพิ่มให้เอง (ครั้งเดียว ถ้ายังไม่มีชื่อนี้ในชุดนั้น) — (ชุด, ชื่อ, ลับ, รหัสแบบฟอร์ม, ลำดับ)
NEW_TYPES = [
    ("HR", "หนังสือถึงหน่วยงานราชการ (ประกันสังคม / แรงงาน / สรรพากร)", False, None, 62),
    ("HR", "หนังสือตักเตือน", True, None, 41),
    ("HR", "หนังสือพักงาน", True, None, 42),
    ("HR", "หนังสือแจ้งผลทดลองงาน (ผ่าน / ไม่ผ่าน)", False, None, 35),
    ("HR", "คำสั่งแต่งตั้ง / มอบหมายรักษาการ", False, None, 52),
    ("HR", "หนังสือโยกย้าย / ยืมตัว", False, None, 53),
    ("HR", "หนังสือรับรองผ่านงาน / ตอบรับการลาออก", False, None, 25),
    ("HR", "สัญญาจ้างงาน", True, "AKR-OHR-FM-006 Rev. 00", 31),
    ("IN", "ใบลาออก", False, None, 31),
    ("IN", "ใบรับรองแพทย์ / เอกสารสุขภาพ", True, None, 32),
    ("IN", "หนังสือจากศาล / กรมบังคับคดี", True, None, 15),
]
CONTRACT_TYPE = "สัญญาจ้างงาน"


def type_rule(series_direction: str, type_label: str | None, stored: dict | None = None) -> dict:
    r = dict(DEFAULT_RULE)
    if series_direction == "in":
        r.update(flow="in", need_review=False, need_approval=False, need_sign=False, need_delivery=False,
                 need_signed_file=False)
        for key, over in IN_DEFAULTS:
            if key in (type_label or ""):
                r.update(over)
                break
    else:
        for key, over in TYPE_DEFAULTS:
            if key in (type_label or ""):
                r.update(over)
                break
    for k, v in (stored or {}).items():
        if k in DEFAULT_RULE and v is not None:
            r[k] = bool(v) if isinstance(DEFAULT_RULE[k], bool) else v
    return r


def flow_after(stage: str, rule: dict) -> str:
    """ขั้นถัดไปจาก stage ตามประเภท (ข้ามขั้นที่ประเภทนี้ไม่ต้องมี)"""
    seq = ["draft"] + (["review"] if rule["need_review"] else []) + (["approval"] if rule["need_approval"] else []) \
        + (["signing"] if rule["need_sign"] else []) + ["to_issue"]
    if stage not in seq:
        raise ValueError(stage)
    i = seq.index(stage)
    return seq[i + 1] if i + 1 < len(seq) else "issued"


# ---------------------------------------------------------------- การดำเนินการ: ใครทำอะไรได้จากขั้นไหน
# perm = สิทธิ์ที่ต้องมี · "owner" = ผู้รับผิดชอบเรื่อง หรือผู้มีสิทธิ์ออกเลข (data.docregister.write) · reason = ต้องใส่เหตุผล
ACTIONS = {
    "submit":     {"from": {"draft"}, "perm": "owner", "label": "ส่งต่อขั้นถัดไป"},
    "review_ok":  {"from": {"review"}, "perm": "doc.review", "task": "review", "label": "ผ่านการตรวจทาน"},
    "approve":    {"from": {"approval"}, "perm": "doc.approve", "task": "approve", "label": "อนุมัติ"},
    "sign":       {"from": {"signing"}, "perm": "doc.sign", "task": "sign", "label": "บันทึกการลงนาม"},
    "return":     {"from": {"review", "approval", "signing"}, "perm": "stage", "reason": True, "label": "ส่งกลับแก้ไข"},
    "reject":     {"from": {"approval"}, "perm": "doc.approve", "task": "approve", "reason": True, "label": "ไม่อนุมัติ"},
    "issue":      {"from": {"to_issue"}, "perm": "doc.official", "label": "ออกฉบับจริง"},
    # จาก "ออกแล้ว" ได้ด้วย: เรื่องเก่าที่แนบสแกนไว้แต่ยังไม่เคยกำหนดว่าไฟล์ไหนคือฉบับจริง (ถ้ามีฉบับจริงแล้วระบบปฏิเสธ)
    "register_official": {"from": {"reserved", "draft", "registered", "issued"}, "perm": "doc.official", "reason": False,
                          "label": "ลงทะเบียนฉบับจริงที่ลงนามแล้ว"},
    "accept":     {"from": {"registered"}, "perm": "owner", "label": "รับเรื่อง/เริ่มดำเนินการ"},
    "use_reserved": {"from": {"reserved"}, "perm": "owner", "label": "ใช้เลขที่จองไว้"},
    "close":      {"from": {"issued", "in_progress", "registered"}, "perm": "owner", "label": "ปิดเรื่อง"},
    "archive":    {"from": {"closed"}, "perm": "owner", "label": "จัดเก็บ"},
    "reopen":     {"from": {"closed", "archived", "rejected"}, "perm": "doc.manage", "reason": True, "label": "เปิดเรื่องใหม่"},
    "cancel":     {"from": OPEN_STAGES | {"rejected", "closed"}, "perm": "doc.cancel", "reason": True, "label": "ยกเลิก"},
}
STAGE_PERM = {"review": "doc.review", "approval": "doc.approve", "signing": "doc.sign"}
SIGN_METHODS = {
    "wet_ink":   "ลงนามด้วยมือบนกระดาษ (แนบสแกนฉบับลงนาม)",
    "external":  "ลงนามโดยหน่วยงาน/ผู้ลงนามภายนอกแล้ว",
    "esign":     "ลายมือชื่ออิเล็กทรอนิกส์จากระบบที่ตรวจสอบได้ (ระบุระบบ)",
    "image":     "ภาพลายเซ็นจากระบบ HR (ไม่ใช่ลายมือชื่ออิเล็กทรอนิกส์ที่ตรวจสอบได้)",
}


class Denied(Exception):
    pass


def check_action(action: str, meta: dict, actor: dict, has_perm, reason: str | None = None, task: dict | None = None) -> None:
    """ยกเว้น Denied พร้อมข้อความภาษาไทยถ้าทำไม่ได้ · actor = {uid} · task = งานที่เปิดอยู่ของขั้นนี้ (ถ้ามี)"""
    a = ACTIONS.get(action)
    if not a:
        raise Denied("ไม่รู้จักการดำเนินการนี้")
    st = meta.get("stage")
    if meta.get("hold") and action == "cancel":
        raise Denied("เอกสารนี้ถูกระงับทำลาย/ระงับการเปลี่ยนแปลง — ยกเลิกไม่ได้จนกว่าจะปลดการระงับ")
    if st not in a["from"]:
        raise Denied(f"ทำ “{a['label']}” จากขั้น “{STAGES.get(st, st)}” ไม่ได้")
    if a.get("reason") and not (reason or "").strip():
        raise Denied("ต้องระบุเหตุผล")
    manage = has_perm("doc.manage")
    p = a["perm"]
    if p == "owner":
        ok = manage or has_perm("data.docregister.write") or (meta.get("owner_id") and str(meta["owner_id"]) == str(actor.get("uid")))
    elif p == "stage":
        ok = manage or has_perm(STAGE_PERM[st])
    else:
        ok = manage or has_perm(p)
    if not ok:
        raise Denied("ไม่มีสิทธิ์ดำเนินการนี้")
    # งานที่มอบหมายให้คนใดคนหนึ่ง: คนนั้น (หรือผู้ดูแลสารบรรณ) เท่านั้นที่ทำได้
    need = a.get("task") or ({"review": "review", "approval": "approve", "signing": "sign"}.get(st) if p == "stage" else None)
    if need and task and task.get("assignee_id") and str(task["assignee_id"]) != str(actor.get("uid")) and not manage:
        raise Denied(f"ขั้นนี้มอบหมายให้ {task.get('assignee_name') or 'ผู้อื่น'} — ให้ผู้นั้นดำเนินการ หรือให้ผู้ดูแลสารบรรณมอบหมายแทน")
    # แบ่งแยกหน้าที่: ผู้สร้างเรื่องอนุมัติเรื่องตัวเองไม่ได้
    if action in ("approve", "reject") and meta.get("created_by") and str(meta["created_by"]) == str(actor.get("uid")) and not manage:
        raise Denied("ผู้สร้างเรื่องอนุมัติเรื่องของตัวเองไม่ได้")


def next_stage(action: str, meta: dict, rule: dict) -> str:
    st = meta["stage"]
    if action in ("submit", "review_ok", "approve", "sign"):
        return flow_after(st, rule)
    return {"return": "draft", "reject": "rejected", "issue": "issued", "register_official": "issued",
            "accept": "in_progress", "use_reserved": "draft", "close": "closed", "archive": "archived",
            "cancel": "cancelled"}.get(action) or _reopen(meta, rule)


def _reopen(meta, rule):
    if meta["stage"] == "rejected":
        return "draft"
    return "in_progress" if rule["flow"] == "in" else "issued"


# ---------------------------------------------------------------- ไฟล์
FILE_KINDS = {"draft": "ไฟล์ร่าง", "signed": "ฉบับลงนาม/ฉบับจริง", "received": "ฉบับที่ได้รับ", "attachment": "เอกสารประกอบ",
              "evidence": "หลักฐานส่ง/รับทราบ"}
FILE_STATES = {
    "complete":      "ไฟล์ครบ",
    "need_draft":    "รอไฟล์ร่าง",
    "need_signed":   "รอฉบับลงนาม/สแกน",
    "need_received": "รอสแกนฉบับที่ได้รับ",
    "not_required":  "ไม่ต้องแนบ",
    "in_module":     "ฉบับอยู่ในระบบออกหนังสือ",
    "unknown":       "ข้อมูลเดิม · ยังไม่สำรวจ",
    "na":            "—",
}


def file_state(doc: dict, meta: dict, rule: dict, kinds: list[str], source: dict | None) -> str:
    """kinds = ชนิดของไฟล์ที่แนบอยู่ (ไฟล์เก่าที่ยังไม่ระบุชนิด = None)"""
    st = meta.get("stage")
    if st in ("cancelled", "reserved", "rejected"):
        return "na"
    if meta.get("file_note"):          # HR ระบุว่าไม่ต้องแนบ พร้อมเหตุผล
        return "not_required"
    signed = any(k in ("signed",) for k in kinds) or (None in kinds and st not in ("draft", "review", "approval"))
    if rule["flow"] == "in":
        return "complete" if (signed or "received" in kinds or None in kinds) else "need_received"
    if st in ("draft", "review", "approval") and not meta.get("legacy"):
        if rule["need_draft_file"]:
            return "complete" if kinds else "need_draft"
        return "na"                    # ยังไม่ถึงขั้นที่ต้องมีไฟล์ — ไม่แสดงว่า "ครบ" ทั้งที่ยังไม่มีอะไร
    if signed or not rule["need_signed_file"]:
        return "complete"
    if source and source.get("kind") == "letter" and source.get("status") == "approved":
        return "in_module"
    if doc.get("imported"):
        return "unknown"
    return "need_signed"


# ---------------------------------------------------------------- เรื่องเก่าที่ยังไม่มีข้อมูลกระบวนการ → ค่าที่อนุมานได้ (ไม่เขียนลงฐานจนกว่าจะมีการดำเนินการ)
SRC_STAGE = {"draft": "draft", "pending": "approval", "approved": "issued", "rejected": "draft", "cancelled": "cancelled",
             "signed": "issued"}                    # signed = สัญญาจ้างที่ผู้แทนบริษัทและพยานลงนามครบแล้ว
SRC_DONE = {"approved", "signed"}


def derive_meta(doc: dict, direction: str, source: dict | None, n_files: int) -> dict:
    origin = "system" if source else ("import" if doc.get("imported") else "manual")
    m = {"doc_id": doc["id"], "origin": origin, "legacy": True, "ver": 0, "owner_id": None, "owner_name": None,
         "created_by": doc.get("created_by"), "sensitivity": None, "hold": False}
    if doc.get("status") == "void":
        m["stage"] = "cancelled"
    elif source:
        m["stage"] = SRC_STAGE.get(source.get("status"), "draft")
        if source.get("kind") == "contract" and source.get("status") == "pending":
            m["stage"] = "signing"
        if source.get("status") in SRC_DONE:
            m["approved_at"] = source.get("decided_at")
            m["sign_method"] = "image" if source.get("kind") == "letter" else None
        m["returned"] = source.get("status") == "rejected"
    elif direction == "in":
        m["stage"] = "registered"
    elif doc.get("imported") or n_files:
        m["stage"] = "issued"
    elif doc.get("batch_id") and not (doc.get("subject") or doc.get("person_name")):
        m["stage"] = "reserved"
    else:
        m["stage"] = "draft"
    return m


# ---------------------------------------------------------------- ต้องทำอะไรต่อ
def next_step(meta: dict, rule: dict, fstate: str, deliveries: list[dict]) -> str:
    st = meta.get("stage")
    if meta.get("hold"):
        return "ระงับไว้ — ห้ามทำลาย/ยกเลิก จนกว่าจะปลดการระงับ"
    if st == "reserved":
        return "ใช้เลขนี้ (ใส่เรื่อง/ผู้รับ) หรือยกเลิกเลข"
    if st == "registered":
        return "มอบหมายผู้รับผิดชอบและเริ่มดำเนินการ"
    if st == "draft":
        return ("แก้ไขตามที่ถูกส่งกลับ แล้วส่งใหม่" if meta.get("returned") else "เตรียมร่าง แล้วส่งต่อ") + f" → {STAGES[flow_after('draft', rule)]}"
    if st == "review":
        return "ผู้ตรวจทานตรวจ แล้วผ่าน หรือส่งกลับแก้ไข"
    if st == "approval":
        return "ผู้อนุมัติพิจารณา"
    if st == "signing":
        return "ลงนาม แล้วแนบฉบับลงนาม + บันทึกวิธีลงนาม"
    if st == "to_issue":
        return "เลือกไฟล์ฉบับจริงแล้วกด “ออกฉบับจริง”"
    if st == "issued":
        if fstate in ("need_signed", "unknown", "in_module") and rule["need_signed_file"]:
            return "แนบสแกนฉบับจริง (หรือระบุว่าไม่ต้องแนบพร้อมเหตุผล)"
        if rule["need_delivery"] and not deliveries:
            return "บันทึกการส่งมอบ"
        if any(d.get("need_ack") and not d.get("ack_at") and d.get("status") != "cancelled" for d in deliveries):
            return "รอหลักฐานรับทราบ"
        return "ปิดเรื่อง"
    if st == "in_progress":
        return "ดำเนินการแล้วปิดเรื่อง"
    if st == "closed":
        return "จัดเก็บ (ระบุที่เก็บต้นฉบับ)"
    if st == "rejected":
        return "ไม่อนุมัติ — ยกเลิกเลข หรือเปิดเรื่องใหม่"
    return ""


def delivery_state(rule: dict, deliveries: list[dict]) -> str:
    live = [d for d in deliveries if d.get("status") != "cancelled"]
    if not live:
        return "none" if rule["need_delivery"] else "na"
    if any(d.get("need_ack") and not d.get("ack_at") for d in live):
        return "wait_ack"
    return "acked" if any(d.get("need_ack") for d in live) else "sent"


def close_blockers(rule: dict, fstate: str, deliveries: list[dict]) -> list[str]:
    out = []
    if fstate in ("need_signed", "need_received", "need_draft"):
        out.append(f"ไฟล์: {FILE_STATES[fstate]}")
    ds = delivery_state(rule, deliveries)
    if ds == "none":
        out.append("ยังไม่ได้บันทึกการส่งมอบ")
    if ds == "wait_ack":
        out.append("ยังรอหลักฐานรับทราบ")
    return out


# ---------------------------------------------------------------- อายุเก็บ
START_EVENTS = {"doc_date": "วันที่เอกสาร", "closed": "วันปิดเรื่อง", "effective": "วันที่มีผล", "employment_end": "วันพ้นสภาพพนักงาน"}


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    last = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, last))


def retention_until(policy: dict | None, start: date | None) -> date | None:
    """None = ยังคำนวณไม่ได้ (ไม่มีนโยบายที่ใช้งาน หรือยังไม่เกิดเหตุการณ์เริ่มนับ)"""
    if not policy or policy.get("status") != "active" or not start:
        return None
    return add_months(start, int(policy.get("years") or 0) * 12 + int(policy.get("months") or 0))


def disposal_block(meta: dict, until: date | None, today: date) -> str | None:
    """เหตุที่ยังทำลายไม่ได้ (None = เข้าเกณฑ์พิจารณาทำลาย)"""
    if meta.get("hold"):
        return "ระงับทำลาย"
    if meta.get("stage") in ("disposed",):
        return "ทำลายแล้ว"
    if meta.get("stage") in OPEN_STAGES:
        return "เรื่องยังไม่ปิด"
    if until is None:
        return "ยังไม่มีนโยบายอายุเก็บที่ใช้งาน หรือยังไม่เกิดเหตุการณ์เริ่มนับ"
    if until > today:
        return f"ยังไม่ครบอายุเก็บ (ครบ {until.isoformat()})"
    return None


# ---------------------------------------------------------------- เลขเอกสาร
def doc_no(prefix: str, seq: int, year: int) -> str:
    """ลำดับนับแยกตามชุด + ปี ค.ศ. ของวันที่เอกสาร (ตัวเลข ไม่ใช่ข้อความปีที่แสดง) — กติกาเดิมของ doc_issue"""
    return f"{prefix}-{seq:03d}-{year}"
