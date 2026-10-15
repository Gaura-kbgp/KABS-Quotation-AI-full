"""
Storage access for the backend.

`manufacturer-docs` and `training-docs` are PRIVATE buckets. The backend
always reads files with the service-role key via `download_bytes()` —
never over HTTP — so access works regardless of bucket visibility and
never depends on a signed URL's expiry.

Stored paths look like "{org_id}/...". `_check_tenant` is defense in depth:
even if a request's own column lookup were ever bypassed, the backend still
refuses to read an object outside the caller's own company.
"""
from urllib.parse import unquote

from app.core.supabase_client import current_org_id, get_supabase_admin, PLATFORM_ORG_ID

DOCS_BUCKET = "manufacturer-docs"
TRAINING_BUCKET = "training-docs"

# Shared cap for user-uploaded catalog/pricing files. Several upload endpoints
# read the whole file into memory (`await file.read()`) with no size check at
# all before handing the bytes to PyMuPDF/pdfplumber/openpyxl/pandas — an
# oversized or maliciously crafted file (PDF decompression bomb, XLSX zip
# bomb) can exhaust server memory/CPU with no auth bypass needed, just a
# large POST from any logged-in user. Matches the limit already enforced on
# /elevate/extract-items.
MAX_UPLOAD_BYTES = 30 * 1024 * 1024  # 30 MB

# Magic-byte signatures for allowed upload types
_MAGIC: dict[str, bytes] = {
    "pdf":  b"%PDF",
    "xlsx": b"PK\x03\x04",   # ZIP-based (Office Open XML)
    "xls":  b"\xd0\xcf\x11\xe0",  # OLE2 compound document
}


def validate_upload(data: bytes, allowed: list[str], filename: str = "") -> None:
    """Raise ValueError if `data` doesn't match one of the allowed magic bytes.

    `allowed` is a list of keys from _MAGIC, e.g. ['pdf'] or ['xlsx', 'xls'].
    Always call this before passing user-supplied bytes to PyMuPDF / openpyxl
    to guard against decompression bombs and format-confusion exploits.
    """
    if len(data) < 8:
        raise ValueError("Uploaded file is too small to be valid.")
    for fmt in allowed:
        sig = _MAGIC.get(fmt)
        if sig and data[:len(sig)] == sig:
            return
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "unknown"
    raise ValueError(
        f"File type not allowed (detected extension: .{ext}). "
        f"Accepted: {', '.join('.' + f for f in allowed)}."
    )

_BROKEN = {"", "#", "local_temp", "null", "undefined", None}


def extract_path(url_or_path: str, bucket: str) -> str | None:
    """Accepts a plain storage path, a public URL, or a signed URL (legacy
    rows from before the bucket went private) and returns the object path."""
    if url_or_path in _BROKEN:
        return None
    if not url_or_path.startswith("http"):
        return url_or_path  # already a path
    for marker in (f"/object/public/{bucket}/", f"/object/sign/{bucket}/"):
        if marker in url_or_path:
            return unquote(url_or_path.split(marker, 1)[1].split("?")[0])
    return None


def _check_tenant(path: str) -> None:
    org = current_org_id.get()
    if not org:
        # Fail closed, not open: every current caller runs inside an HTTP
        # request (get_current_user sets this) or a background job that
        # explicitly re-sets it from a trusted server-side value. Returning
        # here instead of raising would silently skip tenant isolation for
        # any future code path that forgets to set it (e.g. a bare thread,
        # where Python's contextvars don't propagate automatically).
        raise PermissionError(f"Refusing storage access with no tenant context set: {path}")
    # The platform org's files are the shared manufacturer catalog (brands,
    # spec/pricing books) — every org can read them, same as the DB rows
    # that reference them (see SHARED_CATALOG_TABLES in supabase_client.py).
    if path.startswith(f"{org}/") or path.startswith(f"{PLATFORM_ORG_ID}/"):
        return
    raise PermissionError(f"Refusing cross-tenant storage access: {path}")


def download_bytes(url_or_path: str, bucket: str = DOCS_BUCKET) -> bytes:
    path = extract_path(url_or_path, bucket)
    if not path:
        raise FileNotFoundError(f"No storage object for: {url_or_path!r}")
    _check_tenant(path)
    return get_supabase_admin().storage.from_(bucket).download(path)
