export const maxDuration = 120;

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const res = await fetch(`${BACKEND_URL}/api/upload-install-rules`, {
      method: 'POST',
      body: formData,
    });
    const result = await res.json();
    return Response.json(result, { status: res.ok ? 200 : 422 });
  } catch (err: any) {
    console.error('[upload-install-rules-proxy] Error:', err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
