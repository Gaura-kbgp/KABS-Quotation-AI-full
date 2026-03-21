'use server';

import { createServerSupabase } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

/**
 * Generic project update for extracted_data and metadata.
 */
export async function updateProjectAction(id: string, data: any) {
  try {
    const supabase = createServerSupabase();
    const { error } = await supabase.from('quotation_projects').update(data).eq('id', id);
    if (error) throw error;
    
    revalidatePath(`/quotation-ai/review/${id}`);
    revalidatePath(`/quotation-ai/bom/${id}`);
    
    return { success: true };
  } catch (err: any) {
    console.error('[Update Project Error]:', err);
    return { success: false, error: err.message || 'Failed to update project data.' };
  }
}

/**
 * Updates an individual BOM line item.
 */
export async function updateBomItemAction(id: string, updates: any) {
  try {
    const supabase = createServerSupabase();
    const { error } = await supabase.from('quotation_boms').update(updates).eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    console.error('[Update BOM Error]:', err);
    return { success: false, error: err.message };
  }
}
/**
 * Triggers the pricing engine after applying global specs.
 */
export async function generateBOMAction(projectId: string, manufacturerId: string, collection: string, doorStyle: string) {
  try {
    const supabase = createServerSupabase();
    
    // 1. Fetch current project data
    const { data: project } = await supabase
      .from('quotation_projects')
      .select('extracted_data')
      .eq('id', projectId)
      .single();

    if (!project) throw new Error('Project not found');

    // 2. Apply global specs to all rooms
    const updatedRooms = (project.extracted_data?.rooms || []).map((room: any) => ({
      ...room,
      collection,
      door_style: doorStyle
    }));

    // 3. Update database
    const { error: updateError } = await supabase
      .from('quotation_projects')
      .update({
        manufacturer_id: manufacturerId,
        extracted_data: { ...project.extracted_data, rooms: updatedRooms }
      })
      .eq('id', projectId);

    if (updateError) throw updateError;

    // 4. Trigger Python FastAPI Pricing Engine
    const res = await fetch(`http://localhost:8000/api/generate-bom?project_id=${projectId}&manufacturer_id=${manufacturerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await res.json();
    return result;

  } catch (err: any) {
    console.error('[Generate BOM Error]:', err);
    return { success: false, error: err.message };
  }
}
