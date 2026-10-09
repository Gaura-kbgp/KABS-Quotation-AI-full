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

from app.core.supabase_client import current_org_id, get_supabase_admin

DOCS_BUCKET = "manufacturer-docs"
TRAINING_BUCKET = "training-docs"

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
    if org and not path.startswith(f"{org}/"):
        raise PermissionError(f"Refusing cross-tenant storage access: {path}")


def download_bytes(url_or_path: str, bucket: str = DOCS_BUCKET) -> bytes:
    path = extract_path(url_or_path, bucket)
    if not path:
        raise FileNotFoundError(f"No storage object for: {url_or_path!r}")
    _check_tenant(path)
    return get_supabase_admin().storage.from_(bucket).download(path)
