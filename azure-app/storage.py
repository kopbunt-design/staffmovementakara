"""
Files (attachments, signatures, seal) on the Storage account IT prepared, through the app.

  • the app reads/writes blobs with its own managed identity (role "Storage Blob Data Contributor") — no keys
  • each Supabase bucket is a blob container of the same name
  • who may read/write which file = the Supabase storage policies, checked here
  • "signed URLs" point back to this app (/api/file?...) with an HMAC that expires after an hour; the HMAC key is
    generated on first use and kept in the database (table app_keys), never in code or settings
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from urllib.parse import quote, urlencode

ACCOUNT = os.environ.get("AZURE_STORAGE_ACCOUNT", "akarahr2")
BUCKETS = ("movement-docs", "letter-assets", "expense-files", "doc-files")
_svc = None


def service():
    global _svc
    if _svc is None:
        from azure.identity import ManagedIdentityCredential
        from azure.storage.blob import BlobServiceClient
        _svc = BlobServiceClient(f"https://{ACCOUNT}.blob.core.windows.net", credential=ManagedIdentityCredential())
    return _svc


def container(bucket):
    if bucket not in BUCKETS:
        raise PermissionError("unknown bucket")
    c = service().get_container_client(bucket)
    try:
        c.create_container()
    except Exception:
        pass   # already exists
    return c


def put(bucket, path, data: bytes, content_type: str, overwrite: bool):
    from azure.storage.blob import ContentSettings
    container(bucket).upload_blob(path, data, overwrite=overwrite, content_settings=ContentSettings(content_type=content_type))


def get(bucket, path):
    b = container(bucket).get_blob_client(path)
    d = b.download_blob()
    return d.readall(), (d.properties.content_settings.content_type or "application/octet-stream")


def remove(bucket, path):
    try:
        container(bucket).delete_blob(path)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- who may do what (Supabase storage policies)

SIG_WRITE = ("data.letters.approve", "data.fundforms.write", "data.fundforms.approve", "data.expense.write", "data.expense.review",
             "data.expense.approve", "data.contract.approve", "data.empcontract.sign")
LA_READ = ("data.letters.write", "data.letters.approve", "page.fundforms", "page.expense", "page.contractpay", "data.contract.approve",
           "data.empcontract.write", "data.empcontract.sign")


def _doc_visible(ctx, cur, path):
    first = path.split("/")[0]
    if not first.isdigit():
        return False
    r = cur.execute("SELECT confidential FROM dbo.doc_register WHERE id = ?", int(first)).fetchone()
    return bool(r) and ctx.has_perm("page.docregister") and (not r[0] or ctx.has_perm("data.doc.confidential"))


def allowed(ctx, cur, bucket, path, op):
    """op = read | write | delete"""
    if not ctx.uid:
        return False
    role = cur.execute("SELECT dbo.my_role()").fetchone()[0]
    parts = path.split("/")
    if bucket == "movement-docs":
        return True if op == "read" else role in ("hr", "admin")
    if bucket == "expense-files":
        return ctx.has_perm("page.expense" if op == "read" else "data.expense.write")
    if bucket == "doc-files":
        return _doc_visible(ctx, cur, path) and (op == "read" or ctx.has_perm("data.docregister.write"))
    if bucket == "letter-assets":
        if op == "read":
            return any(ctx.has_perm(p) for p in LA_READ)
        if parts[0] == "seal":
            return ctx.has_perm("data.letters.approve")
        if parts[0] == "signatures":
            return role == "admin" or (len(parts) > 1 and parts[1] == str(ctx.uid) and any(ctx.has_perm(p) for p in SIG_WRITE))
    return False


# ---------------------------------------------------------------- signed links back to this app

def _key(cur):
    cur.execute("""IF OBJECT_ID('dbo.app_keys') IS NULL
                   CREATE TABLE dbo.app_keys (name NVARCHAR(100) NOT NULL PRIMARY KEY, value NVARCHAR(200) NOT NULL)""")
    r = cur.execute("SELECT value FROM dbo.app_keys WHERE name = N'file_link'").fetchone()
    if r:
        return r[0].encode()
    v = secrets.token_hex(32)
    cur.execute("INSERT INTO dbo.app_keys (name, value) VALUES (N'file_link', ?)", v)
    cur.connection.commit()
    return v.encode()


def sign_url(cur, bucket, path, seconds=3600, download=None):
    exp = int(time.time()) + seconds
    msg = f"{bucket}\n{path}\n{exp}".encode()
    sig = hmac.new(_key(cur), msg, hashlib.sha256).hexdigest()
    q = {"b": bucket, "p": path, "e": exp, "s": sig}
    if download:
        q["d"] = download if isinstance(download, str) else path.rsplit("/", 1)[-1]
    return "/api/file?" + urlencode(q, quote_via=quote)


def check_signed(cur, bucket, path, exp, sig):
    if int(exp) < time.time():
        return False
    good = hmac.new(_key(cur), f"{bucket}\n{path}\n{int(exp)}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(good, sig or "")
