'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { DOCS_BUCKET, extractStoragePath } from '@/lib/storage';
import { logUsage } from '@/lib/usage';

// Shared between /admin (dealer) and /super-admin (KABS's own catalog),
// so every mutation revalidates both possible homes of this data.
function revalidateManufacturers(id?: string) {
  for (const base of ['/admin', '/super-admin']) {
    revalidatePath(`${base}/manufacturers`);
    revalidatePath(`${base}/dashboard`);
    if (id) revalidatePath(`${base}/manufacturers/${id}`);
  }
}

export async function addManufacturer(name: string) {
  const user = await requireUser();
  try {
    const supabase = await scopedDb();
    const { data, error } = await supabase.from('manufacturers').insert([{ name, status: 'Active' }]).select().single();
    if (error) throw error;

    await logUsage(user, 'manufacturer.create', { manufacturer_id: data.id, name });
    revalidateManufacturers();
    return { success: true, data };
  } catch (err: any) {
    console.error('Add Manufacturer Error:', err);
    return { success: false, error: err.message };
  }
}

export async function updateManufacturer(id: string, updates: { name?: string; status?: string }) {
  await requireUser();
  try {
    const supabase = await scopedDb();
    const { data, error } = await supabase.from('manufacturers').update(updates).eq('id', id).select().single();
    if (error) throw error;

    revalidateManufacturers(id);
    return { success: true, data };
  } catch (err: any) {
    console.error('Update Manufacturer Error:', err);
    return { success: false, error: err.message };
  }
}

/** Deletes a manufacturer and ALL its associated pricing/files (deep cleanup). */
export async function deleteManufacturer(id: string) {
  await requireUser();
  try {
    const supabase = await scopedDb();

    const { data: files } = await supabase.from('manufacturer_files').select('file_url').eq('manufacturer_id', id);
    if (files && files.length > 0) {
      for (const file of files) {
        const path = extractStoragePath(file.file_url, DOCS_BUCKET);
        if (path) await supabase.storage.from(DOCS_BUCKET).remove([path]);
      }
    }

    const { error: pricingError } = await supabase.from('manufacturer_pricing').delete().eq('manufacturer_id', id);
    if (pricingError) throw new Error(`Pricing cleanup failed: ${pricingError.message}`);

    const { error: filesError } = await supabase.from('manufacturer_files').delete().eq('manufacturer_id', id);
    if (filesError) throw new Error(`File record cleanup failed: ${filesError.message}`);

    const { error } = await supabase.from('manufacturers').delete().eq('id', id);
    if (error) throw error;

    revalidateManufacturers();
    return { success: true };
  } catch (err: any) {
    console.error('Delete Manufacturer Error:', err);
    return { success: false, error: err.message };
  }
}

/** Deletes a manufacturer file and its extracted pricing data (keeps the summary accurate). */
export async function deleteManufacturerFileAction(fileId: string, fileUrl: string, manufacturerId: string) {
  await requireUser();
  try {
    const supabase = await scopedDb();

    const { error: pricingError } = await supabase.from('manufacturer_pricing').delete().eq('raw_source_file_id', fileId);
    if (pricingError) throw new Error(`Pricing cleanup failed: ${pricingError.message}`);

    const path = extractStoragePath(fileUrl, DOCS_BUCKET);
    if (path) await supabase.storage.from(DOCS_BUCKET).remove([path]);

    const { error: fileError } = await supabase.from('manufacturer_files').delete().eq('id', fileId);
    if (fileError) throw new Error(`File record deletion failed: ${fileError.message}`);

    revalidateManufacturers(manufacturerId);
    return { success: true };
  } catch (err: any) {
    console.error('[Cleanup Action] Critical Failure:', err);
    return { success: false, error: err.message };
  }
}
