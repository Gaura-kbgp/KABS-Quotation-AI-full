-- ============================================================
-- Multi-tenant migration, STEP 10: Elevate pricing workbench (Phase A)
-- One saved pricing profile per company: its rules and its items.
-- Tenant-scoped (org_id). Safe to re-run.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.elevate_pricing_profiles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT 'Default',
    method      TEXT NOT NULL DEFAULT 'markup' CHECK (method IN ('markup', 'gp')),
    rules       JSONB NOT NULL DEFAULT '{}'::jsonb,
    items       JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS elevate_pricing_profiles_org_idx ON public.elevate_pricing_profiles (org_id);

-- Same lock-down as the other tenant tables: only the server (service role) touches it.
ALTER TABLE public.elevate_pricing_profiles ENABLE ROW LEVEL SECURITY;

COMMIT;
