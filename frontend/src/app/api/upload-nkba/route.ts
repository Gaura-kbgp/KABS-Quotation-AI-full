
import { apiUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { logUsage } from '@/lib/usage';
import { revalidatePath } from 'next/cache';

/**
 * Route Handler for NKBA PDF uploads.
 * Uses the production-ready nkba_files table.
 */
export async function POST(req: Request) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const version = formData.get('version') as string;

    if (!file || !version) {
      return Response.json({ error: 'Missing file or version' }, { status: 400 });
    }

    const supabase = await scopedDb();
    const fileName = `${auth.user.orgId}/nkba-docs/versions/${crypto.randomUUID()}.pdf`;
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('manufacturer-docs')
      .upload(fileName, buffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // The bucket is private: store the path, not a public URL.
    const { error: dbError } = await supabase
      .from('nkba_files')
      .insert([{
        version,
        file_name: file.name,
        file_url: fileName
      }]);

    if (dbError) throw dbError;

    await logUsage(auth.user, 'file.nkba_upload', { file_name: file.name, version });
    revalidatePath('/app/nkba');
    revalidatePath('/super-admin/nkba');
    return Response.json({ success: true });

  } catch (err: any) {
    console.error('API Upload NKBA Error:', err);
    return Response.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
