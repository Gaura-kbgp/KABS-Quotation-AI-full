
-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLES
CREATE TABLE IF NOT EXISTS public.manufacturers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.manufacturer_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE CASCADE,
    file_type TEXT NOT NULL, -- 'spec' | 'pricing'
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_format TEXT, -- 'pdf', 'xlsx', 'xlsm', 'csv'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.manufacturer_specifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE CASCADE,
    collection_name TEXT,
    door_style TEXT,
    finish TEXT,
    category TEXT DEFAULT 'Cabinetry',
    raw_source_file_id UUID REFERENCES public.manufacturer_files(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. STORAGE BUCKETS
-- Note: You might need to create these manually in the UI if the script doesn't have permissions
-- But these policies will apply once the buckets exist.
INSERT INTO storage.buckets (id, name, public) 
VALUES ('manufacturer-docs', 'manufacturer-docs', true)
ON CONFLICT (id) DO NOTHING;

-- 4. RLS POLICIES (Row Level Security)
ALTER TABLE public.manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturer_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturer_specifications ENABLE ROW LEVEL SECURITY;

-- Policy for Manufacturers
CREATE POLICY "Allow public read" ON public.manufacturers FOR SELECT USING (true);
CREATE POLICY "Allow all for authenticated" ON public.manufacturers FOR ALL USING (auth.role() = 'authenticated');

-- Policy for Files
CREATE POLICY "Allow public read" ON public.manufacturer_files FOR SELECT USING (true);
CREATE POLICY "Allow all for authenticated" ON public.manufacturer_files FOR ALL USING (auth.role() = 'authenticated');

-- Policy for Specifications
CREATE POLICY "Allow public read" ON public.manufacturer_specifications FOR SELECT USING (true);
CREATE POLICY "Allow all for authenticated" ON public.manufacturer_specifications FOR ALL USING (auth.role() = 'authenticated');

-- 5. STORAGE POLICIES
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING ( bucket_id = 'manufacturer-docs' );
CREATE POLICY "Auth Upload" ON storage.objects FOR INSERT WITH CHECK ( bucket_id = 'manufacturer-docs' AND auth.role() = 'authenticated' );
CREATE POLICY "Auth Update" ON storage.objects FOR UPDATE USING ( bucket_id = 'manufacturer-docs' AND auth.role() = 'authenticated' );
CREATE POLICY "Auth Delete" ON storage.objects FOR DELETE USING ( bucket_id = 'manufacturer-docs' AND auth.role() = 'authenticated' );
