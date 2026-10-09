import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Cheap first gate: no session cookie, no private pages.
 * (The cookie itself is signature-checked on the server in lib/auth.ts:
 * pages, actions and API routes all re-check it.)
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has('kabs_session');
  const { pathname } = request.nextUrl;

  // Sign-in endpoints must be reachable without a session
  if (pathname.startsWith('/api/auth/')) return NextResponse.next();
  // Super Admin sign-in page (the page itself redirects signed-in users)
  if (pathname === '/admin/login') return NextResponse.next();

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
