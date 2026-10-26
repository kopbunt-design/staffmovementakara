"""
Port of the Supabase Edge Function `letter-notify`: approval e-mails through Microsoft Graph, plus the temporary
file/signature links the no-login approval pages need.

  • Graph app: GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET (Key Vault reference) — App Service settings
  • sender mailbox: MAIL_SENDER setting (falls back to mail_settings.sender)
  • mail_settings.mode = 'outlook' → nothing is sent (HR sends .eml themselves), exactly as before
  • a signed-in caller must be able to read the record (row security) to trigger mail about it;
    the *_token paths work without login but only within 30 minutes after that token was used
  • no salary figures in any e-mail
"""
from __future__ import annotations

import html as H
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import db
import rest
import storage

KIND = {"cert_th": "หนังสือรับรองการทำงาน (ภาษาไทย)", "cert_en": "Certificate of Employment (EN)",
        "salary_th": "หนังสือรับรองเงินเดือน (ภาษาไทย)", "salary_en": "Salary Certificate (EN)", "offer_en": "Offer Letter"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


class Fail(Exception):
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.status = status


def esc(s):
    return H.escape(str(s if s is not None else ""), quote=True)


def lst(s):
    out = []
    for x in re.split(r"[,;\s]+", str(s or "")):
        x = x.strip().lower()
        if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", x) and x not in out:
            out.append(x)
    return out


def fill(tpl, v, html):
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda m: esc(v.get(m.group(1), "")) if html else str(v.get(m.group(1), "")), tpl or "")


def _ts(v):
    return datetime.fromisoformat(str(v)) if v else None


def _fresh_use(t):
    """token was used within the last 30 minutes (the approval page calls right after deciding)"""
    u = _ts(t.get("used_at")) if t else None
    return bool(u) and (datetime.now(timezone.utc) - u).total_seconds() <= 1800


def _live(t):
    return t and not t.get("used_at") and _ts(t["expires_at"]) > datetime.now(timezone.utc)


def one(cur, table, where, *a):
    r = db.rows(cur.execute(f"SELECT TOP 1 * FROM dbo.[{table}] WHERE {where}", *a))
    return db.decode_row(table, r[0]) if r else None


