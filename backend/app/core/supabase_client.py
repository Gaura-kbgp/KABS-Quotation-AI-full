"""
Supabase access for the backend.

`get_supabase()` returns a TENANT-SCOPED client: every query on a tenant-owned
table is automatically limited to the signed-in user's company (org_id), and
every insert/upsert is stamped with that org_id. So a query can never read,
change or delete another company's rows, even if a request passes a foreign id.

`get_supabase_admin()` is the raw service-role client. Use it only for
platform tables (profiles, organizations, auth_tokens) and Super Admin jobs.
"""
import os
from contextvars import ContextVar
from typing import Optional

from supabase import create_client, Client

# Set by app.core.auth.get_current_user for the duration of a request.
current_org_id: ContextVar[Optional[str]] = ContextVar("current_org_id", default=None)

# Tables whose rows belong to one company. Keep in sync with
# docs/multitenant_001_add_orgs.sql. (manufacturer_research is a shared AI cache.)
TENANT_TABLES = {
    "manufacturers",
    "manufacturer_files",
    "manufacturer_pricing",
    "manufacturer_specifications",
    "labor_charges",
    "install_rules",
    "install_rule_overrides",
    "nkba_files",
    "quotation_projects",
    "quotation_boms",
    "elevate_pricing_profiles",
    "manufacturer_detections",
    "usage_events",
}

# Super Admin's org — the platform's shared manufacturer catalog (brands,
# spec/pricing files, per-SKU pricing) is curated here and read-only visible
# to every other org, instead of each dealer re-uploading the same catalog.
# Keep in sync with frontend/src/lib/db.ts (PLATFORM_ORG_ID) and
# backend/app/core/storage.py (_check_tenant).
PLATFORM_ORG_ID = "00000000-0000-0000-0000-0000000000a1"

SHARED_CATALOG_TABLES = {
    "manufacturers",
    "manufacturer_files",
    "manufacturer_pricing",
    "manufacturer_specifications",
}


def get_supabase_admin() -> Client:
    url = os.getenv("SUPABASE_URL")
    # Check for service role key or a generic key
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise Exception("Supabase credentials missing in backend environment (Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY)")

    try:
        return create_client(url, key)
    except Exception as e:
        print(f"DEBUG: Supabase client creation failed ({e})")
        raise


def _stamp(rows, org_id: str):
    if isinstance(rows, list):
        return [{**r, "org_id": org_id} for r in rows]
    return {**rows, "org_id": org_id}


class _ScopedTable:
    """A table handle that always filters/stamps by org_id."""

    def __init__(self, table, org_id: str, share_read: bool = False):
        self._t = table
        self._org = org_id
        self._share_read = share_read

    def select(self, *a, **k):
        q = self._t.select(*a, **k)
        if self._share_read and self._org != PLATFORM_ORG_ID:
            return q.or_(f"org_id.eq.{self._org},org_id.eq.{PLATFORM_ORG_ID}")
        return q.eq("org_id", self._org)

    def update(self, *a, **k):
        return self._t.update(*a, **k).eq("org_id", self._org)

    def delete(self, *a, **k):
        return self._t.delete(*a, **k).eq("org_id", self._org)

    def insert(self, rows, *a, **k):
        return self._t.insert(_stamp(rows, self._org), *a, **k)

    def upsert(self, rows, *a, **k):
        return self._t.upsert(_stamp(rows, self._org), *a, **k)


class ScopedClient:
    """Drop-in for the supabase Client, locked to one company."""

    def __init__(self, raw: Client, org_id: str):
        self._raw = raw
        self.org_id = org_id

    def table(self, name: str):
        t = self._raw.table(name)
        if name not in TENANT_TABLES:
            return t
        return _ScopedTable(t, self.org_id, share_read=name in SHARED_CATALOG_TABLES)

    from_ = table

    @property
    def storage(self):
        return self._raw.storage

    def rpc(self, *a, **k):
        return self._raw.rpc(*a, **k)


def get_supabase() -> ScopedClient:
    org = current_org_id.get()
    if not org:
        # Fail closed: never fall back to unscoped access.
        raise RuntimeError("get_supabase() called without a signed-in company context")
    return ScopedClient(get_supabase_admin(), org)
