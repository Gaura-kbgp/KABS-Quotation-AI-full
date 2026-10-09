import 'server-only';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth';

/**
 * Tenant-scoped Supabase client for server code.
 *
 * Every query on a company-owned table is automatically limited to the
 * signed-in user's company (org_id), and every insert/upsert is stamped with
 * it. A request that passes someone else's id simply finds nothing.
 *
 * Use `createServerSupabase()` (unscoped) only for platform tables
 * (profiles, organizations, auth_tokens) and Super Admin jobs.
 * Keep TENANT_TABLES in sync with docs/multitenant_001_add_orgs.sql
 * and backend/app/core/supabase_client.py.
 */
const TENANT_TABLES = new Set([
  'manufacturers',
  'manufacturer_files',
  'manufacturer_pricing',
  'manufacturer_specifications',
  'labor_charges',
  'install_rules',
  'install_rule_overrides',
  'nkba_files',
  'training_documents',
  'quotation_projects',
  'quotation_boms',
  'elevate_pricing_profiles',
  'manufacturer_detections',
  'usage_events',
]);

const stamp = (rows: any, orgId: string) =>
  Array.isArray(rows) ? rows.map((r) => ({ ...r, org_id: orgId })) : { ...rows, org_id: orgId };

export function scopedFor(orgId: string) {
  const raw = createServerSupabase();
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => {
          const q: any = target.from(table);
          if (!TENANT_TABLES.has(table)) return q;
          return {
            select: (...a: any[]) => q.select(...a).eq('org_id', orgId),
            update: (...a: any[]) => q.update(...a).eq('org_id', orgId),
            delete: (...a: any[]) => q.delete(...a).eq('org_id', orgId),
            insert: (rows: any, ...rest: any[]) => q.insert(stamp(rows, orgId), ...rest),
            upsert: (rows: any, ...rest: any[]) => q.upsert(stamp(rows, orgId), ...rest),
          };
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as typeof raw;
}

/** The signed-in user's company-scoped client. Throws if nobody is signed in. */
export async function scopedDb() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  return scopedFor(user.orgId);
}
