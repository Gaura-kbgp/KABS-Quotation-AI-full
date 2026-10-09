import 'server-only';
import { requireSuperAdmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase-server';

export interface UsageEvent {
  id: string;
  event_type: string;
  actor_email: string | null;
  org_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ByClientRow {
  org_id: string;
  org_name: string;
  total: number;
  byType: Record<string, number>;
  lastActivity: string | null;
}

export interface ByUserRow {
  actor_email: string;
  org_name: string | null;
  total: number;
  byType: Record<string, number>;
  lastActivity: string | null;
}

export const EVENT_LABEL: Record<string, string> = {
  'manufacturer.create': 'Manufacturer added',
  'file.spec_upload': 'Spec book uploaded',
  'file.pricing_upload': 'Pricing sheet uploaded',
  'file.nkba_upload': 'NKBA rules uploaded',
  'drawing.upload': 'Drawing uploaded',
  'bom.generate': 'BOM / quote generated',
};

const WINDOW = 2000; // most recent N events considered

/** Platform-wide tool usage: recent events + per-client and per-user breakdowns. */
export async function getUsageOverview() {
  await requireSuperAdmin();
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from('usage_events')
    .select('id, org_id, event_type, actor_email, details, created_at, organizations(name)')
    .order('created_at', { ascending: false })
    .limit(WINDOW);
  if (error) throw error;

  const rows = (data || []).map((r: any) => ({
    id: r.id as string,
    org_id: r.org_id as string,
    event_type: r.event_type as string,
    actor_email: r.actor_email as string | null,
    org_name: (Array.isArray(r.organizations) ? r.organizations[0] : r.organizations)?.name ?? null,
    details: r.details || {},
    created_at: r.created_at as string,
  }));

  const byClient = new Map<string, ByClientRow>();
  const byUser = new Map<string, ByUserRow>();

  for (const r of rows) {
    const c: ByClientRow = byClient.get(r.org_id) || { org_id: r.org_id, org_name: r.org_name || 'Unknown', total: 0, byType: {}, lastActivity: null };
    c.total += 1;
    c.byType[r.event_type] = (c.byType[r.event_type] || 0) + 1;
    if (!c.lastActivity || r.created_at > c.lastActivity) c.lastActivity = r.created_at;
    byClient.set(r.org_id, c);

    const email = r.actor_email || 'unknown';
    const u: ByUserRow = byUser.get(email) || { actor_email: email, org_name: r.org_name, total: 0, byType: {}, lastActivity: null };
    u.total += 1;
    u.byType[r.event_type] = (u.byType[r.event_type] || 0) + 1;
    if (!u.lastActivity || r.created_at > u.lastActivity) u.lastActivity = r.created_at;
    byUser.set(email, u);
  }

  return {
    recent: rows.slice(0, 50) as UsageEvent[],
    byClient: Array.from(byClient.values()).sort((a, b) => b.total - a.total),
    byUser: Array.from(byUser.values()).sort((a, b) => b.total - a.total),
    windowSize: rows.length,
    windowCapped: rows.length === WINDOW,
  };
}
