import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createServerSupabase } from '@/lib/supabase-server';
import { hashPassword, verifyPassword } from '@/lib/password';

export type SignInResult =
  | { ok: true; profileId: string; version: number; role: 'super_admin' | 'dealer_admin'; onboarded: boolean }
  | { ok: false; code: 'invalid' | 'unverified' | 'suspended' | 'disabled' | 'unverified_google' };

const SELECT = 'id, email, role, status, org_id, token_version, password_hash, email_verified, google_sub, organizations(status, onboarding_completed_at)';

const orgStatus = (p: any) => (Array.isArray(p.organizations) ? p.organizations[0] : p.organizations)?.status;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
export const normEmail = (e: string) => e.trim().toLowerCase();

async function findByEmail(email: string) {
  const { data } = await createServerSupabase().from('profiles').select(SELECT).ilike('email', escapeLike(email)).maybeSingle();
  return data as any;
}

function gate(p: any): SignInResult {
  if (p.status === 'disabled') return { ok: false, code: 'disabled' };
  if (orgStatus(p) !== 'active') return { ok: false, code: 'suspended' };
  const org = Array.isArray(p.organizations) ? p.organizations[0] : p.organizations;
  return { ok: true, profileId: p.id, version: p.token_version ?? 0, role: p.role, onboarded: !!org?.onboarding_completed_at };
}

async function createCompanyAndProfile(companyName: string, fields: Record<string, unknown>) {
  const supabase = createServerSupabase();
  const { data: org, error: orgErr } = await supabase.from('organizations').insert({ name: companyName }).select('id').single();
  if (orgErr) throw orgErr;
  const { data: profile, error } = await supabase
    .from('profiles')
    .insert({ org_id: org.id, role: 'dealer_admin', ...fields })
    .select(SELECT)
    .single();
  if (error) {
    await supabase.from('organizations').delete().eq('id', org.id); // no empty company left behind
    throw error;
  }
  return profile as any;
}

/* ───────────────────────── Google ───────────────────────── */

/**
 * returning user (matched by Google id) -> pre-created/password profile with the
 * same email (linked) -> brand-new person (own company + dealer admin).
 */
export async function signInGoogleUser(g: { sub: string; email: string; emailVerified: boolean; name?: string }): Promise<SignInResult> {
  if (!g.emailVerified) return { ok: false, code: 'unverified_google' };
  const supabase = createServerSupabase();
  const email = normEmail(g.email);

  let { data: profile } = await supabase.from('profiles').select(SELECT).eq('google_sub', g.sub).maybeSingle();

  if (!profile) {
    const existing = await findByEmail(email);
    if (existing) {
      // Google proved ownership of this email. If the email was never verified, whoever
      // registered it with a password is not necessarily the owner, so drop that password.
      const patch: Record<string, unknown> = { google_sub: g.sub, email_verified: true, status: existing.status === 'disabled' ? 'disabled' : 'active' };
      if (!existing.email_verified) patch.password_hash = null;
      const { data: linked, error } = await supabase.from('profiles').update(patch).eq('id', existing.id).select(SELECT).single();
      if (error) throw error;
      profile = linked;
    }
  }

  if (!profile) {
    profile = await createCompanyAndProfile((g.name || '').trim().slice(0, 120) || email.split('@')[0], {
      google_sub: g.sub, email, status: 'active', email_verified: true,
    });
  }
  return gate(profile);
}

/* ───────────────────── Email + password ───────────────────── */

const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function issueToken(profileId: string, kind: 'verify' | 'reset'): Promise<string> {
  const supabase = createServerSupabase();
  await supabase.from('auth_tokens').delete().eq('profile_id', profileId).eq('kind', kind).is('used_at', null);
  const token = randomBytes(32).toString('hex');
  const ttl = kind === 'verify' ? 24 * 3600e3 : 3600e3;
  const { error } = await supabase.from('auth_tokens').insert({
    profile_id: profileId, kind, token_hash: tokenHash(token), expires_at: new Date(Date.now() + ttl).toISOString(),
  });
  if (error) throw error;
  return token;
}

/** One-time use: returns the profile id if the token is valid, else null. */
export async function consumeToken(token: string, kind: 'verify' | 'reset'): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const { data } = await createServerSupabase()
    .from('auth_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash(token)).eq('kind', kind)
    .is('used_at', null).gt('expires_at', new Date().toISOString())
    .select('profile_id').maybeSingle();
  return data?.profile_id ?? null;
}

