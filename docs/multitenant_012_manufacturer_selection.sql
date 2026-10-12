-- ============================================================
-- Migration 012: manufacturer_org_hidden
-- Lets a dealer org hide manufacturers from Super Admin's shared
-- catalog (see PLATFORM_ORG_ID in frontend/src/lib/db.ts) that they
-- don't quote with, without affecting any other org. Presence of a
-- row = hidden for that org; absence = visible (the default — every
-- org starts out seeing the full shared catalog).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.manufacturer_org_hidden (
    org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    manufacturer_id UUID NOT NULL REFERENCES public.manufacturers(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (org_id, manufacturer_id)
);

CREATE INDEX IF NOT EXISTS moh_org_idx ON public.manufacturer_org_hidden (org_id);

ALTER TABLE public.manufacturer_org_hidden ENABLE ROW LEVEL SECURITY;

COMMIT;
