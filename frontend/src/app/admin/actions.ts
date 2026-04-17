"use server";

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';

export async function createSession(token: string) {
  (await cookies()).set('kabs_admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24 hours
    path: '/',
  });
}

export async function logout() {
  (await cookies()).delete('kabs_admin_session');
  redirect('/admin/login');
}

/**
 * Adds a new manufacturer to the database.
 */
export async function addManufacturer(name: string) {
  try {
    const supabase = createServerSupabase();
    
    const { data, error } = await supabase
      .from('manufacturers')
      .insert([{ name, status: 'Active' }])
      .select()
      .single();

    if (error) throw error;

    revalidatePath('/admin/manufacturers');
    revalidatePath('/admin/dashboard');
    return { success: true, data };
  } catch (err: any) {
    console.error('Add Manufacturer Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Updates a manufacturer name or status.
 */
export async function updateManufacturer(id: string, updates: { name?: string, status?: string }) {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('manufacturers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    revalidatePath('/admin/manufacturers');
    revalidatePath(`/admin/manufacturers/${id}`);
    revalidatePath('/admin/dashboard');
    return { success: true, data };
  } catch (err: any) {
    console.error('Update Manufacturer Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Deletes a manufacturer from the database.
 * Implements DEEP RECURSIVE CLEANUP of all associated data.
 */
export async function deleteManufacturer(id: string) {
  try {
    const supabase = createServerSupabase();
    
    // 1. Fetch all file URLs to clean up storage
    const { data: files } = await supabase
      .from('manufacturer_files')
      .select('file_url')
      .eq('manufacturer_id', id);

    if (files && files.length > 0) {
      for (const file of files) {
        const pathParts = file.file_url.split('/public/manufacturer-docs/');
        const path = pathParts.length > 1 ? pathParts[1] : null;
        if (path) {
          await supabase.storage.from('manufacturer-docs').remove([path]);
        }
      }
    }

    // 2. Delete ALL pricing records for this manufacturer (CRITICAL: Purge orphans)
    const { error: pricingError } = await supabase
      .from('manufacturer_pricing')
      .delete()
      .eq('manufacturer_id', id);
    if (pricingError) throw new Error(`Pricing cleanup failed: ${pricingError.message}`);

    // 3. Delete ALL file records
    const { error: filesError } = await supabase
      .from('manufacturer_files')
      .delete()
      .eq('manufacturer_id', id);
    if (filesError) throw new Error(`File record cleanup failed: ${filesError.message}`);

    // 4. Finally delete the manufacturer
    const { error } = await supabase
      .from('manufacturers')
      .delete()
      .eq('id', id);

    if (error) throw error;

    revalidatePath('/admin/manufacturers');
    revalidatePath('/admin/dashboard');
    return { success: true };
  } catch (err: any) {
    console.error('Delete Manufacturer Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Deletes a manufacturer file and ALL its associated pricing data.
 * Implements strict cleanup to ensure Extraction Summary stays accurate.
 */
export async function deleteManufacturerFileAction(fileId: string, fileUrl: string, manufacturerId: string) {
  try {
    const supabase = createServerSupabase();
    
    // 1. Delete all extracted pricing records associated with this specific file
    const { error: pricingError } = await supabase
      .from('manufacturer_pricing')
      .delete()
      .eq('raw_source_file_id', fileId);

    if (pricingError) throw new Error(`Pricing cleanup failed: ${pricingError.message}`);
    
    // 2. Remove file from Physical Storage
    const pathParts = fileUrl.split('/public/manufacturer-docs/');
    const path = pathParts.length > 1 ? pathParts[1] : null;
    
    if (path) {
      await supabase.storage.from('manufacturer-docs').remove([path]);
    }
    
    // 3. Delete File Record from DB
    const { error: fileError } = await supabase
      .from('manufacturer_files')
      .delete()
      .eq('id', fileId);

    if (fileError) throw new Error(`File record deletion failed: ${fileError.message}`);
    
    // 4. Force refresh of the UI components
    revalidatePath(`/admin/manufacturers/${manufacturerId}`);
    revalidatePath('/admin/dashboard');
    return { success: true };
  } catch (err: any) {
    console.error('[Cleanup Action] Critical Failure:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Deletes an NKBA rule from the nkba_files table.
 */
export async function deleteNkbaRuleAction(id: string, fileUrl: string) {
  try {
    const supabase = createServerSupabase();
    const pathParts = fileUrl.split('/public/manufacturer-docs/');
    const path = pathParts.length > 1 ? pathParts[1] : null;
    
    if (path) {
      await supabase.storage.from('manufacturer-docs').remove([path]);
    }
    
    await supabase.from('nkba_files').delete().eq('id', id);
    
    revalidatePath('/admin/nkba');
    return { success: true };
  } catch (err: any) {
    console.error('Delete NKBA Error:', err);
    return { success: false, error: err.message };
  }
}
