'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { logUsage } from '@/lib/usage';
import { DEFAULT_RULES, type Method, type PricingRules, type WorksheetItem } from './pricing';

export interface Manufacturer { id: string; name: string; }

/** All manufacturers this org can access (own + platform shared). */
export async function loadManufacturers(): Promise<Manufacturer[]> {
  await requireUser();
  const supabase = await scopedDb();
  const { data } = await supabase.from('manufacturers').select('id, name').order('name');
  return (data ?? []).map(r => ({ id: r.id as string, name: r.name as string }));
}

/**
 * Look up list prices for a batch of SKU codes from manufacturer_pricing.
 * For Marsh (price_column model) the doorStyle is the price column name (e.g. "APEX").
 * Returns a map of UPPER-CASED sku → price. Missing SKUs are omitted.
 */
export async function lookupSkuPrices(
  manufacturerId: string,
  doorStyle: string,
  skus: string[],
): Promise<Record<string, number>> {
  await requireUser();
  if (!manufacturerId || !doorStyle || !skus.length) return {};
  const supabase = await scopedDb();
  const upperSkus = [...new Set(skus.map(s => s.toUpperCase().trim()).filter(Boolean))];
  const { data } = await supabase
    .from('manufacturer_pricing')
    .select('sku, price')
    .eq('manufacturer_id', manufacturerId)
    .eq('door_style', doorStyle.toUpperCase())
    .in('sku', upperSkus);
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row.sku) out[(row.sku as string).toUpperCase()] = row.price as number;
  }
  return out;
}

export type ElevateApprovalStatus = 'draft' | 'in_review' | 'approved' | 'sent';

export interface ReviewHistoryEntry {
  status: ElevateApprovalStatus;
  by: string;
  at: string;
  note: string;
}

/** Module 5 — advance or revert the approval status, optionally with a note. */
export async function setElevateApprovalAction(
  status: ElevateApprovalStatus,
  note = '',
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await requireUser();
  try {
    const supabase = await scopedDb();

    // Append to history
    const { data: existing } = await supabase
      .from('elevate_pricing_profiles')
      .select('review_history')
      .eq('name', 'Default')
      .maybeSingle();
    const history: ReviewHistoryEntry[] = (existing?.review_history as ReviewHistoryEntry[] | null) ?? [];
    const entry: ReviewHistoryEntry = {
      status,
      by: user.email ?? user.id,
      at: new Date().toISOString(),
      note: note.trim(),
    };
    history.push(entry);

    const patch: Record<string, unknown> = {
      approval_status: status,
      review_notes: note.trim() || null,
      review_history: history,
    };
    if (status === 'approved') {
      patch.approved_at = new Date().toISOString();
      patch.approved_by = user.email ?? user.id;
    }
    if (status === 'draft') {
      patch.approved_at = null;
      patch.approved_by = null;
    }

    const { error } = await supabase
      .from('elevate_pricing_profiles')
      .update(patch)
      .eq('name', 'Default');
    if (error) throw error;
    revalidatePath('/elevate');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message as string };
  }
}

export type SkuMatchStatus = 'exact' | 'variant' | 'wrong_style' | 'not_found';

export interface SkuMatchResult {
  sku: string;
  status: SkuMatchStatus;
  price: number | null;
  suggestion: string | null;
}

/**
 * Module 3 — SKU Confidence Scoring.
 * For each SKU: exact match → price returned; variant → closest size suggested;
 * not_found → no match in catalog for this manufacturer/door style.
 */
