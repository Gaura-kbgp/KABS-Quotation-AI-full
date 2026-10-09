import 'server-only';
import { requireSuperAdmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase-server';

export interface PlatformStats {
  totalClients: number;
  activeClients: number;
  totalUsers: number;
  manufacturers: number;
  specBooks: number;
  pricingSheets: number;
  projects: number;
}

/** Platform-wide totals across every client (never scoped to one company). */
export async function getPlatformStats(): Promise<PlatformStats> {
  await requireSuperAdmin();
  const supabase = createServerSupabase();

  const { data: clientOrgs } = await supabase.from('organizations').select('id, status').eq('is_owner', false);
  const orgIds = (clientOrgs || []).map((o) => o.id);
  const activeClients = (clientOrgs || []).filter((o) => o.status === 'active').length;

  if (orgIds.length === 0) {
    return { totalClients: 0, activeClients: 0, totalUsers: 0, manufacturers: 0, specBooks: 0, pricingSheets: 0, projects: 0 };
  }

  const [users, mfg, specs, pricing, projects] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).in('org_id', orgIds),
    supabase.from('manufacturers').select('id', { count: 'exact', head: true }).in('org_id', orgIds),
    supabase.from('manufacturer_files').select('id', { count: 'exact', head: true }).in('org_id', orgIds).eq('file_type', 'spec'),
    supabase.from('manufacturer_files').select('id', { count: 'exact', head: true }).in('org_id', orgIds).eq('file_type', 'pricing'),
    supabase.from('quotation_projects').select('id', { count: 'exact', head: true }).in('org_id', orgIds),
  ]);

  return {
    totalClients: orgIds.length,
    activeClients,
    totalUsers: users.count || 0,
    manufacturers: mfg.count || 0,
    specBooks: specs.count || 0,
    pricingSheets: pricing.count || 0,
    projects: projects.count || 0,
  };
}
