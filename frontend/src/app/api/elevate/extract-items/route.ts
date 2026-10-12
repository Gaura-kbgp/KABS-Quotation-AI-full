import { NextRequest, NextResponse } from 'next/server';
import { apiUser, authFetch } from '@/lib/auth';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const auth = await apiUser();
  if ('response' in auth) return auth.response;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append('file', file);

  // The backend only reads `Authorization: Bearer <token>` (see
  // backend/app/core/auth.py), never a raw Cookie header — this route used
  // to forward `Cookie: kabs_session=...` instead, which the backend simply
  // ignored, making every request here 401 regardless of the caller's real
  // session. authFetch() sends the correct bearer header, matching every
  // other backend-proxy route in this app.
  const res = await authFetch(`${BACKEND}/api/elevate/extract-items`, {
    method: 'POST',
    body: upstream,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
