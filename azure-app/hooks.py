"""
The Supabase triggers, ported. Every write from the site (rest.py) and from server functions goes through here,
so the same guards apply no matter who writes.

Each hook receives the open cursor `cur`, the request context `ctx` (uid, flags, has_perm) and the row(s) as dicts.
Raise HookError(message) to refuse — the message reaches the page exactly like a Postgres `raise exception`.
"Flags" replace Postgres session settings such as exp.flow / paf.flow: server functions set them in ctx.flags
for the duration of their own writes, so the guarded columns can change only through those functions.
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone


class HookError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _distinct(a, b) -> bool:
    """Postgres IS DISTINCT FROM for values coming back from SQL Server / the browser."""
    def n(v):
        if isinstance(v, (dict, list)):
            return json.dumps(v, sort_keys=True, ensure_ascii=False)
        if isinstance(v, str) and len(v) >= 19 and v[4] == "-" and v[10] == "T":
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
            except ValueError:
                return v
        if isinstance(v, bool):
            return int(v)
        if isinstance(v, float) and v.is_integer():
            return int(v)
        return v
    return n(a) != n(b)


def _changed(old: dict, new: dict, keys) -> bool:
    return any(_distinct(old.get(k), new.get(k)) for k in keys)


def _one(cur, sql, *args):
    r = cur.execute(sql, *args).fetchone()
    return r[0] if r else None


def new_token() -> str:
    return secrets.token_hex(32)   # same shape as Postgres replace(uuid||uuid,'-','')


# ---------------------------------------------------------------------------------------------- per table

def set_updated_at(cur, ctx, old, new):
    new["updated_at"] = now()


def block_locked_run(cur, ctx, row):
    st = _one(cur, "SELECT status FROM dbo.contract_pay_run WHERE id = ?", row.get("run_id"))
    if st == "locked":
        raise HookError("งวดนี้ล็อกแล้ว แก้ไขไม่ได้ — ถ้าต้องแก้ให้เปิดงวดแก้ไขใหม่")
    if st in ("pending", "approved"):
        raise HookError("งวดนี้ส่งขออนุมัติ/อนุมัติแล้ว แก้ตัวเลขไม่ได้ — ถอนคำขอหรือให้ผู้อนุมัติส่งกลับก่อน")


def check_manager_cycle(cur, ctx, row):
    mc = row.get("manager_code")
    if not mc:
        return
    cur_code, hops = mc, 0
    while cur_code and hops < 50:
        if cur_code == row["emp_code"]:
            raise HookError(f"สายบังคับบัญชาวนเป็นวงกลม: {row['emp_code']} ไม่สามารถขึ้นตรงกับ {mc} ได้")
        cur_code = _one(cur, "SELECT manager_code FROM dbo.employees WHERE emp_code = ?", cur_code)
        hops += 1


def check_uniform_balance(cur, ctx, item_id):
    bal = _one(cur, "SELECT COALESCE(SUM(qty), 0) FROM dbo.uniform_move WHERE item_id = ?", item_id) or 0
    if bal < 0:
        nm = _one(cur, "SELECT item_type + N' ไซส์ ' + size FROM dbo.uniform_item WHERE id = ?", item_id)
        raise HookError(f"จ่ายเกินของที่มี: {nm} คงเหลือจะติดลบ ({bal})")


def guard_contract_run(cur, ctx, old, new):
    deciding = ctx.flag("contract.deciding")
    if old["status"] == "locked":
        raise HookError("งวดที่ล็อกแล้วแก้ไขไม่ได้")
    if _distinct(new["status"], old["status"]):
        if new["status"] == "approved":
            if old["status"] != "pending" or not deciding:
                raise HookError("อนุมัติได้เฉพาะผู้ลงนามผ่านปุ่มอนุมัติ")
        elif not ((old["status"] == "draft" and new["status"] == "calculated")
                  or (old["status"] == "calculated" and new["status"] in ("draft", "pending"))
                  or (old["status"] == "pending" and new["status"] == "calculated")
                  or (old["status"] == "approved" and new["status"] == "locked")):
            raise HookError(f"เปลี่ยนสถานะจาก {old['status']} เป็น {new['status']} ไม่ได้")
    if not deciding and _changed(old, new, ("signer", "approved_at", "approved_by")):
        raise HookError("ข้อมูลการอนุมัติแก้ไขไม่ได้")


def doc_register_defaults(cur, ctx, new):
    r = cur.execute("SELECT confidential, form_code FROM dbo.doc_types WHERE id = ?", new.get("type_id")).fetchone()
    c, fc = (r[0], r[1]) if r else (None, None)
    new["confidential"] = bool(new.get("confidential")) or bool(c)
    if new.get("form_code") is None:
        new["form_code"] = fc


def doc_register_guard(cur, ctx, old, new):
    if any(new.get(k) != old.get(k) for k in ("doc_no", "series_code", "year", "seq")):
        raise HookError("เลขที่เอกสารที่ออกแล้วแก้ไม่ได้ — ถ้าออกผิดให้ยกเลิกแล้วออกเลขใหม่")
    if old.get("status") == "void" and new.get("status") != "void":
        raise HookError("เลขที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้")
    if old.get("confidential") and not new.get("confidential") and not ctx.has_perm("data.doc.confidential"):
        raise HookError("ปลดชั้นความลับได้เฉพาะผู้มีสิทธิ์ดูเอกสารลับ")


def doc_void_cascade(cur, ctx, old, new):
    if new.get("status") == "void" and old.get("status") != "void":
        reason = "ยกเลิกเลขในทะเบียน" + (": " + new["void_reason"] if new.get("void_reason") else "")
        cur.execute("""UPDATE dbo.hr_letters SET status = N'cancelled', cancelled_at = SYSDATETIMEOFFSET(), cancelled_by = ?,
                         cancel_reason = COALESCE(cancel_reason, ?), updated_at = SYSDATETIMEOFFSET()
                       WHERE doc_id = ? AND status <> N'cancelled'""", ctx.uid, reason, new["id"])


def _issue_token(cur, table, key_col, key_val):
    tok = new_token()
    exp = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    if _one(cur, f"SELECT COUNT(*) FROM dbo.{table} WHERE {key_col} = ?", key_val):
        cur.execute(f"UPDATE dbo.{table} SET token = ?, expires_at = ?, used_at = NULL, created_at = SYSDATETIMEOFFSET() WHERE {key_col} = ?",
                    tok, exp, key_val)
    else:
        cur.execute(f"INSERT INTO dbo.{table} ({key_col}, token, expires_at) VALUES (?, ?, ?)", key_val, tok, exp)


def ec_token_issue(cur, ctx, old, new):
    if new.get("status") == "pending" and old.get("status") != "pending":
        _issue_token(cur, "ec_sign_tokens", "contract_id", new["id"])


def exp_token_issue(cur, ctx, old, new):
    if new.get("status") == "approval" and old.get("status") != "approval":
        _issue_token(cur, "exp_approve_tokens", "invoice_id", new["id"])


EC_FREE = {"updated_at", "emp_code", "remark", "id_card"}


def emp_contracts_guard(cur, ctx, old, new):
    if ctx.flag("ec.deciding"):
        return
    if _distinct(new.get("status"), old.get("status")) and not (
            new.get("status") == "cancelled" or (old.get("status") == "rejected" and new.get("status") == "draft")):
        raise HookError("เปลี่ยนสถานะสัญญาได้ผ่านปุ่มในระบบเท่านั้น")
    if _changed(old, new, ("signer", "witness", "signed_at", "witnessed_at", "signer_id", "witness_id")):
        raise HookError("ข้อมูลการลงนามแก้ไขไม่ได้")
    locked = old.get("status") in ("pending", "signed", "cancelled")
    if locked and new.get("status") != "cancelled" and _changed(old, new, set(old) - EC_FREE):
        raise HookError("สัญญาที่ส่งลงนาม/ลงนามแล้วแก้เนื้อหาไม่ได้ — ให้ผู้ลงนามส่งกลับ หรือยกเลิกแล้วทำฉบับใหม่")
    if locked and _distinct(new.get("id_card"), old.get("id_card")) and (
            old.get("id_card") is not None or (new.get("id_card") or "")[-5:] != (old.get("id_last5") or "")):
        raise HookError("สัญญาที่ส่งลงนาม/ลงนามแล้วแก้เนื้อหาไม่ได้ — ให้ผู้ลงนามส่งกลับ หรือยกเลิกแล้วทำฉบับใหม่")


def exp_inv_guard_insert(cur, ctx, new):
    if ctx.flag("exp.flow"):
        return
    if (new.get("status") or "draft") != "draft" or new.get("inv_no") is not None or new.get("preparer") is not None or new.get("imported"):
        raise HookError("ใบใหม่ต้องเริ่มจากร่าง")


def exp_inv_guard_update(cur, ctx, old, new):
    if ctx.flag("exp.flow"):
        return
    if _changed(old, new, ("status", "inv_no", "preparer", "reviewer", "approver", "reviewer_id", "approver_id")):
        raise HookError("สถานะ เลขที่ และลายเซ็น เปลี่ยนได้ผ่านปุ่มในขั้นตอนเท่านั้น")
    if old.get("status") not in ("draft", "rejected") and _changed(
            old, new, ("vendor_id", "amount", "vat", "wht", "net", "inv_date", "wht_rate", "category")):
        raise HookError("ใบนี้ส่งตรวจแล้ว — แก้ได้เมื่อถูกส่งกลับ หรือดึงกลับเป็นร่าง")
    new["updated_at"] = now()


def exp_line_guard(cur, ctx, row):
    if ctx.flag("exp.flow"):
        return
    st = _one(cur, "SELECT status FROM dbo.exp_invoices WHERE id = ?", row.get("invoice_id"))
    if st not in ("draft", "rejected"):
        raise HookError("ใบนี้ส่งตรวจแล้ว แก้รายการไม่ได้")


def fund_approval_guard(cur, ctx, old, new):
    if ctx.flag("fund.approving"):
        return
    if _changed(old, new, ("committee", "approved_by", "approver_id", "witness")):
        raise HookError("ผู้อนุมัติ พยาน และลายเซ็นเปลี่ยนได้ผ่านปุ่มส่งลงนาม / อนุมัติเท่านั้น")
    if new.get("status") == "pending_approval" and old.get("status") != "pending_approval":
        raise HookError('ส่งให้กรรมการลงนามได้ผ่านปุ่ม "ส่งให้กรรมการลงนาม" เท่านั้น')
    if old.get("status") == "pending_approval" and new.get("status") not in ("pending_approval", "rejected", "cancelled"):
        raise HookError("รอกรรมการลงนามอยู่ — ดึงกลับก่อน หรือรอกรรมการอนุมัติ")


def fund_block_resubmit(cur, ctx, new):
    st = _one(cur, """SELECT TOP 1 status FROM dbo.fund_form_submission WHERE emp_code = ? AND status <> N'cancelled'
                      ORDER BY submitted_at DESC""", new.get("emp_code"))
    if st == "pending_approval":
        raise HookError("ALREADY_SUBMITTED")


def hr_letters_guard_insert(cur, ctx, new):
    if (new.get("status") or "draft") != "draft" or new.get("signer") is not None or new.get("approved_by") is not None \
            or (new.get("doc_id") is not None and not ctx.flag("hr_letters.fromdoc")):
        raise HookError("หนังสือใหม่ต้องเริ่มจากร่าง")


def hr_letters_guard_update(cur, ctx, old, new):
    approving = ctx.flag("hr_letters.approving")
    if not approving and (_changed(old, new, ("signer", "approved_by"))
                          or (new.get("status") == "approved" and old.get("status") != "approved")
                          or (new.get("status") == "rejected" and old.get("status") != "rejected")):
        raise HookError("อนุมัติ / ส่งกลับ ได้ผ่านปุ่มของผู้อนุมัติที่ถูกเลือกเท่านั้น")
    if old.get("status") == "pending" and new.get("status") == "pending" and _distinct(new.get("approver_id"), old.get("approver_id")):
        raise HookError("เปลี่ยนผู้อนุมัติไม่ได้ระหว่างรอ — ดึงกลับแล้วส่งใหม่")
    if _distinct(new.get("doc_id"), old.get("doc_id")) and old.get("doc_id") is not None:
        raise HookError("เลขที่หนังสือเปลี่ยนไม่ได้")
    if old.get("status") == "pending" and new.get("status") == "pending" and (
            _distinct(new.get("data"), old.get("data")) or new.get("kind") != old.get("kind")):
        raise HookError("หนังสือรออนุมัติอยู่ — ดึงกลับเป็นร่างก่อนแก้ไข")
    if old.get("status") == "approved" and (_distinct(new.get("data"), old.get("data")) or new.get("kind") != old.get("kind")
                                           or _distinct(new.get("signer"), old.get("signer"))
                                           or new.get("status") not in ("approved", "cancelled")):
        raise HookError("หนังสือที่อนุมัติแล้วแก้ไขไม่ได้ — ถ้าต้องแก้ให้ยกเลิกแล้วออกฉบับใหม่")
    if old.get("status") == "cancelled" and new.get("status") != "cancelled":
        raise HookError("หนังสือที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้")
    new["updated_at"] = now()


def log_sub_worker_insert(cur, ctx, new):
    cur.execute("INSERT INTO dbo.sub_worker_log (worker_id, action) VALUES (?, N'insert')", new["id"])


def log_sub_worker_update(cur, ctx, old, new):
    ch = {k: [old.get(k), new.get(k)] for k in new if k not in ("updated_at", "created_at") and _distinct(old.get(k), new.get(k))}
    if ch:
        cur.execute("INSERT INTO dbo.sub_worker_log (worker_id, action, changes) VALUES (?, N'update', ?)",
                    new["id"], json.dumps(ch, ensure_ascii=False, default=str))


PAF_FLOW = ("status", "doc_id", "doc_no", "steps", "cur_step", "approved_at", "movement_id", "requested_by")


def paf_guard(cur, ctx, old, new):
    if ctx.flag("paf.flow"):
        return
    if _changed(old, new, PAF_FLOW):
        raise HookError("สถานะ/เลขที่/ผู้อนุมัติ เปลี่ยนได้ผ่านปุ่มในระบบเท่านั้น")
    if old.get("status") not in ("draft", "rejected") and _changed(old, new, set(old) - {"updated_at", "ack_date"}):
        raise HookError("PAF ที่ส่งอนุมัติแล้วแก้เนื้อหาไม่ได้ — ให้ผู้อนุมัติส่งกลับ หรือยกเลิกแล้วทำฉบับใหม่")


def pr_reset_on_reupload(cur, ctx, old, new):
    if _distinct(new.get("uploaded_at"), old.get("uploaded_at")):
        cur.execute("DELETE FROM dbo.payroll_sign WHERE month = ?", new["month"])


# ---------------------------------------------------------------------------------------------- registry
# (table) → list of hooks per moment. BEFORE hooks may change `new`.

BEFORE_INSERT = {
    "contract_pay_adjust": [lambda c, x, n: block_locked_run(c, x, n)],
    "contract_pay_item": [lambda c, x, n: block_locked_run(c, x, n)],
    "doc_register": [doc_register_defaults],
    "employees": [check_manager_cycle],
    "exp_invoice_lines": [exp_line_guard],
    "exp_invoices": [exp_inv_guard_insert],
    "fund_form_submission": [fund_block_resubmit],
    "hr_letters": [hr_letters_guard_insert],
}
AFTER_INSERT = {
    "sub_workers": [log_sub_worker_insert],
    "uniform_move": [lambda c, x, n: check_uniform_balance(c, x, n.get("item_id"))],
}
BEFORE_UPDATE = {
    "contract_pay_adjust": [lambda c, x, o, n: (block_locked_run(c, x, o), block_locked_run(c, x, n))],
    "contract_pay_item": [lambda c, x, o, n: (block_locked_run(c, x, o), block_locked_run(c, x, n))],
    "contract_pay_run": [guard_contract_run],
    "doc_register": [doc_register_guard, set_updated_at],
    "emp_contracts": [emp_contracts_guard],
    "employees": [lambda c, x, o, n: check_manager_cycle(c, x, n) if _distinct(o.get("manager_code"), n.get("manager_code")) else None,
                  set_updated_at],
    "exp_invoice_lines": [lambda c, x, o, n: (exp_line_guard(c, x, o), exp_line_guard(c, x, n))],
    "exp_invoices": [exp_inv_guard_update],
    "fund_form_submission": [fund_approval_guard, set_updated_at],
    "hr_letters": [hr_letters_guard_update],
    "movements": [set_updated_at],
    "paf_forms": [paf_guard],
}
AFTER_UPDATE = {
    "doc_register": [doc_void_cascade],
    "emp_contracts": [ec_token_issue],
    "exp_invoices": [exp_token_issue],
    "payroll_period": [pr_reset_on_reupload],
    "sub_workers": [log_sub_worker_update],
    "uniform_move": [lambda c, x, o, n: (check_uniform_balance(c, x, o.get("item_id")), check_uniform_balance(c, x, n.get("item_id")))],
}
BEFORE_DELETE = {
    "contract_pay_adjust": [lambda c, x, o: block_locked_run(c, x, o)],
    "contract_pay_item": [lambda c, x, o: block_locked_run(c, x, o)],
    "exp_invoice_lines": [lambda c, x, o: exp_line_guard(c, x, o)],
}
AFTER_DELETE = {
    "uniform_move": [lambda c, x, o: check_uniform_balance(c, x, o.get("item_id"))],
}
