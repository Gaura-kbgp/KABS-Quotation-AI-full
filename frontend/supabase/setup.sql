-- 1. Create Manufacturers Table
CREATE TABLE IF NOT EXISTS public.manufacturers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create Manufacturer Files Table
CREATE TABLE IF NOT EXISTS public.manufacturer_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE CASCADE,
    file_type TEXT NOT NULL, -- 'spec' or 'pricing'
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_format TEXT, -- 'pdf', 'xlsx', 'xlsm', 'csv'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create Manufacturer Specifications Table (Parsed Data)
CREATE TABLE IF NOT EXISTS public.manufacturer_specifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE CASCADE,
    raw_source_file_id UUID REFERENCES public.manufacturer_files(id) ON DELETE CASCADE,
    collection_name TEXT,
    door_style TEXT,
    finish TEXT DEFAULT 'Standard',
    category TEXT DEFAULT 'Cabinetry',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create NKBA Files Table
CREATE TABLE IF NOT EXISTS public.nkba_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    version TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Set up Storage Buckets
-- Note: This requires the storage schema to exist (standard in Supabase)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('manufacturer-docs', 'manufacturer-docs', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturer_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturer_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nkba_files ENABLE ROW LEVEL SECURITY;

-- 7. Create Policies (Simplified for Admin access)
-- Note: In production, you'd restrict these to authenticated users or specific roles.
CREATE POLICY "Allow public read access" ON public.manufacturers FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.manufacturer_files FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.manufacturer_specifications FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.nkba_files FOR SELECT USING (true);

-- Allow full access for development/admin (Replace with proper Auth roles in production)
CREATE POLICY "Allow all for authenticated" ON public.manufacturers ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON public.manufacturer_files ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON public.manufacturer_specifications ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated" ON public.nkba_files ALL USING (auth.role() = 'authenticated');

-- 8. Storage Policies
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'manufacturer-docs');
CREATE POLICY "Admin Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'manufacturer-docs');
CREATE POLICY "Admin Delete" ON storage.objects FOR DELETE USING (bucket_id = 'manufacturer-docs');