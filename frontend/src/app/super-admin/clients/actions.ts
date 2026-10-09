'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperAdmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase-server';
import { normEmail } from '@/lib/profiles';

export interface ClientRow {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  created_at: string;
  admin_email: string | null;
  admin_status: string | null;
  manufacturers: number;
  spec_books: number;
  pricing_sheets: number;
  pricing_rows: number;
  projects: number;
}

async function logAction(action: string, targetOrgId: string | null, targetOrgName: string, details: Record<string, unknown> = {}) {
  const admin = await requireSuperAdmin();
  await createServerSupabase().from('audit_log').insert({
    actor_profile_id: admin.uid,
    actor_email: admin.email,
    action,
    target_org_id: targetOrgId,
    target_org_name: targetOrgName,
    details,
  });
}

export async function listClients(): Promise<ClientRow[]> {
  await requireSuperAdmin();
  const supabase = createServerSupabase();

  // Three queries total, regardless of how many clients exist.
  const [orgsRes, statsRes, adminsRes] = await Promise.all([
    supabase.from('organizations').select('id, name, status, created_at').eq('is_owner', false).order('created_at', { ascending: false }),
    supabase.rpc('client_stats'),
    supabase.from('profiles').select('org_id, email, status').eq('role', 'dealer_admin'),
  ]);
  if (orgsRes.error) throw orgsRes.error;
  if (statsRes.error) throw statsRes.error;
  if (adminsRes.error) throw adminsRes.error;

  const stats = new Map<string, any>((statsRes.data || []).map((s: any) => [s.org_id, s]));
  const admins = new Map<string, any>((adminsRes.data || []).map((a: any) => [a.org_id, a]));

  return (orgsRes.data || []).map((org): ClientRow => {
    const s = stats.get(org.id);
    const admin = admins.get(org.id);
    return {
      id: org.id,
      name: org.name,
      status: org.status,
      created_at: org.created_at,
      admin_email: admin?.email ?? null,
      admin_status: admin?.status ?? null,
      manufacturers: Number(s?.manufacturers ?? 0),
      spec_books: Number(s?.spec_books ?? 0),
      pricing_sheets: Number(s?.pricing_sheets ?? 0),
      pricing_rows: Number(s?.pricing_rows ?? 0),
      projects: Number(s?.projects ?? 0),
    };
  });
}

export interface ClientManufacturer {
  id: string;
  name: string;
  status: string;
  spec_books: number;
  pricing_sheets: number;
}

/** The actual manufacturers a client has added, with their file counts. */
export async function getClientManufacturers(orgId: string): Promise<ClientManufacturer[]> {
  await requireSuperAdmin();
  const supabase = createServerSupabase();

  const { data: mfgs, error } = await supabase
    .from('manufacturers')
    .select('id, name, status')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  if (!mfgs || mfgs.length === 0) return [];

  const { data: files } = await supabase
    .from('manufacturer_files')
    .select('manufacturer_id, file_type')
    .eq('org_id', orgId);

  const counts = new Map<string, { spec: number; pricing: number }>();
  for (const f of files || []) {
    const c = counts.get(f.manufacturer_id) || { spec: 0, pricing: 0 };
    if (f.file_type === 'spec') c.spec += 1;
    if (f.file_type === 'pricing') c.pricing += 1;
    counts.set(f.manufacturer_id, c);
  }

  return mfgs.map((m) => ({
    id: m.id,
    name: m.name,
    status: m.status,
    spec_books: counts.get(m.id)?.spec || 0,
    pricing_sheets: counts.get(m.id)?.pricing || 0,
  }));
}

export interface AuditRow {
  id: string;
  action: string;
  actor_email: string | null;
  target_org_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export async function listAuditLog(limit = 30): Promise<AuditRow[]> {
  await requireSuperAdmin();
  const { data, error } = await createServerSupabase()
    .from('audit_log')
    .select('id, action, actor_email, target_org_name, details, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

const NAME_RE = /^.{2,120}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function createClient(input: { companyName: string; adminEmail: string }) {
  try {
    await requireSuperAdmin();
    const name = input.companyName.trim();
    const email = normEmail(input.adminEmail || '');
    if (!NAME_RE.test(name)) return { success: false, error: 'Please enter a valid company name.' };
    if (!EMAIL_RE.test(email)) return { success: false, error: 'Please enter a valid admin email.' };

    const supabase = createServerSupabase();

    const { data: existing } = await supabase.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (existing) return { success: false, error: 'An account with this email already exists.' };

    const { data: org, error: orgErr } = await supabase.from('organizations').insert({ name }).select('id').single();
    if (orgErr) throw orgErr;

    const { error: profErr } = await supabase
      .from('profiles')
      .insert({ org_id: org.id, email, role: 'dealer_admin', status: 'invited' });
    if (profErr) {
      await supabase.from('organizations').delete().eq('id', org.id);
      throw profErr;
    }

    await logAction('client.create', org.id, name, { admin_email: email });
    revalidatePath('/super-admin/clients');
    return {
      success: true,
      message: `${name} created. They can sign in with Google or "Create account" using ${email} — it will link to this company automatically.`,
    };
  } catch (err: any) {
    console.error('[createClient]', err);
    return { success: false, error: err.message || 'Could not create the client.' };
  }
}

export async function setClientStatus(orgId: string, status: 'active' | 'suspended') {
  try {
    await requireSuperAdmin();
    const supabase = createServerSupabase();
    const { data: org, error: fetchErr } = await supabase.from('organizations').select('name, is_owner').eq('id', orgId).single();
    if (fetchErr) throw fetchErr;
    if (org.is_owner) return { success: false, error: 'Cannot change status of the KABS account.' };

    const { error } = await supabase.from('organizations').update({ status }).eq('id', orgId);
    if (error) throw error;

    await logAction(status === 'active' ? 'client.reactivate' : 'client.suspend', orgId, org.name);
    revalidatePath('/super-admin/clients');
    return { success: true };
  } catch (err: any) {
    console.error('[setClientStatus]', err);
    return { success: false, error: err.message || 'Could not update status.' };
  }
}

export async function deleteClient(orgId: string) {
  try {
    await requireSuperAdmin();
    const supabase = createServerSupabase();
    const { data: org, error: fetchErr } = await supabase.from('organizations').select('name, is_owner').eq('id', orgId).single();
    if (fetchErr) throw fetchErr;
    if (org.is_owner) return { success: false, error: 'Cannot delete the KABS account.' };

    const [mfg, pricing, proj] = await Promise.all([
      supabase.from('manufacturers').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('manufacturer_pricing').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('quotation_projects').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    ]);

    // Deleting the organization cascades: profiles, manufacturers, pricing,
    // files, labor charges, rules, NKBA files, training docs, projects, BOMs.
    const { error } = await supabase.from('organizations').delete().eq('id', orgId);
    if (error) throw error;

    await logAction('client.delete', null, org.name, {
      manufacturers: mfg.count || 0,
      pricing_rows: pricing.count || 0,
      projects: proj.count || 0,
    });
    revalidatePath('/super-admin/clients');
    return { success: true };
  } catch (err: any) {
    console.error('[deleteClient]', err);
    return { success: false, error: err.message || 'Could not delete the client.' };
  }
}
