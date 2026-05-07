import { createServerSupabase } from '@/lib/supabase-server';
import { LaborClient } from './labor-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function LaborPage() {
  let rates: any[] = [];
  let error: string | null = null;

  try {
    const supabase = createServerSupabase();
    const { data, error: dbErr } = await supabase
      .from('labor_charges')
      .select('*')
      .eq('is_active', true)
      .order('charge_type')
      .order('name');

    if (dbErr) throw new Error(dbErr.message);
    rates = data || [];
  } catch (err: any) {
    error = err.message;
  }

  return <LaborClient initialRates={rates} initialError={error} />;
}
