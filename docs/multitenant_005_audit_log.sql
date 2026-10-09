-- ============================================================
-- Multi-tenant migration, STEP 5: Super Admin audit log (Phase 5)
-- Run in Supabase SQL Editor after 001. Purely additive; safe to re-run.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_email      TEXT,
    action           TEXT NOT NULL,
    -- 'client.create' | 'client.suspend' | 'client.reactivate' | 'client.delete'
    target_org_id    UUID,  -- no FK: the org may already be deleted by the time this is read
    target_org_name  TEXT,
    details          JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log (created_at DESC);

-- Server-only (service-role key); no anon/authenticated policies.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

COMMIT;
