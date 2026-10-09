import { apiUser, authFetch } from '@/lib/auth';
export async function GET(req: Request) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    const { searchParams } = new URL(req.url);
    const manufacturer_id = searchParams.get('manufacturer_id');
    if (!manufacturer_id) {
      return Response.json({ error: 'Missing manufacturer_id' }, { status: 400 });
    }
    const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const res = await authFetch(`${BACKEND_URL}/api/catalog-check?manufacturer_id=${manufacturer_id}`);
    const data = await res.json();
    return Response.json(data);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
