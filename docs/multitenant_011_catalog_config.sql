-- ============================================================
-- Migration 011: manufacturer_catalog_config
-- Stores AI-extracted catalog configuration per manufacturer:
-- door styles, species, finishes, price model, upcharges.
-- Drives dynamic dropdowns — no hardcoding per manufacturer.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.manufacturer_catalog_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    manufacturer_id UUID NOT NULL REFERENCES public.manufacturers(id) ON DELETE CASCADE,

    -- 'collection' = Wellborn-style (collection_name = "PRIME MAPLE", door_style = "Canyon Maple")
    -- 'price_column' = Marsh-style (one catalog, 9 price cols, door style selects col)
    price_model     TEXT NOT NULL DEFAULT 'collection'
                    CHECK (price_model IN ('collection', 'price_column')),

    -- Door styles for review-page dropdown.
    -- collection model:  [{"name":"Canyon Maple","collection":"PRIME MAPLE","overlay":"Standard"}]
    -- price_column model:[{"name":"Atlanta Maple","column":"COL_4S","overlay":"Standard","species":"Maple"}]
    door_styles     JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Species available: [{"name":"Maple","code":"M"},{"name":"Cherry","code":"C","upcharge_pct":7}]
    species         JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Finishes: [{"name":"Jute","type":"stain"},{"name":"Alpine","type":"paint","upcharge_pct":15}]
    finishes        JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Upcharge rules (flat $ or % stored as numbers):
    -- {"plywood_wall":75,"plywood_base":110,"plywood_tall":220,
    --  "fe_wall":96,"fe_base":154,"fe_tall":340,
    --  "cherry_pct":7,"paint_pct":15,"glaze_pct":15}
    upcharges       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Price column definitions (price_column model only):
    -- [{"id":"COL_1","label":"Cambridge Birch — Standard"},{"id":"COL_4S","label":"Atlanta/Brunswick/Pinehurst Maple & Oak"}]
    price_columns   JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Door style → collection_name or column_id mapping (for BOM lookup):
    -- {"ATLANTA MAPLE":"COL_4S","CAMBRIDGE BIRCH":"COL_1","HAMPTON MAPLE":"COL_7",...}
    style_to_collection JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Extraction metadata
    extraction_source TEXT CHECK (extraction_source IN ('ai_pdf','ai_excel','manual')),
    extraction_notes  TEXT,
    extracted_at      TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),

    UNIQUE (org_id, manufacturer_id)
);

CREATE INDEX IF NOT EXISTS mcc_org_idx  ON public.manufacturer_catalog_config (org_id);
CREATE INDEX IF NOT EXISTS mcc_mfg_idx  ON public.manufacturer_catalog_config (manufacturer_id);

ALTER TABLE public.manufacturer_catalog_config ENABLE ROW LEVEL SECURITY;

COMMIT;
