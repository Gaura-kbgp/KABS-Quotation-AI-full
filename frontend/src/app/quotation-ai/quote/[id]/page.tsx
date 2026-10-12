import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { CustomerQuoteClient } from './customer-quote-client';

export default async function CustomerQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) redirect('/login');

  const supabase = await scopedDb();

  const { data: project, error } = await supabase
    .from('quotation_projects')
    .select('id, project_name, created_at, status, review_status, extracted_data, manufacturer_id')
    .eq('id', id)
    .maybeSingle();

  if (error || !project) redirect('/quotation-ai');

  // Load BOM items for pricing summary
  const { data: bom } = await supabase
    .from('quotation_boms')
    .select('room_name, sku, description, quantity, unit_price, tier')
    .eq('project_id', id)
    .order('room_name');

  // Load org name for letterhead
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .maybeSingle();

  return (
    <CustomerQuoteClient
      project={project}
      bom={bom ?? []}
      orgName={org?.name ?? 'KABS'}
    />
  );
}
