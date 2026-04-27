import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const { project_id, metadata } = await req.json();
    if (!project_id) return NextResponse.json({ success: false, error: 'project_id required' }, { status: 400 });

    const supabase = createServerSupabase();

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
