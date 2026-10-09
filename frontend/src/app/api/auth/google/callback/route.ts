import { NextRequest, NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { signSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import { signInGoogleUser } from '@/lib/profiles';
import { homeFor } from '@/lib/auth';

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function back(req: NextRequest, error: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${error}`, req.url));
  res.cookies.delete({ name: 'kabs_oauth_state', path: '/api/auth/google' });
  return res;
}

/** Step 2: Google sends the user back here with a one-time code. */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return back(req, 'not_configured');

  const params = req.nextUrl.searchParams;
  if (params.get('error')) return back(req, 'cancelled');

  // CSRF check: the state we issued must come back unchanged
  const state = params.get('state');
  const expected = req.cookies.get('kabs_oauth_state')?.value;
  const code = params.get('code');
  if (!state || !expected || state !== expected || !code) return back(req, 'invalid');

  try {
    const origin = (process.env.APP_URL || req.nextUrl.origin).replace(/\/$/, '');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      console.error('[google callback] token exchange failed', tokenRes.status, await tokenRes.text());
      return back(req, 'invalid');
    }
    const { id_token } = await tokenRes.json();

    const { payload } = await jwtVerify(id_token, JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
    });

    const result = await signInGoogleUser({
      sub: String(payload.sub),
      email: String(payload.email || ''),
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    });
    if (!result.ok) return back(req, result.code);

    const res = NextResponse.redirect(new URL(homeFor(result), req.url));
    res.cookies.set(SESSION_COOKIE, await signSession(result.profileId, result.version), sessionCookieOptions);
    res.cookies.delete({ name: 'kabs_oauth_state', path: '/api/auth/google' });
    return res;
  } catch (err: any) {
    console.error('[google callback]', err);
    const msg = String(err?.message || '');
    return back(req, msg.includes('does not exist') ? 'not_migrated' : msg.includes('SESSION_SECRET') ? 'not_configured' : 'invalid');
  }
}
