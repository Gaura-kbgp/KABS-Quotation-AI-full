import os
import asyncio
import httpx
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not supabase_url or not supabase_key:
    load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(supabase_url, supabase_key)

async def reprice_bom(project_id):
    try:
        # 1. Get Project
        response = supabase.table('quotation_projects').select('manufacturer_id').eq('id', project_id).single().execute()
        m_id = response.data.get('manufacturer_id')
        if not m_id:
            print(f"Manufacturer ID not found for project {project_id}.")
            return
        
        print(f"Triggering BOM generation for project {project_id} (Manufacturer: {m_id})...")
        
        # 2. Call FastAPI
        url = f"http://localhost:8000/api/generate-bom?project_id={project_id}&manufacturer_id={m_id}"
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=300.0)
            print(f"Response: {res.status_code}")
            if res.status_code == 200:
                print(res.json())
            else:
                print(res.text)

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    import sys
    project_id = sys.argv[1] if len(sys.argv) > 1 else "474055fa-3305-47a8-a948-e6274cd08076"
    asyncio.run(reprice_bom(project_id))
