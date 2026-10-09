import { NextRequest } from 'next/server';
import { apiUser, authFetch, BACKEND_URL } from '@/lib/auth';

/**
 * Same-origin proxy for browser -> FastAPI calls.
 * The backend is never called directly from the browser: this route checks
 * the login, then forwards the request with the user's session attached.
 */
export const maxDuration = 600;

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;

  const { path } = await ctx.params;
  const target = `${BACKEND_URL}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  try {
    const res = await authFetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error required by Node fetch when streaming a request body
      duplex: hasBody ? 'half' : undefined,
      cache: 'no-store',
    });
    const out = new Headers();
    const rct = res.headers.get('content-type');
    if (rct) out.set('content-type', rct);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (err: any) {
    return Response.json({ error: `Backend unreachable: ${err.message}` }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
