import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { StaffReviewClient } from './staff-review-client';
import { redirect } from 'next/navigation';

export default async function StaffReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const supabase = await scopedDb();

  const [pRes, bomRes] = await Promise.all([
    supabase.from('quotation_projects').select('*').eq('id', id).single(),
    supabase.from('quotation_boms').select('*').eq('project_id', id).order('room').order('sku'),
  ]);

  if (pRes.error || !pRes.data) redirect('/quotation-ai');

  const project = pRes.data;
  const bom = bomRes.data || [];

  let manufacturerName = '';
  if (project.manufacturer_id) {
    const { data: mfg } = await supabase
      .from('manufacturers')
      .select('name')
      .eq('id', project.manufacturer_id)
      .maybeSingle();
    manufacturerName = mfg?.name || '';
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <StaffReviewClient project={project} bom={bom} manufacturerName={manufacturerName} />
    </main>
  );
}
