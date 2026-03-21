/**
 * BOM Generation Route — Thin Proxy to Python FastAPI Backend
 *
 * The Python backend (port 8000) has the full pricing engine:
 *  - Batch-fetches all pricing from Supabase with proper OR filter quoting
 *  - Multi-tier SKU matching (exact → suffix strip → compressed → manual review)
 *  - Writes results directly to quotation_boms table
 *
 * This route simply forwards the request to avoid duplicating logic and
 * avoids Vercel/Next.js 10-second function timeout on large datasets.
 */

export const maxDuration = 300;

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectId, manufacturerId } = body;

    if (!projectId || !manufacturerId) {
      return Response.json({ success: false, error: 'Missing required IDs.' }, { status: 400 });
    }

    // Proxy to Python FastAPI backend
    const backendRes = await fetch(
      `${BACKEND_URL}/api/generate-bom?project_id=${projectId}&manufacturer_id=${manufacturerId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No body needed — query params carry the IDs
      }
    );

    if (!backendRes.ok) {
      const errText = await backendRes.text();
      console.error('[BOM Proxy] Backend error:', errText);
      return Response.json({ success: false, error: `Backend error: ${backendRes.status} — ${errText}` }, { status: 500 });
    }

    const result = await backendRes.json();
    return Response.json(result);

  } catch (err: any) {
    console.error('[BOM Proxy] Failure:', err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
