import { apiUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { scopedDb } from '@/lib/db';

export async function POST(req: NextRequest) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    const { project_id, metadata } = await req.json();
    if (!project_id) return NextResponse.json({ success: false, error: 'project_id required' }, { status: 400 });

    const supabase = await scopedDb();

    // Fetch current metadata and merge
    const { data: project } = await supabase
      .from('quotation_projects')
      .select('metadata')
      .eq('id', project_id)
      .single();

    const merged = { ...(project?.metadata || {}), ...metadata };

    const { error } = await supabase
      .from('quotation_projects')
      .update({ metadata: merged })
      .eq('id', project_id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
