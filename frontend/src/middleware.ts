import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── In-memory rate limiter for auth routes ────────────────────────────────────
// Edge runtime doesn't support Node.js APIs, so this is a plain Map.
// Resets on cold start — acceptable for the single-container deployment.
// Limits: 10 auth attempts per IP per 60 seconds (brute-force guard).
const _authHits = new Map<string, number[]>();
const AUTH_MAX = 10;
const AUTH_WINDOW_MS = 60_000;

function authRateLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (_authHits.get(ip) ?? []).filter(t => now - t < AUTH_WINDOW_MS);
  if (hits.length >= AUTH_MAX) return false;
  hits.push(now);
  _authHits.set(ip, hits);
  return true;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Cheap first gate: no session cookie, no private pages.
 * Auth routes are rate-limited (10 req/min/IP) to block credential stuffing.
 * (The cookie itself is signature-checked on the server in lib/auth.ts:
 * pages, actions and API routes all re-check it.)
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has('kabs_session');
  const { pathname } = request.nextUrl;

  // Sign-in endpoints must be reachable without a session — but rate-limited
  if (pathname.startsWith('/api/auth/') || pathname === '/login' || pathname === '/admin/login') {
    const ip = clientIp(request);
    if (!authRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait a minute and try again.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/app/:path*', '/setup', '/super-admin/:path*', '/quotation-ai/:path*', '/api/:path*'],
};
