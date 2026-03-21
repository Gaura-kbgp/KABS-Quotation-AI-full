export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return Response.json({ error: 'Missing Manufacturer ID' }, { status: 400 });
    }

    let BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    // Remove trailing slash if present
    BACKEND_URL = BACKEND_URL.replace(/\/$/, '');
    
    try {
      const targetUrl = `${BACKEND_URL}/api/manufacturer-config?id=${id}`;
      console.log(`[API Proxy] Probing backend: ${targetUrl}`);
      
      const backendRes = await fetch(targetUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!backendRes.ok) {
        const errText = await backendRes.text();
        console.error(`[API Proxy] Backend returned error: ${errText} from URL: ${BACKEND_URL}`);
        return Response.json({ error: `Backend error: ${errText}` }, { status: 500 });
      }

      const data = await backendRes.json();
      if (data.debug) {
        console.log(`[API Proxy] Backend scan summary: ${JSON.stringify(data.debug)} for ID: ${id}`);
      }
      return Response.json(data);

    } catch (fetchErr: any) {
      console.error(`[API Proxy] Connection Error to Backend: ${fetchErr.message}. BACKEND_URL: ${BACKEND_URL}`);
      return Response.json({ 
        error: `Could not connect to backend at ${BACKEND_URL}. Ensure BACKEND_URL environment variable is set correctly on Render.`,
        details: fetchErr.message 
      }, { status: 500 });
    }


  } catch (err: any) {
    console.error('[API Proxy] Config Handler Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
