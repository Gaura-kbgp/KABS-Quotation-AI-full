import { apiUser, authFetch } from '@/lib/auth';
export const maxDuration = 120;

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export async function POST(req: Request) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;
  try {
    const formData = await req.formData();
    const res = await authFetch(`${BACKEND_URL}/api/upload-labor`, {
      method: 'POST',
      body: formData,
    });
    const result = await res.json();
    return Response.json(result, { status: res.ok ? 200 : 422 });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
