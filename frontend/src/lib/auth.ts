import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { createServerSupabase } from '@/lib/supabase-server';

export { SESSION_COOKIE };

export type Role = 'super_admin' | 'dealer_admin';

export interface CurrentUser {
  uid: string;
  email: string;
  orgId: string;
  orgName: string;
  role: Role;
  onboarded: boolean; // company finished /setup
}

export const BACKEND_URL = (
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'
).replace(/\/$/, '');

/** Raw session cookie of the current request (or null). */
export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Verifies our signed session cookie and loads the user's profile
 * (org + role) from Supabase. Returns null if anything is missing or invalid.
 * Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  const supabase = createServerSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, role, status, org_id, token_version, organizations(name, status, onboarding_completed_at)')
    .eq('id', session.sub)
    .maybeSingle();

  const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
  if (!profile || profile.status === 'disabled' || !org || org.status !== 'active') return null;
  if ((profile.token_version ?? 0) !== session.v) return null; // signed out everywhere (password reset)

  return {
    uid: session.sub,
    email: profile.email,
    orgId: profile.org_id,
    orgName: org.name,
    role: profile.role as Role,
    onboarded: !!org.onboarding_completed_at,
  };
});

/** For pages, layouts, server actions and route handlers that need a logged-in user. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'super_admin') redirect(homeFor(user));
  return user;
}

/** For company pages (/app/*): super admin goes to their section; unfinished setup goes to /setup. */
export async function requireDealerAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role === 'super_admin') redirect('/super-admin/dashboard');
  if (!user.onboarded) redirect('/setup');
  return user;
}

/** For the setup wizard: only company members who have not finished setup. */
export async function requireSetupUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role === 'super_admin') redirect('/super-admin/dashboard');
  if (user.onboarded) redirect('/');
  return user;
}

/**
 * Where a signed-in user lands, decided here and nowhere else:
 *  - KABS super admin        -> /super-admin/dashboard
 *  - company, setup unfinished -> /setup
 *  - company, setup finished   -> / (home — Dashboard is one click away via the sidebar)
 */
export function homeFor(user: { role: Role; onboarded: boolean }): string {
  if (user.role === 'super_admin') return '/super-admin/dashboard';
  return user.onboarded ? '/' : '/setup';
}

/** For API route handlers: returns a 401 Response instead of redirecting. */
export async function apiUser(): Promise<{ user: CurrentUser } | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  return { user };
}

/** Headers to call the FastAPI backend as the current user (server-side). */
export async function backendAuthHeaders(extra: Record<string, string> = {}) {
  const token = await getSessionToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** fetch() to the FastAPI backend as the current user (server-side only). */
export async function authFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = await getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Next.js's fetch() caches GET requests server-side (the Data Cache) by
  // default, independent of the backend's own state — restarting the
  // backend, or fixing data directly in the DB, did NOT bust it. Every
  // caller of authFetch is live business data (pricing, catalog config,
  // project state) that must never be served stale from an in-process
  // cache the user has no way to invalidate — a dealer could see outdated
  // prices/door-styles indefinitely. `init.cache` can still override this
  // per call if a caller genuinely wants caching.
  return fetch(input, { cache: 'no-store', ...init, headers });
}