/**
 * Email verification is switched off until a mail provider (SMTP) is configured:
 * set REQUIRE_EMAIL_VERIFICATION=true to turn it back on.
 */
export const emailVerificationRequired = () => process.env.REQUIRE_EMAIL_VERIFICATION === 'true';

/** Creates the account (company + dealer admin). Returns the profile id; verify mail is sent only when required. */
export async function signUpWithPassword(companyName: string, email: string, password: string) {
  const supabase = createServerSupabase();
  const existing = await findByEmail(email);
  const password_hash = await hashPassword(password);
  const required = emailVerificationRequired();

  if (existing) {
    // Verified accounts can't be re-registered. An unverified one (or a pre-created KABS
    // profile) can be claimed by whoever proves the email by clicking the link.
    if (existing.email_verified) return { exists: true as const };
    const { error } = await supabase.from('profiles').update({ password_hash }).eq('id', existing.id);
    if (error) throw error;
    return { exists: false as const, profileId: existing.id as string, needsVerify: required };
  }

  const p = await createCompanyAndProfile(companyName, {
    email,
    status: required ? 'invited' : 'active',
    password_hash,
    email_verified: !required,
  });
  return { exists: false as const, profileId: p.id as string, needsVerify: required };
}

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const p = await findByEmail(email);
  const ok = await verifyPassword(password, p?.password_hash ?? null); // constant work either way
  if (!p || !ok) return { ok: false, code: 'invalid' };
  if (!p.email_verified && emailVerificationRequired()) return { ok: false, code: 'unverified' };
  return gate(p);
}

export async function markEmailVerified(profileId: string) {
  await createServerSupabase().from('profiles').update({ email_verified: true, status: 'active' }).eq('id', profileId);
}

/** Sets a new password, verifies the email (they just proved it) and signs out all old sessions. */
export async function setNewPassword(profileId: string, password: string) {
  const supabase = createServerSupabase();
  const { data: cur } = await supabase.from('profiles').select('token_version, status').eq('id', profileId).single();
  await supabase.from('profiles').update({
    password_hash: await hashPassword(password),
    email_verified: true,
    status: cur?.status === 'disabled' ? 'disabled' : 'active',
    token_version: (cur?.token_version ?? 0) + 1,
  }).eq('id', profileId);
}

export async function profileIdByEmail(email: string): Promise<string | null> {
  return (await findByEmail(email))?.id ?? null;
}

/* ───────────────────── Env-configured Super Admin ───────────────────── */

/** Constant-time string compare (hash first so differing lengths don't leak timing). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * The one built-in Super Admin account, configured by SUPER_ADMIN_EMAIL /
 * SUPER_ADMIN_PASSWORD in the server's .env — never through public signup.
 * Returns the matching sign-in result only when both the email AND password
 * match the configured values; otherwise null (falls through to the normal
 * database check, so this never widens what any other email can do).
 */
export async function signInEnvSuperAdmin(email: string, password: string): Promise<SignInResult | null> {
  const envEmail = process.env.SUPER_ADMIN_EMAIL;
  const envPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (!envEmail || !envPassword) return null;
  if (!safeEqual(normEmail(email), normEmail(envEmail))) return null;
  if (!safeEqual(password || '', envPassword)) return null;

  const supabase = createServerSupabase();
  const { data: owner, error: ownerErr } = await supabase.from('organizations').select('id').eq('is_owner', true).single();
  if (ownerErr) throw ownerErr;

  // Upsert so the DB profile always matches .env (source of truth for this one account).
  const existing = await findByEmail(normEmail(envEmail));
  let profile: any;
  if (existing) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ role: 'super_admin', org_id: owner.id, status: 'active', email_verified: true })
      .eq('id', existing.id)
      .select(SELECT)
      .single();
    if (error) throw error;
    profile = data;
  } else {
    const { data, error } = await supabase
      .from('profiles')
      .insert({ org_id: owner.id, email: normEmail(envEmail), role: 'super_admin', status: 'active', email_verified: true })
      .select(SELECT)
      .single();
    if (error) throw error;
    profile = data;
  }
  return gate(profile);
}
