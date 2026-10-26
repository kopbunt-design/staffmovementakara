"""
The Supabase database functions the site calls with supabase.rpc(...), ported to Python.

Every function here ran as SECURITY DEFINER in Supabase, so it runs with row security bypassed and checks
permissions itself (has_perm / user_has_perm) exactly as the original did. Writes go through rest.insert_row /
rest.update_row so the ported triggers (hooks.py) still fire; the "flow" flags the originals set with set_config
are set on ctx.flags.

Functions in PUBLIC run without a Microsoft login (approval links in e-mails, the employee fund form) —
they are protected by their single-use token, like before.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone

import db
import hooks
import rest
from hooks import HookError as E

FUNCS = {}
PUBLIC = {"ec_link_get", "ec_link_decide", "exp_link_get", "exp_link_decide", "paf_link_get", "paf_link_decide",
          "pr_link_get", "pr_link_decide", "fund_form_lookup", "fund_form_submit"}


def fn(f):
    FUNCS[f.__name__] = f
    return f


def now():
    return datetime.now(timezone.utc).isoformat()


def today():
    return datetime.now(timezone.utc).date().isoformat()   # Supabase current_date = UTC


class R:
    """What a ported function needs: cursor, caller, permission checks, row helpers that keep the triggers."""
    def __init__(self, cn, uid):
        self.cn, self.uid = cn, uid
        self.cur = cn.cursor()
        self.ctx = rest.Ctx(self.cur, uid, bypass=True)

    def rows(self, table, sql, *a):
        return [db.decode_row(table, r) for r in db.rows(self.cur.execute(sql, *a))] if table else db.rows(self.cur.execute(sql, *a))

    def row(self, table, where, *a, lock=False):
        hint = " WITH (UPDLOCK, ROWLOCK)" if lock else ""
        r = self.rows(table, f"SELECT TOP 1 * FROM dbo.[{table}]{hint} WHERE {where}", *a)
        return r[0] if r else None

    def val(self, sql, *a):
        r = self.cur.execute(sql, *a).fetchone()
        return r[0] if r else None

    def has_perm(self, p):
        return self.ctx.has_perm(p)

    def user_has_perm(self, uid, p):
        if not uid:
            return False
        return bool(self.val("""SELECT COUNT(*) FROM dbo.user_roles ur WHERE ur.user_id = ? AND (ur.[role] = N'admin'
                                OR EXISTS (SELECT 1 FROM dbo.role_permissions rp WHERE rp.role_key = ur.[role] AND rp.perm_key = ?))""", uid, p))

    def flag(self, name):
        self.ctx.flags.add(name)

    def upd(self, table, old, values):
        return rest.update_row(self.cur, self.ctx, table, old, values)

    def ins(self, table, row):
        return rest.insert_row(self.cur, self.ctx, table, row)

    def lock(self, name):
        self.cur.execute("EXEC sp_getapplock @Resource = ?, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000", name)

    def signer(self, uid):
        return self.row("letter_signers", "user_id = ?", uid) if uid else None

    def email_of(self, uid):
        return self.val("SELECT TOP 1 email FROM dbo.user_roles WHERE user_id = ?", uid) if uid else None

    def notify(self, title, detail, created_by, link):
        self.ins("notifications", {"title": title, "detail": detail, "category": "default", "created_by": created_by, "link": link})


def nz(s):
    """nullif(trim(s), '')"""
    s = (s or "").strip() if isinstance(s, str) or s is None else s
    return s or None


def sig_name(g, en_first=False):
    a, b = ("name_en", "name_th") if en_first else ("name_th", "name_en")
    return (g.get(a) or None) or g.get(b)


def sig_title(g, en_first=False):
    a, b = ("title_en", "title_th") if en_first else ("title_th", "title_en")
    return (g.get(a) or None) or g.get(b)


def call(cn, uid, name, args):
    f = FUNCS.get(name)
    if not f:
        raise rest.ApiError(f"function {name} is not available on Azure yet", "PGRST202")
    r = R(cn, uid)
    out = f(r, **(args or {}))
    cn.commit()
    return out


def without(d, *keys):
    return {k: v for k, v in (d or {}).items() if k not in keys} if d is not None else None


# ================================================================================ who / lists

@fn
def my_permissions(r):
    if r.ctx.role == "admin":
        return [x["key"] for x in r.rows(None, "SELECT [key] FROM dbo.permissions")]
    return [x["perm_key"] for x in r.rows(None, """SELECT DISTINCT rp.perm_key FROM dbo.user_roles ur
              JOIN dbo.role_permissions rp ON rp.role_key = ur.[role] WHERE ur.user_id = ?""", r.uid)]


def _signers(r, where_perm, extra=None, en_first=False):
    out = []
    for g in r.rows("letter_signers", "SELECT * FROM dbo.letter_signers WHERE signature_path IS NOT NULL"):
        if not where_perm(g):
            continue
        o = {"user_id": g["user_id"], "name": sig_name(g, en_first), "title": sig_title(g, en_first), "email": g.get("email")}
        if extra:
            o.update(extra(g))
        out.append(o)
    return sorted(out, key=lambda x: (x["name"] or ""))


@fn
def ct_signers(r):
    if not (r.has_perm("page.contractpay") or r.has_perm("data.contract.approve")):
        return []
    return _signers(r, lambda g: r.user_has_perm(g["user_id"], "data.contract.approve"))


@fn
def ec_signers(r):
    if not (r.has_perm("data.empcontract.write") or r.has_perm("data.empcontract.sign")):
        return []
    return _signers(r, lambda g: r.user_has_perm(g["user_id"], "data.empcontract.sign") or r.user_has_perm(g["user_id"], "data.empcontract.write"),
                    lambda g: {"can_sign": r.user_has_perm(g["user_id"], "data.empcontract.sign")})


@fn
def exp_signers(r):
    if not r.has_perm("page.expense"):
        return []
    return _signers(r, lambda g: r.user_has_perm(g["user_id"], "data.expense.review") or r.user_has_perm(g["user_id"], "data.expense.approve"),
                    lambda g: {"can_review": r.user_has_perm(g["user_id"], "data.expense.review"),
                               "can_approve": r.user_has_perm(g["user_id"], "data.expense.approve")})


@fn
def pr_signers(r):
    if not r.has_perm("data.payroll.read"):
        return []
    out = _signers(r, lambda g: True, en_first=True)
    for o in out:
        o["email"] = o["email"] or r.email_of(o["user_id"])
    return out


@fn
def fund_approvers(r):
    if not r.has_perm("page.fundforms"):
        return []
    rows = r.rows(None, """SELECT g.user_id, g.name_th, g.title_th, g.email FROM dbo.fund_committee c
                            JOIN dbo.letter_signers g ON g.user_id = c.user_id WHERE g.signature_path IS NOT NULL
                            ORDER BY c.sort_order, g.name_th""")
    return [x for x in rows if r.user_has_perm(x["user_id"], "data.fundforms.approve")]


@fn
def fund_committee_status(r):
    if not r.has_perm("page.fundforms"):
        return []
    rows = r.rows(None, """SELECT c.user_id, ur.name, ur.email, ur.[role], CAST(CASE WHEN g.signature_path IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS has_signature,
                                  g.name_th AS signer_name, g.title_th AS signer_title, g.email AS signer_email, c.sort_order
                             FROM dbo.fund_committee c LEFT JOIN dbo.user_roles ur ON ur.user_id = c.user_id
                             LEFT JOIN dbo.letter_signers g ON g.user_id = c.user_id ORDER BY c.sort_order, ur.name""")
    for x in rows:
        x["has_signature"] = bool(x["has_signature"])
        x["has_page"] = r.user_has_perm(x["user_id"], "page.fundforms")
        x["has_approve"] = r.user_has_perm(x["user_id"], "data.fundforms.approve")
    return rows


# ================================================================================ document register

def doc_visible(r, confidential):
    return r.has_perm("page.docregister") and (not confidential or r.has_perm("data.doc.confidential"))


@fn
def doc_sources(r):
    out = []
    for kind, table in (("letter", "hr_letters"), ("paf", "paf_forms")):
        rows = r.rows(None, f"""SELECT x.doc_id, x.id AS source_id, x.status, x.approved_at AS decided_at, d.confidential FROM (
                                  SELECT l.doc_id, l.id, l.status, l.approved_at, ROW_NUMBER() OVER (PARTITION BY l.doc_id
                                    ORDER BY CASE WHEN l.status = N'cancelled' THEN 1 ELSE 0 END, l.id DESC) AS rn
                                  FROM dbo.{table} l WHERE l.doc_id IS NOT NULL) x JOIN dbo.doc_register d ON d.id = x.doc_id WHERE x.rn = 1""")
        out += [{"doc_id": x["doc_id"], "kind": kind, "source_id": x["source_id"], "status": x["status"], "decided_at": x["decided_at"]}
                for x in rows if doc_visible(r, x["confidential"])]
    return out


def _doc_issue(r, p_series, p_count, p_type_id, p_subject, p_issued_date, p_ref, p_note, p_people):
    import uuid
    issued = p_issued_date or today()
    y = int(str(issued)[:4])
    if not p_count or p_count < 1 or p_count > 500:
        raise E("จำนวนต้องอยู่ระหว่าง 1–500")
    pre = r.val("SELECT prefix FROM dbo.doc_series WHERE code = ? AND is_active = 1", p_series)
    if pre is None:
        raise E(f"ไม่พบชุดเลข {p_series}")
    tl = r.val("SELECT label FROM dbo.doc_types WHERE id = ?", p_type_id) if p_type_id else None
    r.lock(f"doc_issue:{p_series}:{y}")   # คนที่กดพร้อมกันรอคิวแล้วได้เลขถัดไป
    start = (r.val("SELECT MAX(seq) FROM dbo.doc_register WHERE series_code = ? AND year = ?", p_series, y) or 0) + 1
    batch = str(uuid.uuid4()) if p_count > 1 else None
    out = []
    for i in range(p_count):
        p = p_people[i] if isinstance(p_people, list) and i < len(p_people) else {}
        out.append(r.ins("doc_register", {
            "series_code": p_series, "year": y, "seq": start + i, "doc_no": f"{pre}-{start + i:03d}-{y}",
            "type_id": p_type_id, "type_label": tl, "subject": nz(p_subject),
            "emp_code": nz((p or {}).get("emp_code")), "person_name": nz((p or {}).get("person_name")),
            "issued_date": issued, "ref_doc_no": nz(p_ref), "note": nz(p_note), "batch_id": batch, "created_by": r.uid}))
    return out


@fn
def doc_issue(r, p_series, p_count, p_type_id=None, p_subject=None, p_issued_date=None, p_ref=None, p_note=None, p_people=None):
    if not r.has_perm("data.docregister.write"):
        raise E("ไม่มีสิทธิ์ออกเลขเอกสาร")
    return _doc_issue(r, p_series, p_count, p_type_id, p_subject, p_issued_date, p_ref, p_note, p_people)


@fn
def doc_import(r, p_rows):
    if not r.has_perm("data.docregister.write"):
        raise E("ไม่มีสิทธิ์นำเข้า")
    n = 0
    for x in p_rows or []:
        pre = r.val("SELECT prefix FROM dbo.doc_series WHERE code = ?", x.get("series_code"))
        if pre is None:
            continue
        y, seq = int(x["year"]), int(x["seq"])
        doc_no = f"{pre}-{str(x['seq']).zfill(3)}-{x['year']}"
        if r.val("SELECT COUNT(*) FROM dbo.doc_register WHERE doc_no = ? OR (series_code = ? AND year = ? AND seq = ?)",
                 doc_no, x["series_code"], y, seq):
            continue   # on conflict do nothing
        r.ins("doc_register", {
            "series_code": x["series_code"], "year": y, "seq": seq, "doc_no": doc_no,
            "type_id": r.val("SELECT id FROM dbo.doc_types WHERE series_code = ? AND label = ?", x["series_code"], x.get("type_label")),
            "type_label": x.get("type_label"), "subject": nz(x.get("subject")), "person_name": nz(x.get("person_name")),
            "issued_date": nz(x.get("issued_date")), "ref_doc_no": nz(x.get("ref_doc_no")), "note": nz(x.get("note")),
            "imported": True, "created_by": r.uid})
        n += 1
    return n


def _my_name(r):
    g = r.signer(r.uid) or {}
    return (g.get("name_th") or None) or r.val("SELECT TOP 1 NULLIF(name, N'') FROM dbo.user_roles WHERE user_id = ?", r.uid) or r.email_of(r.uid)


@fn
def doc_log(r, p_doc_id, p_file_id=None, p_file_name=None, p_action=None):
    d = r.row("doc_register", "id = ?", p_doc_id)
    if not d or not doc_visible(r, d.get("confidential")):
        raise E("ไม่มีสิทธิ์")
    r.ins("doc_access_log", {"doc_id": p_doc_id, "file_id": p_file_id, "file_name": p_file_name, "action": p_action,
                             "user_id": r.uid, "user_name": _my_name(r)})
    return None


# ================================================================================ HR letters

@fn
def letter_submit(r, p_id, p_approver, p_type_label=None):
    if not r.has_perm("data.letters.write"):
        raise E("ไม่มีสิทธิ์ออกหนังสือ")
    if not p_approver or not r.val("SELECT COUNT(*) FROM dbo.letter_signers WHERE user_id = ? AND signature_path IS NOT NULL", p_approver):
        raise E("เลือกผู้อนุมัติที่ตั้งลายเซ็นไว้แล้ว")
    l = r.row("hr_letters", "id = ?", p_id, lock=True)
    if not l:
        raise E("ไม่พบหนังสือ")
    if l["status"] not in ("draft", "rejected"):
        raise E("หนังสือนี้ส่งไปแล้ว")
    doc_id, doc_no = l.get("doc_id"), l.get("doc_no")
    if doc_id is None:
        tid = r.val("SELECT id FROM dbo.doc_types WHERE series_code = N'HR' AND label = ?", p_type_label)
        d = _doc_issue(r, "HR", 1, tid, None, today(), None, "ออกจากระบบออกหนังสือ",
                       [{"emp_code": l.get("emp_code"), "person_name": l.get("person_name")}])[0]
        doc_id, doc_no = d["id"], d["doc_no"]
    return r.upd("hr_letters", l, {"status": "pending", "doc_id": doc_id, "doc_no": doc_no, "approver_id": p_approver,
                                   "requested_by": r.uid, "requested_at": now(), "reject_reason": None})


@fn
def letter_approve(r, p_id):
    if not r.has_perm("data.letters.approve"):
        raise E("ไม่มีสิทธิ์อนุมัติหนังสือ")
    l = r.row("hr_letters", "id = ?", p_id, lock=True)
    if not l or l["status"] != "pending":
        raise E("หนังสือนี้ไม่ได้อยู่ในสถานะรออนุมัติ")
    if str(l.get("approver_id")) != str(r.uid):
        raise E("หนังสือนี้ส่งถึงผู้อนุมัติคนอื่น — อนุมัติได้เฉพาะคนที่ถูกเลือก")
    s = r.signer(r.uid) or {}
    if not s.get("signature_path"):
        raise E("ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ “ลายเซ็นของฉัน” ก่อน")
    st = r.row("letter_settings", "id = 1") or {}
    r.flag("hr_letters.approving")
    return r.upd("hr_letters", l, {"status": "approved", "approved_by": r.uid, "approved_at": now(),
                                   "signer": {"name_th": s.get("name_th"), "title_th": s.get("title_th"), "name_en": s.get("name_en"),
                                              "title_en": s.get("title_en"), "signature_path": s.get("signature_path"),
                                              "seal_path": st.get("seal_path")}})


@fn
def letter_reject(r, p_id, p_reason=None):
    if not r.has_perm("data.letters.approve"):
        raise E("ไม่มีสิทธิ์อนุมัติหนังสือ")
    l = r.row("hr_letters", "id = ?", p_id, lock=True)
    if not l or l["status"] != "pending":
        raise E("หนังสือนี้ไม่ได้อยู่ในสถานะรออนุมัติ")
    if str(l.get("approver_id")) != str(r.uid):
        raise E("หนังสือนี้ส่งถึงผู้อนุมัติคนอื่น — ส่งกลับได้เฉพาะคนที่ถูกเลือก")
    r.flag("hr_letters.approving")
    return r.upd("hr_letters", l, {"status": "rejected", "reject_reason": nz(p_reason)})


@fn
def letter_cancel(r, p_id, p_reason=None, p_void_number=False):
    if not r.has_perm("data.letters.write"):
        raise E("ไม่มีสิทธิ์ยกเลิกหนังสือ")
    l = r.row("hr_letters", "id = ?", p_id, lock=True)
    if not l:
        raise E("ไม่พบหนังสือ")
    if l["status"] == "cancelled":
        raise E("หนังสือนี้ยกเลิกไปแล้ว")
    l = r.upd("hr_letters", l, {"status": "cancelled", "cancel_reason": nz(p_reason), "cancelled_at": now(), "cancelled_by": r.uid})
    if p_void_number and l.get("doc_id") is not None:
        d = r.row("doc_register", "id = ? AND status <> N'void'", l["doc_id"], lock=True)
        if d:
            r.upd("doc_register", d, {"status": "void", "voided_at": now(), "voided_by": r.uid,
                                      "void_reason": "ยกเลิกหนังสือ" + (": " + nz(p_reason) if nz(p_reason) else "")})
    return l


@fn
def letter_from_doc(r, p_doc_id, p_kind):
    if not r.has_perm("data.letters.write"):
        raise E("ไม่มีสิทธิ์ออกหนังสือ")
    l = r.row("hr_letters", "doc_id = ? AND status <> N'cancelled'", p_doc_id)
    if l:
        return l
    d = r.row("doc_register", "id = ?", p_doc_id)
    if not d or d["status"] != "active":
        raise E("เลขที่นี้ใช้ไม่ได้ (ไม่พบ หรือถูกยกเลิกแล้ว)")
    r.flag("hr_letters.fromdoc")
    return r.ins("hr_letters", {"kind": p_kind, "emp_code": d.get("emp_code"), "person_name": d.get("person_name"),
                                "doc_id": d["id"], "doc_no": d["doc_no"], "created_by": r.uid})


@fn
def mail_set_secret(r, p_secret=None):
    # Azure sends mail with the Graph secret in Key Vault — nothing is stored in the database any more
    raise E("บน Azure ใช้รหัสส่งอีเมลจาก Key Vault — ไม่ต้องตั้งค่าที่นี่")


# ================================================================================ Invoice Hub

def exp_sig(r, uid):
    g = r.signer(uid)
    if not g or not g.get("signature_path"):
        return None
    return {"name": (g.get("name_en") or None) or g.get("name_th"), "name_th": g.get("name_th"),
            "title": (g.get("title_en") or None) or g.get("title_th"), "signature_path": g["signature_path"], "at": now()}


@fn
def exp_submit(r, p_id, p_reviewer, p_approver):
    if not r.has_perm("data.expense.write"):
        raise E("ไม่มีสิทธิ์ออกใบแจ้งหนี้")
    v = r.row("exp_invoices", "id = ?", p_id, lock=True)
    if not v:
        raise E("ไม่พบใบแจ้งหนี้")
    if v["status"] not in ("draft", "rejected"):
        raise E("ใบนี้ส่งตรวจแล้ว")
    if v.get("vendor_id") is None:
        raise E("เลือกผู้ขายก่อน")
    if not r.val("SELECT COUNT(*) FROM dbo.exp_invoice_lines WHERE invoice_id = ?", p_id):
        raise E("ยังไม่มีรายการ")
    if not p_reviewer or not r.user_has_perm(p_reviewer, "data.expense.review"):
        raise E("ผู้ตรวจที่เลือกไม่มีสิทธิ์ตรวจ")
    if not p_approver or not r.user_has_perm(p_approver, "data.expense.approve"):
        raise E("ผู้อนุมัติที่เลือกไม่มีสิทธิ์อนุมัติ")
    if exp_sig(r, p_reviewer) is None or exp_sig(r, p_approver) is None:
        raise E("ผู้ตรวจ/ผู้อนุมัติยังไม่ได้ตั้งลายเซ็น")
    s = exp_sig(r, r.uid)
    if s is None:
        raise E("ท่านยังไม่ได้ตั้งลายเซ็น (ใช้ลงช่องผู้จัดทำ)")
    r.flag("exp.flow")
    if v.get("inv_no") is None:
        y = int(str(v["inv_date"])[:4])
        r.lock(f"exp_inv_no:{y}")
        n = (r.val("SELECT MAX(inv_seq) FROM dbo.exp_invoices WHERE inv_year = ?", y) or 0) + 1
        v = r.upd("exp_invoices", v, {"inv_year": y, "inv_seq": n, "inv_no": f"HRIN{n:03d}/{y}"})
    return r.upd("exp_invoices", v, {"status": "review", "reviewer_id": p_reviewer, "approver_id": p_approver, "preparer": s,
                                     "reviewer": None, "approver": None, "prepared_by": r.uid, "submitted_at": now(), "reject_reason": None})


@fn
def exp_decide(r, p_id, p_ok, p_reason=None):
    v = r.row("exp_invoices", "id = ?", p_id, lock=True)
    if not v:
        raise E("ไม่พบใบแจ้งหนี้")
    r.flag("exp.flow")
    if v["status"] == "review":
        if str(v.get("reviewer_id")) != str(r.uid) or not r.has_perm("data.expense.review"):
            raise E("ใบนี้รอผู้ตรวจท่านอื่น")
        if p_ok:
            s = exp_sig(r, r.uid)
            if s is None:
                raise E("ท่านยังไม่ได้ตั้งลายเซ็น")
            return r.upd("exp_invoices", v, {"status": "approval", "reviewer": s, "reviewed_by": r.uid, "reviewed_at": now()})
        return r.upd("exp_invoices", v, {"status": "rejected", "reject_reason": nz(p_reason)})
    if v["status"] == "approval":
        if str(v.get("approver_id")) != str(r.uid) or not r.has_perm("data.expense.approve"):
            raise E("ใบนี้รอผู้อนุมัติท่านอื่น")
        if p_ok:
            s = exp_sig(r, r.uid)
            if s is None:
                raise E("ท่านยังไม่ได้ตั้งลายเซ็น")
            return r.upd("exp_invoices", v, {"status": "approved", "approver": s, "approved_by": r.uid, "approved_at": now()})
        return r.upd("exp_invoices", v, {"status": "rejected", "reject_reason": nz(p_reason), "reviewer": None})
    raise E("ใบนี้ไม่ได้รอตรวจ/อนุมัติ")


@fn
def exp_action(r, p_id, p_action, p_text=None, p_date=None):
    if not r.has_perm("data.expense.write"):
        raise E("ไม่มีสิทธิ์จัดการใบแจ้งหนี้")
    v = r.row("exp_invoices", "id = ?", p_id, lock=True)
    if not v:
        raise E("ไม่พบใบแจ้งหนี้")
    r.flag("exp.flow")
    if p_action == "recall":
        if v["status"] not in ("review", "approval"):
            raise E("ดึงกลับได้เฉพาะใบที่รอตรวจ/รออนุมัติ")
        return r.upd("exp_invoices", v, {"status": "draft", "reviewer": None, "approver": None})
    if p_action == "receive":
        if v["status"] != "approved":
            raise E("ส่งบัญชีได้เมื่ออนุมัติแล้ว")
        return r.upd("exp_invoices", v, {"status": "received", "received_name": nz(p_text), "received_at": p_date or today()})
    if p_action == "cancel":
        if v["status"] == "cancelled":
            raise E("ยกเลิกไปแล้ว")
        return r.upd("exp_invoices", v, {"status": "cancelled", "reject_reason": nz(p_text)})
    raise E("action ไม่ถูกต้อง")


@fn
def exp_approve_link(r, p_id):
    return r.val("""SELECT t.token FROM dbo.exp_approve_tokens t JOIN dbo.exp_invoices v ON v.id = t.invoice_id
                     WHERE v.id = ? AND v.status = N'approval' AND t.used_at IS NULL AND t.expires_at > SYSDATETIMEOFFSET()
                       AND (v.reviewed_by = ? OR v.approver_id = ?)""", p_id, r.uid, r.uid)


@fn
def exp_import(r, p_rows):
    if not r.has_perm("data.expense.write"):
        raise E("ไม่มีสิทธิ์นำเข้า")
    r.flag("exp.flow")
    n = 0
    for x in p_rows or []:
        if r.val("SELECT COUNT(*) FROM dbo.exp_invoices WHERE inv_no = ?", x.get("inv_no")):
            continue
        vend = r.row("exp_vendors", "code = ?", x.get("vendor_code"))
        no = x["inv_no"]
        seq = re.sub(r"\D", "", no.split("/")[0])
        inv = r.ins("exp_invoices", {
            "inv_no": no, "inv_year": int(no.split("/")[1]), "inv_seq": int(seq) if seq else None, "inv_date": x["inv_date"],
            "vendor_id": vend["id"] if vend else None,
            "vendor": ({"code": vend["code"], "name": vend.get("name"), "address": vend.get("address"), "bank": vend.get("bank"),
                        "tax_id": vend.get("tax_id")} if vend else {"code": x.get("vendor_code")}),
            "category": x.get("category"), "wht_rate": x.get("wht_rate") or 0, "status": "received", "imported": True,
            "received_at": x["inv_date"], "created_by": r.uid})
        a = va = w = 0
        for i, l in enumerate(x.get("lines") or [], 1):
            am, vt, wh = float(l.get("amount") or 0), float(l.get("vat") or 0), float(l.get("wht") or 0)
            r.ins("exp_invoice_lines", {"invoice_id": inv["id"], "line_no": i, "cost_code": nz(l.get("cost_code")),
                                        "detail": l.get("detail") or "", "detail2": nz(l.get("detail2")), "amount": am,
                                        "vat_rate": 7 if vt > 0 else 0, "vat": vt, "wht": wh, "net": am + vt - wh})
            a, va, w = a + am, va + vt, w + wh
        r.upd("exp_invoices", inv, {"amount": a, "vat": va, "wht": w, "net": a + va - w})
        n += 1
    return n


def _token_row(r, table, token, lock=False):
    return r.row(table, "token = ?", token, lock=lock) if token else None


def _state(open_cond, live_cond):
    return "open" if open_cond else ("expired" if live_cond else "closed")


def _not_expired(t):
    return datetime.fromisoformat(str(t["expires_at"])) > datetime.now(timezone.utc)


@fn
def exp_link_get(r, p_token):
    if len(p_token or "") < 40:
        return {"error": "ลิงก์ไม่ถูกต้อง"}
    t = _token_row(r, "exp_approve_tokens", p_token)
    if not t:
        return {"error": "ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว"}
    v = r.row("exp_invoices", "id = ?", t["invoice_id"])
    live = v["status"] == "approval" and t.get("used_at") is None
    out = {k: v.get(k) for k in ("id", "status", "inv_no", "inv_date", "category", "vendor", "imported", "ref_no", "ref_date",
                                 "po_no", "note", "wht_rate", "amount", "vat", "wht", "net", "reject_reason")}
    sig = exp_sig(r, v.get("approver_id")) or {}
    out.update({
        "state": _state(live and _not_expired(t), live),
        "preparer": without(v.get("preparer"), "signature_path"), "reviewer": without(v.get("reviewer"), "signature_path"),
        "approver": without(v.get("approver"), "signature_path"),
        "approver_name": (v.get("approver") or {}).get("name") or sig.get("name"), "expires_at": t["expires_at"],
        "lines": r.rows(None, """SELECT cost_code, detail, detail2, amount, vat, wht, net FROM dbo.exp_invoice_lines
                                  WHERE invoice_id = ? ORDER BY line_no, id""", v["id"]),
        "files": r.rows(None, "SELECT id, name, size FROM dbo.exp_files WHERE invoice_id = ? ORDER BY uploaded_at", v["id"])})
    return out


@fn
def exp_link_decide(r, p_token, p_ok, p_reason=None):
    t = _token_row(r, "exp_approve_tokens", p_token, lock=True)
    if not t:
        raise E("ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว")
    if t.get("used_at"):
        raise E("ลิงก์นี้ใช้ไปแล้ว")
    if not _not_expired(t):
        raise E("ลิงก์หมดอายุแล้ว — เข้าสู่ระบบเพื่ออนุมัติแทน")
    v = r.row("exp_invoices", "id = ?", t["invoice_id"], lock=True)
    if v["status"] != "approval":
        raise E("ใบนี้ไม่ได้รออนุมัติแล้ว")
    if not r.user_has_perm(v.get("approver_id"), "data.expense.approve"):
        raise E("ผู้อนุมัติของใบนี้ไม่มีสิทธิ์อนุมัติแล้ว — ติดต่อ HR")
    r.flag("exp.flow")
    if p_ok:
        s = exp_sig(r, v["approver_id"])
        if s is None:
            raise E("ผู้อนุมัติยังไม่ได้ตั้งลายเซ็น — ติดต่อ HR")
        v = r.upd("exp_invoices", v, {"status": "approved", "approver": {**s, "via": "email_link"}, "approved_by": v["approver_id"], "approved_at": now()})
    else:
        if not nz(p_reason):
            raise E("กรุณาระบุเหตุผลที่ส่งกลับ")
        v = r.upd("exp_invoices", v, {"status": "rejected", "reject_reason": p_reason.strip(), "reviewer": None})
    r.cur.execute("UPDATE dbo.exp_approve_tokens SET used_at = SYSDATETIMEOFFSET() WHERE invoice_id = ?", v["id"])
    r.notify("ใบแจ้งหนี้อนุมัติแล้ว" if p_ok else "ใบแจ้งหนี้ถูกส่งกลับแก้ไข",
             f"{v.get('inv_no')} · {(v.get('vendor') or {}).get('name') or ''}", v.get("approver_id"), f"/expense/#/invoice/{v['id']}")
    return {"status": v["status"], "inv_no": v.get("inv_no")}


# ================================================================================ Contract Pay

@fn
def ct_decide(r, p_run, p_approve, p_reason=None):
    if not r.has_perm("data.contract.approve"):
        raise E("ไม่มีสิทธิ์อนุมัติงวดค่าจ้างเหมา")
    run = r.row("contract_pay_run", "id = ?", p_run, lock=True)
    if not run or run["status"] != "pending":
        raise E("งวดนี้ไม่ได้อยู่ในสถานะรออนุมัติ")
    if str(run.get("approver_id")) != str(r.uid):
        raise E("งวดนี้ส่งถึงผู้อนุมัติคนอื่น")
    r.flag("contract.deciding")
    if p_approve:
        s = r.signer(r.uid) or {}
        if not s.get("signature_path"):
            raise E("ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ “ลายเซ็นของฉัน” ก่อน")
        st = r.row("letter_settings", "id = 1") or {}
        return r.upd("contract_pay_run", run, {"status": "approved", "approved_by": r.uid, "approved_at": now(), "reject_reason": None,
                                               "signer": {"name_th": s.get("name_th"), "title_th": s.get("title_th"),
                                                          "signature_path": s["signature_path"], "seal_path": st.get("seal_path")}})
    return r.upd("contract_pay_run", run, {"status": "calculated", "reject_reason": nz(p_reason) or "ส่งกลับแก้ไข"})


# ================================================================================ diligence

def _dil_row(ym, x):
    num = lambda v: float(v) if v not in (None, "") else None
    return {"ym": ym, "emp_code": x.get("code"), "emp_name": x.get("name"), "department": x.get("department"), "job_level": x.get("job_level"),
            "qualified": bool(x.get("qualified")) if x.get("qualified") is not None else None, "streak": int(x.get("streak") or 0),
            "amount": num(x.get("amount")) or 0, "edit_days": int(x.get("edit_days") or 0), "reasons": x.get("reasons") or [],
            "flags": x.get("flags") or [], "manual": x.get("manual"),
            "auto_qualified": bool(x["auto_qualified"]) if x.get("auto_qualified") is not None else None, "auto_amount": num(x.get("auto_amount"))}


@fn
def diligence_save(r, p_ym, p_pay_ym, p_files, p_rows, p_groups=None):
    if not r.has_perm("data.diligence.write"):
        raise E("ไม่มีสิทธิ์บันทึกเบี้ยขยัน")
    if r.val("SELECT COUNT(*) FROM dbo.diligence_runs WHERE ym > ?", p_ym):
        raise E("มีเดือนหลังจากนี้บันทึกไว้แล้ว — ลบเดือนหลังก่อน แล้วค่อยบันทึกเดือนนี้ใหม่ (เดือนต่อเนื่องจะได้นับถูก)")
    r.cur.execute("DELETE FROM dbo.diligence_runs WHERE ym = ?", p_ym)   # results go with it (cascade)
    rows = p_rows or []
    r.ins("diligence_runs", {"ym": p_ym, "pay_ym": p_pay_ym, "files": p_files, "edit_groups": p_groups, "in_scope": len(rows),
                             "qualified": sum(1 for x in rows if x.get("qualified")),
                             "total": sum(float(x.get("amount") or 0) for x in rows), "saved_by": r.uid})
    for x in rows:
        r.ins("diligence_results", _dil_row(p_ym, x))
    return len(rows)


@fn
def diligence_edit(r, p_ym, p_rows):
    if not r.has_perm("data.diligence.write"):
        raise E("ไม่มีสิทธิ์แก้เบี้ยขยัน")
    later = r.val("SELECT COUNT(*) FROM dbo.diligence_runs WHERE ym > ?", p_ym)
    n = 0
    for x in p_rows or []:
        d = r.row("diligence_results", "ym = ? AND emp_code = ?", p_ym, x.get("code"))
        if not d:
            continue
        q, s = bool(x.get("qualified")), int(x.get("streak") or 0)
        if later and (bool(d.get("qualified")) != q or int(d.get("streak") or 0) != s):
            raise E("มีเดือนหลังจากนี้บันทึกแล้ว — เปลี่ยนได้/ไม่ได้ของเดือนนี้ไม่ได้ (แก้ได้เฉพาะยอดเงิน)")
        r.upd("diligence_results", d, {"qualified": q, "streak": s, "amount": float(x.get("amount") or 0), "manual": x.get("manual")})
        n += 1
    agg = r.cur.execute("SELECT SUM(CASE WHEN qualified = 1 THEN 1 ELSE 0 END), COALESCE(SUM(amount), 0) FROM dbo.diligence_results WHERE ym = ?", p_ym).fetchone()
    run = r.row("diligence_runs", "ym = ?", p_ym)
    if run:
        r.upd("diligence_runs", run, {"qualified": agg[0] or 0, "total": float(agg[1] or 0)})
    return n


# ================================================================================ fund forms (employee form is public)

def fund_valid_thai_id(p):
    if not p or not re.fullmatch(r"[0-9]{13}", p):
        return False
    s = sum(int(p[i]) * (13 - i) for i in range(12))
    return (11 - s % 11) % 10 == int(p[12])


def fund_verify_invite(r, p_token, p_emp_code, p_last5):
    inv = r.row("fund_form_invite", "token = ?", (p_token or "").strip())
    if not inv:
        return None
    if inv.get("cancelled"):
        raise E("CANCELLED")
    if datetime.fromisoformat(str(inv["expires_at"])) < datetime.now(timezone.utc):
        raise E("EXPIRED")
    if r.val("SELECT COUNT(*) FROM dbo.fund_invite_attempt WHERE invite_id = ? AND at > DATEADD(minute, -30, SYSDATETIMEOFFSET())", inv["id"]) >= 8:
        raise E("LOCKED")
    if (p_emp_code or "").strip().upper() != (inv["emp_code"] or "").upper() or (p_last5 or "").strip() != inv.get("id_last5"):
        r.ins("fund_invite_attempt", {"invite_id": inv["id"]})
        r.cn.commit()     # the failed attempt must count even though nothing else happens
        return None
    return inv


@fn
def fund_form_lookup(r, p_token, p_emp_code, p_last5):
    inv = fund_verify_invite(r, p_token, p_emp_code, p_last5)
    if not inv:
        return None
    if not inv.get("opened_at"):
        r.upd("fund_form_invite", inv, {"opened_at": now()})
    e = r.row("employees", "UPPER(LTRIM(RTRIM(emp_code))) = ?", inv["emp_code"].upper()) or {}
    subs = r.rows("fund_form_submission", "SELECT * FROM dbo.fund_form_submission WHERE emp_code = ? ORDER BY submitted_at DESC", inv["emp_code"])
    live = [s for s in subs if s["status"] != "cancelled"]
    latest_by_form = {}
    for s in live:
        latest_by_form.setdefault(s["form_type"], s)
    name = nz(inv.get("emp_name")) or " ".join(x for x in (e.get("firstname_th"), e.get("lastname_th")) if x)
    dept = nz(inv.get("department")) or " / ".join(x for x in (nz(e.get("division")), nz(e.get("department"))) if x)
    return {
        "emp_code": inv["emp_code"], "title": inv.get("title"), "name": name, "department": dept,
        "gender": e.get("gender"), "dob": e.get("dob"), "phone": e.get("phone"), "join_date": e.get("join_date"),
        "forms": inv.get("forms"), "expires_at": inv.get("expires_at"),
        "history": [{"id": s["id"], "form_type": s["form_type"], "status": s["status"], "submitted_at": s["submitted_at"],
                     "hr_note": s.get("hr_note") if s["status"] == "rejected" else None} for s in subs],
        "latest": ({k: live[0].get(k) for k in ("id", "form_type", "status", "submitted_at", "payload")} if live else None),
        "drafts": {ft: without(s.get("payload"), "signature", "consent") for ft, s in latest_by_form.items() if s["status"] == "rejected"},
    }


@fn
def fund_form_submit(r, p_token, p_emp_code, p_last5, p_form_type, p_payload):
    inv = fund_verify_invite(r, p_token, p_emp_code, p_last5)
    if not inv:
        raise E("VERIFY_FAILED")
    if p_form_type not in (inv.get("forms") or []):
        raise E("FORM_NOT_ALLOWED")
    last = r.val("""SELECT TOP 1 status FROM dbo.fund_form_submission WHERE emp_code = ? AND status <> N'cancelled'
                    ORDER BY submitted_at DESC""", inv["emp_code"])
    if last in ("submitted", "accepted", "received", "approved", "sent"):
        raise E("ALREADY_SUBMITTED")
    p = p_payload
    if not isinstance(p, dict):
        raise E("BAD_PAYLOAD")
    if p.get("consent") is not True:
        raise E("NO_CONSENT")
    if p_form_type == "pvd":
        req = p.get("requests") or []
        if not req:
            raise E("PVD_NO_REQUEST")
        if "apply" in req or "beneficiary" in req:
            bs = p.get("beneficiaries") or []
            for b in bs:
                if not (b.get("name") or "").strip() or not (b.get("relation") or "").strip():
                    raise E("PVD_BENEF_INCOMPLETE")
            if not 1 <= len(bs) <= 3:
                raise E("PVD_BENEF_COUNT")
            if sum(float(b.get("percent") or 0) for b in bs) != 100:
                raise E("PVD_PERCENT_SUM")
        if ("apply" in req or "rate" in req) and not 2 <= float(p.get("rate") or 0) <= 15:
            raise E("PVD_RATE")
        if ("apply" in req or "policy" in req) and (p.get("policy") or "") not in ("PF1103", "PF4103", "PF6103", "PFM103", "PF2103"):
            raise E("PVD_POLICY")
    elif p_form_type == "wef":
        if p.get("is_thai", True) in (True, None, "true"):
            if not fund_valid_thai_id(p.get("id_card")):
                raise E("WEF_ID_CARD")
            if (p.get("id_card") or "")[-5:] != inv.get("id_last5"):
                raise E("WEF_ID_MISMATCH")
        elif not (p.get("passport") or "").strip():
            raise E("WEF_PASSPORT")
        bs = p.get("beneficiaries") or []
        for b in bs:
            if not (b.get("name") or "").strip() or not (b.get("relation") or "").strip() or not (b.get("address") or "").strip():
                raise E("WEF_BENEF_INCOMPLETE")
            if not fund_valid_thai_id(b.get("id_card")):
                raise E("WEF_BENEF_ID")
        if not 1 <= len(bs) <= 8:
            raise E("WEF_BENEF_COUNT")
    else:
        raise E("BAD_FORM_TYPE")
    s = r.ins("fund_form_submission", {"form_type": p_form_type, "emp_code": inv["emp_code"], "emp_name": inv.get("emp_name"),
                                       "department": inv.get("department"), "payload": p, "invite_id": inv["id"]})
    return {"id": s["id"], "submitted_at": now()}


@fn
def fund_request_approval(r, p_id, p_approver):
    if not r.has_perm("data.fundforms.write"):
        raise E("ไม่มีสิทธิ์จัดการคำขอกองทุน")
    s = r.row("fund_form_submission", "id = ?", p_id, lock=True)
    if not s:
        raise E("ไม่พบคำขอ")
    if s["form_type"] != "pvd":
        raise E("ส่งลงนามได้เฉพาะแบบฟอร์มกองทุนสำรองเลี้ยงชีพ")
    if s["status"] not in ("accepted", "received"):
        raise E("ต้องรับเรื่องก่อน จึงส่งให้กรรมการลงนามได้")
    if r.val("SELECT COUNT(*) FROM dbo.fund_form_submission WHERE emp_code = ? AND status <> N'cancelled' AND submitted_at > ?",
             s["emp_code"], s["submitted_at"]):
        raise E("มีฉบับใหม่กว่านี้ — ส่งฉบับล่าสุดแทน")
    if not p_approver or not r.val("SELECT COUNT(*) FROM dbo.fund_committee WHERE user_id = ?", p_approver):
        raise E("ผู้ที่เลือกไม่อยู่ในรายชื่อคณะกรรมการ")
    if not r.user_has_perm(p_approver, "data.fundforms.approve"):
        raise E("กรรมการที่เลือกยังไม่มีสิทธิ์ลงนามแบบฟอร์มกองทุน")
    if not r.val("SELECT COUNT(*) FROM dbo.letter_signers WHERE user_id = ? AND signature_path IS NOT NULL", p_approver):
        raise E("กรรมการที่เลือกยังไม่ได้ตั้งลายเซ็น")
    w = r.signer(r.uid) or {}
    if not w.get("signature_path"):
        raise E("ท่านยังไม่ได้ตั้งลายเซ็น — ต้องใช้ลงนามเป็นพยาน")
    r.flag("fund.approving")
    return r.upd("fund_form_submission", s, {
        "status": "pending_approval", "approval_prev_status": s["status"], "approver_id": p_approver,
        "approval_requested_at": now(), "approval_requested_by": r.uid, "approval_requested_email": r.email_of(r.uid),
        "approval_note": None, "updated_by": r.uid,
        "witness": {"name_th": w.get("name_th"), "title_th": w.get("title_th"), "signature_path": w["signature_path"]}, "witnessed_at": now()})


@fn
def fund_approve(r, p_id):
    if not r.has_perm("data.fundforms.approve"):
        raise E("ไม่มีสิทธิ์อนุมัติแบบฟอร์มกองทุน")
    s = r.row("fund_form_submission", "id = ?", p_id, lock=True)
    if not s or s["status"] != "pending_approval":
        raise E("คำขอนี้ไม่ได้รอกรรมการลงนาม")
    if str(s.get("approver_id")) != str(r.uid):
        raise E("คำขอนี้ส่งถึงกรรมการท่านอื่น")
    g = r.signer(r.uid) or {}
    if not g.get("signature_path"):
        raise E("ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ ออกหนังสือ HR → ตั้งค่า")
    r.flag("fund.approving")
    return r.upd("fund_form_submission", s, {"status": "approved", "approved_by": r.uid, "approved_at": now(), "updated_by": r.uid,
                                             "committee": {"name_th": g.get("name_th"), "title_th": g.get("title_th"), "signature_path": g["signature_path"]}})


@fn
def fund_recall_approval(r, p_id):
    if not r.has_perm("data.fundforms.write"):
        raise E("ไม่มีสิทธิ์จัดการคำขอกองทุน")
    s = r.row("fund_form_submission", "id = ?", p_id, lock=True)
    if not s or s["status"] != "pending_approval":
        raise E("คำขอนี้ไม่ได้รอกรรมการลงนาม")
    r.flag("fund.approving")
    return r.upd("fund_form_submission", s, {"status": s.get("approval_prev_status") or "accepted", "approver_id": None,
                                             "witness": None, "witnessed_at": None, "updated_by": r.uid})


@fn
def fund_reject_approval(r, p_id, p_reason=None):
    if not r.has_perm("data.fundforms.approve"):
        raise E("ไม่มีสิทธิ์อนุมัติแบบฟอร์มกองทุน")
    s = r.row("fund_form_submission", "id = ?", p_id, lock=True)
    if not s or s["status"] != "pending_approval":
        raise E("คำขอนี้ไม่ได้รอกรรมการลงนาม")
    if str(s.get("approver_id")) != str(r.uid):
        raise E("คำขอนี้ส่งถึงกรรมการท่านอื่น")
    r.flag("fund.approving")
    return r.upd("fund_form_submission", s, {"status": s.get("approval_prev_status") or "accepted", "approval_note": nz(p_reason),
                                             "witness": None, "witnessed_at": None, "updated_by": r.uid})


# ================================================================================ Employment Agreement

@fn
def ec_submit(r, p_id, p_signer, p_witness):
    if not r.has_perm("data.empcontract.write"):
        raise E("ไม่มีสิทธิ์ทำสัญญาจ้าง")
    if not p_signer or not p_witness:
        raise E("เลือกผู้ลงนามและพยานก่อน")
    if str(p_signer) == str(p_witness):
        raise E("ผู้ลงนามกับพยานต้องเป็นคนละคน")
    if not r.user_has_perm(p_signer, "data.empcontract.sign"):
        raise E("ผู้แทนบริษัทที่เลือกไม่มีสิทธิ์ลงนามสัญญาจ้าง")
    if not (r.user_has_perm(p_witness, "data.empcontract.sign") or r.user_has_perm(p_witness, "data.empcontract.write")):
        raise E("พยานที่เลือกไม่มีสิทธิ์")
    c = r.row("emp_contracts", "id = ? AND status IN (N'draft', N'rejected')", p_id, lock=True)
    if not c:
        raise E("ส่งได้เฉพาะสัญญาที่เป็นร่างหรือถูกส่งกลับ")
    r.flag("ec.deciding")
    return r.upd("emp_contracts", c, {"status": "pending", "signer_id": p_signer, "witness_id": p_witness, "signer": None, "witness": None,
                                      "signed_at": None, "witnessed_at": None, "reject_reason": None, "requested_by": r.uid,
                                      "requested_email": r.email_of(r.uid), "submitted_at": now(), "updated_at": now()})


@fn
def ec_sign(r, p_id):
    c = r.row("emp_contracts", "id = ?", p_id, lock=True)
    if not c:
        raise E("สัญญานี้ไม่ได้รอลงนาม")
    me = str(r.uid)
    if not (r.has_perm("data.empcontract.sign") or (str(c.get("witness_id")) == me and r.has_perm("data.empcontract.write"))):
        raise E("ไม่มีสิทธิ์ลงนามสัญญาจ้าง")
    if c["status"] != "pending":
        raise E("สัญญานี้ไม่ได้รอลงนาม")
    s = r.signer(r.uid) or {}
    if not s.get("signature_path"):
        raise E("ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ “ลายเซ็นของฉัน” ก่อน")
    snap = {"name_th": s.get("name_th"), "title_th": s.get("title_th"), "signature_path": s["signature_path"]}
    r.flag("ec.deciding")
    if str(c.get("signer_id")) == me and not c.get("signed_at"):
        c = r.upd("emp_contracts", c, {"signer": snap, "signed_at": now()})
    elif str(c.get("witness_id")) == me and not c.get("witnessed_at"):
        c = r.upd("emp_contracts", c, {"witness": snap, "witnessed_at": now()})
    else:
        raise E("สัญญานี้ไม่ได้รอลายเซ็นของคุณ")
    if c.get("signed_at") and c.get("witnessed_at"):
        c = r.upd("emp_contracts", c, {"status": "signed", "updated_at": now()})
    return c


@fn
def ec_reject(r, p_id, p_reason=None):
    c = r.row("emp_contracts", "id = ?", p_id, lock=True)
    if not c:
        raise E("ไม่มีสิทธิ์")
    me = str(r.uid)
    if not (r.has_perm("data.empcontract.sign") or (str(c.get("witness_id")) == me and r.has_perm("data.empcontract.write"))):
        raise E("ไม่มีสิทธิ์")
    if c["status"] != "pending" or me not in (str(c.get("signer_id")), str(c.get("witness_id"))):
        raise E("สัญญานี้ไม่ได้รอลายเซ็นของคุณ")
    r.flag("ec.deciding")
    return r.upd("emp_contracts", c, {"status": "rejected", "reject_reason": nz(p_reason) or "ส่งกลับแก้ไข", "signer": None, "witness": None,
                                      "signed_at": None, "witnessed_at": None, "updated_at": now()})


@fn
def ec_sign_link(r, p_id):
    return r.val("""SELECT t.token FROM dbo.ec_sign_tokens t JOIN dbo.emp_contracts c ON c.id = t.contract_id
                     WHERE c.id = ? AND c.status = N'pending' AND c.signed_at IS NULL AND t.used_at IS NULL AND t.expires_at > SYSDATETIMEOFFSET()
                       AND (c.requested_by = ? OR c.signer_id = ?)""", p_id, r.uid, r.uid)


@fn
def ec_link_get(r, p_token):
    if len(p_token or "") < 40:
        return {"error": "ลิงก์ไม่ถูกต้อง"}
    t = _token_row(r, "ec_sign_tokens", p_token)
    if not t:
        return {"error": "ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว"}
    c = r.row("emp_contracts", "id = ?", t["contract_id"])
    live = c["status"] == "pending" and not c.get("signed_at") and t.get("used_at") is None
    g = lambda uid: (lambda s: (s.get("name_th") or None) or s.get("name_en"))(r.signer(uid) or {}) if uid else None
    out = without(c, "id_card", "requested_email", "signer", "witness")
    out.update({"state": _state(live and _not_expired(t), live), "signer_name": g(c.get("signer_id")), "witness_name": g(c.get("witness_id")),
                "signer": without(c.get("signer"), "signature_path"), "witness": without(c.get("witness"), "signature_path"),
                "expires_at": t["expires_at"]})
    return out


@fn
def ec_link_decide(r, p_token, p_ok, p_reason=None):
    t = _token_row(r, "ec_sign_tokens", p_token, lock=True)
    if not t:
        raise E("ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว")
    if t.get("used_at"):
        raise E("ลิงก์นี้ใช้ไปแล้ว")
    if not _not_expired(t):
        raise E("ลิงก์หมดอายุแล้ว — เข้าสู่ระบบเพื่อลงนามแทน")
    c = r.row("emp_contracts", "id = ?", t["contract_id"], lock=True)
    if c["status"] != "pending" or c.get("signed_at"):
        raise E("สัญญานี้ไม่ได้รอลายเซ็นผู้แทนบริษัทแล้ว")
    if not r.user_has_perm(c.get("signer_id"), "data.empcontract.sign"):
        raise E("ผู้แทนบริษัทของสัญญานี้ไม่มีสิทธิ์ลงนามแล้ว — ติดต่อ HR")
    r.flag("ec.deciding")
    if p_ok:
        s = r.signer(c["signer_id"]) or {}
        if not s.get("signature_path"):
            raise E("ผู้แทนบริษัทยังไม่ได้ตั้งลายเซ็น — ติดต่อ HR")
        c = r.upd("emp_contracts", c, {"signer": {"name_th": s.get("name_th"), "title_th": s.get("title_th"),
                                                  "signature_path": s["signature_path"], "via": "email_link"},
                                       "signed_at": now(), "updated_at": now()})
        if c.get("witnessed_at"):
            c = r.upd("emp_contracts", c, {"status": "signed"})
    else:
        if not nz(p_reason):
            raise E("กรุณาระบุเหตุผลที่ส่งกลับ")
        c = r.upd("emp_contracts", c, {"status": "rejected", "reject_reason": p_reason.strip(), "signer": None, "witness": None,
                                       "signed_at": None, "witnessed_at": None, "updated_at": now()})
    r.cur.execute("UPDATE dbo.ec_sign_tokens SET used_at = SYSDATETIMEOFFSET() WHERE contract_id = ?", c["id"])
    return {"status": c["status"], "name": (c.get("title_th") or "") + (c.get("name_th") or "")}


# ================================================================================ PAF

def paf_issue_token(r, paf_id, step):
    tok = hooks.new_token()
    exp = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    if r.val("SELECT COUNT(*) FROM dbo.paf_tokens WHERE paf_id = ? AND step = ?", paf_id, step):
        r.cur.execute("UPDATE dbo.paf_tokens SET token = ?, expires_at = ?, used_at = NULL, created_at = SYSDATETIMEOFFSET() WHERE paf_id = ? AND step = ?",
                      tok, exp, paf_id, step)
    else:
        r.cur.execute("INSERT INTO dbo.paf_tokens (paf_id, step, token, expires_at) VALUES (?, ?, ?, ?)", paf_id, step, tok, exp)


def paf_apply(r, paf_id):
    f = r.row("paf_forms", "id = ?", paf_id)
    if not f.get("mov_type") or f["mov_type"] == "none":
        return
    j = lambda sep, *xs: sep.join(x for x in xs if x)
    frm = j(" / ", nz(f.get("department")), nz(f.get("position")))
    dst = j(" / ", nz(f.get("department_to")) or nz(f.get("department")), nz(f.get("position_to")) or nz(f.get("position")))
    m = r.ins("movements", {"emp_code": f["emp_code"], "name": f.get("name_th") or f["emp_code"], "type": f["mov_type"],
                            "date": f.get("effective_date"), "from_dept": frm or None, "to_dept": dst or None,
                            "reason": j(" · ", f.get("doc_no"), nz(f.get("subject_th"))), "salary": f.get("salary_to"),
                            "job_level": nz(f.get("job_level_to")), "recorded_by": f"PAF {f.get('doc_no') or ''}", "created_by": f.get("requested_by")})
    e = r.row("employees", "emp_code = ?", f["emp_code"], lock=True)
    if e:
        ch = {k: nz(f.get(k + "_to")) for k in ("position", "job_level", "division", "department", "section", "team")}
        upd = {k: v for k, v in ch.items() if v}
        if f.get("salary_to") is not None:
            upd["salary"] = f["salary_to"]
        upd["effective_date"] = f.get("effective_date")
        r.upd("employees", e, upd)
    r.upd("paf_forms", f, {"movement_id": m["id"]})


@fn
def paf_submit(r, p_id, p_steps):
    if not r.has_perm("data.paf.write"):
        raise E("ไม่มีสิทธิ์ทำ PAF")
    if not isinstance(p_steps, list) or len(p_steps) != 2:
        raise E("เลือกผู้อนุมัติให้ครบ 2 ขั้น")
    for s in p_steps:
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", (s.get("email") or "").strip()):
            raise E(f"ผู้อนุมัติ {s.get('name_th') or ''} ไม่มีอีเมล")
    f = r.row("paf_forms", "id = ?", p_id, lock=True)
    if not f:
        raise E("ไม่พบ PAF")
    if f["status"] not in ("draft", "rejected"):
        raise E("PAF นี้ส่งไปแล้ว")
    if not f.get("effective_date"):
        raise E("กรอกวันที่มีผล")
    doc_id, doc_no = f.get("doc_id"), f.get("doc_no")
    if doc_id is None:
        tid = r.val("SELECT TOP 1 id FROM dbo.doc_types WHERE series_code = N'PAF' ORDER BY sort_order")
        d = _doc_issue(r, "PAF", 1, tid, f.get("subject_th"), today(), None, "ออกจากระบบ Personnel Action Form",
                       [{"emp_code": f.get("emp_code"), "person_name": f.get("name_th")}])[0]
        doc_id, doc_no = d["id"], d["doc_no"]
    me = _my_name(r)
    r.flag("paf.flow")
    f = r.upd("paf_forms", f, {"status": "pending", "doc_id": doc_id, "doc_no": doc_no, "steps": p_steps, "cur_step": 1,
                               "requested_by": r.uid, "requested_name": me, "requested_email": r.email_of(r.uid),
                               "requested_at": now(), "reject_reason": None, "approved_at": None, "updated_at": now()})
    r.ins("paf_log", {"paf_id": p_id, "action": "submit", "step": 0, "actor_name": me,
                      "actor_detail": nz((r.signer(r.uid) or {}).get("title_th")), "via": "app"})
    r.cur.execute("DELETE FROM dbo.paf_tokens WHERE paf_id = ?", p_id)
    paf_issue_token(r, p_id, 1)
    return f


@fn
def paf_cancel(r, p_id, p_reason):
    if not r.has_perm("data.paf.write"):
        raise E("ไม่มีสิทธิ์")
    if not nz(p_reason):
        raise E("ระบุเหตุผลที่ยกเลิก")
    f = r.row("paf_forms", "id = ?", p_id, lock=True)
    if not f or f["status"] in ("approved", "cancelled"):
        raise E("PAF ที่อนุมัติแล้ว/ยกเลิกแล้ว ยกเลิกไม่ได้")
    r.flag("paf.flow")
    f = r.upd("paf_forms", f, {"status": "cancelled", "cancel_reason": p_reason.strip(), "cur_step": None, "updated_at": now()})
    r.cur.execute("DELETE FROM dbo.paf_tokens WHERE paf_id = ?", p_id)
    g = r.signer(r.uid) or {}
    r.ins("paf_log", {"paf_id": p_id, "action": "cancel", "actor_name": (g.get("name_th") or None) or r.email_of(r.uid),
                      "remark": p_reason.strip(), "via": "app"})
    if f.get("doc_id") is not None:
        d = r.row("doc_register", "id = ? AND status = N'active'", f["doc_id"], lock=True)
        if d:
            r.upd("doc_register", d, {"status": "void", "void_reason": "ยกเลิก PAF: " + p_reason.strip(), "voided_at": now(), "voided_by": r.uid})
    return f


@fn
def paf_ack(r, p_id, p_date):
    if not r.has_perm("data.paf.write"):
        raise E("ไม่มีสิทธิ์")
    f = r.row("paf_forms", "id = ? AND status = N'approved'", p_id, lock=True)
    if not f:
        raise E("บันทึกรับทราบได้เฉพาะ PAF ที่อนุมัติแล้ว")
    f = r.upd("paf_forms", f, {"ack_date": p_date, "updated_at": now()})
    d = date.fromisoformat(str(p_date)[:10])
    r.ins("paf_log", {"paf_id": p_id, "action": "ack", "actor_name": f.get("name_th"), "remark": f"พนักงานลงนามรับทราบ {d:%d/%m/%Y}", "via": "app"})
    return f


@fn
def paf_pending_link(r, p_id):
    if not r.has_perm("data.paf.write"):
        return None
    return r.val("""SELECT t.token FROM dbo.paf_tokens t JOIN dbo.paf_forms f ON f.id = t.paf_id
                     WHERE f.id = ? AND f.status = N'pending' AND t.step = f.cur_step AND t.used_at IS NULL AND t.expires_at > SYSDATETIMEOFFSET()""", p_id)


@fn
def paf_renew_link(r, p_id):
    if not r.has_perm("data.paf.write"):
        raise E("ไม่มีสิทธิ์")
    f = r.row("paf_forms", "id = ?", p_id)
    if not f or f["status"] != "pending":
        raise E("PAF นี้ไม่ได้รออนุมัติ")
    paf_issue_token(r, p_id, f["cur_step"])
    return r.val("SELECT token FROM dbo.paf_tokens WHERE paf_id = ? AND step = ?", p_id, f["cur_step"])


@fn
def paf_link_get(r, p_token):
    if len(p_token or "") < 40:
        return {"error": "ลิงก์ไม่ถูกต้อง"}
    t = _token_row(r, "paf_tokens", p_token)
    if not t:
        return {"error": "ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว"}
    f = r.row("paf_forms", "id = ?", t["paf_id"])
    live = f["status"] == "pending" and f.get("cur_step") == t["step"] and t.get("used_at") is None
    out = without(f, "requested_email", "created_by", "requested_by")
    out.update({"state": _state(live and _not_expired(t), live), "link_step": t["step"], "expires_at": t["expires_at"],
                "log": [without(x, "paf_id") for x in r.rows("paf_log", "SELECT * FROM dbo.paf_log WHERE paf_id = ? ORDER BY at, id", f["id"])]})
    return out


@fn
def paf_link_decide(r, p_token, p_ok, p_remark=None):
    t = _token_row(r, "paf_tokens", p_token, lock=True)
    if not t:
        raise E("ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว")
    if t.get("used_at"):
        raise E("ลิงก์นี้ใช้ไปแล้ว")
    if not _not_expired(t):
        raise E("ลิงก์หมดอายุแล้ว — ติดต่อ HR ให้ส่งลิงก์ใหม่")
    f = r.row("paf_forms", "id = ?", t["paf_id"], lock=True)
    if f["status"] != "pending" or f.get("cur_step") != t["step"]:
        raise E("PAF นี้ไม่ได้รอการพิจารณาขั้นนี้แล้ว")
    steps = f.get("steps") or []
    a = next((x for x in steps if int(x.get("step") or 0) == t["step"]), {})
    n = len(steps)
    if not p_ok and not nz(p_remark):
        raise E("กรุณาระบุเหตุผลที่ส่งกลับ")
    r.flag("paf.flow")
    detail = " · ".join(x for x in (nz(a.get("emp_code")), nz(a.get("title_th"))) if x) or None
    r.ins("paf_log", {"paf_id": f["id"], "action": "approve" if p_ok else "reject", "step": t["step"], "actor_name": a.get("name_th"),
                      "actor_detail": detail, "remark": nz(p_remark), "via": "email_link"})
    r.cur.execute("UPDATE dbo.paf_tokens SET used_at = SYSDATETIMEOFFSET() WHERE paf_id = ? AND step = ?", f["id"], t["step"])
    if not p_ok:
        f = r.upd("paf_forms", f, {"status": "rejected", "reject_reason": p_remark.strip(), "cur_step": None, "updated_at": now()})
    elif t["step"] < n:
        f = r.upd("paf_forms", f, {"cur_step": t["step"] + 1, "updated_at": now()})
        paf_issue_token(r, f["id"], t["step"] + 1)
    else:
        f = r.upd("paf_forms", f, {"status": "approved", "cur_step": None, "approved_at": now(), "updated_at": now()})
        paf_apply(r, f["id"])
    f = r.row("paf_forms", "id = ?", f["id"])
    title = {"approved": "PAF อนุมัติครบแล้ว", "rejected": "PAF ถูกส่งกลับแก้ไข"}.get(f["status"], f"PAF ผ่านขั้น {t['step']} แล้ว — ส่งขอขั้นถัดไป")
    r.notify(title, f.get("doc_no"), f.get("requested_by"), f"paf?paf={f['id']}")
    return {"status": f["status"], "cur_step": f.get("cur_step"), "doc_no": f.get("doc_no"), "name": f.get("name_th")}


# ================================================================================ Payroll Register signing

def pr_issue_token(r, month, step):
    tok = hooks.new_token()
    exp = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    if r.val("SELECT COUNT(*) FROM dbo.payroll_sign_tokens WHERE month = ? AND step = ?", month, step):
        r.cur.execute("UPDATE dbo.payroll_sign_tokens SET token = ?, expires_at = ?, used_at = NULL, created_at = SYSDATETIMEOFFSET() WHERE month = ? AND step = ?",
                      tok, exp, month, step)
    else:
        r.cur.execute("INSERT INTO dbo.payroll_sign_tokens (month, step, token, expires_at) VALUES (?, ?, ?, ?)", month, step, tok, exp)


@fn
def pr_submit(r, p_month, p_steps):
    if not r.has_perm("data.payroll.write"):
        raise E("ไม่มีสิทธิ์ส่งเซ็น Payroll Register")
    if not r.val("SELECT COUNT(*) FROM dbo.payroll_period WHERE month = ?", p_month):
        raise E(f"ยังไม่ได้บันทึกรายงานเดือน {p_month}")
    steps = p_steps or []
    if len(steps) < 2:
        raise E("ต้องมีอย่างน้อย 2 ช่อง (ผู้จัดทำ + ผู้อนุมัติ)")
    out = []
    for i, x in enumerate(steps, 1):
        if i == 1 and str(x.get("user_id")) != str(r.uid):
            raise E("ช่องแรก (ผู้จัดทำ) ต้องเป็นคนที่กดส่ง")
        g = r.signer(x.get("user_id"))
        if not g or not g.get("signature_path"):
            raise E(f"ช่องที่ {i} ยังไม่ได้เลือกคน หรือคนนั้นยังไม่มีลายเซ็นในระบบ")
        out.append({"step": i, "role": x.get("role"), "dept": x.get("dept"), "user_id": g["user_id"],
                    "name": sig_name(g, True), "title": sig_title(g, True), "email": nz(g.get("email")) or r.email_of(g["user_id"]),
                    "signature_path": g["signature_path"] if i == 1 else None, "signed_at": now() if i == 1 else None,
                    "via": "app" if i == 1 else None})
    r.cur.execute("DELETE FROM dbo.payroll_sign WHERE month = ?", p_month)
    row = r.ins("payroll_sign", {"month": p_month, "status": "pending", "steps": out, "cur_step": 2, "submitted_by": r.uid})
    pr_issue_token(r, p_month, 2)
    return row


@fn
def pr_cancel(r, p_month):
    if not r.has_perm("data.payroll.write"):
        raise E("ไม่มีสิทธิ์")
    r.cur.execute("DELETE FROM dbo.payroll_sign WHERE month = ?", p_month)
    return None


@fn
def pr_pending_link(r, p_month):
    if not r.has_perm("data.payroll.write"):
        return None
    return r.val("""SELECT t.token FROM dbo.payroll_sign_tokens t JOIN dbo.payroll_sign s ON s.month = t.month
                     WHERE s.month = ? AND s.status = N'pending' AND t.step = s.cur_step AND t.used_at IS NULL AND t.expires_at > SYSDATETIMEOFFSET()""", p_month)


@fn
def pr_renew_link(r, p_month):
    if not r.has_perm("data.payroll.write"):
        raise E("ไม่มีสิทธิ์")
    s = r.row("payroll_sign", "month = ?", p_month)
    if not s or s["status"] != "pending":
        raise E("รายงานเดือนนี้ไม่ได้รอลงนาม")
    pr_issue_token(r, p_month, s["cur_step"])
    return r.val("SELECT token FROM dbo.payroll_sign_tokens WHERE month = ? AND step = ?", p_month, s["cur_step"])


@fn
def pr_link_get(r, p_token):
    if len(p_token or "") < 40:
        return {"error": "ลิงก์ไม่ถูกต้อง"}
    t = _token_row(r, "payroll_sign_tokens", p_token)
    if not t:
        return {"error": "ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว"}
    s = r.row("payroll_sign", "month = ?", t["month"]) or {}
    live = s.get("status") == "pending" and s.get("cur_step") == t["step"] and t.get("used_at") is None
    return {"month": s.get("month"), "status": s.get("status"), "cur_step": s.get("cur_step"), "reject_reason": s.get("reject_reason"),
            "link_step": t["step"], "state": _state(live and _not_expired(t), live),
            "steps": [without(x, "email", "user_id", "signature_path") for x in sorted(s.get("steps") or [], key=lambda x: int(x.get("step") or 0))],
            "rows": [without(x, "id") for x in r.rows("payroll_summary", "SELECT * FROM dbo.payroll_summary WHERE month = ?", t["month"])]}


@fn
def pr_link_decide(r, p_token, p_ok, p_remark=None):
    t = _token_row(r, "payroll_sign_tokens", p_token, lock=True)
    if not t:
        raise E("ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว")
    if t.get("used_at"):
        raise E("ลิงก์นี้ใช้ไปแล้ว")
    if not _not_expired(t):
        raise E("ลิงก์หมดอายุแล้ว — ติดต่อ HR ให้ส่งลิงก์ใหม่")
    s = r.row("payroll_sign", "month = ?", t["month"], lock=True)
    if not s or s["status"] != "pending" or s.get("cur_step") != t["step"]:
        raise E("รายงานนี้ไม่ได้รอการลงนามขั้นนี้แล้ว")
    if not p_ok and not nz(p_remark):
        raise E("กรุณาระบุเหตุผลที่ส่งกลับ")
    steps = sorted(s.get("steps") or [], key=lambda x: int(x.get("step") or 0))
    a = next((x for x in steps if int(x.get("step") or 0) == t["step"]), {})
    n = len(steps)
    r.cur.execute("UPDATE dbo.payroll_sign_tokens SET used_at = SYSDATETIMEOFFSET() WHERE month = ? AND step = ?", t["month"], t["step"])
    if not p_ok:
        s = r.upd("payroll_sign", s, {"status": "rejected", "reject_reason": p_remark.strip(), "cur_step": None, "updated_at": now()})
    else:
        sig = r.val("SELECT signature_path FROM dbo.letter_signers WHERE user_id = ?", a.get("user_id"))
        if not sig:
            raise E("ยังไม่มีลายเซ็นของผู้ลงนามขั้นนี้ในระบบ — ติดต่อ HR")
        steps = [({**x, "signature_path": sig, "signed_at": now(), "via": "email_link"} if int(x.get("step") or 0) == t["step"] else x) for x in steps]
        last = t["step"] >= n
        s = r.upd("payroll_sign", s, {"steps": steps, "status": "approved" if last else "pending", "cur_step": None if last else t["step"] + 1,
                                      "approved_at": now() if last else None, "updated_at": now()})
        if not last:
            pr_issue_token(r, s["month"], t["step"] + 1)
    title = {"approved": "Payroll Register ลงนามครบแล้ว", "rejected": "Payroll Register ถูกส่งกลับ"}.get(s["status"], f"Payroll Register ผ่านขั้น {t['step']} แล้ว")
    r.notify(title, s["month"], s.get("submitted_by"), "payrollbuild")
    return {"status": s["status"], "cur_step": s.get("cur_step"), "month": s["month"]}
