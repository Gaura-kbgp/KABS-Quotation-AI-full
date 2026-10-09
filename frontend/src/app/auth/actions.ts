'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/session';
import { passwordProblem } from '@/lib/password';
import { allow } from '@/lib/rate-limit';
import { sendPasswordResetEmail, sendVerificationEmail } from '@/lib/mailer';
import {
  consumeToken, issueToken, markEmailVerified, normEmail, profileIdByEmail,
  setNewPassword, signInEnvSuperAdmin, signInWithPassword, signUpWithPassword,
} from '@/lib/profiles';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
export type SignInActionResult =
  | { ok: true; role: 'super_admin' | 'dealer_admin'; onboarded: boolean }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MINUTE = 60_000;

async function clientIp() {
  const h = await headers();
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
}

function dbMessage(err: any): string {
  const msg = String(err?.message || '');
  if (msg.includes('SESSION_SECRET')) return 'Sign-in is not configured on the server yet.';
  if (msg.includes('profiles') || msg.includes('organizations') || msg.includes('auth_tokens')) {
    return 'The database is not set up yet (run the multi-tenant SQL migration).';
  }
  return 'Something went wrong. Please try again.';
}

const SIGNIN_ERRORS: Record<string, string> = {
  invalid: 'Incorrect email or password.',
  unverified: 'Please verify your email first. We can send the link again.',
  suspended: 'This company account is suspended. Please contact KABS.',
  disabled: 'This account has been disabled.',
  unverified_google: 'Your Google email is not verified.',
};

export async function signUp(input: { company: string; email: string; password: string }): Promise<ActionResult> {
  try {
    const company = (input.company || '').trim();
    const email = normEmail(input.email || '');
    if (company.length < 2 || company.length > 120) return { ok: false, error: 'Please enter your company name.' };
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
    const problem = passwordProblem(input.password || '');
    if (problem) return { ok: false, error: problem };
    if (!allow(`signup:${await clientIp()}`, 5, 60 * MINUTE)) return { ok: false, error: 'Too many attempts. Please try again later.' };

    const res = await signUpWithPassword(company, email, input.password);
    if (res.exists) return { ok: false, error: 'An account with this email already exists. Please sign in.' };

    if (!res.needsVerify) return { ok: true, message: 'Account created. You can sign in now.' };
    await sendVerificationEmail(email, await issueToken(res.profileId, 'verify'));
    return { ok: true, message: 'Account created. We sent a verification link to your email. Verify it, then sign in.' };
  } catch (err) {
    console.error('[signUp]', err);
    return { ok: false, error: dbMessage(err) };
  }
}

export async function signIn(input: { email: string; password: string }): Promise<SignInActionResult> {
  try {
    const email = normEmail(input.email || '');
    if (!allow(`signin:${await clientIp()}:${email}`, 10, 15 * MINUTE)) {
      return { ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' };
    }
    const res = (await signInEnvSuperAdmin(email, input.password || '')) ?? (await signInWithPassword(email, input.password || ''));
    if (!res.ok) return { ok: false, error: SIGNIN_ERRORS[res.code] };

    (await cookies()).set(SESSION_COOKIE, await signSession(res.profileId, res.version), sessionCookieOptions);
    return { ok: true, role: res.role, onboarded: res.onboarded };
  } catch (err) {
    console.error('[signIn]', err);
    return { ok: false, error: dbMessage(err) };
  }
}

/** Always answers the same, so it can't be used to discover which emails have accounts. */
export async function resendVerification(emailRaw: string): Promise<ActionResult> {
  const generic: ActionResult = { ok: true, message: 'If that account needs verifying, a new link is on its way.' };
  try {
    const email = normEmail(emailRaw || '');
    if (!EMAIL_RE.test(email) || !allow(`verify:${email}`, 3, 60 * MINUTE)) return generic;
    const id = await profileIdByEmail(email);
    if (id) await sendVerificationEmail(email, await issueToken(id, 'verify'));
    return generic;
  } catch (err) {
    console.error('[resendVerification]', err);
    return generic;
  }
}

export async function requestPasswordReset(emailRaw: string): Promise<ActionResult> {
  const generic: ActionResult = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };
  try {
    const email = normEmail(emailRaw || '');
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
    if (!allow(`reset:${email}`, 3, 60 * MINUTE)) return generic;
    const id = await profileIdByEmail(email);
    if (id) await sendPasswordResetEmail(email, await issueToken(id, 'reset'));
    return generic;
  } catch (err) {
    console.error('[requestPasswordReset]', err);
    return { ok: false, error: dbMessage(err) };
  }
}

export async function resetPassword(token: string, password: string): Promise<ActionResult> {
  try {
    const problem = passwordProblem(password || '');
    if (problem) return { ok: false, error: problem };
    const profileId = await consumeToken(token, 'reset');
    if (!profileId) return { ok: false, error: 'This reset link is invalid or has expired. Please request a new one.' };
    await setNewPassword(profileId, password);
    return { ok: true, message: 'Password updated. You can now sign in.' };
  } catch (err) {
    console.error('[resetPassword]', err);
    return { ok: false, error: dbMessage(err) };
  }
}

/** Used by the /verify-email page. */
export async function verifyEmailToken(token: string): Promise<boolean> {
  try {
    const profileId = await consumeToken(token, 'verify');
    if (!profileId) return false;
    await markEmailVerified(profileId);
    return true;
  } catch (err) {
    console.error('[verifyEmailToken]', err);
    return false;
  }
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
