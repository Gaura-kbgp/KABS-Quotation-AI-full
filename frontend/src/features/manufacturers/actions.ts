'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { DOCS_BUCKET, extractStoragePath } from '@/lib/storage';
import { logUsage } from '@/lib/usage';

// Shared between /app (dealer) and /super-admin (KABS's own catalog),
// so every mutation revalidates both possible homes of this data.
function revalidateManufacturers(id?: string) {
  for (const base of ['/app', '/super-admin']) {
    revalidatePath(`${base}/manufacturers`);
    revalidatePath(`${base}/dashboard`);
    if (id) revalidatePath(`${base}/manufacturers/${id}`);
  }
}

/**
 * The manufacturer catalog (brands, spec/pricing files, SKU pricing) is
 * curated ONCE by Super Admin and shared read-only with every dealer org
 * (see PLATFORM_ORG_ID / SHARED_CATALOG_TABLES in lib/db.ts). Dealers pick
 * from that list for their quotations — they don't re-create or edit
 * manufacturer records themselves, so creating/renaming/deleting one here
 * is restricted to Super Admin. Without this gate, a dealer typing a brand
 * name they don't realize Super Admin already added just creates a second,
 * empty, disconnected row under their own org (no files, no pricing) that
 * their quotations then silently use instead of the real catalog.
 */
async function requireSuperAdminAction(): Promise<ReturnType<typeof requireUser> extends Promise<infer U> ? U : never> {
  const user = await requireUser();
  if (user.role !== 'super_admin') {
    throw new Error('Only Super Admin can manage the shared manufacturer catalog.');
  }
  return user;
}

export async function addManufacturer(name: string) {
  try {
    const user = await requireSuperAdminAction();
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
  try {
    await requireSuperAdminAction();
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
  try {
    await requireSuperAdminAction();
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
  try {
    await requireSuperAdminAction();
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

/**
 * Shows/hides one manufacturer from the signed-in company's own pickers
 * (Configure Brands / Select Manufacturer) without touching the shared
 * catalog itself — Super Admin's manufacturer, its files and its pricing
 * are untouched; this only records "my company doesn't use this one" in
 * manufacturer_org_hidden. Any company user can set this for their own
 * org (it's a per-org preference, not a catalog edit), so it does NOT
 * require Super Admin like addManufacturer/updateManufacturer/delete.
 */
export async function setManufacturerSelected(manufacturerId: string, selected: boolean) {
  const user = await requireUser();
  try {
    const supabase = await scopedDb();
    if (selected) {
      const { error } = await supabase.from('manufacturer_org_hidden').delete().eq('manufacturer_id', manufacturerId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('manufacturer_org_hidden')
        .upsert([{ manufacturer_id: manufacturerId }], { onConflict: 'org_id,manufacturer_id' });
      if (error) throw error;
    }
    revalidateManufacturers();
    return { success: true };
  } catch (err: any) {
    console.error('Set Manufacturer Selected Error:', err);
    return { success: false, error: err.message };
  }
}
