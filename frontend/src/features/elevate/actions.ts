'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { logUsage } from '@/lib/usage';
import { DEFAULT_RULES, type Method, type PricingRules, type WorksheetItem } from './pricing';

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
  r.grossProfitTargetPct = isNum(raw.grossProfitTargetPct) ? raw.grossProfitTargetPct : null;
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
    .select('method, rules, items')
    .eq('name', PROFILE_NAME)
    .maybeSingle();
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
