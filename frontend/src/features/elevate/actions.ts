'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { logUsage } from '@/lib/usage';
import { DEFAULT_RULES, buildWorksheet, type Method, type PricingRules, type WorksheetItem } from './pricing';

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

// Approval used to be tracked here (draft/in_review/approved/sent on this single
// org-wide profile row), but elevate_pricing_profiles isn't tied to any one
// quotation — it couldn't reflect a real per-customer review. The actual approval
// gate is setReviewStatusAction() in app/quotation-ai/actions.ts, scoped to the
// quotation project and its BOM (which also blocks on unconfirmed catalog prices).
// This file keeps the pricing worksheet (rules/method/items) only.

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

/**
 * The saved Elevate pricing worksheet, or null if nothing is saved yet.
 * With a projectId, loads that project's own worksheet (one per project).
 * Without one, loads the legacy org-wide scratchpad (name='Default', no project).
 */
export async function loadPricingProfile(projectId?: string): Promise<SavedProfile | null> {
  await requireUser();
  const supabase = await scopedDb();
  let query = supabase.from('elevate_pricing_profiles').select('method, rules, items');
  query = projectId ? query.eq('project_id', projectId) : query.eq('name', PROFILE_NAME).is('project_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('Load Elevate profile error:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    rules: sanitizeRules(data.rules),
    method: data.method === 'gp' ? 'gp' : 'markup',
    items: sanitizeItems(data.items),
  };
}

export async function savePricingProfile(input: SavedProfile, projectId?: string) {
  const user = await requireUser();
  try {
    const supabase = await scopedDb();
    // Per-project rows use name = the project id, so the existing (org_id, name)
    // unique constraint still gives one row per project without touching the DB
    // constraint — see docs/multitenant_014_elevate_per_project.sql.
    const row: Record<string, unknown> = {
      name: projectId ?? PROFILE_NAME,
      project_id: projectId ?? null,
      method: input.method === 'gp' ? 'gp' : 'markup',
      rules: sanitizeRules(input.rules),
      items: sanitizeItems(input.items),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('elevate_pricing_profiles').upsert([row], { onConflict: 'org_id,name' });
    if (error) throw error;

    await logUsage(user, 'elevate.pricing_save', { items: (row.items as unknown[]).length, project_id: projectId ?? null });
    revalidatePath(projectId ? `/quotation-ai/elevate/${projectId}` : '/elevate');
    return { success: true as const };
  } catch (err: any) {
    console.error('Save Elevate profile error:', err);
    return { success: false as const, error: err.message as string };
  }
}

/**
 * Push this project's Elevate worksheet into the shared BOM (quotation_boms), the
 * same table generate-bom and Blueprint's apply-to-project write into — so it goes
 * through the same confirmed-price gate and staff review as everything else.
 * Replaces any Elevate-origin rows from a previous apply for this project (tagged
 * by price_source) so re-applying after editing the worksheet doesn't duplicate.
 */
export async function applyElevateToProject(projectId: string) {
  const user = await requireUser();
  try {
    const supabase = await scopedDb();
    const { data: profileRow, error: loadErr } = await supabase
      .from('elevate_pricing_profiles')
      .select('method, rules, items')
      .eq('project_id', projectId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!profileRow) return { success: false as const, error: 'No saved worksheet for this project yet — add items and save first.' };

    const items = sanitizeItems(profileRow.items);
    if (!items.length) return { success: false as const, error: 'Worksheet has no items.' };

    const rules = sanitizeRules(profileRow.rules);
    const method = profileRow.method === 'gp' ? 'gp' : 'markup';
    const ws = buildWorksheet(items, effectiveRulesFor(rules, method));

    const PRICE_SOURCE = 'Elevate Worksheet';
    const { error: delErr } = await supabase
      .from('quotation_boms')
      .delete()
      .eq('project_id', projectId)
      .eq('price_source', PRICE_SOURCE);
    if (delErr) throw delErr;

    const rows = ws.lines.map(line => ({
      project_id: projectId,
      sku: line.code,
      matched_sku: line.code,
      qty: line.qty,
      unit_price: line.qty > 0 ? round2(line.extendedSell / line.qty) : 0,
      line_total: round2(line.extendedSell),
      room: 'Elevate Worksheet',
      precision_level: 'ELEVATE_WORKSHEET',
      price_confirmed: true, // staff authored this pricing deliberately via the worksheet's own rules
      price_source: PRICE_SOURCE,
      description: line.description || null,
      cabinet_type: 'elevate_item',
      match_explanation: `Priced via Elevate worksheet (${method === 'gp' ? `${rules.grossProfitTargetPct ?? 0}% GP target` : `${rules.markupPct}% markup`} on ${rules.costFactor} cost factor)`,
      is_billable: true,
    }));

    const { error: insErr } = await supabase.from('quotation_boms').insert(rows);
    if (insErr) throw insErr;

    await logUsage(user, 'elevate.apply_to_project', { project_id: projectId, items: rows.length });
    revalidatePath(`/quotation-ai/bom/${projectId}`);
    revalidatePath(`/quotation-ai/elevate/${projectId}`);
    return { success: true as const, count: rows.length };
  } catch (err: any) {
    console.error('Apply Elevate to project error:', err);
    return { success: false as const, error: err.message as string };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function effectiveRulesFor(rules: PricingRules, method: Method): PricingRules {
  return { ...rules, grossProfitTargetPct: method === 'gp' ? rules.grossProfitTargetPct ?? 0 : null };
}
