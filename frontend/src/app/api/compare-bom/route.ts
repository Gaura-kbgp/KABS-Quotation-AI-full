import { apiUser, authFetch } from '@/lib/auth';
export const maxDuration = 300;

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'http://127.0.0.1:8000'
).replace(/\/$/, '');

export async function POST(req: Request) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    const body = await req.json();

    const backendRes = await authFetch(`${BACKEND_URL}/api/compare-bom`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!backendRes.ok) {
      const errText = await backendRes.text();
      console.error('[Compare BOM Proxy] Backend error:', errText);
      return Response.json(
        { success: false, error: `Backend error: ${backendRes.status} — ${errText}` },
        { status: 500 }
      );
    }

    const result = await backendRes.json();
    return Response.json(result);
  } catch (err: any) {
    console.error('[Compare BOM Proxy] Failure:', err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
