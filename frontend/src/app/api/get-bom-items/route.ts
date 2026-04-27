import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    const project_id = req.nextUrl.searchParams.get('project_id');
    if (!project_id) return NextResponse.json({ success: false, error: 'project_id required' }, { status: 400 });

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('quotation_boms')
      .select('id,sku,matched_sku,qty,unit_price,room,description,cabinet_type,match_explanation,precision_level')
      .eq('project_id', project_id);

    if (error) throw error;
    return NextResponse.json({ success: true, items: data || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
