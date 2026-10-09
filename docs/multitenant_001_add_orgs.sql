-- ============================================================
-- Multi-tenant migration, STEP 1 of 2: add organizations + org_id
-- Run in Supabase SQL Editor. BACK UP YOUR DATA FIRST.
--
-- Safe to run while the current app is live:
--   * purely additive (new tables, new columns, indexes)
--   * every existing row is assigned to the "KABS" organization
--   * org_id gets DEFAULT = KABS org, so the old code (which does not
--     send org_id yet) keeps working until Phase 3 is deployed
--
-- Idempotent: can be re-run. Run STEP 2 only AFTER Phase 3 code is live.
-- ============================================================

BEGIN;

-- 1. ORGANIZATIONS (one row per dealer/company; KABS is the owner org)
CREATE TABLE IF NOT EXISTS public.organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended')),
    is_owner    BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE only for KABS
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one owner org may exist
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_single_owner
    ON public.organizations (is_owner) WHERE is_owner;

-- Fixed id so migrations and defaults can reference it
INSERT INTO public.organizations (id, name, is_owner)
VALUES ('00000000-0000-0000-0000-0000000000a1'::uuid, 'KABS', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 2. PROFILES (maps a Google account to an org + role)
CREATE TABLE IF NOT EXISTS public.profiles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_sub    TEXT UNIQUE,            -- Google account id; NULL until the pre-created user first signs in
    email         TEXT NOT NULL,
    org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('super_admin', 'dealer_admin')),
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('invited', 'active', 'disabled')),
    password_hash TEXT,                   -- scrypt hash; NULL for Google-only accounts
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    token_version INTEGER NOT NULL DEFAULT 0,  -- bump to sign the user out everywhere
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (safe if profiles already existed from an earlier run of this script)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- One-time tokens for "verify your email" and "reset your password" links.
-- Only a SHA-256 hash of the token is stored.
CREATE TABLE IF NOT EXISTS public.auth_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_profile ON public.auth_tokens (profile_id, kind);

-- Emails are matched case-insensitively (Google sign-in vs. invite)
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_email_lower
    ON public.profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_org ON public.profiles (org_id);

-- Super admins must belong to the KABS owner org; dealer admins must not
-- (enforced by trigger because CHECK cannot read other tables)
CREATE OR REPLACE FUNCTION public.profiles_check_role_org() RETURNS trigger AS $$
DECLARE owner_org BOOLEAN;
BEGIN
    SELECT is_owner INTO owner_org FROM public.organizations WHERE id = NEW.org_id;
    IF NEW.role = 'super_admin' AND NOT owner_org THEN
        RAISE EXCEPTION 'super_admin must belong to the owner organization';
    END IF;
    IF NEW.role = 'dealer_admin' AND owner_org THEN
        RAISE EXCEPTION 'dealer_admin cannot belong to the owner organization';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_check_role_org ON public.profiles;
CREATE TRIGGER trg_profiles_check_role_org
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.profiles_check_role_org();

-- 2b. If an earlier version of this script already created profiles.firebase_uid, rename it
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='profiles' AND column_name='firebase_uid')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='profiles' AND column_name='google_sub') THEN
        ALTER TABLE public.profiles RENAME COLUMN firebase_uid TO google_sub;
    END IF;
END $$;

-- 3. ADD org_id TO EVERY TENANT-OWNED TABLE
--    Existing rows are backfilled to KABS via the column DEFAULT.
--    Tables that do not exist in your database are skipped.
--    NOT shared/global: manufacturer_research (AI cache, super admin only).
DO $$
DECLARE
    t TEXT;
    kabs CONSTANT UUID := '00000000-0000-0000-0000-0000000000a1'::uuid;
    tenant_tables TEXT[] := ARRAY[
        'manufacturers',
        'manufacturer_files',
        'manufacturer_pricing',
        'manufacturer_specifications',
        'labor_charges',
        'install_rules',
        'install_rule_overrides',
        'nkba_files',
        'training_documents',
        'quotation_projects',
        'quotation_boms',
        'manufacturer_detections'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'Skipping % (table not found)', t;
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS org_id UUID '
            'NOT NULL DEFAULT %L REFERENCES public.organizations(id) ON DELETE CASCADE',
            t, kabs);

        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id)',
            'idx_' || t || '_org', t);

        RAISE NOTICE 'org_id added to %', t;
    END LOOP;
END $$;

-- 4. COMPOSITE INDEXES for the hot paths (44k+ pricing rows)
DO $$
BEGIN
    IF to_regclass('public.manufacturer_pricing') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_mfg_pricing_org_mfg
            ON public.manufacturer_pricing (org_id, manufacturer_id);
    END IF;
    IF to_regclass('public.quotation_projects') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_quotation_projects_org_created
            ON public.quotation_projects (org_id, created_at DESC);
    END IF;
END $$;

-- 5. Keep the new tables closed to the public API from day one
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_tokens   ENABLE ROW LEVEL SECURITY;
-- (no policies = anon/authenticated denied; only the server's service-role key can access)

COMMIT;

-- ============================================================
-- AFTER RUNNING: bootstrap the first Super Admin.
-- Replace the email with the real KABS admin Google/email account.
-- google_sub is filled automatically on first Google sign-in (Phase 2).
--
-- INSERT INTO public.profiles (email, org_id, role, status)
-- VALUES ('you@kabs.com', '00000000-0000-0000-0000-0000000000a1'::uuid, 'super_admin', 'invited');
-- (then sign in with Google using that email, or sign up with email+password and verify it)
-- ============================================================

-- VERIFY (every count should equal the table's total rows; mismatches = 0):
-- SELECT 'manufacturers' t, count(*) total, count(*) FILTER (WHERE org_id = '00000000-0000-0000-0000-0000000000a1'::uuid) kabs FROM manufacturers
-- UNION ALL SELECT 'manufacturer_pricing', count(*), count(*) FILTER (WHERE org_id = '00000000-0000-0000-0000-0000000000a1'::uuid) FROM manufacturer_pricing
-- UNION ALL SELECT 'quotation_projects', count(*), count(*) FILTER (WHERE org_id = '00000000-0000-0000-0000-0000000000a1'::uuid) FROM quotation_projects;
