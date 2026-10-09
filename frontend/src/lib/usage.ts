import 'server-only';
import type { CurrentUser } from '@/lib/auth';
import { scopedFor } from '@/lib/db';

/**
 * Lightweight usage tracking: who (which company/user) used which tool, for
 * the Super Admin's Usage page. Never throws — a logging failure must never
 * break the actual feature that triggered it.
 */
export async function logUsage(user: CurrentUser, eventType: string, details: Record<string, unknown> = {}) {
  try {
    const supabase = scopedFor(user.orgId);
    const { error } = await supabase.from('usage_events').insert({
      profile_id: user.uid,
      actor_email: user.email,
      event_type: eventType,
      details,
    });
    if (error) console.error('[logUsage]', eventType, error.message);
  } catch (err) {
    console.error('[logUsage]', eventType, err);
  }
}
