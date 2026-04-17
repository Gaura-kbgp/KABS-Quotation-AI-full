/**
 * Proxy: POST /api/test-install-rule
 *
 * Forwards a test-rule request to the Python backend which performs
 * the priority-based rule lookup and returns calculated Install / 3PL units.
 *
 * Body: { manufacturer_id, client_name?, item_code, quantity }
 */

export const maxDuration = 30;

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'http://127.0.0.1:8000'
).replace(/\/$/, '');

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const backendRes = await fetch(`${BACKEND_URL}/api/test-install-rule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await backendRes.json();
    return Response.json(result, { status: backendRes.ok ? 200 : 500 });
  } catch (err: any) {
    console.error('[test-install-rule proxy]', err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
