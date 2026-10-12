import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { getSelectedManufacturers } from '@/features/manufacturers/data';
import { notFound } from 'next/navigation';
import { DetectManufacturerClient } from './detect-client';

export default async function DetectManufacturerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const supabase = await scopedDb();

  const [projectRes, { manufacturers }] = await Promise.all([
    supabase.from('quotation_projects').select('*').eq('id', id).single(),
    getSelectedManufacturers(),
  ]);

  if (projectRes.error || !projectRes.data) return notFound();

  return (
    <DetectManufacturerClient
      project={projectRes.data}
      manufacturers={manufacturers}
    />
  );
}
