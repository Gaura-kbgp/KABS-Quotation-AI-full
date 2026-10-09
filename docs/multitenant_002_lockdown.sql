-- ============================================================
-- Multi-tenant migration, STEP 2 of 2: LOCKDOWN
--
-- Phase 3 code is now deployed: every server query is company-scoped and
-- every insert is stamped with org_id. This step is safe to run once you
-- have confirmed the app works on the scoped build.
--   * org_id loses its KABS default (a forgotten org_id now fails loudly)
--   * all anon/authenticated access is removed (only the server's
--     service-role key can read/write; the browser no longer queries
--     Supabase directly)
--   * Storage buckets are NOT changed here (see STEP 3 below)
--
-- After this, the ONLY gate is server code using the service-role key,
-- so every server query must be scoped by the caller's org_id.
-- ============================================================

BEGIN;

-- 1. Remove the KABS default so a forgotten org_id fails loudly
--    instead of silently landing in KABS's data.
DO $$
DECLARE
    t TEXT;
    tenant_tables TEXT[] := ARRAY[
        'manufacturers', 'manufacturer_files', 'manufacturer_pricing',
        'manufacturer_specifications', 'labor_charges', 'install_rules',
        'install_rule_overrides', 'nkba_files', 'training_documents',
        'quotation_projects', 'quotation_boms', 'manufacturer_detections'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id DROP DEFAULT', t);
        END IF;
    END LOOP;
END $$;

-- 2. Drop EVERY existing policy ("public read", "USING (true)", etc.)
--    on the app tables, then enable RLS with no policies = deny all.
DO $$
DECLARE
    r RECORD;
    t TEXT;
    all_tables TEXT[] := ARRAY[
        'organizations', 'profiles', 'auth_tokens',
        'manufacturers', 'manufacturer_files', 'manufacturer_pricing',
        'manufacturer_specifications', 'labor_charges', 'install_rules',
        'install_rule_overrides', 'nkba_files', 'training_documents',
        'quotation_projects', 'quotation_boms', 'manufacturer_detections',
        'manufacturer_research'
    ];
BEGIN
    FOREACH t IN ARRAY all_tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

        FOR r IN SELECT policyname FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
        END LOOP;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- 3. Storage (DEFERRED): making the buckets private requires the app to serve
--    files via short-lived signed URLs instead of the public URLs stored in
--    the database (raw_pdf_url, file_url). Not implemented yet, so this step
--    stays commented out. New uploads are already stored under {org_id}/...
--
-- -- 3. Storage: make the buckets private and drop the public policies.
-- --    (Server serves files via short-lived signed URLs.)
-- UPDATE storage.buckets
--    SET public = FALSE
--  WHERE id IN ('manufacturer-docs', 'training-docs');
--
-- DO $$
-- DECLARE r RECORD;
-- BEGIN
--     FOR r IN SELECT policyname FROM pg_policies
--              WHERE schemaname = 'storage' AND tablename = 'objects'
--                AND policyname IN (
--                  'Public Access', 'Auth Upload', 'Auth Update', 'Auth Delete',
--                  'Admin Upload', 'Admin Delete',
--                  'Public Access training-docs', 'Auth Upload training-docs',
--                  'Auth Update training-docs', 'Auth Delete training-docs')
--     LOOP
--         EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
--     END LOOP;
-- END $$;

COMMIT;

-- VERIFY after running:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY 1;   -- all true
--   SELECT tablename, policyname FROM pg_policies WHERE schemaname='public';             -- no rows
--
-- ROLLBACK (emergency): re-add the defaults and public read policies, e.g.
--   ALTER TABLE public.manufacturers ALTER COLUMN org_id
--       SET DEFAULT '00000000-0000-0000-0000-0000000000a1'::uuid;   -- repeat per table
--   UPDATE storage.buckets SET public = TRUE WHERE id IN ('manufacturer-docs','training-docs');
