'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { DOCS_BUCKET, extractStoragePath } from '@/lib/storage';

export async function deleteNkbaRuleAction(id: string, fileUrl: string) {
  await requireUser();
  try {
    const supabase = await scopedDb();
    const path = extractStoragePath(fileUrl, DOCS_BUCKET);
    if (path) await supabase.storage.from(DOCS_BUCKET).remove([path]);

    await supabase.from('nkba_files').delete().eq('id', id);

    revalidatePath('/app/nkba');
    revalidatePath('/super-admin/nkba');
    revalidatePath('/app/dashboard');
    revalidatePath('/super-admin/dashboard');
    return { success: true };
  } catch (err: any) {
    console.error('Delete NKBA Error:', err);
    return { success: false, error: err.message };
  }
}
