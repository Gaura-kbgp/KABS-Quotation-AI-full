-- ============================================================
-- Multi-tenant migration, STEP 6: usage events (Phase 6)
-- Tracks which dealer/user used which tool, for the Super Admin's
-- Usage page. Run in Supabase SQL Editor after 001. Safe to re-run.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.usage_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    profile_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_email TEXT,
    event_type  TEXT NOT NULL,
    -- 'manufacturer.create' | 'file.spec_upload' | 'file.pricing_upload' |
    -- 'file.nkba_upload' | 'drawing.upload' | 'bom.generate'
    details     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_org_created ON public.usage_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_type ON public.usage_events (event_type);

-- Server-only (service-role key); no anon/authenticated policies.
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

COMMIT;
