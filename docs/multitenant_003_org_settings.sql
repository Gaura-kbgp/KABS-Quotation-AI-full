-- ============================================================
-- Multi-tenant migration, STEP 3: per-company settings (Phase 4)
-- Run in Supabase SQL Editor after 001. Purely additive; safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS default_markup_percent NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS tax_percent NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS proposal_terms TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMIT;
