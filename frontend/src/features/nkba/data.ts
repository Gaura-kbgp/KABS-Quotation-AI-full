import 'server-only';
import { scopedDb } from '@/lib/db';
import { DOCS_BUCKET, resolveFileUrls } from '@/lib/storage';

export async function getNkbaRules() {
  try {
    const supabase = await scopedDb();
    const { data, error } = await supabase.from('nkba_files').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return { rules: await resolveFileUrls(supabase, DOCS_BUCKET, data || [], 'file_url'), error: null as string | null };
  } catch (err: any) {
    console.error('NKBA Fetch Error:', err.message);
    return { rules: [] as any[], error: err.message as string };
  }
}
