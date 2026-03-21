export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return Response.json({ error: 'Missing Manufacturer ID' }, { status: 400 });
    }

    const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
    
    // Proxy to Python FastAPI backend which handles 100k+ records much faster and without timeout
    const backendRes = await fetch(`${BACKEND_URL}/api/manufacturer-config?id=${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!backendRes.ok) {
      const errText = await backendRes.text();
      return Response.json({ error: `Backend error: ${errText}` }, { status: 500 });
    }

    const data = await backendRes.json();
    return Response.json(data);

  } catch (err: any) {
    console.error('[API Proxy] Config Handler Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
