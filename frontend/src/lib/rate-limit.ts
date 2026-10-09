import 'server-only';

/**
 * Simple in-memory limiter for sign-in / signup / reset attempts.
 * (Per server instance: fine for the single-container deployment.)
 */
const hits = new Map<string, { count: number; resetAt: number }>();

/** Returns true if the action is allowed, false if the limit is exceeded. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}
