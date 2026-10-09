-- ============================================================
-- Multi-tenant migration, STEP 9: authorized signature (Step 3 of onboarding)
-- Signatures are private (they authorize documents). Served via signed URLs only.
-- Safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signature_path TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signature_method TEXT
    CHECK (signature_method IN ('drawn', 'uploaded'));

INSERT INTO storage.buckets (id, name, public)
VALUES ('company-signatures', 'company-signatures', false)
ON CONFLICT (id) DO UPDATE SET public = false;

COMMIT;
