import { apiUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { scopedDb } from '@/lib/db';

// NOTE: `quotation_projects` has no `metadata` column — writing one always
// failed with Postgres error PGRST204 ("Could not find the 'metadata'
// column"). The caller (detect-client.tsx) never checked this route's
// response either, so the failure was completely silent: every manufacturer
// selection made on the "Detect Manufacturer" screen was discarded and
// nothing downstream ever read `.metadata` back anyway. The one piece of
// that payload with a real destination is `selected_manufacturer_id`, which
// maps onto the actual `manufacturer_id` column — persist that instead.
export async function POST(req: NextRequest) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    const { project_id, metadata } = await req.json();
    if (!project_id) return NextResponse.json({ success: false, error: 'project_id required' }, { status: 400 });

    const manufacturerId = metadata?.selected_manufacturer_id;
    if (manufacturerId) {
      const supabase = await scopedDb();
      const { error } = await supabase
        .from('quotation_projects')
        .update({ manufacturer_id: manufacturerId })
        .eq('id', project_id);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
