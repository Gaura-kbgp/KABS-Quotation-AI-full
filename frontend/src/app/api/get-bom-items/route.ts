import { apiUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { scopedDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    const project_id = req.nextUrl.searchParams.get('project_id');
    if (!project_id) return NextResponse.json({ success: false, error: 'project_id required' }, { status: 400 });

    const supabase = await scopedDb();
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
