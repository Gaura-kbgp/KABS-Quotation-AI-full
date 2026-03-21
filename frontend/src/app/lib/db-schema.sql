-- KABS Quotation AI Phase 1 Schema

-- Manufacturers Table
CREATE TABLE IF NOT EXISTS manufacturers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Manufacturer Files Table
CREATE TABLE IF NOT EXISTS manufacturer_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id UUID REFERENCES manufacturers(id) ON DELETE CASCADE,
    spec_pdf_url TEXT,
    pricing_file_url TEXT,
    google_sheet_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- NKBA Rules Files Table
CREATE TABLE IF NOT EXISTS nkba_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_url TEXT NOT NULL,
    version TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Row Level Security (RLS) Setup
ALTER TABLE manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturer_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE nkba_files ENABLE ROW LEVEL SECURITY;

-- Simple Policies for Admin Access (Service Role handles management)
CREATE POLICY "Public read manufacturers" ON manufacturers FOR SELECT USING (true);
CREATE POLICY "Public read manufacturer files" ON manufacturer_files FOR SELECT USING (true);
CREATE POLICY "Public read nkba files" ON nkba_files FOR SELECT USING (true);

-- Storage Buckets Configuration (Note: Must be run in Supabase Storage UI or via CLI)
-- 1. manufacturer-docs (Folders: spec-books, pricing-sheets)
-- 2. nkba-docs
