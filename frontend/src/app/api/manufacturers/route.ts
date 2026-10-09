import { apiUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';

/** Active manufacturers of the signed-in user's company. */
export async function GET() {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  const supabase = await scopedDb();
  const { data, error } = await supabase.from('manufacturers').select('id,name').eq('status', 'Active').order('name');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
