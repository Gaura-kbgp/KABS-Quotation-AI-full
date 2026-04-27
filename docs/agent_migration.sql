-- ============================================================
-- KABS AI Agent System Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Training Documents Table
-- Stores uploaded spec books, NKBA rules, pricing sheets for AI training
CREATE TABLE IF NOT EXISTS public.training_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    doc_type TEXT NOT NULL DEFAULT 'general',
    -- doc_type: 'spec_book' | 'nkba_rules' | 'pricing_sheet' | 'manufacturer_data' | 'general'
    file_url TEXT,
    file_name TEXT,
    file_size_bytes BIGINT,
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE SET NULL,
    manufacturer_name TEXT, -- for docs about non-DB manufacturers
    extracted_knowledge JSONB DEFAULT '{}', -- AI-extracted key info
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Manufacturer Research Cache
-- Stores AI-researched data about manufacturers not in our database
CREATE TABLE IF NOT EXISTS public.manufacturer_research (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manufacturer_name TEXT UNIQUE NOT NULL,
    research_data JSONB DEFAULT '{}',
    -- research_data contains:
    -- { coding_system, series, collections, cabinet_types, suffixes,
    --   wall_cabinet_format, base_cabinet_format, door_style_codes,
    --   special_codes, notes, sources_used }
    confidence_score NUMERIC DEFAULT 0.5,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Add AI description columns to quotation_boms
ALTER TABLE public.quotation_boms
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS cabinet_type TEXT,
    ADD COLUMN IF NOT EXISTS match_explanation TEXT,
    ADD COLUMN IF NOT EXISTS match_confidence NUMERIC DEFAULT 0;

-- 4. Manufacturer detection log (per project)
CREATE TABLE IF NOT EXISTS public.manufacturer_detections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.quotation_projects(id) ON DELETE CASCADE,
    detected_manufacturer TEXT,
    detection_confidence NUMERIC DEFAULT 0,
    detection_reasoning TEXT,
    sample_codes JSONB DEFAULT '[]',
    selected_manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE SET NULL,
    selected_manufacturer_name TEXT, -- if "Other" was chosen
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Storage bucket for training documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-docs', 'training-docs', true)
ON CONFLICT (id) DO NOTHING;

-- 6. RLS Policies
ALTER TABLE public.training_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturer_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturer_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read training_documents" ON public.training_documents FOR SELECT USING (true);
CREATE POLICY "Allow all authenticated training_documents" ON public.training_documents FOR ALL USING (true);

CREATE POLICY "Allow public read manufacturer_research" ON public.manufacturer_research FOR SELECT USING (true);
CREATE POLICY "Allow all authenticated manufacturer_research" ON public.manufacturer_research FOR ALL USING (true);

CREATE POLICY "Allow public read manufacturer_detections" ON public.manufacturer_detections FOR SELECT USING (true);
CREATE POLICY "Allow all authenticated manufacturer_detections" ON public.manufacturer_detections FOR ALL USING (true);

-- Storage policies for training-docs bucket
CREATE POLICY "Public Access training-docs" ON storage.objects FOR SELECT USING (bucket_id = 'training-docs');
CREATE POLICY "Auth Upload training-docs" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'training-docs');
CREATE POLICY "Auth Update training-docs" ON storage.objects FOR UPDATE USING (bucket_id = 'training-docs');
CREATE POLICY "Auth Delete training-docs" ON storage.objects FOR DELETE USING (bucket_id = 'training-docs');

-- 7. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_training_docs_manufacturer ON public.training_documents(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_training_docs_type ON public.training_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_training_docs_active ON public.training_documents(is_active);
CREATE INDEX IF NOT EXISTS idx_mfg_research_name ON public.manufacturer_research(manufacturer_name);
CREATE INDEX IF NOT EXISTS idx_mfg_detections_project ON public.manufacturer_detections(project_id);
