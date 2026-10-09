import { apiUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { logUsage } from '@/lib/usage';
import { revalidatePath } from 'next/cache';

/**
 * Route Handler for large specification PDF uploads.
 */
export async function POST(req: Request) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const manufacturerId = formData.get('manufacturerId') as string;

    if (!file || !manufacturerId) {
      return Response.json({ error: 'Missing file or manufacturer ID' }, { status: 400 });
    }

    const supabase = await scopedDb();
    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `${auth.user.orgId}/${manufacturerId}/spec-books/${fileName}`;
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('manufacturer-docs')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true
      });

    if (uploadError) throw uploadError;

    // The bucket is private: store the path, not a public URL. A signed URL
    // is generated on demand whenever the file is shown or downloaded.
    const { error: dbError } = await supabase
      .from('manufacturer_files')
      .insert([{
        manufacturer_id: manufacturerId,
        file_type: 'spec',
        file_name: file.name,
        file_url: filePath,
        file_format: fileExt?.toLowerCase()
      }]);

    if (dbError) throw dbError;

    await logUsage(auth.user, 'file.spec_upload', { manufacturer_id: manufacturerId, file_name: file.name });
    revalidatePath(`/app/manufacturers/${manufacturerId}`);
    revalidatePath(`/super-admin/manufacturers/${manufacturerId}`);
    return Response.json({ success: true, fileName: file.name });

  } catch (err: any) {
    console.error('API Upload Spec Error:', err);
    return Response.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
