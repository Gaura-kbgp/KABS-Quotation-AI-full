-- ============================================================
-- Multi-tenant migration, STEP 7: one-query client statistics (perf)
-- Replaces ~6 queries per client on the Super Admin Clients page with a
-- single read-only function. Additive; safe to re-run.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.client_stats()
RETURNS TABLE (
    org_id          UUID,
    manufacturers   BIGINT,
    spec_books      BIGINT,
    pricing_sheets  BIGINT,
    pricing_rows    BIGINT,
    projects        BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT o.id,
        (SELECT count(*) FROM manufacturers m WHERE m.org_id = o.id),
        (SELECT count(*) FROM manufacturer_files f WHERE f.org_id = o.id AND f.file_type = 'spec'),
        (SELECT count(*) FROM manufacturer_files f WHERE f.org_id = o.id AND f.file_type = 'pricing'),
        (SELECT count(*) FROM manufacturer_pricing p WHERE p.org_id = o.id),
        (SELECT count(*) FROM quotation_projects q WHERE q.org_id = o.id)
    FROM organizations o
    WHERE o.is_owner = FALSE;
$$;

-- Only the server (service role) may call it; never the public or logged-in browser roles.
REVOKE ALL ON FUNCTION public.client_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_stats() TO service_role;

COMMIT;
