/**
 * Proxy: POST /api/install-rules-upload
 *
 * Forwards a multipart Excel file to the Python backend for bulk
 * install-rule ingestion into the install_rules table.
 *
 * Query params forwarded as-is: manufacturer_id
 */

export const maxDuration = 60;

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'http://127.0.0.1:8000'
).replace(/\/$/, '');

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const manufacturerId = url.searchParams.get('manufacturer_id') || '';

    if (!manufacturerId) {
      return Response.json(
        { success: false, error: 'manufacturer_id query param is required.' },
        { status: 400 }
      );
    }

    // Forward the raw multipart body unchanged
    const formData = await req.formData();
    const backendRes = await fetch(
      `${BACKEND_URL}/api/install-rules/upload?manufacturer_id=${encodeURIComponent(manufacturerId)}`,
      { method: 'POST', body: formData }
    );

    const result = await backendRes.json();
    return Response.json(result, { status: backendRes.ok ? 200 : 500 });
  } catch (err: any) {
    console.error('[install-rules-upload proxy]', err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
