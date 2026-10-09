-- ============================================================
-- Multi-tenant migration, STEP 4: private storage (Phase 3b)
--
-- Run this only after the Phase 3b app code is deployed: uploads now store
-- the storage PATH (not a public URL), the backend reads files with the
-- service-role key, and pages mint short-lived signed URLs for display.
-- This supersedes the "STEP 3: Storage" section left commented out in
-- multitenant_002_lockdown.sql.
--
-- manufacturer-docs / training-docs: pricing sheets, spec books, drawings,
-- training material — made PRIVATE.
-- company-logos: branding only, not sensitive — created PUBLIC.
-- ============================================================

BEGIN;

-- 1. New public bucket for company logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read company-logos" ON storage.objects;
CREATE POLICY "Public read company-logos" ON storage.objects
    FOR SELECT USING (bucket_id = 'company-logos');

-- 2. Make the sensitive buckets private
UPDATE storage.buckets
   SET public = FALSE
 WHERE id IN ('manufacturer-docs', 'training-docs');

-- 3. Drop their old "public read" / "anyone can write" policies.
--    Access now goes only through the server's service-role key
--    (direct download in the backend, signed URLs for the browser).
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'storage' AND tablename = 'objects'
               AND policyname IN (
                 'Public Access', 'Auth Upload', 'Auth Update', 'Auth Delete',
                 'Admin Upload', 'Admin Delete',
                 'Public Access training-docs', 'Auth Upload training-docs',
                 'Auth Update training-docs', 'Auth Delete training-docs')
    LOOP
        EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
    END LOOP;
END $$;

COMMIT;

-- VERIFY:
--   SELECT id, public FROM storage.buckets WHERE id IN ('manufacturer-docs','training-docs','company-logos');
--   -- manufacturer-docs=false, training-docs=false, company-logos=true
--
-- ROLLBACK (emergency):
--   UPDATE storage.buckets SET public = TRUE WHERE id IN ('manufacturer-docs','training-docs');
--   CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'manufacturer-docs');
--   CREATE POLICY "Public Access training-docs" ON storage.objects FOR SELECT USING (bucket_id = 'training-docs');
