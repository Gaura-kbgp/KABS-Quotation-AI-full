'use server';

import { requireUser, authFetch } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { revalidatePath } from 'next/cache';
const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

// Precision tiers that get an amber/orange/red "not exact" badge in the BOM manager
// (bom-manager-client.tsx getPrecisionBadge). These are provisional — a guessed price,
// not a confirmed catalog hit — and must be staff-confirmed (price_confirmed=true) or
// corrected before a quote can move to 'approved'/'sent'. Mirrors the backend's
// _is_confirmed_by_default() in backend/app/api/pricing.py — keep both in sync.
function isProvisionalPrecision(precisionLevel: string | null | undefined): boolean {
  const p = (precisionLevel || '').toUpperCase();
  if (!p) return false;
  if (p.startsWith('NEAREST_DIM')) return true;
  return p === 'CATEGORY_AVERAGE' || p === 'MANUAL_PRICING_REQUIRED' || p === 'ESTIMATED_DOOR_DRAWER';
}

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
  await requireUser();
  try {
    const supabase = await scopedDb();
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
  await requireUser();
  try {
    const supabase = await scopedDb();
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
  await requireUser();
  try {
    const supabase = await scopedDb();
    const { error } = await supabase.from('install_rules').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message as string };
  }
}

export async function fetchInstallOverridesAction(manufacturerId: string, clientName?: string) {
  await requireUser();
  try {
    const supabase = await scopedDb();
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
  await requireUser();
  try {
    const supabase = await scopedDb();
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
  await requireUser();
  try {
    const supabase = await scopedDb();
    const { error } = await supabase.from('install_rule_overrides').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message as string };
  }
}

export type ReviewStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'sent' | 'accepted' | 'rejected';

export interface QuotationReviewEntry {
  status: ReviewStatus;
  by: string;
  at: string;
  note: string;
}

/** Advance or revert review status on a quotation project, recording a note in history. */
export async function setReviewStatusAction(
  projectId: string,
  status: ReviewStatus,
  note = '',
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await requireUser();
  try {
    const supabase = await scopedDb();

    // Gate: a quote can't be approved/sent while it still has unconfirmed provisional
    // prices (nearest-size substitution, category average, manual-required, estimated
    // door/drawer) on a billable line. Staff must either confirm the price as-is or
    // correct it (both set price_confirmed=true) in the BOM manager first.
    if (status === 'approved' || status === 'sent' || status === 'accepted') {
      const { data: items } = await supabase
        .from('quotation_boms')
        .select('sku, precision_level, price_confirmed, is_billable')
        .eq('project_id', projectId);
      const unresolved = (items ?? []).filter(
        (i: any) => i.is_billable !== false && isProvisionalPrecision(i.precision_level) && !i.price_confirmed
      );
      if (unresolved.length > 0) {
        const skus = unresolved.slice(0, 5).map((i: any) => i.sku).join(', ');
        const more = unresolved.length > 5 ? ` and ${unresolved.length - 5} more` : '';
        return {
          success: false,
          error: `${unresolved.length} item(s) still need price confirmation before approval: ${skus}${more}. Confirm or correct them in the BOM manager first.`,
        };
      }
    }

    const { data: existing } = await supabase
      .from('quotation_projects')
      .select('review_history')
      .eq('id', projectId)
      .maybeSingle();
    const history: QuotationReviewEntry[] = (existing?.review_history as QuotationReviewEntry[] | null) ?? [];
    history.push({ status, by: user.email ?? user.id, at: new Date().toISOString(), note: note.trim() });

    const { error } = await supabase
      .from('quotation_projects')
      .update({ review_status: status, review_notes: note.trim() || null, review_history: history })
      .eq('id', projectId);
    if (error) throw error;

    revalidatePath(`/quotation-ai/review/${projectId}`);
    revalidatePath(`/quotation-ai/bom/${projectId}`);
    revalidatePath(`/quotation-ai/quote/${projectId}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message as string };
  }
}

/**
 * Generic project update for extracted_data and metadata.
 */
export async function updateProjectAction(id: string, data: any) {
  await requireUser();
  try {
    const supabase = await scopedDb();
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
  await requireUser();
  try {
    const supabase = await scopedDb();
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
  await requireUser();
  try {
    const supabase = await scopedDb();
    
    // 1. Fetch current project data
    const { data: project } = await supabase
      .from('quotation_projects')
      .select('extracted_data')
      .eq('id', projectId)
      .single();

    if (!project) throw new Error('Project not found');

    // 2. Apply global specs to all rooms.
    // IMPORTANT: a room's own door_style/collection/finish — set during PDF
    // extraction for multi-display manufacturer catalogs where each display
    // has its own style (see backend/app/utils/display_catalog_extractor.py)
    // — takes priority over the single project-wide dropdown value. Ordinary
    // single-style drawings never populate these on the room, so they fall
    // through to the global value exactly as before.
    const updatedRooms = (project.extracted_data?.rooms || []).map((room: any) => ({
      ...room,
      collection: room.collection || collection,
      door_style: room.door_style || doorStyle,
      box_construction: room.box_construction || allSpecs.box_construction || '',
      finish: room.finish || allSpecs.finish || '',
      wood_species: room.wood_species || allSpecs.wood_species || '',
      drawer_box: room.drawer_box || allSpecs.drawer_box || ''
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
    const res = await authFetch(`${BACKEND_URL}/api/generate-bom?project_id=${projectId}&manufacturer_id=${manufacturerId}`, {
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
