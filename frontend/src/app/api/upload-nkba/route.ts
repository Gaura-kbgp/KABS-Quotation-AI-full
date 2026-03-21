
import { createServerSupabase } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';

/**
 * Route Handler for NKBA PDF uploads.
 * Uses the production-ready nkba_files table.
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const version = formData.get('version') as string;

    if (!file || !version) {
      return Response.json({ error: 'Missing file or version' }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const fileName = `nkba-docs/versions/${crypto.randomUUID()}.pdf`;
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('manufacturer-docs')
      .upload(fileName, buffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('manufacturer-docs').getPublicUrl(fileName);

    const { error: dbError } = await supabase
      .from('nkba_files')
      .insert([{
        version,
        file_name: file.name,
        file_url: publicUrl
      }]);

    if (dbError) throw dbError;

    revalidatePath('/admin/nkba');
    return Response.json({ success: true });

  } catch (err: any) {
    console.error('API Upload NKBA Error:', err);
    return Response.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