export async function validateSkuMatches(
  manufacturerId: string,
  doorStyle: string,
  skus: string[],
): Promise<SkuMatchResult[]> {
  await requireUser();
  if (!manufacturerId || !doorStyle || !skus.length) return [];
  const supabase = await scopedDb();
  const door = doorStyle.toUpperCase();
  const upperSkus = [...new Set(skus.map(s => s.toUpperCase().trim()).filter(Boolean))];

  // Fetch all rows for this manufacturer + door_style
  const { data: exactRows } = await supabase
    .from('manufacturer_pricing')
    .select('sku, price')
    .eq('manufacturer_id', manufacturerId)
    .eq('door_style', door)
    .limit(10000);
  const catalog: Record<string, number> = {};
  for (const r of exactRows ?? []) {
    if (r.sku) catalog[(r.sku as string).toUpperCase()] = r.price as number;
  }

  // Fetch all SKUs for this manufacturer (all door styles) — for wrong_style detection
  const { data: allRows } = await supabase
    .from('manufacturer_pricing')
    .select('sku')
    .eq('manufacturer_id', manufacturerId)
    .limit(10000);
  const allSkus = new Set((allRows ?? []).map(r => ((r.sku as string) ?? '').toUpperCase()));

  return upperSkus.map(sku => {
    if (sku in catalog) {
      return { sku, status: 'exact' as const, price: catalog[sku], suggestion: null };
    }

    // Try to find a variant: same alpha prefix, closest size
    const m = sku.match(/^([A-Z]+)(\d+)(.*)$/);
    if (m) {
      const [, prefix, numStr, suffix] = m;
      const targetNum = parseInt(numStr, 10);
      let candidates = Object.keys(catalog).filter(
        s => s.startsWith(prefix) && s.endsWith(suffix)
      );
      if (!candidates.length) {
        candidates = Object.keys(catalog).filter(s => s.startsWith(prefix));
      }
      if (candidates.length) {
        candidates.sort((a, b) => {
          const na = parseInt((a.match(/\d+/) ?? ['0'])[0], 10);
          const nb = parseInt((b.match(/\d+/) ?? ['0'])[0], 10);
          return Math.abs(na - targetNum) - Math.abs(nb - targetNum);
        });
        return { sku, status: 'variant' as const, price: null, suggestion: candidates[0] };
      }
    }

    if (allSkus.has(sku)) {
      return { sku, status: 'wrong_style' as const, price: null, suggestion: null };
    }
    return { sku, status: 'not_found' as const, price: null, suggestion: null };
  });
}

const PROFILE_NAME = 'Default';

export interface SavedProfile {
  rules: PricingRules;
  method: Method;
  items: WorksheetItem[];
  approvalStatus?: ElevateApprovalStatus;
  approvedAt?: string | null;
  approvedBy?: string | null;
  reviewNotes?: string | null;
  reviewHistory?: ReviewHistoryEntry[];
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Only accept the shape we write. Anything else falls back to defaults. */
function sanitizeRules(raw: any): PricingRules {
  const r = { ...DEFAULT_RULES };
  if (!raw || typeof raw !== 'object') return r;
  for (const k of ['costFactor', 'builderDiscountPct', 'markupPct', 'installation', 'delivery', 'freight', 'threePl', 'hardware', 'taxPct'] as const) {
    if (isNum(raw[k])) r[k] = raw[k];
  }
  r.grossProfitTargetPct = isNum(raw.grossProfitTargetPct) ? raw.grossProfitTargetPct : 0;
  r.taxOnCharges = raw.taxOnCharges === true;
  return r;
}

function sanitizeItems(raw: any): WorksheetItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 2000).map((i) => ({
    code: String(i?.code ?? '').slice(0, 80),
    description: String(i?.description ?? '').slice(0, 300),
    qty: isNum(i?.qty) ? i.qty : 0,
    listPrice: isNum(i?.listPrice) ? i.listPrice : 0,
    category: 'cabinet' as const,
  }));
}

/** This company's saved Elevate pricing profile, or null if nothing is saved yet. */
export async function loadPricingProfile(): Promise<SavedProfile | null> {
  await requireUser();
  const supabase = await scopedDb();
  const { data, error } = await supabase
    .from('elevate_pricing_profiles')
    .select('method, rules, items, approval_status, approved_at, approved_by, review_notes, review_history')
    .eq('name', PROFILE_NAME)
    .maybeSingle();
  if (error) {
    console.error('Load Elevate profile error:', error.message);
    return null;
  }
  if (!data) return null;
  const approvalStatus = (['draft', 'in_review', 'approved', 'sent'] as ElevateApprovalStatus[])
    .includes(data.approval_status) ? data.approval_status as ElevateApprovalStatus : 'draft';
  return {
    rules: sanitizeRules(data.rules),
    method: data.method === 'gp' ? 'gp' : 'markup',
    items: sanitizeItems(data.items),
    approvalStatus,
    approvedAt: data.approved_at ?? null,
    approvedBy: data.approved_by ?? null,
    reviewNotes: data.review_notes ?? null,
    reviewHistory: Array.isArray(data.review_history) ? (data.review_history as ReviewHistoryEntry[]) : [],
  };
}

export async function savePricingProfile(input: SavedProfile) {
  const user = await requireUser();
  try {
    const supabase = await scopedDb();
    const row = {
      name: PROFILE_NAME,
      method: input.method === 'gp' ? 'gp' : 'markup',
      rules: sanitizeRules(input.rules),
      items: sanitizeItems(input.items),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('elevate_pricing_profiles').upsert([row], { onConflict: 'org_id,name' });
    if (error) throw error;

    await logUsage(user, 'elevate.pricing_save', { items: row.items.length });
    revalidatePath('/elevate');
    return { success: true as const };
  } catch (err: any) {
    console.error('Save Elevate profile error:', err);
    return { success: false as const, error: err.message as string };
  }
}
