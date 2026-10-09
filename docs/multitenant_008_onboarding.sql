-- ============================================================
-- Multi-tenant migration, STEP 8: company onboarding state
-- New companies start with onboarding_completed_at = NULL (must finish /setup).
-- Companies that already exist are marked complete so nobody is forced into setup.
-- Safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

UPDATE public.organizations
   SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
 WHERE onboarding_completed_at IS NULL
   AND created_at < now();

COMMIT;
