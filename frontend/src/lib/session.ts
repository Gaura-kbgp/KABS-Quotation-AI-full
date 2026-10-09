import 'server-only';
import { SignJWT, jwtVerify } from 'jose';

/**
 * Our own signed session (HS256 JWT) stored in an httpOnly cookie.
 * Subject = profile id, `v` = profile.token_version (bumped on password
 * reset to sign the user out everywhere). The same SESSION_SECRET is set
 * on the FastAPI backend, which verifies the identical token.
 */
export const SESSION_COOKIE = 'kabs_session';
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET is missing or too short (use at least 32 random characters).');
  }
  return new TextEncoder().encode(s);
}

export async function signSession(profileId: string, version: number): Promise<string> {
  return new SignJWT({ v: version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(profileId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<{ sub: string; v: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, v: typeof payload.v === 'number' ? payload.v : 0 };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: SESSION_MAX_AGE_S,
  path: '/',
};
