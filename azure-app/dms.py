"""
ระบบสารบรรณและควบคุมเอกสาร HR — ฐานข้อมูลและฟังก์ชันที่หน้าเว็บ /docs เรียก (supabase.rpc("dms_…")) · user 2026-11-03
กติกาอยู่ใน dms_core.py (มีเทส) · ไฟล์นี้อ่าน/เขียนฐานข้อมูลและตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ทุกครั้ง

ทะเบียนเลขเดิม (doc_register / doc_files / doc_access_log / doc_issue) ไม่เปลี่ยนโครงสร้าง — ข้อมูลใหม่อยู่ในตารางแยกด้านล่าง
ซึ่งสร้างเองตอนใช้ครั้งแรก (ensure) และไม่เปิดให้ REST เขียนตรง: สถานะ ผู้รับผิดชอบ ไฟล์ฉบับจริง การส่ง/รับทราบ
อายุเก็บ และการทำลาย เปลี่ยนได้ผ่านฟังก์ชันในไฟล์นี้เท่านั้น จึงข้ามขั้นหรือทำเกินสิทธิ์ไม่ได้ และทุกครั้งมีประวัติใน doc_events
(ไม่มีฟังก์ชันแก้/ลบประวัติ)

เรื่องเก่าที่ยังไม่เคยดำเนินการในระบบใหม่ไม่มีแถวใน doc_meta — อนุมานสถานะจากข้อมูลเดิม (dms_core.derive_meta)
และเขียนลงฐานเมื่อมีการดำเนินการครั้งแรกเท่านั้น จึงไม่มีการแก้ข้อมูลเดิมเป็นกลุ่ม

SQL เขียนแบบกลาง ๆ (? params, ไม่มี TOP/OUTPUT นอก helper) เพื่อให้เทสรันบน SQLite ได้ — ส่วนที่ต่างกันอยู่ใน _q / _insert / DDL
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone

import dms_core as C

# ================================================================================ ตาราง (สร้างเมื่อใช้ครั้งแรก)
_T = {
    "doc_meta": [("doc_id", "bigpk"), ("origin", "s40"), ("stage", "s30"), ("returned", "bit"), ("owner_id", "uuid"),
                 ("owner_name", "s200"), ("due_date", "date"), ("priority", "s20"), ("effective_date", "date"),
                 ("case_ref", "s200"), ("sensitivity", "s30"), ("paper_location", "s300"), ("sign_method", "s30"),
                 ("sign_note", "s500"), ("signed_by_name", "s200"), ("approved_at", "ts"), ("approved_by_name", "s200"),
                 ("signed_at", "ts"), ("issued_at", "ts"), ("closed_at", "ts"), ("archived_at", "ts"), ("disposed_at", "ts"),
                 ("file_note", "s500"), ("hold", "bit"), ("hold_reason", "s500"), ("hold_by_name", "s200"), ("hold_at", "ts"),
                 ("superseded_by", "big"), ("created_by", "uuid"), ("created_at", "ts"), ("updated_at", "ts"), ("ver", "int")],
    "doc_people": [("id", "id"), ("doc_id", "big"), ("role", "s20"), ("emp_code", "s40"), ("name", "s300"), ("org", "s300")],
    "doc_tasks": [("id", "id"), ("doc_id", "big"), ("kind", "s20"), ("assignee_id", "uuid"), ("assignee_name", "s200"),
                  ("status", "s20"), ("due_date", "date"), ("note", "s500"), ("created_by_name", "s200"), ("created_at", "ts"),
                  ("done_at", "ts"), ("done_by_name", "s200"), ("result_note", "s500")],
    "doc_events": [("id", "id"), ("doc_id", "big"), ("at", "ts"), ("actor_id", "uuid"), ("actor_name", "s200"),
                   ("action", "s40"), ("from_stage", "s30"), ("to_stage", "s30"), ("reason", "s1000"), ("detail", "s1000")],
    "doc_file_meta": [("file_id", "bigpk"), ("doc_id", "big"), ("kind", "s20"), ("version", "int"), ("is_official", "bit"),
                      ("locked", "bit"), ("replaced_by", "big"), ("note", "s500"), ("set_by_name", "s200"), ("set_at", "ts")],
    "doc_deliveries": [("id", "id"), ("doc_id", "big"), ("recipient", "s300"), ("emp_code", "s40"), ("channel", "s30"),
                       ("sent_at", "date"), ("sent_by_name", "s200"), ("need_ack", "bit"), ("ack_at", "date"),
                       ("ack_method", "s30"), ("ack_note", "s500"), ("ack_by_name", "s200"), ("evidence_file_id", "big"),
                       ("status", "s20"), ("note", "s500"), ("created_at", "ts")],
    "doc_links": [("id", "id"), ("doc_id", "big"), ("other_id", "big"), ("kind", "s20"), ("note", "s300"),
                  ("created_by_name", "s200"), ("created_at", "ts")],
    "doc_type_rules": [("type_id", "bigpk"), ("flow", "s20"), ("need_review", "bitn"), ("need_approval", "bitn"),
                       ("need_sign", "bitn"), ("need_delivery", "bitn"), ("need_ack", "bitn"), ("need_draft_file", "bitn"),
                       ("need_signed_file", "bitn"), ("sensitivity", "s30"), ("retention_id", "big"), ("due_days", "int"),
                       ("updated_by_name", "s200"), ("updated_at", "ts")],
    "doc_retention": [("id", "id"), ("name", "s300"), ("years", "int"), ("months", "int"), ("start_event", "s30"),
                      ("basis", "s1000"), ("approved_by_name", "s200"), ("approved_on", "date"), ("status", "s20"),
                      ("note", "s1000"), ("created_by_name", "s200"), ("created_at", "ts"), ("updated_at", "ts")],
    "doc_disposals": [("id", "id"), ("title", "s300"), ("status", "s20"), ("proposed_by", "uuid"), ("proposed_by_name", "s200"),
                      ("proposed_at", "ts"), ("decided_by_name", "s200"), ("decided_at", "ts"), ("decided_note", "s1000"),
                      ("paper_method", "s30"), ("files_action", "s30"), ("executed_by_name", "s200"), ("executed_at", "ts"),
                      ("evidence_ref", "s300"), ("note", "s1000")],
    "doc_disposal_items": [("id", "id"), ("disposal_id", "big"), ("doc_id", "big"), ("result", "s20"), ("result_note", "s1000")],
    # เลขในทะเบียนที่ออกให้เอกสารจากโมดูลที่ไม่มีคอลัมน์ doc_id ของตัวเอง (สัญญาจ้าง)
    "doc_source_links": [("doc_id", "bigpk"), ("kind", "s20"), ("source_id", "big"), ("created_at", "ts")],
    "dms_migrations": [("name", "s100pk"), ("at", "ts"), ("detail", "s1000")],
    # ใบลาออกที่ลงรับอัตโนมัติจาก Staff Movement (movement id เป็น uuid)
    "doc_mov_links": [("doc_id", "bigpk"), ("movement_id", "uuid"), ("path", "s500"), ("created_at", "ts")],
}
_IDX = [("doc_people", "doc_id"), ("doc_tasks", "doc_id"), ("doc_events", "doc_id"), ("doc_file_meta", "doc_id"),
        ("doc_deliveries", "doc_id"), ("doc_links", "doc_id"), ("doc_disposal_items", "disposal_id")]
_MS = {"id": "BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY", "bigpk": "BIGINT NOT NULL PRIMARY KEY", "big": "BIGINT NULL",
       "int": "INT NULL", "bit": "BIT NOT NULL DEFAULT 0", "bitn": "BIT NULL", "date": "DATE NULL", "ts": "DATETIMEOFFSET NULL",
       "uuid": "UNIQUEIDENTIFIER NULL"}
_LITE = {"id": "INTEGER PRIMARY KEY AUTOINCREMENT", "bigpk": "INTEGER NOT NULL PRIMARY KEY", "big": "INTEGER", "int": "INTEGER",
         "bit": "INTEGER NOT NULL DEFAULT 0", "bitn": "INTEGER", "date": "TEXT", "ts": "TEXT", "uuid": "TEXT"}
_ready = False


def _lite(cur) -> bool:
    return type(cur).__module__.startswith("sqlite3")


def _coltype(t, lite):
    if t.startswith("s") and t.endswith("pk"):
        return "TEXT NOT NULL PRIMARY KEY" if lite else f"NVARCHAR({t[1:-2]}) NOT NULL PRIMARY KEY"
    if t.startswith("s"):
        return "TEXT" if lite else f"NVARCHAR({t[1:]}) NULL"
    return (_LITE if lite else _MS)[t]


def _tbl(cur, name):
    return f"[{name}]" if _lite(cur) else f"dbo.[{name}]"


def ensure(cur):
    """สร้างตารางที่ยังไม่มี + ลงทะเบียนสิทธิ์ใหม่ (ครั้งเดียวต่อ process · รันซ้ำได้)"""
    global _ready
    if _ready:
        return
    lite = _lite(cur)
    for name, cols in _T.items():
        body = ", ".join(f"[{c}] {_coltype(t, lite)}" for c, t in cols)
        try:
            if lite:
                cur.execute(f"CREATE TABLE IF NOT EXISTS [{name}] ({body})")
            else:
                cur.execute(f"IF OBJECT_ID('dbo.{name}') IS NULL CREATE TABLE dbo.[{name}] ({body})")
        except Exception as e:                        # อีก worker สร้างพร้อมกัน
            if "already" not in str(e).lower():
                raise
    for t, c in _IDX:
        ix = f"ix_{t}_{c}"
        try:
            if lite:
                cur.execute(f"CREATE INDEX IF NOT EXISTS {ix} ON [{t}] ([{c}])")
            else:
                cur.execute(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '{ix}') CREATE INDEX {ix} ON dbo.[{t}] ([{c}])")
        except Exception as e:
            if "already" not in str(e).lower():
                raise
    _seed_perms(cur)
    _seed_types(cur)
    # บันทึกทันที: ถ้าคำสั่งที่เรียกเราล้มแล้ว rollback ตารางต้องไม่หายไปด้วย (_ready ถูกตั้งแล้ว)
    try:
        cur.connection.commit()
    except Exception:
        pass
    _ready = True


def _seed_perms(cur):
    """สิทธิ์ใหม่ลงในรายการสิทธิ์ (หน้าจัดการบทบาทเห็นเอง) — ตอนเพิ่มครั้งแรกให้บทบาทที่มีสิทธิ์เดิมคู่กันอยู่แล้ว
    (คงสิ่งที่ทำได้วันนี้) · สิทธิ์ที่เป็นเรื่องนโยบาย (อนุมัติ ลงนาม ทำลาย) ไม่ให้ใคร นอกจาก Admin ซึ่งมีทุกสิทธิ์อยู่แล้ว"""
    t, rp = _tbl(cur, "permissions"), _tbl(cur, "role_permissions")
    for i, (key, label, desc, grant) in enumerate(C.PERMS):
        if _x(cur, f"SELECT 1 FROM {t} WHERE [key] = ?", key).fetchone():
            continue
        _x(cur, f"INSERT INTO {t} ([key], category, label, description, sort_order) VALUES (?, ?, ?, ?, ?)",
           key, "data", label, desc, 60 + i)
        if grant:
            for (role,) in _x(cur, f"SELECT role_key FROM {rp} WHERE perm_key = ?", grant).fetchall():
                _x(cur, f"INSERT INTO {rp} (role_key, perm_key) VALUES (?, ?)", role, key)


def _seed_types(cur):
    """ประเภทเอกสารที่ user ให้เพิ่ม (2026-11-03) + ปรับข้อมูลเดิมครั้งเดียว (บันทึกใน dms_migrations ไม่ทำซ้ำ)"""
    t, mg = _tbl(cur, "doc_types"), _tbl(cur, "dms_migrations")
    if _x(cur, f"SELECT 1 FROM {mg} WHERE name = ?", "types_2026_11_03").fetchone():
        return
    added = []
    for series, label, conf, form, order in C.NEW_TYPES:
        if not _x(cur, f"SELECT 1 FROM {_tbl(cur, 'doc_series')} WHERE code = ?", series).fetchone():
            continue
        if _x(cur, f"SELECT 1 FROM {t} WHERE series_code = ? AND label = ?", series, label).fetchone():
            continue
        _x(cur, f"INSERT INTO {t} (series_code, label, sort_order, is_active, confidential, form_code) VALUES (?, ?, ?, 1, ?, ?)",
           series, label, order, 1 if conf else 0, form)
        added.append(label)
    # Offer Letter มีเงินเดือนในตัวหนังสือ → เลขใหม่เป็นเอกสารลับ (เลขเก่าไม่เปลี่ยน)
    _x(cur, f"UPDATE {t} SET confidential = 1 WHERE series_code = 'HR' AND label = ?", "Offer Letter (จดหมายจ้างงาน)")
    # 3 เรื่องใน "อื่น ๆ" ที่เป็นหนังสือถึงสำนักงานประกันสังคม → ประเภทใหม่ (ตรวจจากข้อมูลจริง 2026-11-03)
    gov = _x(cur, f"SELECT id FROM {t} WHERE series_code = 'HR' AND label = ?", C.NEW_TYPES[0][1]).fetchone()
    moved = 0
    if gov:
        reg, ev = _tbl(cur, "doc_register"), _tbl(cur, "doc_events")
        for no in ("HR-020-2025", "HR-161-2025", "HR-068-2026"):
            row = _x(cur, f"SELECT id FROM {reg} WHERE doc_no = ? AND type_label = ?", no, "อื่น ๆ").fetchone()
            if not row:
                continue
            _x(cur, f"UPDATE {reg} SET type_id = ?, type_label = ? WHERE id = ?", gov[0], C.NEW_TYPES[0][1], row[0])
            _x(cur, f"INSERT INTO {ev} (doc_id, at, actor_name, action, reason, detail) VALUES (?, ?, ?, ?, ?, ?)",
               row[0], _now(), "ระบบ", "edit", "จัดประเภทใหม่ตามที่ HR อนุมัติ 2026-11-03", "แก้ทะเบียน: ประเภท (อื่น ๆ → หนังสือถึงหน่วยงานราชการ)")
            moved += 1
    _x(cur, f"INSERT INTO {mg} (name, at, detail) VALUES (?, ?, ?)", "types_2026_11_03", _now(),
       f"เพิ่ม {len(added)} ประเภท · Offer Letter เป็นลับ · ย้ายประเภท {moved} เรื่อง")


# ================================================================================ SQL helpers
def _x(cur, sql, *a):
    return cur.execute(sql, a) if _lite(cur) else cur.execute(sql, *a)


def _val(v):
    if v is None:
        return None
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if type(v).__name__ == "Decimal":
        f = float(v)
        return int(f) if f.is_integer() else f
    return v


def _q(r, sql, *a):
    """SELECT → list[dict] · ตารางในคำสั่งเขียนเป็น {t:ชื่อ}"""
    cur = r.cur
    sql = _names(cur, sql)
    c = _x(cur, sql, *a)
    cols = [d[0] for d in c.description]
    return [{k: _val(v) for k, v in zip(cols, row)} for row in c.fetchall()]


def _one(r, sql, *a):
    out = _q(r, sql, *a)
    return out[0] if out else None


def _exec(r, sql, *a):
    c = _x(r.cur, _names(r.cur, sql), *a)
    return c.rowcount


def _names(cur, sql):
    import re
    return re.sub(r"\{t:(\w+)\}", lambda m: _tbl(cur, m.group(1)), sql)


def _insert(r, table, row: dict):
    cols = list(row)
    vals = [row[c] for c in cols]
    t = _tbl(r.cur, table)
    if _lite(r.cur):
        c = r.cur.execute(f"INSERT INTO {t} ({', '.join(f'[{c}]' for c in cols)}) VALUES ({', '.join('?' for _ in cols)})", vals)
        return c.lastrowid
    pk = "doc_id" if table == "doc_meta" else "file_id" if table == "doc_file_meta" else "type_id" if table == "doc_type_rules" else "id"
    got = r.cur.execute(f"INSERT INTO {t} ({', '.join(f'[{c}]' for c in cols)}) OUTPUT INSERTED.[{pk}] VALUES ({', '.join('?' for _ in cols)})",
                        *vals).fetchone()
    return got[0] if got else None


def _update(r, table, where: str, wargs: tuple, values: dict):
    sets = ", ".join(f"[{k}] = ?" for k in values)
    return _exec(r, f"UPDATE {{t:{table}}} SET {sets} WHERE {where}", *values.values(), *wargs)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _in(ids):
    return ", ".join("?" for _ in ids) or "NULL"


# ================================================================================ ผู้ใช้ / สิทธิ์
def _actor(r):
    return {"uid": r.uid}


def _name(r):
    n = getattr(r, "_dms_name", None)
    if n is None:
        row = _one(r, "SELECT name, email FROM {t:user_roles} WHERE user_id = ?", str(r.uid)) if r.uid else None
        n = (row and (row.get("name") or row.get("email"))) or "ระบบ"
        try:
            r._dms_name = n
        except Exception:
            pass
    return n


def _need(r, perm):
    if not (r.has_perm(perm) or r.has_perm("doc.manage")):
        raise C.Denied("ไม่มีสิทธิ์ดำเนินการนี้")


def _err(e):
    import hooks
    return hooks.HookError(str(e))


def _wrap(f):
    """แปลง Denied → ข้อความถึงผู้ใช้ · ensure ตารางก่อนทุกครั้ง"""
    def g(r, **kw):
        ensure(r.cur)
        try:
            return f(r, **kw)
        except C.Denied as e:
            raise _err(e)
    g.__name__ = f.__name__
    return g


FUNCS = {}


def fn(f):
    w = _wrap(f)
    FUNCS[f.__name__] = w
    return w


# ================================================================================ โหลดเอกสาร
def _series(r):
    return {s["code"]: s for s in _q(r, "SELECT code, prefix, label, direction, is_active FROM {t:doc_series}")}


def _rules(r):
    return {x["type_id"]: x for x in _q(r, "SELECT * FROM {t:doc_type_rules}")}


def _rule_for(r, doc, series=None, rules=None):
    series = series if series is not None else _series(r)
    rules = rules if rules is not None else _rules(r)
    d = (series.get(doc.get("series_code")) or {}).get("direction", "out")
    return C.type_rule(d, doc.get("type_label"), rules.get(doc.get("type_id")))


def contract_sources(r):
    """สัญญาจ้างที่ได้เลขในทะเบียนแล้ว → {doc_id: source} · signed_at ของสัญญา = เวลาที่ลงนามครบ"""
    out = {}
    try:
        rows = _q(r, """SELECT l.doc_id, c.id, c.status, c.signed_at, c.witnessed_at FROM {t:doc_source_links} l
                        JOIN {t:emp_contracts} c ON c.id = l.source_id WHERE l.kind = 'contract'""")
    except Exception:
        return out
    for x in rows:
        done = max([v for v in (x["signed_at"], x["witnessed_at"]) if v] or [None]) if x["status"] == "signed" else None
        out[x["doc_id"]] = {"kind": "contract", "source_id": x["id"], "status": x["status"], "decided_at": done}
    return out


def _sources(r, ids=None):
    out = contract_sources(r)
    for kind, table in (("letter", "hr_letters"), ("paf", "paf_forms")):
        try:
            rows = _q(r, f"SELECT doc_id, id, status, approved_at FROM {{t:{table}}} WHERE doc_id IS NOT NULL ORDER BY id")
        except Exception:
            continue
        for x in rows:
            cur = out.get(x["doc_id"])
            # แถวล่าสุดที่ไม่ใช่ยกเลิกชนะ (เหมือน doc_sources)
            if cur is None or not (x["status"] == "cancelled" and cur["status"] != "cancelled"):
                out[x["doc_id"]] = {"kind": kind, "source_id": x["id"], "status": x["status"], "decided_at": x["approved_at"]}
    return out


def _visible(r, doc, meta):
    return C.visible(r.has_perm, doc.get("confidential"), (meta or {}).get("sensitivity"))


def _load(r, doc_id, need_visible=True):
    doc = _one(r, "SELECT * FROM {t:doc_register} WHERE id = ?", int(doc_id))
    if not doc:
        raise C.Denied("ไม่พบเอกสาร หรือไม่มีสิทธิ์")
    stored = _one(r, "SELECT * FROM {t:doc_meta} WHERE doc_id = ?", doc["id"])
    if need_visible and not _visible(r, doc, stored):
        raise C.Denied("ไม่พบเอกสาร หรือไม่มีสิทธิ์")
    return doc, stored


def _meta_of(r, doc, stored, series=None, rules=None, source=None, nfiles=None):
    if stored:
        m = dict(stored)
        m["legacy"] = False
        return m
    d = (series or _series(r)).get(doc["series_code"], {}).get("direction", "out")
    if source is None:
        source = _sources(r).get(doc["id"])
    if nfiles is None:
        nfiles = (_one(r, "SELECT COUNT(*) AS n FROM {t:doc_files} WHERE doc_id = ?", doc["id"]) or {}).get("n", 0)
    return C.derive_meta(doc, d, source, nfiles)


SOURCE_FLOW = {"submit", "review_ok", "approve", "sign", "return", "reject", "issue", "use_reserved", "register_official"}
PRE_ISSUE = {"draft", "review", "approval", "signing", "to_issue"}


def _eff(m, source):
    """เรื่องที่สร้างจากระบบออกหนังสือ HR / PAF: ขั้นก่อนออกฉบับจริงเป็นของระบบต้นทาง — สถานะตามต้นทางเสมอ
    (สารบรรณดูแลต่อตั้งแต่ออกแล้ว: ส่งมอบ รับทราบ ปิดเรื่อง จัดเก็บ)"""
    if not source or m.get("stage") in C.TERMINAL:
        return m
    st = source.get("status")
    if st == "cancelled":
        return {**m, "stage": "cancelled"}
    if m.get("stage") in PRE_ISSUE or (m.get("stage") == "issued" and st not in C.SRC_DONE):
        to = "signing" if source.get("kind") == "contract" and st == "pending" else C.SRC_STAGE.get(st, m["stage"])
        m = {**m, "stage": to, "returned": st == "rejected"}
    if source.get("kind") == "contract" and st == "signed" and not m.get("signed_at"):
        m = {**m, "signed_at": source.get("decided_at"), "sign_method": m.get("sign_method") or "image"}
    elif st == "approved" and not m.get("approved_at"):
        m = {**m, "approved_at": source.get("decided_at"), "sign_method": m.get("sign_method") or ("image" if source.get("kind") == "letter" else None)}
    return m


def _materialize(r, doc, stored):
    """เรื่องเก่า → เขียนแถว doc_meta ครั้งแรกจากค่าที่อนุมานได้"""
    if stored:
        return stored
    m = _meta_of(r, doc, None)
    rule = _rule_for(r, doc)
    sens = rule["sensitivity"]
    if sens in C.CONFIDENTIAL_SENS and not doc.get("confidential"):
        sens = "personal"                 # ไม่ทำให้เอกสารที่เคยเห็นได้หายไปจากคนที่เห็นอยู่ โดยไม่มีใครตั้งใจ
    if doc.get("confidential") and sens not in C.CONFIDENTIAL_SENS:
        sens = "confidential"
    row = {"doc_id": doc["id"], "origin": m["origin"], "stage": m["stage"], "returned": 1 if m.get("returned") else 0,
           "sensitivity": sens, "approved_at": m.get("approved_at"), "sign_method": m.get("sign_method"),
           "created_by": str(doc["created_by"]) if doc.get("created_by") else None, "created_at": _now(), "updated_at": _now(),
           "ver": 0, "hold": 0}
    _insert(r, "doc_meta", row)
    _event(r, doc["id"], "migrate", None, m["stage"], None, "เริ่มติดตามในระบบสารบรรณ (สถานะตั้งต้นอนุมานจากข้อมูลเดิม)")
    return _one(r, "SELECT * FROM {t:doc_meta} WHERE doc_id = ?", doc["id"])


def _event(r, doc_id, action, frm, to, reason=None, detail=None):
    _insert(r, "doc_events", {"doc_id": doc_id, "at": _now(), "actor_id": str(r.uid) if r.uid else None, "actor_name": _name(r),
                              "action": action, "from_stage": frm, "to_stage": to, "reason": (reason or None) and reason[:1000],
                              "detail": (detail or None) and detail[:1000]})


def _set_meta(r, doc_id, ver, values):
    """เปลี่ยน doc_meta แบบกันชนกัน: ถ้ามีคนเปลี่ยนไปก่อน (ver ไม่ตรง) → ปฏิเสธ"""
    values = {**values, "updated_at": _now()}
    sets = ", ".join(f"[{k}] = ?" for k in values)
    n = _exec(r, f"UPDATE {{t:doc_meta}} SET {sets}, ver = ver + 1 WHERE doc_id = ? AND ver = ?", *values.values(), doc_id, int(ver or 0))
    if n != 1:
        raise C.Denied("เอกสารนี้ถูกผู้อื่นเปลี่ยนไปแล้ว — โหลดใหม่แล้วลองอีกครั้ง")


def _files(r, doc_id):
    return _q(r, """SELECT f.id, f.name, f.path, f.size, f.mime, f.uploaded_name, f.uploaded_at, m.kind, m.version, m.is_official,
                           m.locked, m.replaced_by, m.note AS kind_note, m.set_by_name
                    FROM {t:doc_files} f LEFT JOIN {t:doc_file_meta} m ON m.file_id = f.id WHERE f.doc_id = ? ORDER BY f.id""", doc_id)


def _open_task(r, doc_id, kind):
    return _one(r, "SELECT * FROM {t:doc_tasks} WHERE doc_id = ? AND kind = ? AND status = 'open' ORDER BY id DESC", doc_id, kind)


STAGE_TASK = {"review": "review", "approval": "approve", "signing": "sign"}


# ================================================================================ ภาพรวม (รายการ + Dashboard) — เฉพาะที่ผู้ใช้เห็นได้
@fn
def dms_overview(r):
    if not r.has_perm("page.docregister"):
        raise C.Denied("ไม่มีสิทธิ์")
    series, rules = _series(r), _rules(r)
    docs = _q(r, """SELECT id, series_code, type_id, type_label, status, imported, batch_id, subject, person_name, created_by,
                           confidential, issued_date, emp_code FROM {t:doc_register}""")
    metas = {m["doc_id"]: m for m in _q(r, "SELECT * FROM {t:doc_meta}")}
    src = _sources(r)
    kinds: dict = {}
    for f in _q(r, "SELECT f.doc_id, m.kind FROM {t:doc_files} f LEFT JOIN {t:doc_file_meta} m ON m.file_id = f.id"):
        kinds.setdefault(f["doc_id"], []).append(f["kind"])
    dels: dict = {}
    for d in _q(r, "SELECT doc_id, need_ack, ack_at, status FROM {t:doc_deliveries}"):
        dels.setdefault(d["doc_id"], []).append(d)
    tasks: dict = {}
    for t in _q(r, "SELECT id, doc_id, kind, assignee_id, assignee_name, due_date FROM {t:doc_tasks} WHERE status = 'open'"):
        tasks.setdefault(t["doc_id"], []).append(t)
    pols = {p["id"]: p for p in _q(r, "SELECT * FROM {t:doc_retention}")}
    today = C.today_bkk()
    out = []
    for d in docs:
        st = metas.get(d["id"])
        if not _visible(r, d, st):
            continue
        dirn = series.get(d["series_code"], {}).get("direction", "out")
        rule = C.type_rule(dirn, d.get("type_label"), rules.get(d.get("type_id")))
        m = _eff(dict(st, legacy=False), src.get(d["id"])) if st else C.derive_meta(d, dirn, src.get(d["id"]), len(kinds.get(d["id"], [])))
        fs = C.file_state(d, m, rule, kinds.get(d["id"], []), src.get(d["id"]))
        dl = dels.get(d["id"], [])
        until = _until(r, d, m, rule, pols)
        o = {"id": d["id"], "stage": m["stage"], "origin": m["origin"], "legacy": m.get("legacy", False), "ver": m.get("ver", 0),
             "owner_id": m.get("owner_id"), "owner_name": m.get("owner_name"), "due_date": m.get("due_date"),
             "priority": m.get("priority"), "sensitivity": m.get("sensitivity") or ("confidential" if d.get("confidential") else None),
             "returned": bool(m.get("returned")), "hold": bool(m.get("hold")), "file_state": fs,
             "approved": bool(m.get("approved_at")), "signed": bool(m.get("signed_at")), "issued": bool(m.get("issued_at")) or m["stage"] in ("issued", "closed", "archived"),
             "delivery": C.delivery_state(rule, dl), "flow": rule["flow"],
             "next": _src_next(src.get(d["id"])) if src.get(d["id"]) and m["stage"] in PRE_ISSUE else C.next_step(m, rule, fs, dl),
             "tasks": [{"kind": t["kind"], "assignee_id": t["assignee_id"], "assignee_name": t["assignee_name"], "due_date": t["due_date"]}
                       for t in tasks.get(d["id"], [])],
             "retention_until": until.isoformat() if until else None, "case_ref": m.get("case_ref"),
             "overdue": bool(m.get("due_date") and m["stage"] in C.OPEN_STAGES and str(m["due_date"]) < today.isoformat())}
        out.append(o)
    return {"docs": out, "today": today.isoformat(), "me": str(r.uid) if r.uid else None,
            "perms": [p for p, *_ in C.PERMS if r.has_perm(p)] + (["doc.manage"] if r.has_perm("doc.manage") else []),
            "next_numbers": _next_numbers(r, series)}


def _until(r, doc, meta, rule, pols, emp_end=None):
    pid = rule.get("retention_id")
    pol = pols.get(pid) if pid else None
    if not pol or pol.get("status") != "active":
        return None
    ev = pol.get("start_event")
    s = None
    if ev == "doc_date":
        s = doc.get("issued_date")
    elif ev == "closed":
        s = (meta.get("closed_at") or "")[:10] or None
    elif ev == "effective":
        s = meta.get("effective_date")
    elif ev == "employment_end" and doc.get("emp_code"):
        e = emp_end if emp_end is not None else _one(r, "SELECT end_date FROM {t:employees} WHERE emp_code = ?", doc["emp_code"])
        s = (e or {}).get("end_date")
    try:
        return C.retention_until(pol, date.fromisoformat(str(s)[:10]) if s else None)
    except ValueError:
        return None


def _next_numbers(r, series):
    """เลขถัดไปจริงจากฐาน (รวมเลขลับที่ผู้ใช้มองไม่เห็น) — ตัวเลขไม่ใช่ข้อมูลลับ · ปี = ปี ค.ศ. ตามเวลาไทย"""
    y = C.today_bkk().year
    out = {}
    for code, s in series.items():
        if not s.get("is_active"):
            continue
        mx = (_one(r, "SELECT MAX(seq) AS m FROM {t:doc_register} WHERE series_code = ? AND [year] = ?", code, y) or {}).get("m") or 0
        out[code] = C.doc_no(s["prefix"], mx + 1, y)
    return out


# ================================================================================ รายละเอียดเรื่อง
@fn
def dms_doc(r, p_doc_id):
    doc, stored = _load(r, p_doc_id)
    series, rules = _series(r), _rules(r)
    rule = _rule_for(r, doc, series, rules)
    src = _sources(r).get(doc["id"])
    files = _files(r, doc["id"])
    m = _eff(_meta_of(r, doc, stored, series, rules, src, len(files)), src)
    dl = _q(r, "SELECT * FROM {t:doc_deliveries} WHERE doc_id = ? ORDER BY id", doc["id"])
    fs = C.file_state(doc, m, rule, [f["kind"] for f in files], src)
    tasks = _q(r, "SELECT * FROM {t:doc_tasks} WHERE doc_id = ? ORDER BY id", doc["id"])
    links = []
    for l in _q(r, "SELECT * FROM {t:doc_links} WHERE doc_id = ? OR other_id = ? ORDER BY id", doc["id"], doc["id"]):
        oid = l["other_id"] if l["doc_id"] == doc["id"] else l["doc_id"]
        try:
            o, ost = _load(r, oid)
            l["other"] = {"id": o["id"], "doc_no": o["doc_no"], "type_label": o.get("type_label"), "subject": o.get("subject")}
        except C.Denied:
            l["other"] = {"id": None, "doc_no": "เอกสารที่คุณไม่มีสิทธิ์ดู"}
        l["direction"] = "out" if l["doc_id"] == doc["id"] else "in"
        links.append(l)
    pols = {p["id"]: p for p in _q(r, "SELECT * FROM {t:doc_retention}")}
    until = _until(r, doc, m, rule, pols)
    acts = []
    for a in C.ACTIONS:
        if src and a in SOURCE_FLOW:
            continue
        try:
            C.check_action(a, m, _actor(r), r.has_perm, reason="x", task=_open_task(r, doc["id"], STAGE_TASK.get(m["stage"], "")))
            acts.append(a)
        except C.Denied:
            pass
    return {"meta": m, "rule": rule, "source": src, "files": files, "deliveries": dl, "tasks": tasks, "links": links,
            "people": _q(r, "SELECT * FROM {t:doc_people} WHERE doc_id = ? ORDER BY id", doc["id"]),
            "events": _q(r, "SELECT * FROM {t:doc_events} WHERE doc_id = ? ORDER BY id DESC", doc["id"]),
            "file_state": fs, "delivery": C.delivery_state(rule, dl),
            "next": _src_next(src) if src and m["stage"] in PRE_ISSUE else C.next_step(m, rule, fs, dl),
            "blockers": C.close_blockers(rule, fs, dl), "actions": acts,
            "retention": {"policy": pols.get(rule.get("retention_id")), "until": until.isoformat() if until else None,
                          "block": C.disposal_block(m, until, C.today_bkk())},
            "can": {"edit": r.has_perm("data.docregister.write") or r.has_perm("doc.manage") or (m.get("owner_id") and str(m["owner_id"]) == str(r.uid)),
                    "files_open": r.has_perm("doc.files.open"), "hold": r.has_perm("doc.retention"),
                    "official": r.has_perm("doc.official") or r.has_perm("doc.manage")}}


# ================================================================================ เปลี่ยนขั้นตอน
@fn
def dms_act(r, p_doc_id, p_action, p_ver=None, p_reason=None, p_opts=None):
    o = p_opts or {}
    doc, stored = _load(r, p_doc_id)
    meta = _materialize(r, doc, stored)
    if p_ver is not None and stored and int(p_ver) != int(meta["ver"]):
        raise C.Denied("เอกสารนี้ถูกผู้อื่นเปลี่ยนไปแล้ว — โหลดใหม่แล้วลองอีกครั้ง")
    src = _sources(r).get(doc["id"])
    if src and p_action in SOURCE_FLOW:
        raise C.Denied(_src_next(src) or "ขั้นนี้ดำเนินการในระบบต้นทาง")
    meta = _eff(meta, src)
    rule = _rule_for(r, doc)
    st = meta["stage"]
    task = _open_task(r, doc["id"], STAGE_TASK.get(st, ""))
    C.check_action(p_action, meta, _actor(r), r.has_perm, p_reason, task)
    to = C.next_stage(p_action, meta, rule)
    files = _files(r, doc["id"])
    vals: dict = {"stage": to}
    now, me = _now(), _name(r)
    detail = None

    if p_action == "sign":
        method = o.get("sign_method")
        if method not in C.SIGN_METHODS:
            raise C.Denied("เลือกวิธีลงนาม")
        if rule["need_signed_file"] and not any(f["kind"] == "signed" for f in files):
            raise C.Denied("แนบไฟล์ฉบับลงนาม (ชนิด “ฉบับลงนาม/ฉบับจริง”) ก่อนบันทึกการลงนาม")
        vals.update(signed_at=now, sign_method=method, signed_by_name=(o.get("signed_by_name") or me)[:200],
                    sign_note=(o.get("sign_note") or None))
        detail = C.SIGN_METHODS[method]
    if p_action == "approve":
        vals.update(approved_at=now, approved_by_name=me)
    if p_action in ("issue", "register_official"):
        if p_action == "register_official":
            method = o.get("sign_method")
            if method not in C.SIGN_METHODS:
                raise C.Denied("ระบุวิธีที่เอกสารนี้ลงนาม")
            vals.update(signed_at=meta.get("signed_at") or now, sign_method=method,
                        signed_by_name=(o.get("signed_by_name") or "")[:200] or None, sign_note=o.get("sign_note"))
            detail = C.SIGN_METHODS[method]
        fid = o.get("official_file_id")
        if fid:
            f = next((x for x in files if x["id"] == int(fid)), None)
            if not f:
                raise C.Denied("ไฟล์ฉบับจริงไม่ใช่ไฟล์ของเอกสารนี้")
            _mark_official(r, doc["id"], f, me)
            detail = (detail + " · " if detail else "") + f"ฉบับจริง: {f['name']}"
        elif rule["need_signed_file"] and not meta.get("file_note"):
            raise C.Denied("เลือกไฟล์ฉบับจริง — หรือระบุว่าไม่ต้องแนบพร้อมเหตุผลก่อน")
        if p_action == "register_official" and st == "issued" and not fid:
            raise C.Denied("เลือกไฟล์ฉบับจริง")
        vals["issued_at"] = meta.get("issued_at") or now
    if p_action == "close":
        dl = _q(r, "SELECT * FROM {t:doc_deliveries} WHERE doc_id = ?", doc["id"])
        fs = C.file_state(doc, meta, rule, [f["kind"] for f in files], None)
        block = C.close_blockers(rule, fs, dl)
        if block and not (p_reason or "").strip():
            raise C.Denied("ยังปิดเรื่องไม่ได้: " + " · ".join(block) + " — หรือใส่เหตุผลเพื่อปิดโดยมีข้อยกเว้น")
        if block:
            detail = "ปิดโดยมีข้อยกเว้น: " + " · ".join(block)
        vals["closed_at"] = now
    if p_action == "archive":
        loc = (o.get("paper_location") or meta.get("paper_location") or "").strip()
        if not loc:
            raise C.Denied("ระบุที่เก็บต้นฉบับ (หรือ “ไม่มีต้นฉบับกระดาษ”)")
        vals.update(archived_at=now, paper_location=loc[:300])
    if p_action == "submit":
        vals["returned"] = 0
    if p_action == "return":
        vals["returned"] = 1
    if p_action == "use_reserved":
        if not (doc.get("subject") or doc.get("person_name") or o.get("subject")):
            raise C.Denied("ใส่เรื่องหรือผู้รับก่อนใช้เลข")
    if p_action == "accept" and o.get("owner_id"):
        vals.update(owner_id=str(o["owner_id"]), owner_name=o.get("owner_name"))
    if p_action == "reopen":
        vals.update(closed_at=None, archived_at=None)

    # งานของขั้นเดิม
    if task:
        res = {"return": "returned", "reject": "rejected", "cancel": "cancelled"}.get(p_action, "done")
        _update(r, "doc_tasks", "id = ?", (task["id"],), {"status": res, "done_at": now, "done_by_name": me,
                                                         "result_note": (p_reason or None)})
    if p_action in ("return", "reject", "cancel"):
        _exec(r, "UPDATE {t:doc_tasks} SET status = 'cancelled', done_at = ?, done_by_name = ? WHERE doc_id = ? AND status = 'open'",
              now, me, doc["id"])
    # งานของขั้นใหม่ (ระบุผู้รับงานได้)
    if to in STAGE_TASK and (o.get("assignee_id") or o.get("assignee_name")):
        _insert(r, "doc_tasks", {"doc_id": doc["id"], "kind": STAGE_TASK[to], "assignee_id": o.get("assignee_id"),
                                 "assignee_name": o.get("assignee_name"), "status": "open", "due_date": o.get("due_date"),
                                 "note": o.get("task_note"), "created_by_name": me, "created_at": now})
    _set_meta(r, doc["id"], meta["ver"], vals)
    if p_action == "cancel" and doc.get("status") != "void":
        _void_number(r, doc, p_reason)
    _event(r, doc["id"], p_action, st, to, p_reason, detail)
    return dms_doc(r, p_doc_id=doc["id"])


def _src_next(src):
    where = {"letter": "ระบบออกหนังสือ HR", "contract": "หน้าสัญญาจ้างงาน"}.get(src.get("kind"), "หน้า PAF")
    if src.get("kind") == "contract" and src.get("status") == "pending":
        return f"ผู้แทนบริษัทและพยานลงนามที่{where}"
    st = src.get("status")
    if st in ("draft", "rejected"):
        return f"ร่าง/แก้ไขและส่งอนุมัติที่{where}"
    if st == "pending":
        return f"รออนุมัติที่{where}"
    return ""


def _void_number(r, doc, reason):
    """ยกเลิกเลขในทะเบียนเดิม — ผ่าน rest เพื่อให้ trigger เดิม (ยกเลิกหนังสือที่ผูกกับเลข) ทำงานด้วย · เลขไม่ถูกนำกลับมาใช้"""
    vals = {"status": "void", "void_reason": (reason or "")[:500] or None, "voided_at": _now(), "voided_by": str(r.uid) if r.uid else None}
    if hasattr(r, "upd"):
        r.upd("doc_register", doc, vals)
    else:
        _update(r, "doc_register", "id = ?", (doc["id"],), vals)
    # PAF ที่ใช้เลขนี้ → ยกเลิกด้วย (หน้า PAF ยกเลิกฉบับที่อนุมัติแล้วไม่ได้) · ไม่ย้อน Movement ที่สร้างไปแล้ว
    f = _one(r, "SELECT id, status FROM {t:paf_forms} WHERE doc_id = ? AND status <> 'cancelled'", doc["id"]) if _has_table(r, "paf_forms") else None
    if f:
        if hasattr(r, "upd"):
            r.flag("paf.flow")
            r.upd("paf_forms", r.row("paf_forms", "id = ?", f["id"]), {"status": "cancelled", "cancel_reason": ("ยกเลิกเลขในสารบรรณ: " + (reason or ""))[:500],
                                                                     "cur_step": None, "updated_at": _now()})
            r.ins("paf_log", {"paf_id": f["id"], "action": "cancel", "actor_name": _name(r), "remark": (reason or "")[:500], "via": "app"})
        else:
            _update(r, "paf_forms", "id = ?", (f["id"],), {"status": "cancelled"})


def _has_table(r, name):
    try:
        _q(r, f"SELECT 1 AS x FROM {{t:{name}}} WHERE 1 = 0")
        return True
    except Exception:
        return False


def _mark_official(r, doc_id, f, me):
    prev = _one(r, "SELECT * FROM {t:doc_file_meta} WHERE doc_id = ? AND is_official = 1 AND file_id <> ?", doc_id, f["id"])
    if prev:
        raise C.Denied("มีฉบับจริงอยู่แล้ว — ใช้ “แทนที่ฉบับจริง” (มีเหตุผลและประวัติ) แทนการเลือกใหม่")
    _file_meta(r, doc_id, f["id"], {"kind": "signed", "is_official": 1, "locked": 1, "set_by_name": me, "set_at": _now()})


def _file_meta(r, doc_id, file_id, values):
    if _one(r, "SELECT file_id FROM {t:doc_file_meta} WHERE file_id = ?", file_id):
        _update(r, "doc_file_meta", "file_id = ?", (file_id,), values)
    else:
        n = (_one(r, "SELECT COUNT(*) AS n FROM {t:doc_file_meta} WHERE doc_id = ? AND kind = ?", doc_id, values.get("kind")) or {}).get("n", 0)
        _insert(r, "doc_file_meta", {"file_id": file_id, "doc_id": doc_id, "version": n + 1, "is_official": 0, "locked": 0, **values})


# ================================================================================ ข้อมูลเรื่อง (ผู้รับผิดชอบ กำหนด ชั้นข้อมูล ...)
UPD_FIELDS = {"owner_id", "owner_name", "due_date", "priority", "effective_date", "case_ref", "sensitivity", "paper_location", "file_note"}


@fn
def dms_update(r, p_doc_id, p_fields, p_reason=None):
    doc, stored = _load(r, p_doc_id)
    meta = _materialize(r, doc, stored)
    if meta["stage"] in C.TERMINAL:
        raise C.Denied("เอกสารนี้ปิดถาวรแล้ว")
    mine = meta.get("owner_id") and str(meta["owner_id"]) == str(r.uid)
    if not (r.has_perm("data.docregister.write") or r.has_perm("doc.manage") or mine):
        raise C.Denied("ไม่มีสิทธิ์แก้ไขเรื่องนี้")
    f = {k: (v if v != "" else None) for k, v in (p_fields or {}).items() if k in UPD_FIELDS}
    changed = [k for k, v in f.items() if str(v or "") != str(meta.get(k) or "")]
    if not changed:
        return dms_doc(r, p_doc_id=doc["id"])
    if "owner_id" in changed and meta.get("owner_id") and not (r.has_perm("doc.manage") or r.has_perm("data.docregister.write")):
        raise C.Denied("โอนเรื่องให้ผู้อื่นได้เฉพาะ HR ผู้ออกเลข/ผู้ดูแลสารบรรณ")
    if "owner_id" in changed and meta.get("owner_id") and not (p_reason or "").strip():
        raise C.Denied("เปลี่ยนผู้รับผิดชอบต้องระบุเหตุผล")
    if "file_note" in changed and f.get("file_note") and len(f["file_note"].strip()) < 4:
        raise C.Denied("ระบุเหตุผลที่ไม่ต้องแนบไฟล์")
    if "sensitivity" in changed:
        new, old = f.get("sensitivity") or "general", meta.get("sensitivity") or ("confidential" if doc.get("confidential") else "general")
        if new not in C.SENS:
            raise C.Denied("ชั้นข้อมูลไม่ถูกต้อง")
        if new in C.CAT_PERM and not r.has_perm(C.CAT_PERM[new]):
            raise C.Denied("ตั้งหมวดนี้ได้เฉพาะผู้มีสิทธิ์ดูหมวดนั้น")
        if old in C.CONFIDENTIAL_SENS and new not in C.CONFIDENTIAL_SENS and not r.has_perm("data.doc.confidential"):
            raise C.Denied("ปลดชั้นความลับได้เฉพาะผู้มีสิทธิ์ดูเอกสารลับ")
        if new in C.CONFIDENTIAL_SENS and not r.has_perm("data.doc.confidential"):
            raise C.Denied("ตั้งเป็นเอกสารลับได้เฉพาะผู้มีสิทธิ์ดูเอกสารลับ (ไม่งั้นจะมองไม่เห็นเอง)")
        conf = 1 if new in C.CONFIDENTIAL_SENS else 0
        if bool(doc.get("confidential")) != bool(conf):
            _update(r, "doc_register", "id = ?", (doc["id"],), {"confidential": conf})
    _set_meta(r, doc["id"], meta["ver"], f)
    # ไม่คัดลอกค่าลงประวัติ (อาจมีข้อมูลส่วนบุคคล) — บันทึกชื่อช่อง และผู้รับผิดชอบคนใหม่
    label = {"owner_id": "ผู้รับผิดชอบ", "owner_name": None, "due_date": "กำหนดเสร็จ", "priority": "ความเร่งด่วน",
             "effective_date": "วันที่มีผล", "case_ref": "แฟ้มเรื่อง", "sensitivity": "ชั้นข้อมูล", "paper_location": "ที่เก็บต้นฉบับ",
             "file_note": "ไม่ต้องแนบไฟล์"}
    det = ", ".join(x for x in (label.get(k) for k in changed) if x)
    if "owner_id" in changed:
        det += f" → {f.get('owner_name') or '—'}"
    if "sensitivity" in changed:
        det += f" → {C.SENS.get(f.get('sensitivity') or 'general')}"
    _event(r, doc["id"], "update", meta["stage"], meta["stage"], p_reason, "แก้ " + det)
    return dms_doc(r, p_doc_id=doc["id"])


@fn
def dms_people_set(r, p_doc_id, p_people):
    doc, stored = _load(r, p_doc_id)
    meta = _materialize(r, doc, stored)
    if not (r.has_perm("data.docregister.write") or r.has_perm("doc.manage")):
        raise C.Denied("ไม่มีสิทธิ์แก้ไขผู้เกี่ยวข้อง")
    _exec(r, "DELETE FROM {t:doc_people} WHERE doc_id = ?", doc["id"])
    n = 0
    for p in (p_people or [])[:200]:
        if not ((p.get("emp_code") or "").strip() or (p.get("name") or "").strip()):
            continue
        role = p.get("role") if p.get("role") in ("subject", "recipient", "sender", "cc") else "subject"
        _insert(r, "doc_people", {"doc_id": doc["id"], "role": role, "emp_code": (p.get("emp_code") or None),
                                  "name": (p.get("name") or None), "org": (p.get("org") or None)})
        n += 1
    _event(r, doc["id"], "people", meta["stage"], meta["stage"], None, f"ผู้เกี่ยวข้อง {n} คน")
    return dms_doc(r, p_doc_id=doc["id"])


# ================================================================================ ไฟล์และรุ่น
@fn
def dms_file_set(r, p_file_id, p_kind, p_note=None):
    f = _one(r, "SELECT * FROM {t:doc_files} WHERE id = ?", int(p_file_id))
    if not f:
        raise C.Denied("ไม่พบไฟล์")
    doc, stored = _load(r, f["doc_id"])
    if not (r.has_perm("data.docregister.write") or r.has_perm("doc.manage")):
        raise C.Denied("ไม่มีสิทธิ์จัดการไฟล์")
    if p_kind not in C.FILE_KINDS:
        raise C.Denied("ชนิดไฟล์ไม่ถูกต้อง")
    fm = _one(r, "SELECT * FROM {t:doc_file_meta} WHERE file_id = ?", f["id"])
    if fm and fm.get("locked"):
        raise C.Denied("ไฟล์ฉบับจริงถูกล็อก — เปลี่ยนชนิดไม่ได้")
    _file_meta(r, doc["id"], f["id"], {"kind": p_kind, "note": (p_note or None), "set_by_name": _name(r), "set_at": _now()})
    _event(r, doc["id"], "file_kind", None, None, None, f"{f['name']} → {C.FILE_KINDS[p_kind]}")
    return {"ok": True}


@fn
def dms_file_supersede(r, p_doc_id, p_new_file_id, p_reason):
    """แทนที่ฉบับจริง (แก้ไขหลังออกฉบับจริง): ฉบับเดิมยังอยู่และถูกล็อก ชี้ไปฉบับใหม่ · ต้องมีเหตุผล"""
    doc, stored = _load(r, p_doc_id)
    meta = _materialize(r, doc, stored)
    if not (r.has_perm("doc.official") or r.has_perm("doc.manage")):
        raise C.Denied("ไม่มีสิทธิ์แทนที่ฉบับจริง")
    if not (p_reason or "").strip():
        raise C.Denied("ต้องระบุเหตุผลที่แทนที่ฉบับจริง")
    files = _files(r, doc["id"])
    new = next((x for x in files if x["id"] == int(p_new_file_id)), None)
    if not new or new.get("is_official"):
        raise C.Denied("เลือกไฟล์ใหม่ของเอกสารนี้ที่ยังไม่ใช่ฉบับจริง")
    old = next((x for x in files if x.get("is_official") and not x.get("replaced_by")), None)
    me = _name(r)
    if old:
        _update(r, "doc_file_meta", "file_id = ?", (old["id"],), {"is_official": 0, "locked": 1, "replaced_by": new["id"]})
    v = (_one(r, "SELECT MAX(version) AS v FROM {t:doc_file_meta} WHERE doc_id = ? AND kind = 'signed'", doc["id"]) or {}).get("v") or 0
    _file_meta(r, doc["id"], new["id"], {"kind": "signed", "is_official": 1, "locked": 1, "version": v + 1, "set_by_name": me, "set_at": _now()})
    _event(r, doc["id"], "supersede_file", meta["stage"], meta["stage"], p_reason,
           f"ฉบับจริงใหม่: {new['name']}" + (f" (แทน {old['name']})" if old else ""))
    return dms_doc(r, p_doc_id=doc["id"])


def file_locked(cur, file_id=None, path=None) -> bool:
    """ใช้โดย hooks (ลบแถว doc_files) และ storage (ลบ blob): ฉบับจริงที่ล็อกแล้วลบไม่ได้"""
    try:
        ensure(cur)
        t, fm = _tbl(cur, "doc_files"), _tbl(cur, "doc_file_meta")
        if path is not None:
            row = _x(cur, f"SELECT m.locked FROM {t} f JOIN {fm} m ON m.file_id = f.id WHERE f.path = ?", path).fetchone()
        else:
            row = _x(cur, f"SELECT locked FROM {fm} WHERE file_id = ?", file_id).fetchone()
        return bool(row and row[0])
    except Exception:
        return False


# ================================================================================ ฉบับแก้ไข/แทนที่ (เลขใหม่) และเอกสารเชื่อมโยง
@fn
def dms_revise(r, p_doc_id, p_reason):
    """ออกฉบับแก้ไขเป็นเลขใหม่ในชุดเดิม ผูก “แทนที่” กับฉบับเดิม — ฉบับเดิมไม่ถูกแก้ ยังเปิดดูได้"""
    import rpc
    doc, stored = _load(r, p_doc_id)
    meta = _materialize(r, doc, stored)
    if not (r.has_perm("data.docregister.write") and (r.has_perm("doc.official") or r.has_perm("doc.manage"))):
        raise C.Denied("ไม่มีสิทธิ์ออกฉบับแก้ไข")
    if not (p_reason or "").strip():
        raise C.Denied("ต้องระบุเหตุผลที่ออกฉบับแก้ไข")
    if meta["stage"] not in ("issued", "closed", "archived"):
        raise C.Denied("ออกฉบับแก้ไขได้เฉพาะเอกสารที่ออกฉบับจริงแล้ว")
    if meta.get("superseded_by"):
        raise C.Denied("เอกสารนี้มีฉบับแก้ไขแล้ว")
    new = rpc._doc_issue(r, doc["series_code"], 1, doc.get("type_id"), doc.get("subject"), C.today_bkk().isoformat(),
                         doc["doc_no"], f"ฉบับแก้ไขของ {doc['doc_no']}", [{"emp_code": doc.get("emp_code"), "person_name": doc.get("person_name")}])[0]
    if doc.get("confidential") and not new.get("confidential"):
        _update(r, "doc_register", "id = ?", (new["id"],), {"confidential": 1})
    nm = _materialize(r, new, None)
    _set_meta(r, new["id"], nm["ver"], {"sensitivity": meta.get("sensitivity"), "owner_id": meta.get("owner_id"),
                                       "owner_name": meta.get("owner_name"), "case_ref": meta.get("case_ref")})
    for p in _q(r, "SELECT role, emp_code, name, org FROM {t:doc_people} WHERE doc_id = ?", doc["id"]):
        _insert(r, "doc_people", {"doc_id": new["id"], **p})
    me = _name(r)
    _insert(r, "doc_links", {"doc_id": new["id"], "other_id": doc["id"], "kind": "supersedes", "note": p_reason[:300],
                             "created_by_name": me, "created_at": _now()})
    _set_meta(r, doc["id"], meta["ver"], {"superseded_by": new["id"]})
    _event(r, doc["id"], "superseded", meta["stage"], meta["stage"], p_reason, f"ถูกแทนที่โดย {new['doc_no']}")
    _event(r, new["id"], "revision_of", "draft", "draft", p_reason, f"ฉบับแก้ไขของ {doc['doc_no']}")
    return {"id": new["id"], "doc_no": new["doc_no"]}


LINK_KINDS = {"related": "เกี่ยวข้อง", "reply_to": "ตอบ/อ้างถึง", "supersedes": "แทนที่", "attachment_of": "เป็นเอกสารประกอบของ"}


@fn
def dms_link_add(r, p_doc_id, p_other_no, p_kind="related", p_note=None):
    doc, _ = _load(r, p_doc_id)
    if not (r.has_perm("data.docregister.write") or r.has_perm("doc.manage")):
        raise C.Denied("ไม่มีสิทธิ์")
    if p_kind not in LINK_KINDS or p_kind == "supersedes":
        raise C.Denied("ชนิดการเชื่อมโยงไม่ถูกต้อง")
    other = _one(r, "SELECT id FROM {t:doc_register} WHERE doc_no = ?", (p_other_no or "").strip())
    if not other or other["id"] == doc["id"]:
        raise C.Denied("ไม่พบเลขที่เอกสารนั้น")
    _load(r, other["id"])           # ต้องเห็นเอกสารปลายทางด้วย
    _insert(r, "doc_links", {"doc_id": doc["id"], "other_id": other["id"], "kind": p_kind, "note": p_note,
                             "created_by_name": _name(r), "created_at": _now()})
    _event(r, doc["id"], "link", None, None, None, f"{LINK_KINDS[p_kind]} {p_other_no}")
    return dms_doc(r, p_doc_id=doc["id"])


@fn
def dms_link_remove(r, p_link_id):
    l = _one(r, "SELECT * FROM {t:doc_links} WHERE id = ?", int(p_link_id))
    if not l or l["kind"] == "supersedes":
        raise C.Denied("ลบการเชื่อมโยงนี้ไม่ได้")
    doc, _ = _load(r, l["doc_id"])
    if not (r.has_perm("data.docregister.write") or r.has_perm("doc.manage")):
        raise C.Denied("ไม่มีสิทธิ์")
    _exec(r, "DELETE FROM {t:doc_links} WHERE id = ?", l["id"])
    _event(r, doc["id"], "unlink", None, None, None, "ลบการเชื่อมโยง")
    return dms_doc(r, p_doc_id=doc["id"])


# ================================================================================ มอบหมาย / มอบหมายแทน
@fn
def dms_task_delegate(r, p_task_id, p_assignee_id, p_assignee_name, p_reason):
    t = _one(r, "SELECT * FROM {t:doc_tasks} WHERE id = ?", int(p_task_id))
    if not t or t["status"] != "open":
        raise C.Denied("งานนี้ปิดไปแล้ว")
    doc, stored = _load(r, t["doc_id"])
    if not ((t.get("assignee_id") and str(t["assignee_id"]) == str(r.uid)) or r.has_perm("doc.manage")):
        raise C.Denied("มอบหมายแทนได้เฉพาะผู้รับงาน หรือผู้ดูแลสารบรรณ")
    if not (p_reason or "").strip():
        raise C.Denied("ต้องระบุเหตุผล")
    if not (p_assignee_id or p_assignee_name):
        raise C.Denied("เลือกผู้รับงานแทน")
    me, now = _name(r), _now()
    _update(r, "doc_tasks", "id = ?", (t["id"],), {"status": "delegated", "done_at": now, "done_by_name": me, "result_note": p_reason})
    _insert(r, "doc_tasks", {"doc_id": t["doc_id"], "kind": t["kind"], "assignee_id": p_assignee_id, "assignee_name": p_assignee_name,
                             "status": "open", "due_date": t.get("due_date"), "note": f"รับมอบหมายแทนจาก {t.get('assignee_name') or '—'}",
                             "created_by_name": me, "created_at": now})
    _event(r, t["doc_id"], "delegate", None, None, p_reason, f"{t.get('assignee_name') or '—'} → {p_assignee_name or '—'}")
    return dms_doc(r, p_doc_id=t["doc_id"])


@fn
def dms_assignees(r, p_kind=None):
    """รายชื่อผู้ใช้ที่ทำงานขั้นนั้นได้ (สำหรับเลือกผู้รับงาน) — คืนเฉพาะชื่อ"""
    if not (r.has_perm("page.docregister")):
        raise C.Denied("ไม่มีสิทธิ์")
    perm = {"review": "doc.review", "approve": "doc.approve", "sign": "doc.sign", "owner": "data.docregister.write"}.get(p_kind)
    out = []
    for u in _q(r, "SELECT user_id, name, email, [role] FROM {t:user_roles} ORDER BY name"):
        if perm and not r.user_has_perm(u["user_id"], perm):
            continue
        out.append({"id": u["user_id"], "name": u.get("name") or u.get("email")})
    return out


# ================================================================================ ส่งมอบ / รับทราบ
CHANNELS = {"hand": "ส่งมอบด้วยตนเอง", "email": "อีเมล", "post": "ไปรษณีย์", "internal": "ส่งภายใน", "other": "อื่น ๆ"}
ACK_METHODS = {"signature": "ลงชื่อรับบนสำเนา", "email_reply": "ตอบรับทางอีเมล", "witness": "มีพยานยืนยัน", "system": "ยืนยันในระบบ",
               "refused": "ปฏิเสธการรับ"}


@fn
def dms_delivery_add(r, p_doc_id, p_d):
    doc, stored = _load(r, p_doc_id)
    meta = _materialize(r, doc, stored)
    if meta["stage"] not in ("issued", "closed", "in_progress"):
        raise C.Denied("บันทึกการส่งได้หลังออกฉบับจริง")
    if not (r.has_perm("data.docregister.write") or r.has_perm("doc.manage") or str(meta.get("owner_id")) == str(r.uid)):
        raise C.Denied("ไม่มีสิทธิ์")
    d = p_d or {}
    if not (d.get("recipient") or "").strip():
        raise C.Denied("ระบุผู้รับ")
    if d.get("channel") not in CHANNELS:
        raise C.Denied("เลือกช่องทางส่ง")
    _insert(r, "doc_deliveries", {"doc_id": doc["id"], "recipient": d["recipient"][:300], "emp_code": d.get("emp_code") or None,
                                  "channel": d["channel"], "sent_at": d.get("sent_at") or C.today_bkk().isoformat(),
                                  "sent_by_name": _name(r), "need_ack": 1 if d.get("need_ack") else 0, "status": "sent",
                                  "note": d.get("note") or None, "created_at": _now()})
    _event(r, doc["id"], "deliver", meta["stage"], meta["stage"], None,
           f"ส่ง{CHANNELS[d['channel']]}" + (" · ต้องรับทราบ" if d.get("need_ack") else ""))
    return dms_doc(r, p_doc_id=doc["id"])


@fn
def dms_delivery_ack(r, p_delivery_id, p_a):
    d = _one(r, "SELECT * FROM {t:doc_deliveries} WHERE id = ?", int(p_delivery_id))
    if not d or d["status"] == "cancelled":
        raise C.Denied("ไม่พบรายการส่ง")
    doc, stored = _load(r, d["doc_id"])
    meta = _materialize(r, doc, stored)
    if not (r.has_perm("data.docregister.write") or r.has_perm("doc.manage") or str(meta.get("owner_id")) == str(r.uid)):
        raise C.Denied("ไม่มีสิทธิ์")
    a = p_a or {}
    if a.get("ack_method") not in ACK_METHODS:
        raise C.Denied("เลือกวิธีรับทราบ")
    ev = a.get("evidence_file_id")
    if ev:
        f = _one(r, "SELECT id FROM {t:doc_files} WHERE id = ? AND doc_id = ?", int(ev), doc["id"])
        if not f:
            raise C.Denied("ไฟล์หลักฐานไม่ใช่ไฟล์ของเอกสารนี้")
        _file_meta(r, doc["id"], f["id"], {"kind": "evidence", "set_by_name": _name(r), "set_at": _now()})
    elif a.get("ack_method") in ("signature",) and not (a.get("ack_note") or "").strip():
        raise C.Denied("แนบไฟล์หลักฐาน (สำเนาที่ลงชื่อรับ) หรือบันทึกรายละเอียด")
    st = "refused" if a["ack_method"] == "refused" else "acknowledged"
    _update(r, "doc_deliveries", "id = ?", (d["id"],), {"ack_at": a.get("ack_at") or C.today_bkk().isoformat(), "ack_method": a["ack_method"],
                                                       "ack_note": a.get("ack_note") or None, "ack_by_name": _name(r),
                                                       "evidence_file_id": int(ev) if ev else None, "status": st})
    _event(r, doc["id"], "ack", meta["stage"], meta["stage"], None, f"{d['recipient']}: {ACK_METHODS[a['ack_method']]}")
    return dms_doc(r, p_doc_id=doc["id"])


@fn
def dms_delivery_cancel(r, p_delivery_id, p_reason):
    d = _one(r, "SELECT * FROM {t:doc_deliveries} WHERE id = ?", int(p_delivery_id))
    if not d or d["status"] == "cancelled":
        raise C.Denied("ไม่พบรายการส่ง")
    doc, stored = _load(r, d["doc_id"])
    if not (r.has_perm("data.docregister.write") or r.has_perm("doc.manage")):
        raise C.Denied("ไม่มีสิทธิ์")
    if not (p_reason or "").strip():
        raise C.Denied("ต้องระบุเหตุผล")
    _update(r, "doc_deliveries", "id = ?", (d["id"],), {"status": "cancelled", "note": ((d.get("note") or "") + " · ยกเลิก: " + p_reason)[:500]})
    _event(r, doc["id"], "deliver_cancel", None, None, p_reason, d["recipient"])
    return dms_doc(r, p_doc_id=doc["id"])


# ================================================================================ ตั้งค่าขั้นตอนตามประเภท
@fn
def dms_rules(r):
    if not r.has_perm("page.docregister"):
        raise C.Denied("ไม่มีสิทธิ์")
    series, rules = _series(r), _rules(r)
    out = []
    for t in _q(r, "SELECT id, series_code, label, is_active FROM {t:doc_types} ORDER BY series_code, sort_order"):
        d = series.get(t["series_code"], {}).get("direction", "out")
        out.append({"type_id": t["id"], "series_code": t["series_code"], "label": t["label"], "is_active": t["is_active"],
                    "stored": t["id"] in rules, **C.type_rule(d, t["label"], rules.get(t["id"]))})
    return {"rules": out, "policies": _q(r, "SELECT * FROM {t:doc_retention} ORDER BY id")}


@fn
def dms_rule_save(r, p_type_id, p_rule):
    _need(r, "doc.manage")
    t = _one(r, "SELECT id FROM {t:doc_types} WHERE id = ?", int(p_type_id))
    if not t:
        raise C.Denied("ไม่พบประเภท")
    x = p_rule or {}
    vals = {k: (1 if x.get(k) else 0) for k in ("need_review", "need_approval", "need_sign", "need_delivery", "need_ack",
                                                 "need_draft_file", "need_signed_file")}
    if x.get("sensitivity") not in C.SENS:
        raise C.Denied("ชั้นข้อมูลไม่ถูกต้อง")
    pid = x.get("retention_id")
    if pid and not _one(r, "SELECT id FROM {t:doc_retention} WHERE id = ?", int(pid)):
        raise C.Denied("ไม่พบนโยบายอายุเก็บ")
    vals.update(flow=x.get("flow") if x.get("flow") in ("out", "in", "internal") else "out", sensitivity=x["sensitivity"],
                retention_id=int(pid) if pid else None, due_days=int(x["due_days"]) if x.get("due_days") not in (None, "") else None,
                updated_by_name=_name(r), updated_at=_now())
    if _one(r, "SELECT type_id FROM {t:doc_type_rules} WHERE type_id = ?", t["id"]):
        _update(r, "doc_type_rules", "type_id = ?", (t["id"],), vals)
    else:
        _insert(r, "doc_type_rules", {"type_id": t["id"], **vals})
    _event(r, None, "rule_save", None, None, None, f"ตั้งค่าขั้นตอนประเภท #{t['id']}")
    return {"ok": True}


# ================================================================================ อายุเก็บ · ระงับทำลาย · การทำลาย
@fn
def dms_retention_save(r, p_policy):
    """นโยบายใหม่เป็น “ร่าง” เสมอ · เปิดใช้ได้เมื่อระบุผู้อนุมัตินโยบายและวันที่ และผู้เปิดมีสิทธิ์อนุมัติทำลาย"""
    _need(r, "doc.retention")
    p = p_policy or {}
    if not (p.get("name") or "").strip():
        raise C.Denied("ตั้งชื่อนโยบาย")
    if p.get("start_event") not in C.START_EVENTS:
        raise C.Denied("เลือกเหตุการณ์เริ่มนับ")
    yrs, mos = int(p.get("years") or 0), int(p.get("months") or 0)
    if yrs < 0 or mos < 0 or yrs * 12 + mos <= 0:
        raise C.Denied("ระบุระยะเวลาเก็บ")
    status = p.get("status") if p.get("status") in ("draft", "active", "retired") else "draft"
    if status == "active":
        if not (p.get("approved_by_name") or "").strip() or not p.get("approved_on"):
            raise C.Denied("เปิดใช้นโยบายต้องระบุผู้อนุมัตินโยบายและวันที่อนุมัติ")
        if not (r.has_perm("doc.dispose.approve") or r.has_perm("doc.manage")):
            raise C.Denied("เปิดใช้นโยบายได้เฉพาะผู้มีสิทธิ์อนุมัติทำลาย")
        if not (p.get("basis") or "").strip():
            raise C.Denied("ระบุเหตุผล/ข้อกำหนดอ้างอิงของนโยบาย")
    vals = {"name": p["name"][:300], "years": yrs, "months": mos, "start_event": p["start_event"], "basis": p.get("basis") or None,
            "approved_by_name": p.get("approved_by_name") or None, "approved_on": p.get("approved_on") or None, "status": status,
            "note": p.get("note") or None, "updated_at": _now()}
    if p.get("id"):
        old = _one(r, "SELECT * FROM {t:doc_retention} WHERE id = ?", int(p["id"]))
        if not old:
            raise C.Denied("ไม่พบนโยบาย")
        _update(r, "doc_retention", "id = ?", (old["id"],), vals)
        pid = old["id"]
    else:
        pid = _insert(r, "doc_retention", {**vals, "created_by_name": _name(r), "created_at": _now()})
    _event(r, None, "retention_save", None, None, None, f"นโยบาย #{pid} {vals['name']} · {status}")
    return {"id": pid}


@fn
def dms_hold(r, p_doc_id, p_on, p_reason):
    doc, stored = _load(r, p_doc_id)
    meta = _materialize(r, doc, stored)
    _need(r, "doc.retention")
    if not (p_reason or "").strip():
        raise C.Denied("ต้องระบุเหตุผล (เช่น ข้อพิพาท การตรวจสอบ)")
    if meta["stage"] == "disposed":
        raise C.Denied("เอกสารถูกทำลายแล้ว")
    on = bool(p_on)
    _set_meta(r, doc["id"], meta["ver"], {"hold": 1 if on else 0, "hold_reason": p_reason[:500] if on else None,
                                         "hold_by_name": _name(r) if on else None, "hold_at": _now() if on else None})
    _event(r, doc["id"], "hold" if on else "unhold", meta["stage"], meta["stage"], p_reason, None)
    return dms_doc(r, p_doc_id=doc["id"])


def _eligible(r, ids=None):
    """รายการที่ครบอายุเก็บตามนโยบายที่เปิดใช้ — ตรวจที่ฝั่งเซิร์ฟเวอร์ทุกครั้ง"""
    series, rules = _series(r), _rules(r)
    pols = {p["id"]: p for p in _q(r, "SELECT * FROM {t:doc_retention}")}
    metas = {m["doc_id"]: m for m in _q(r, "SELECT * FROM {t:doc_meta}")}
    today = C.today_bkk()
    docs = _q(r, "SELECT * FROM {t:doc_register}" + (f" WHERE id IN ({_in(ids)})" if ids is not None else ""), *(ids or []))
    out = []
    for d in docs:
        st = metas.get(d["id"])
        if not _visible(r, d, st):
            continue
        m = dict(st) if st else _meta_of(r, d, None, series, rules)
        rule = C.type_rule(series.get(d["series_code"], {}).get("direction", "out"), d.get("type_label"), rules.get(d.get("type_id")))
        until = _until(r, d, m, rule, pols)
        out.append((d, m, until, C.disposal_block(m, until, today)))
    return out


@fn
def dms_disposal_candidates(r):
    _need(r, "doc.retention")
    out = []
    for d, m, until, block in _eligible(r):
        if until is None and m.get("stage") != "disposed":
            continue
        out.append({"id": d["id"], "doc_no": d["doc_no"], "type_label": d.get("type_label"), "until": until.isoformat() if until else None,
                    "block": block, "hold": bool(m.get("hold")), "stage": m.get("stage")})
    soon = (C.today_bkk().replace(day=1))
    return {"items": out, "today": C.today_bkk().isoformat(), "since": soon.isoformat()}


@fn
def dms_disposal_list(r):
    if not (r.has_perm("doc.retention") or r.has_perm("doc.dispose.approve")):
        raise C.Denied("ไม่มีสิทธิ์")
    rows = _q(r, "SELECT * FROM {t:doc_disposals} ORDER BY id DESC")
    for x in rows:
        x["items"] = _q(r, """SELECT i.*, d.doc_no, d.type_label FROM {t:doc_disposal_items} i JOIN {t:doc_register} d ON d.id = i.doc_id
                               WHERE i.disposal_id = ? ORDER BY d.doc_no""", x["id"])
    return rows


@fn
def dms_disposal_propose(r, p_title, p_doc_ids, p_paper_method="shred", p_files_action="keep", p_note=None):
    _need(r, "doc.retention")
    ids = [int(i) for i in (p_doc_ids or [])][:1000]
    if not ids:
        raise C.Denied("เลือกรายการ")
    if p_paper_method not in ("shred", "none", "other") or p_files_action not in ("keep", "delete"):
        raise C.Denied("วิธีทำลายไม่ถูกต้อง")
    rows = _eligible(r, ids)
    bad = [d["doc_no"] for d, m, u, b in rows if b] + ([] if len(rows) == len(set(ids)) else ["(บางรายการไม่พบ/ไม่มีสิทธิ์)"])
    if bad:
        raise C.Denied("บางรายการยังไม่เข้าเกณฑ์ทำลาย: " + ", ".join(bad[:10]))
    busy = _q(r, f"""SELECT i.doc_id FROM {{t:doc_disposal_items}} i JOIN {{t:doc_disposals}} x ON x.id = i.disposal_id
                     WHERE x.status IN ('proposed', 'approved') AND i.doc_id IN ({_in(ids)})""", *ids)
    if busy:
        raise C.Denied("บางรายการอยู่ในรายการทำลายอื่นที่ยังไม่จบ")
    pid = _insert(r, "doc_disposals", {"title": (p_title or "รายการทำลายเอกสาร")[:300], "status": "proposed", "proposed_by": str(r.uid),
                                      "proposed_by_name": _name(r), "proposed_at": _now(), "paper_method": p_paper_method,
                                      "files_action": p_files_action, "note": p_note})
    for i in ids:
        _insert(r, "doc_disposal_items", {"disposal_id": pid, "doc_id": i, "result": "pending"})
        _event(r, i, "dispose_propose", None, None, None, f"เสนอทำลาย (รายการ #{pid})")
    return {"id": pid}


@fn
def dms_disposal_decide(r, p_id, p_approve, p_note=None):
    _need(r, "doc.dispose.approve")
    x = _one(r, "SELECT * FROM {t:doc_disposals} WHERE id = ?", int(p_id))
    if not x or x["status"] != "proposed":
        raise C.Denied("รายการนี้ไม่ได้รออนุมัติ")
    if str(x.get("proposed_by")) == str(r.uid):
        raise C.Denied("ผู้เสนอทำลายอนุมัติรายการของตัวเองไม่ได้")
    if not p_approve and not (p_note or "").strip():
        raise C.Denied("ระบุเหตุผลที่ไม่อนุมัติ")
    _update(r, "doc_disposals", "id = ?", (x["id"],), {"status": "approved" if p_approve else "rejected", "decided_by_name": _name(r),
                                                     "decided_at": _now(), "decided_note": p_note})
    _event(r, None, "dispose_decide", None, None, p_note, f"รายการทำลาย #{x['id']} · {'อนุมัติ' if p_approve else 'ไม่อนุมัติ'}")
    return {"ok": True}


REMOVE_BLOB = None        # เทสใส่ตัวลบปลอม · ปกติ = storage.remove("doc-files", path)


@fn
def dms_disposal_execute(r, p_id, p_evidence_ref, p_paper_done=False):
    """บันทึกผลการทำลายตามจริง: ตรวจการระงับอีกครั้งรายฉบับ · ลบไฟล์ในระบบเฉพาะเมื่อเลือก “ลบไฟล์” ·
    แถวทะเบียน (เลข เรื่อง ประเภท) ยังอยู่เป็นหลักฐานว่าเคยมีและถูกทำลายเมื่อใด — ไม่ลบเลขออกจากทะเบียน"""
    _need(r, "doc.dispose.approve")
    x = _one(r, "SELECT * FROM {t:doc_disposals} WHERE id = ?", int(p_id))
    if not x or x["status"] != "approved":
        raise C.Denied("รายการนี้ยังไม่ได้รับอนุมัติ")
    if not (p_evidence_ref or "").strip():
        raise C.Denied("ระบุหลักฐานการทำลาย (เช่น เลขบันทึก/ใบรับรองการทำลาย)")
    if x["paper_method"] == "shred" and not p_paper_done:
        raise C.Denied("ยืนยันว่าทำลายต้นฉบับกระดาษแล้ว")
    remove_blob = REMOVE_BLOB
    if remove_blob is None:
        import storage
        remove_blob = lambda p: storage.remove("doc-files", p)
    me, now = _name(r), _now()
    done = 0
    for it in _q(r, "SELECT * FROM {t:doc_disposal_items} WHERE disposal_id = ?", x["id"]):
        doc = _one(r, "SELECT * FROM {t:doc_register} WHERE id = ?", it["doc_id"])
        stored = _one(r, "SELECT * FROM {t:doc_meta} WHERE doc_id = ?", it["doc_id"])
        meta = _materialize(r, doc, stored)
        if meta.get("hold"):
            _update(r, "doc_disposal_items", "id = ?", (it["id"],), {"result": "skipped", "result_note": "ระงับทำลาย — ไม่ได้ทำลาย"})
            continue
        notes = []
        if x["files_action"] == "delete":
            files = _q(r, "SELECT id, path FROM {t:doc_files} WHERE doc_id = ?", doc["id"])
            ok = 0
            for f in files:
                if remove_blob(f["path"]):
                    _exec(r, "DELETE FROM {t:doc_file_meta} WHERE file_id = ?", f["id"])
                    _exec(r, "DELETE FROM {t:doc_files} WHERE id = ?", f["id"])
                    ok += 1
            notes.append(f"ลบไฟล์ในระบบ {ok}/{len(files)} ไฟล์" + ("" if ok == len(files) else " (ที่เหลือลบไม่สำเร็จ — ยังอยู่ในระบบ)"))
            notes.append("สำเนาสำรอง/soft delete ของ Azure Storage (ถ้าเปิดไว้) ยังเก็บอยู่จนหมดรอบตามการตั้งค่าของ IT")
        else:
            notes.append("ไม่ได้ลบไฟล์ในระบบ (เลือกเก็บไฟล์ไว้)")
        notes.append({"shred": "ต้นฉบับกระดาษ: ทำลายแล้ว", "none": "ไม่มีต้นฉบับกระดาษ", "other": "ต้นฉบับกระดาษ: ดูหลักฐาน"}[x["paper_method"]])
        _set_meta(r, doc["id"], meta["ver"], {"stage": "disposed", "disposed_at": now})
        _update(r, "doc_disposal_items", "id = ?", (it["id"],), {"result": "done", "result_note": " · ".join(notes)})
        _event(r, doc["id"], "dispose", meta["stage"], "disposed", None, f"รายการ #{x['id']} · " + " · ".join(notes))
        done += 1
    _update(r, "doc_disposals", "id = ?", (x["id"],), {"status": "done", "executed_by_name": me, "executed_at": now,
                                                     "evidence_ref": p_evidence_ref[:300]})
    return {"done": done}


# ================================================================================ รายงาน / Export
@fn
def dms_export_log(r, p_count, p_filter=None):
    if not (r.has_perm("doc.export") or r.has_perm("doc.manage")):
        raise C.Denied("ไม่มีสิทธิ์ Export")
    _event(r, None, "export", None, None, None, f"Export {int(p_count or 0)} รายการ" + (f" · {str(p_filter)[:300]}" if p_filter else ""))
    return {"ok": True}


@fn
def dms_audit(r, p_limit=200):
    """ประวัติระดับระบบ (ตั้งค่า นโยบาย Export ทำลาย) — ผู้ดูแลสารบรรณ/อายุเก็บ อ่านได้ ไม่มีใครแก้ได้"""
    if not (r.has_perm("doc.manage") or r.has_perm("doc.retention") or r.has_perm("doc.dispose.approve")):
        raise C.Denied("ไม่มีสิทธิ์")
    return _q(r, "SELECT id, at, actor_name, action, reason, detail FROM {t:doc_events} WHERE doc_id IS NULL ORDER BY id DESC")[: int(p_limit or 200)]


# ================================================================================ บันทึกการแก้รายละเอียดทะเบียน (hook จาก rest.update_row)
REG_LABEL = {"type_id": "ประเภท", "issued_date": "วันที่", "subject": "เรื่อง", "emp_code": "รหัสพนักงาน", "person_name": "ผู้เกี่ยวข้อง",
             "ref_doc_no": "อ้างอิง", "note": "หมายเหตุ", "form_code": "รหัสแบบฟอร์ม", "confidential": "ชั้นความลับ", "sender": "ผู้ส่ง",
             "received_date": "วันที่ได้รับ", "status": "สถานะเลข"}


def log_register_edit(cur, ctx, old, new):
    try:
        ensure(cur)
        changed = [REG_LABEL[k] for k in REG_LABEL if str(old.get(k) if old.get(k) is not None else "") != str(new.get(k) if new.get(k) is not None else "")]
        if not changed:
            return
        name = None
        if ctx.uid:
            row = _x(cur, f"SELECT name, email FROM {_tbl(cur, 'user_roles')} WHERE user_id = ?", str(ctx.uid)).fetchone()
            name = row and (row[0] or row[1])
        act = "void" if new.get("status") == "void" and old.get("status") != "void" else "edit"
        _x(cur, f"INSERT INTO {_tbl(cur, 'doc_events')} (doc_id, at, actor_id, actor_name, action, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
           new["id"], _now(), str(ctx.uid) if ctx.uid else None, name or "ระบบ", act,
           (new.get("void_reason") if act == "void" else None), "แก้ทะเบียน: " + ", ".join(changed))
    except Exception:
        pass                                   # ประวัติต้องไม่ทำให้การบันทึกหลักล้ม


def block_locked_delete(cur, ctx, old):
    import hooks
    if file_locked(cur, file_id=old.get("id")):
        raise hooks.HookError("ไฟล์ฉบับจริงถูกล็อก ลบไม่ได้ — ถ้าผิดให้ใช้ “แทนที่ฉบับจริง”")


def hidden_filter(ctx, col):
    """เงื่อนไข SQL ซ่อนเอกสารหมวดลับที่ผู้ใช้ไม่มีสิทธิ์ (rest.rule_filter) · col = คอลัมน์ id เอกสาร"""
    hide = C.hidden_cats(ctx.has_perm)
    if not hide:
        return ""
    try:
        ensure(ctx.cur)
    except Exception:
        return ""                    # ตารางยังสร้างไม่ได้ = ยังไม่มีเรื่องที่ตั้งหมวดไว้ — ห้ามทำให้การอ่านทะเบียนล้ม
    cats = ", ".join(f"N'{c}'" for c in hide)
    return f"NOT EXISTS (SELECT 1 FROM dbo.doc_meta dm_ WHERE dm_.doc_id = {col} AND dm_.sensitivity IN ({cats}))"


# ================================================================================ สัญญาจ้างงาน → เลขในทะเบียน (user 2026-11-03)
def contract_register(r, c):
    """ออกเลข HR ให้สัญญาเมื่อส่งลงนามครั้งแรก (ส่งใหม่หลังถูกส่งกลับใช้เลขเดิม) · ไม่พิมพ์เลขบนตัวสัญญา (แบบฟอร์มเดิมไม่มีช่องเลข)"""
    ensure(r.cur)
    have = _one(r, "SELECT doc_id FROM {t:doc_source_links} WHERE kind = 'contract' AND source_id = ?", c["id"])
    if have:
        return have["doc_id"]
    import rpc
    t = _one(r, "SELECT id FROM {t:doc_types} WHERE series_code = 'HR' AND label = ?", C.CONTRACT_TYPE)
    who = " ".join(x for x in (c.get("title_th"), c.get("name_th")) if x) or c.get("name_en") or None
    day = str(c.get("contract_date") or "")[:10] or C.today_bkk().isoformat()
    d = rpc._doc_issue(r, "HR", 1, t["id"] if t else None, f"สัญญาจ้างงาน · {c.get('position_th') or c.get('position_en') or ''}".strip(" ·"),
                       day, None, f"สัญญาจ้าง #{c['id']}", [{"emp_code": c.get("emp_code"), "person_name": who}])[0]
    if not d.get("confidential"):
        _update(r, "doc_register", "id = ?", (d["id"],), {"confidential": 1})
    _insert(r, "doc_source_links", {"doc_id": d["id"], "kind": "contract", "source_id": c["id"], "created_at": _now()})
    _event(r, d["id"], "register_contract", None, None, None, f"ออกเลขให้สัญญาจ้าง #{c['id']}")
    return d["id"]


@fn
def dms_contract_backfill(r):
    """สัญญาที่ส่งลงนาม/ลงนามก่อนมีระบบนี้ → ออกเลขให้ครั้งเดียว (HR กดเอง) · เรียงตามวันที่สัญญา"""
    if not (r.has_perm("data.docregister.write") and r.has_perm("data.doc.confidential")):
        raise C.Denied("ต้องมีสิทธิ์ออกเลขและดูเอกสารลับ")
    rows = _q(r, """SELECT * FROM {t:emp_contracts} c WHERE c.status IN ('pending', 'signed')
                    AND NOT EXISTS (SELECT 1 FROM {t:doc_source_links} l WHERE l.kind = 'contract' AND l.source_id = c.id)
                    ORDER BY c.contract_date, c.id""")
    out = [contract_register(r, c) for c in rows]
    return {"count": len(out)}


@fn
def dms_contract_pending(r):
    if not r.has_perm("page.docregister"):
        raise C.Denied("ไม่มีสิทธิ์")
    try:
        n = _one(r, """SELECT COUNT(*) AS n FROM {t:emp_contracts} c WHERE c.status IN ('pending', 'signed')
                       AND NOT EXISTS (SELECT 1 FROM {t:doc_source_links} l WHERE l.kind = 'contract' AND l.source_id = c.id)""")
    except Exception:
        return {"count": 0}
    return {"count": (n or {}).get("n", 0)}


def contract_cancelled(cur, ctx, old, new):
    """ยกเลิกสัญญา → ยกเลิกเลขในทะเบียนด้วย (เลขไม่ถูกนำกลับมาใช้) — hook AFTER_UPDATE emp_contracts"""
    if new.get("status") != "cancelled" or old.get("status") == "cancelled":
        return
    try:
        ensure(cur)
        row = _x(cur, f"SELECT doc_id FROM {_tbl(cur, 'doc_source_links')} WHERE kind = 'contract' AND source_id = ?", new["id"]).fetchone()
        if not row:
            return
        _x(cur, f"UPDATE {_tbl(cur, 'doc_register')} SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ? WHERE id = ? AND status <> 'void'",
           "ยกเลิกสัญญาจ้าง", _now(), str(ctx.uid) if ctx.uid else None, row[0])
        _x(cur, f"INSERT INTO {_tbl(cur, 'doc_events')} (doc_id, at, actor_id, actor_name, action, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
           row[0], _now(), str(ctx.uid) if ctx.uid else None, "ระบบ", "void", "ยกเลิกสัญญาจ้าง", f"สัญญาจ้าง #{new['id']} ถูกยกเลิก")
    except Exception:
        pass


# ================================================================================ ใบลาออกจาก Staff Movement → ทะเบียนรับ (user 2026-11-03)
COPY_BLOB = None       # เทสใส่ตัวคัดลอกปลอม · ปกติ = storage.get("movement-docs") → storage.put("doc-files")
RESIGN_TYPE = "ใบลาออก"


def _copy_blob(src_path, dst_path):
    if COPY_BLOB:
        return COPY_BLOB(src_path, dst_path)
    import storage
    data, ctype = storage.get("movement-docs", src_path)
    storage.put("doc-files", dst_path, data, ctype, False)
    return len(data), ctype


def _ascii(name):
    import re
    m = re.match(r"^(.*?)(\.[A-Za-z0-9]{1,8})?$", name or "file")
    base = re.sub(r"_+", "_", re.sub(r"[^\w.-]+", "_", (m.group(1) or "file").encode("ascii", "ignore").decode())).strip("_")[:60] or "file"
    return base + (m.group(2) or "").lower()


def register_resignation(r, mv):
    """Movement ลาออกที่แนบไฟล์ → ลงรับในทะเบียน (ชุด IN ประเภทใบลาออก) + คัดลอกไฟล์มา · ทำครั้งเดียวต่อรายการ
    เปลี่ยนไฟล์ใน Movement ภายหลัง → เพิ่มไฟล์ใหม่ในเรื่องเดิม ไม่ออกเลขใหม่"""
    path = mv.get("attachment_path")
    if mv.get("type") != "Resignation" or not path:
        return None
    link = _one(r, "SELECT doc_id, path FROM {t:doc_mov_links} WHERE movement_id = ?", str(mv["id"]))
    me = _name(r)
    if link and link["path"] == path:
        return link["doc_id"]
    if link:
        doc_id = link["doc_id"]
    else:
        import rpc
        t = _one(r, "SELECT id FROM {t:doc_types} WHERE series_code = 'IN' AND label = ?", RESIGN_TYPE)
        got = str(mv.get("created_at") or "")[:10] or C.today_bkk().isoformat()
        d = rpc._doc_issue(r, "IN", 1, t["id"] if t else None, f"ใบลาออก · {mv.get('name') or mv.get('emp_code') or ''}".strip(" ·"),
                           got, None, f"ลงรับจาก Staff Movement · มีผล {mv.get('date') or '—'}",
                           [{"emp_code": mv.get("emp_code"), "person_name": mv.get("name")}])[0]
        doc_id = d["id"]
        _update(r, "doc_register", "id = ?", (doc_id,), {"sender": (mv.get("name") or "")[:300] or None, "received_date": got})
        _insert(r, "doc_mov_links", {"doc_id": doc_id, "movement_id": str(mv["id"]), "path": path, "created_at": _now()})
        doc = _one(r, "SELECT * FROM {t:doc_register} WHERE id = ?", doc_id)
        meta = _materialize(r, doc, None)
        _set_meta(r, doc_id, meta["ver"], {"stage": "closed", "closed_at": _now(), "owner_id": str(r.uid) if r.uid else None,
                                          "owner_name": me, "sensitivity": "personal"})
        _event(r, doc_id, "from_movement", "registered", "closed", None, "ลงรับจาก Staff Movement (ดำเนินการลาออกแล้วในทะเบียนพนักงาน)")
    name = mv.get("attachment_name") or path.rsplit("/", 1)[-1]
    dst = f"{doc_id}/{int(datetime.now().timestamp() * 1000)}-{_ascii(name)}"
    size, ctype = _copy_blob(path, dst)
    fid = _insert(r, "doc_files", {"doc_id": doc_id, "name": name[:300], "path": dst, "size": size, "mime": ctype,
                                   "uploaded_by": str(r.uid) if r.uid else None, "uploaded_name": me, "uploaded_at": _now()})
    _file_meta(r, doc_id, fid, {"kind": "received", "set_by_name": me, "set_at": _now()})
    if link:
        _update(r, "doc_mov_links", "doc_id = ?", (doc_id,), {"path": path})
        _event(r, doc_id, "file_kind", None, None, None, f"ไฟล์ใหม่จาก Staff Movement: {name}")
    return doc_id


@fn
def dms_from_movement(r, p_path):
    if not (r.has_perm("data.movement.create") or r.has_perm("data.docregister.write")):
        raise C.Denied("ไม่มีสิทธิ์")
    mv = _one(r, "SELECT * FROM {t:movements} WHERE attachment_path = ?", p_path)
    if not mv:
        raise C.Denied("ไม่พบรายการ Movement")
    d = register_resignation(r, mv)
    if not d:
        return None
    x = _one(r, "SELECT doc_no FROM {t:doc_register} WHERE id = ?", d)
    return {"doc_id": d, "doc_no": x and x["doc_no"]}


def _mov_pending(r):
    return _q(r, """SELECT * FROM {t:movements} m WHERE m.type = 'Resignation' AND m.attachment_path IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM {t:doc_mov_links} l WHERE l.movement_id = m.id) ORDER BY m.created_at""")


@fn
def dms_movement_pending(r):
    if not r.has_perm("page.docregister"):
        raise C.Denied("ไม่มีสิทธิ์")
    try:
        return {"count": len(_mov_pending(r))}
    except Exception:
        return {"count": 0}


@fn
def dms_movement_backfill(r):
    if not r.has_perm("data.docregister.write"):
        raise C.Denied("ไม่มีสิทธิ์ออกเลข")
    n = 0
    for mv in _mov_pending(r):
        if register_resignation(r, mv):
            n += 1
    return {"count": n}
