-- Labor Charges Table
-- Stores per-unit installation rates and delivery charges for use in quotations.
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS labor_charges (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    charge_type  TEXT NOT NULL DEFAULT 'installation'
                   CHECK (charge_type IN ('installation', 'delivery', 'other')),
    cabinet_category TEXT NOT NULL DEFAULT 'all',
    rate_basis   TEXT NOT NULL DEFAULT 'per_unit'
                   CHECK (rate_basis IN ('per_unit', 'per_linear_ft', 'percentage', 'flat', 'per_mile')),
    rate         NUMERIC(10, 2) NOT NULL DEFAULT 0,
    notes        TEXT DEFAULT '',
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_labor_charges_type   ON labor_charges (charge_type);
CREATE INDEX IF NOT EXISTS idx_labor_charges_active ON labor_charges (is_active);

-- Row Level Security
ALTER TABLE labor_charges ENABLE ROW LEVEL SECURITY;

-- Public read (so frontend can display rates in quotations)
CREATE POLICY "Public read labor_charges"
    ON labor_charges FOR SELECT USING (true);

-- Authenticated write (admin panel uses service role key via backend)
CREATE POLICY "Service role full access labor_charges"
    ON labor_charges USING (auth.role() = 'service_role');
