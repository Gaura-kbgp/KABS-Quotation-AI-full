import { createServerSupabase } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';

/**
 * Route Handler for large specification PDF uploads.
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const manufacturerId = formData.get('manufacturerId') as string;

    if (!file || !manufacturerId) {
      return Response.json({ error: 'Missing file or manufacturer ID' }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `${manufacturerId}/spec-books/${fileName}`;
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('manufacturer-docs')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('manufacturer-docs').getPublicUrl(filePath);

    const { error: dbError } = await supabase
      .from('manufacturer_files')
      .insert([{
        manufacturer_id: manufacturerId,
        file_type: 'spec',
        file_name: file.name,
        file_url: publicUrl,
        file_format: fileExt?.toLowerCase()
      }]);

    if (dbError) throw dbError;

    revalidatePath(`/admin/manufacturers/${manufacturerId}`);
    return Response.json({ success: true, fileName: file.name });

  } catch (err: any) {
    console.error('API Upload Spec Error:', err);
    return Response.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
