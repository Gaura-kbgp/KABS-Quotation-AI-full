-- ============================================================
-- Install Rules Migration
-- Run this in your Supabase SQL Editor (Project → SQL Editor)
-- ============================================================

-- 1. MANUFACTURER DEFAULTS TABLE
--    Stores the standard install factor and 3PL flag per item code per manufacturer.

CREATE TABLE IF NOT EXISTS public.install_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE CASCADE,
    item_code       TEXT NOT NULL,
    item_type       TEXT NOT NULL DEFAULT 'cabinet',
    -- e.g. 'wall_cabinet', 'base_cabinet', 'tall_cabinet', 'vanity',
    --       'dishwasher_panel', 'oven_cabinet', 'trim', 'filler', 'hardware'
    install_factor  NUMERIC NOT NULL DEFAULT 1.0,
    -- Multiplied by quantity → weighted Install Units
    include_in_3pl  BOOLEAN NOT NULL DEFAULT TRUE,
    -- TRUE = count toward 3PL Units (cabinets); FALSE = exclude (trim/molding)
    count_basis     TEXT NOT NULL DEFAULT 'quantity',
    -- Always 'quantity' for now; reserved for future 'linear_ft' etc.
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (manufacturer_id, item_code)
);

-- 2. CLIENT OVERRIDES TABLE
--    Stores per-client exceptions that take priority over manufacturer defaults.

CREATE TABLE IF NOT EXISTS public.install_rule_overrides (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_name     TEXT NOT NULL,
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE CASCADE,
    item_code       TEXT NOT NULL,
    item_type       TEXT,
    install_factor  NUMERIC NOT NULL,
    include_in_3pl  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (client_name, manufacturer_id, item_code)
);

-- 3. ROW LEVEL SECURITY

ALTER TABLE public.install_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.install_rule_overrides ENABLE ROW LEVEL SECURITY;

-- Public read (no auth needed to calculate in frontend)
CREATE POLICY "Allow public read install_rules"
    ON public.install_rules FOR SELECT USING (true);
CREATE POLICY "Allow all for authenticated install_rules"
    ON public.install_rules FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow public read install_rule_overrides"
    ON public.install_rule_overrides FOR SELECT USING (true);
CREATE POLICY "Allow all for authenticated install_rule_overrides"
    ON public.install_rule_overrides FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- SAMPLE DATA (optional — remove if not needed)
-- Replace 'YOUR_MANUFACTURER_ID' with actual UUID from manufacturers table
-- ============================================================
-- INSERT INTO public.install_rules (manufacturer_id, item_code, item_type, install_factor, include_in_3pl) VALUES
--   ('YOUR_MANUFACTURER_ID', 'W3030',  'wall_cabinet',      1.0,  TRUE),
--   ('YOUR_MANUFACTURER_ID', 'B36',    'base_cabinet',      1.0,  TRUE),
--   ('YOUR_MANUFACTURER_ID', 'DP24',   'dishwasher_panel',  0.5,  TRUE),
--   ('YOUR_MANUFACTURER_ID', 'OC33',   'oven_cabinet',      3.0,  TRUE),
--   ('YOUR_MANUFACTURER_ID', 'TM8',    'trim',              0.25, FALSE),
--   ('YOUR_MANUFACTURER_ID', 'QR',     'molding',           0.25, FALSE);
