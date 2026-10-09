import 'server-only';
import { scopedDb } from '@/lib/db';

export async function getLaborRates() {
  try {
    const supabase = await scopedDb();
    const { data, error } = await supabase.from('labor_charges').select('*').eq('is_active', true).order('charge_type').order('name');
    if (error) throw new Error(error.message);
    return { rates: data || [], error: null as string | null };
  } catch (err: any) {
    return { rates: [] as any[], error: err.message as string };
  }
}