def handle(admin_cn, user_cn, uid, email, body, app_url):
    """admin_cn bypasses row security; user_cn is the caller's own connection (None without login)."""
    A = admin_cn.cursor()
    U = user_cn.cursor() if user_cn else None
    UC = rest.Ctx(U, uid) if U else None
    action = body.get("action")
    sign = lambda bucket, path: storage.sign_url(A, bucket, path) if path else None

    # ---------------- file / signature links for the approval pages
    if body.get("exp_token") and action == "exp_files":
        t = one(A, "exp_approve_tokens", "token = ?", str(body["exp_token"]))
        if not t or _ts(t["expires_at"]) <= datetime.now(timezone.utc):
            raise Fail("ลิงก์ไม่ถูกต้องหรือหมดอายุ", 403)
        x = one(A, "exp_invoices", "id = ?", t["invoice_id"]) or {}
        fs = db.rows(A.execute("SELECT id, name, path FROM dbo.exp_files WHERE invoice_id = ?", t["invoice_id"]))
        return {"files": [{"id": f["id"], "url": sign("expense-files", f["path"])} for f in fs],
                "sig": {k: sign("letter-assets", (x.get(k) or {}).get("signature_path")) for k in ("preparer", "reviewer", "approver")}}
    if body.get("ec_token") and action == "ec_files":
        t = one(A, "ec_sign_tokens", "token = ?", str(body["ec_token"]))
        if not t or _ts(t["expires_at"]) <= datetime.now(timezone.utc):
            raise Fail("ลิงก์ไม่ถูกต้องหรือหมดอายุ", 403)
        c = one(A, "emp_contracts", "id = ?", t["contract_id"]) or {}
        return {"sig": {k: sign("letter-assets", (c.get(k) or {}).get("signature_path")) for k in ("signer", "witness")}}
    if body.get("pr_token") and action == "pr_files":
        t = one(A, "payroll_sign_tokens", "token = ?", str(body["pr_token"]))
        if not t or _ts(t["expires_at"]) <= datetime.now(timezone.utc):
            raise Fail("ลิงก์ไม่ถูกต้องหรือหมดอายุ", 403)
        r = one(A, "payroll_sign", "month = ?", t["month"]) or {}
        return {"sig": {str(s["step"]): sign("letter-assets", s.get("signature_path")) for s in r.get("steps") or []}}

    tokened = any(body.get(k) for k in ("exp_token", "ec_token", "paf_token", "pr_token"))
    if not tokened and not uid:
        raise Fail("Invalid session", 401)
    if body.get("pr_month") and action == "pr_files":
        r = one(U, "payroll_sign", "month = ? AND " + (rest.rule_filter(UC, "payroll_sign", "read") or "1 = 1"), str(body["pr_month"])) if U else None
        if not r:
            raise Fail("ไม่พบ หรือไม่มีสิทธิ์", 403)
        return {"sig": {str(s["step"]): sign("letter-assets", s.get("signature_path")) for s in r.get("steps") or []}}

    ms = one(A, "mail_settings", "id = 1") or {}
    cfg = {"tenant": os.environ.get("GRAPH_TENANT_ID") or ms.get("tenant_id"),
           "client": os.environ.get("GRAPH_CLIENT_ID") or ms.get("client_id"),
           "secret": os.environ.get("GRAPH_CLIENT_SECRET"),
           "sender": os.environ.get("MAIL_SENDER") or ms.get("sender")}
    if action != "test" and ms.get("mode") != "auto":
        return {"sent": False, "reason": "outlook_mode"}
    if not all(cfg.values()):
        return {"sent": False, "reason": "not_configured",
                "detail": "ขาด " + ", ".join(k for k, v in cfg.items() if not v) + " (ตั้งใน App Service → Environment variables)"}

    def name_of(u):
        if not u:
            return {"name": "", "email": ""}
        s = one(A, "letter_signers", "user_id = ?", u) or {}
        ur = one(A, "user_roles", "user_id = ?", u) or {}
        return {"name": s.get("name_th") or s.get("name_en") or ur.get("name") or ur.get("email") or "",
                "email": s.get("email") or ur.get("email") or ""}

    out = {"to": "", "subject": "", "html": "", "extra": [], "cc": []}

    def tpl(key, v):
        t = one(A, "mail_templates", "[key] = ?", key)
        if not t:
            return False
        out.update(subject=fill(t["subject"], v, False), html=fill(t["html"], v, True), extra=lst(t.get("to_extra")), cc=lst(t.get("cc")))
        return True

    def read_as_caller(table, where, *a):
        rf = rest.rule_filter(UC, table, "read")   # same visibility as the site
        x = one(U, table, where + (f" AND {rf}" if rf else ""), *a) if U else None
        if not x:
            raise Fail("ไม่พบ หรือไม่มีสิทธิ์", 403)
        return x

    if body.get("exp_id") or body.get("exp_token"):
        if body.get("exp_token"):
            t = one(A, "exp_approve_tokens", "token = ?", str(body["exp_token"]))
            if not _fresh_use(t):
                raise Fail("ลิงก์ไม่ถูกต้องหรือหมดเวลาแจ้งผล", 403)
            x = one(A, "exp_invoices", "id = ?", t["invoice_id"])
            action = {"approved": "exp_approved", "rejected": "exp_rejected"}.get(x.get("status"), "")
            if not action:
                raise Fail("ใบนี้ไม่ได้อยู่ในสถานะที่ต้องแจ้ง")
        else:
            x = read_as_caller("exp_invoices", "id = ?", body["exp_id"])
        ln = db.rows(A.execute("SELECT TOP 1 detail FROM dbo.exp_invoice_lines WHERE invoice_id = ? ORDER BY line_no", x["id"]))
        prep, rev, appr = name_of(x.get("prepared_by")), name_of(x.get("reviewer_id")), name_of(x.get("approver_id"))
        if action == "exp_review":
            if x["status"] != "review":
                raise Fail("ใบนี้ไม่ได้รอตรวจ")
            out["to"] = rev["email"]
        elif action == "exp_approve":
            if x["status"] != "approval":
                raise Fail("ใบนี้ไม่ได้รออนุมัติ")
            out["to"] = appr["email"]
        elif action in ("exp_approved", "exp_rejected"):
            out["to"] = prep["email"]
        else:
            raise Fail("action ไม่ถูกต้อง")
        by_approver = x.get("reviewed_at") and x.get("submitted_at") and _ts(x["reviewed_at"]) > _ts(x["submitted_at"])
        decider = (appr if by_approver else rev)["name"] if action == "exp_rejected" else appr["name"]
        link = f"{app_url}/expense/#/invoice/{x['id']}"
        if action == "exp_approve":
            t = one(A, "exp_approve_tokens", "invoice_id = ?", x["id"])
            if _live(t):
                link = f"{app_url}/expense/approve.html?t={t['token']}"
        money = f"{float(x.get('net') or 0):,.2f} บาท"
        if not tpl(action, {"doc_no": x.get("inv_no") or "", "person": (x.get("vendor") or {}).get("name") or "",
                            "kind": (ln[0]["detail"] if ln else None) or x.get("category") or "", "emp_code": money, "link": link,
                            "reason": x.get("reject_reason") or "-", "requester": rev["name"] if action == "exp_approve" else prep["name"],
                            "approver": decider}):
            return {"sent": False, "reason": "no_template"}
        if action == "exp_approve" and "approve.html" in link:
            out.update(extra=[], cc=[])
    elif body.get("ec_id") or body.get("ec_token"):
        who = body.get("role")
        if body.get("ec_token"):
            t = one(A, "ec_sign_tokens", "token = ?", str(body["ec_token"]))
            if not _fresh_use(t):
                raise Fail("ลิงก์ไม่ถูกต้องหรือหมดเวลาแจ้งผล", 403)
            c = one(A, "emp_contracts", "id = ?", t["contract_id"])
            action = ("ec_signed" if c["status"] == "signed" else "ec_rejected" if c["status"] == "rejected"
                      else "ec_sign" if c["status"] == "pending" and not c.get("witnessed_at") else "")
            who = "witness"
            if not action:
                raise Fail("สัญญานี้ไม่ได้อยู่ในสถานะที่ต้องแจ้ง")
        else:
            c = read_as_caller("emp_contracts", "id = ?", body["ec_id"])
        sg, wt, rq = name_of(c.get("signer_id")), name_of(c.get("witness_id")), name_of(c.get("requested_by"))
        link = f"{app_url}/?econtract={c['id']}"
        if action == "ec_sign":
            if c["status"] != "pending":
                raise Fail("สัญญาไม่ได้รอลงนาม")
            who = who or ("signer" if not c.get("signed_at") else "witness")
            if who == "signer":
                if c.get("signed_at"):
                    raise Fail("ผู้แทนบริษัทลงนามแล้ว")
                out["to"] = sg["email"]
                t = one(A, "ec_sign_tokens", "contract_id = ?", c["id"])
                if _live(t):
                    link = f"{app_url}/econtract/sign.html?t={t['token']}"
            else:
                if c.get("witnessed_at"):
                    raise Fail("พยานลงนามแล้ว")
                out["to"] = wt["email"]
        elif action in ("ec_signed", "ec_rejected"):
            out["to"] = c.get("requested_email") or rq["email"]
        else:
            raise Fail("action ไม่ถูกต้อง")
        me = sg if body.get("ec_token") else name_of(uid)
        if not tpl(action, {"doc_no": "", "kind": f"สัญญาจ้างงาน · {c.get('position_th') or ''}", "person": f"{c.get('title_th') or ''}{c.get('name_th') or ''}",
                            "emp_code": f"เริ่มงาน {c['start_date']}" if c.get("start_date") else "", "link": link,
                            "reason": c.get("reject_reason") or "-", "requester": rq["name"],
                            "approver": (sg if who == "signer" else wt)["name"] if action == "ec_sign" else me["name"]}):
            return {"sent": False, "reason": "no_template"}
        if "/econtract/sign.html" in link:
            out.update(extra=[], cc=[])
    elif body.get("pr_month") or body.get("pr_token"):
        if body.get("pr_token"):
            t = one(A, "payroll_sign_tokens", "token = ?", str(body["pr_token"]))
            if not _fresh_use(t):
                raise Fail("ลิงก์ไม่ถูกต้องหรือหมดเวลาแจ้งผล", 403)
            r = one(A, "payroll_sign", "month = ?", t["month"])
            action = {"approved": "pr_approved", "rejected": "pr_rejected", "pending": "pr_request"}.get(r.get("status"), "")
            if not action:
                raise Fail("รายงานไม่ได้อยู่ในสถานะที่ต้องแจ้ง")
        else:
            r = read_as_caller("payroll_sign", "month = ?", str(body["pr_month"]))
        steps = sorted(r.get("steps") or [], key=lambda s: int(s.get("step") or 0))
        cur = next((s for s in steps if s.get("step") == r.get("cur_step")), {})
        first = steps[0] if steps else {}
        y, m = map(int, str(r["month"]).split("-"))
        period = f"{MONTHS[m - 1]} {y}"
        box = lambda b: (f'<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#101828">{b}'
                         '<p style="color:#667085;font-size:12px;margin-top:18px">ส่งอัตโนมัติจากระบบ HR (Staff Movement) · อีเมลนี้ไม่มีตัวเลขเงินเดือน</p></div>')
        if action == "pr_request":
            if r["status"] != "pending":
                raise Fail("รายงานนี้ไม่ได้รอลงนาม")
            t = one(A, "payroll_sign_tokens", "month = ? AND step = ?", r["month"], r["cur_step"])
            if not _live(t):
                raise Fail("ลิงก์ของขั้นนี้หมดอายุ — กดออกลิงก์ใหม่ในระบบ")
            link = f"{app_url}/payroll/sign.html?t={t['token']}"
            out["to"] = cur.get("email") or ""
            out["subject"] = f"[Payroll Register] {period} — ขอให้ลงนาม ({cur.get('role') or 'Step ' + str(r['cur_step'])})"
            out["html"] = box(f"""<p>เรียน {esc(cur.get('name'))}</p>
              <p>Payroll Register งวด <b>{esc(period)}</b> รอท่านลงนามในช่อง <b>{esc(cur.get('role') or '')}</b><br>
              Payroll Register for <b>{esc(period)}</b> is awaiting your signature as <b>{esc(cur.get('role') or '')}</b>.</p>
              <p><a href="{esc(link)}" style="display:inline-block;background:#1A3E9A;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">เปิดรายงานและลงนาม · Review &amp; sign</a></p>
              <p style="font-size:12px;color:#667085">ลิงก์นี้สำหรับท่านคนเดียว ใช้ได้ครั้งเดียว ภายใน 14 วัน · ส่งโดย {esc(first.get('name') or '')}</p>""")
        elif action in ("pr_approved", "pr_rejected"):
            ok = action == "pr_approved"
            out["to"] = first.get("email") or ""
            out["subject"] = f"[Payroll Register] {period} — {'ลงนามครบแล้ว' if ok else 'ถูกส่งกลับ'}"
            out["html"] = box(f"""<p>Payroll Register งวด <b>{esc(period)}</b> {'ลงนามครบทุกช่องแล้ว — พิมพ์/ดาวน์โหลดฉบับที่มีลายเซ็นได้ในระบบ' if ok
                              else 'ถูกส่งกลับ เหตุผล: <b>' + esc(r.get('reject_reason') or '-') + '</b>'}</p>
              <p><a href="{esc(app_url + '/')}">เข้าสู่ระบบ</a> → Payroll → สร้าง Payroll Register → เปิดเดือน {esc(r['month'])}</p>""")
        else:
            raise Fail("action ไม่ถูกต้อง")
    elif body.get("paf_id") or body.get("paf_token"):
        if body.get("paf_token"):
            t = one(A, "paf_tokens", "token = ?", str(body["paf_token"]))
            if not _fresh_use(t):
                raise Fail("ลิงก์ไม่ถูกต้องหรือหมดเวลาแจ้งผล", 403)
            f = one(A, "paf_forms", "id = ?", t["paf_id"])
            action = {"approved": "paf_approved", "rejected": "paf_rejected", "pending": "paf_request"}.get(f.get("status"), "")
            if not action:
                raise Fail("PAF นี้ไม่ได้อยู่ในสถานะที่ต้องแจ้ง")
        else:
            f = read_as_caller("paf_forms", "id = ?", body["paf_id"])
        cur = next((s for s in f.get("steps") or [] if s.get("step") == f.get("cur_step")), {})
        lg = db.rows(A.execute("SELECT TOP 1 actor_name FROM dbo.paf_log WHERE paf_id = ? ORDER BY at DESC", f["id"]))
        link = f"{app_url}/?paf={f['id']}"
        if action == "paf_request":
            if f["status"] != "pending":
                raise Fail("PAF ไม่ได้รออนุมัติ")
            out["to"] = cur.get("email") or ""
            t = one(A, "paf_tokens", "paf_id = ? AND step = ?", f["id"], f.get("cur_step"))
            if _live(t):
                link = f"{app_url}/paf/approve.html?t={t['token']}"
        elif action in ("paf_approved", "paf_rejected"):
            out["to"] = f.get("requested_email") or ""
        else:
            raise Fail("action ไม่ถูกต้อง")
        if not tpl(action, {"doc_no": f.get("doc_no") or "", "kind": f.get("subject_th") or "Personnel Action Form", "person": f.get("name_th") or "",
                            "emp_code": f"({f.get('emp_code')})", "link": link, "reason": f.get("reject_reason") or "-",
                            "requester": f.get("requested_name") or "",
                            "approver": cur.get("name_th") or "" if action == "paf_request" else (lg[0]["actor_name"] if lg else "")}):
            return {"sent": False, "reason": "no_template"}
        if "/paf/approve.html" in link:
            out.update(extra=[], cc=[])
    elif body.get("fund_id"):
        f = read_as_caller("fund_form_submission", "id = ?", body["fund_id"])
        req_by, appr = name_of(f.get("approval_requested_by")), name_of(f.get("approver_id") or f.get("approved_by"))
        if action == "fund_request":
            if f["status"] != "pending_approval":
                raise Fail("คำขอไม่ได้รอกรรมการลงนาม")
            out["to"] = appr["email"]
        elif action in ("fund_approved", "fund_rejected"):
            out["to"] = req_by["email"]
        else:
            raise Fail("action ไม่ถูกต้อง")
        if not tpl(action, {"doc_no": f"#{f['id']}", "kind": "แบบฟอร์มกองทุนสำรองเลี้ยงชีพ", "person": f.get("emp_name") or "",
                            "emp_code": f"({f['emp_code']})" if f.get("emp_code") else "", "link": f"{app_url}/?fund={f['id']}",
                            "reason": f.get("approval_note") or "-", "requester": req_by["name"], "approver": appr["name"]}):
            return {"sent": False, "reason": "no_template"}
    elif action == "test":
        out.update(to=email or "", subject="ทดสอบส่งเมลจากระบบ HR",
                   html=f'<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px">ตั้งค่าการส่งอีเมลถูกต้อง — ระบบส่งเมลจาก <b>{esc(cfg["sender"])}</b> ได้แล้ว</div>')
    else:
        l = read_as_caller("hr_letters", "id = ?", body.get("letter_id"))
        rq, appr = name_of(l.get("requested_by")), name_of(l.get("approved_by") or l.get("approver_id"))
        if action == "request":
            if l["status"] != "pending":
                raise Fail("หนังสือไม่ได้อยู่ในสถานะรออนุมัติ")
            out["to"] = appr["email"]
        elif action in ("approved", "rejected"):
            out["to"] = l.get("requested_email") or rq["email"]
        else:
            raise Fail("action ไม่ถูกต้อง")
        if not tpl(action, {"doc_no": l.get("doc_no") or "", "kind": KIND.get(l.get("kind"), l.get("kind")), "person": l.get("person_name") or "",
                            "emp_code": f"({l['emp_code']})" if l.get("emp_code") else "", "link": f"{app_url}/?letter={l['id']}",
                            "reason": l.get("reject_reason") or "-", "requester": rq["name"], "approver": appr["name"]}):
            return {"sent": False, "reason": "no_template"}

    to_all = list(dict.fromkeys(lst(out["to"]) + out["extra"]))
    if not to_all:
        return {"sent": False, "reason": "no_recipient"}
    # Until the switch-over Azure is a test copy: mail goes out only when the App Service setting MAIL_LIVE=1,
    # so trying an approval on Azure never e-mails a real approver. The test button always sends (to yourself).
    if os.environ.get("MAIL_LIVE") != "1" and action != "test":
        return {"sent": False, "reason": "test_mode", "would_send_to": ", ".join(to_all)}
    cc = [x for x in out["cc"] if x not in to_all]
    failed = send(cfg, to_all, cc, out["subject"], out["html"])
    if failed:
        return failed
    return {"sent": True, "to": ", ".join(to_all) + (f" (cc {', '.join(cc)})" if cc else "")}


