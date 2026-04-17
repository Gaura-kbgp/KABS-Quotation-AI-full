
import { createServerSupabase } from '@/lib/supabase-server';
import { parseSpecifications } from '@/lib/specs-parser';
import { revalidatePath } from 'next/cache';

export const maxDuration = 300;

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
    const filePath = `${manufacturerId}/pricing-files/${fileName}`;
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await supabase.storage
      .from('manufacturer-docs')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true
      });

    const { data: { publicUrl } } = supabase.storage.from('manufacturer-docs').getPublicUrl(filePath);

    const { data: dbData, error: dbError } = await supabase
      .from('manufacturer_files')
      .insert([{
        manufacturer_id: manufacturerId,
        file_type: 'pricing',
        file_name: file.name,
        file_url: publicUrl,
        file_format: fileExt?.toLowerCase()
      }])
      .select()
      .single();

    if (dbError) throw dbError;

    const pricing = await parseSpecifications(buffer, manufacturerId, dbData.id);

    if (pricing.length > 0) {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < pricing.length; i += CHUNK_SIZE) {
        const chunk = pricing.slice(i, i + CHUNK_SIZE);
        await supabase.from('manufacturer_pricing').insert(chunk);
      }
    }

    revalidatePath(`/admin/manufacturers/${manufacturerId}`);
    return Response.json({ success: true, count: pricing.length, fileName: file.name });

  } catch (err: any) {
    console.error('[Upload] Error:', err);
    return Response.json({ error: err.message || 'Server-side extraction failed' }, { status: 500 });
  }
}
