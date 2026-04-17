'use server';

import { createServerSupabase } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

// ─── Install Rules ─────────────────────────────────────────────────────────

export interface InstallRule {
  id: string;
  manufacturer_id: string;
  item_code: string;
  item_type: string;
  install_factor: number;
  include_in_3pl: boolean;
  count_basis: string;
  created_at?: string;
}

export interface InstallOverride {
  id: string;
  client_name: string;
  manufacturer_id: string;
  item_code: string;
  item_type?: string;
  install_factor: number;
  include_in_3pl: boolean;
  created_at?: string;
}

export async function fetchInstallRulesAction(manufacturerId: string) {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('install_rules')
      .select('*')
      .eq('manufacturer_id', manufacturerId)
      .order('item_code');
    if (error) throw error;
    return { success: true, rules: (data || []) as InstallRule[] };
  } catch (err: any) {
    console.error('[fetchInstallRules]', err);
    return { success: false, error: err.message as string, rules: [] as InstallRule[] };
  }
}

export async function upsertInstallRuleAction(rule: Omit<InstallRule, 'id' | 'created_at'> & { id?: string }) {
  try {
    const supabase = createServerSupabase();
    const payload = {
      ...(rule.id ? { id: rule.id } : {}),
      manufacturer_id: rule.manufacturer_id,
      item_code: rule.item_code.toUpperCase().trim(),
      item_type: rule.item_type,
      install_factor: rule.install_factor,
      include_in_3pl: rule.include_in_3pl,
      count_basis: rule.count_basis || 'quantity',
    };
    const { data, error } = await supabase
      .from('install_rules')
      .upsert(payload, { onConflict: 'manufacturer_id,item_code' })
      .select()
      .single();
    if (error) throw error;
    return { success: true, rule: data as InstallRule };
  } catch (err: any) {
    console.error('[upsertInstallRule]', err);
    return { success: false, error: err.message as string };
  }
}

export async function deleteInstallRuleAction(id: string) {
  try {
    const supabase = createServerSupabase();
    const { error } = await supabase.from('install_rules').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message as string };
  }
}

export async function fetchInstallOverridesAction(manufacturerId: string, clientName?: string) {
  try {
    const supabase = createServerSupabase();
    let query = supabase
      .from('install_rule_overrides')
      .select('*')
      .eq('manufacturer_id', manufacturerId);
    if (clientName && clientName.trim()) {
      query = query.eq('client_name', clientName.trim());
    }
    const { data, error } = await query.order('item_code');
    if (error) throw error;
    return { success: true, overrides: (data || []) as InstallOverride[] };
  } catch (err: any) {
    console.error('[fetchInstallOverrides]', err);
    return { success: false, error: err.message as string, overrides: [] as InstallOverride[] };
  }
}

export async function upsertInstallOverrideAction(override: Omit<InstallOverride, 'id' | 'created_at'> & { id?: string }) {
  try {
    const supabase = createServerSupabase();
    const payload = {
      ...(override.id ? { id: override.id } : {}),
      client_name: override.client_name.trim(),
      manufacturer_id: override.manufacturer_id,
      item_code: override.item_code.toUpperCase().trim(),
      item_type: override.item_type,
      install_factor: override.install_factor,
      include_in_3pl: override.include_in_3pl,
    };
    const { data, error } = await supabase
      .from('install_rule_overrides')
      .upsert(payload, { onConflict: 'client_name,manufacturer_id,item_code' })
      .select()
      .single();
    if (error) throw error;
    return { success: true, override: data as InstallOverride };
  } catch (err: any) {
    console.error('[upsertInstallOverride]', err);
    return { success: false, error: err.message as string };
  }
}

export async function deleteInstallOverrideAction(id: string) {
  try {
    const supabase = createServerSupabase();
    const { error } = await supabase.from('install_rule_overrides').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message as string };
  }
}

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
export async function generateBOMAction(projectId: string, manufacturerId: string, collection: string, doorStyle: string, allSpecs: any = {}) {
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
      collection: collection || room.collection,
      door_style: doorStyle || room.door_style,
      box_construction: allSpecs.box_construction || room.box_construction || '',
      finish: allSpecs.finish || room.finish || '',
      wood_species: allSpecs.wood_species || room.wood_species || '',
      drawer_box: allSpecs.drawer_box || room.drawer_box || ''
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
    const res = await fetch(`${BACKEND_URL}/api/generate-bom?project_id=${projectId}&manufacturer_id=${manufacturerId}`, {
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
