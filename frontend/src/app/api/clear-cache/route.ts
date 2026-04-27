export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const manufacturer_id = searchParams.get('manufacturer_id') || '';
    const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const url = manufacturer_id
      ? `${BACKEND_URL}/api/clear-cache?manufacturer_id=${manufacturer_id}`
      : `${BACKEND_URL}/api/clear-cache`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    return Response.json(data);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
