import { createServerSupabase } from '@/lib/supabase-server';
import { notFound } from 'next/navigation';
import { DetectManufacturerClient } from './detect-client';

export default async function DetectManufacturerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabase();

  const [projectRes, manufacturersRes] = await Promise.all([
    supabase.from('quotation_projects').select('*').eq('id', id).single(),
    supabase.from('manufacturers').select('id,name').eq('status', 'Active').order('name'),
  ]);

  if (projectRes.error || !projectRes.data) return notFound();

  return (
    <DetectManufacturerClient
      project={projectRes.data}
      manufacturers={manufacturersRes.data || []}
    />
  );
}
