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
  'manufacturer_org_hidden',
  'labor_charges',
  'install_rules',
  'install_rule_overrides',
  'nkba_files',
  'quotation_projects',
  'quotation_boms',
  'manufacturer_detections',
  'usage_events',
]);

/**
 * Super Admin's org — this is where the platform's shared manufacturer
 * catalog (brands, spec/pricing files, per-SKU pricing) is curated and
 * lives. Every other org reads it read-only, in addition to anything of
 * their own, instead of each dealer having to re-upload the same catalog
 * under their own org_id. Writes to these tables stay org-scoped as
 * before (a dealer can still only insert/update/delete their own rows —
 * the UI layer is responsible for not offering create/edit on manufacturer
 * records to non-Super-Admin users; see features/setup/manufacturers-step.tsx
 * and features/manufacturers/actions.ts).
 * Keep in sync with backend/app/core/supabase_client.py and
 * backend/app/core/storage.py (_check_tenant).
 */
export const PLATFORM_ORG_ID = '00000000-0000-0000-0000-0000000000a1';

const SHARED_CATALOG_TABLES = new Set([
  'manufacturers',
  'manufacturer_files',
  'manufacturer_pricing',
  'manufacturer_specifications',
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
          const shareRead = SHARED_CATALOG_TABLES.has(table) && orgId !== PLATFORM_ORG_ID;
          return {
            select: (...a: any[]) =>
              shareRead
                ? q.select(...a).or(`org_id.eq.${orgId},org_id.eq.${PLATFORM_ORG_ID}`)
                : q.select(...a).eq('org_id', orgId),
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