def send(cfg, to, cc, subject, html):
    """None when sent; otherwise {sent: False, reason, detail} — same answers the Supabase function gave,
    so the settings page shows "Tenant/Client ID/Secret ไม่ถูกต้อง" / "แอปไม่มีสิทธิ์ Mail.Send" etc."""
    tok_req = urllib.request.Request(
        f"https://login.microsoftonline.com/{cfg['tenant']}/oauth2/v2.0/token",
        data=urllib.parse.urlencode({"client_id": cfg["client"], "client_secret": cfg["secret"], "grant_type": "client_credentials",
                                     "scope": "https://graph.microsoft.com/.default"}).encode())
    try:
        tok = json.loads(urllib.request.urlopen(tok_req, timeout=20).read())["access_token"]
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            body = json.loads(body).get("error_description") or body
        except ValueError:
            pass
        return {"sent": False, "reason": "auth_error", "detail": body[:300]}
    except Exception as e:
        return {"sent": False, "reason": "auth_error", "detail": str(e)[:300]}
    msg = {"message": {"subject": subject, "body": {"contentType": "HTML", "content": html},
                       "toRecipients": [{"emailAddress": {"address": a}} for a in to],
                       "ccRecipients": [{"emailAddress": {"address": a}} for a in cc]}, "saveToSentItems": True}
    req = urllib.request.Request(f"https://graph.microsoft.com/v1.0/users/{urllib.parse.quote(cfg['sender'])}/sendMail",
                                 data=json.dumps(msg).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        return {"sent": False, "reason": "graph_error", "detail": e.read().decode(errors="replace")[:300]}
    except Exception as e:
        return {"sent": False, "reason": "graph_error", "detail": str(e)[:300]}
    return None
