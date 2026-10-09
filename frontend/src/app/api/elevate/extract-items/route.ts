import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const session = cookieStore.get('kabs_session')?.value;
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append('file', file);

  const res = await fetch(`${BACKEND}/api/elevate/extract-items`, {
    method: 'POST',
    headers: { Cookie: `kabs_session=${session}` },
    body: upstream,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
