import os
import asyncio
import json
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

async def check_extraction(project_id):
    try:
        # Get Project
        response = supabase.table('quotation_projects').select('extracted_data').eq('id', project_id).single().execute()
        data = response.data
        if not data:
            print(f"No data found for project {project_id}.")
            return
        
        extracted = data.get('extracted_data', {})
        rooms = extracted.get('rooms', [])
        
        with open('extraction_analysis.txt', 'w') as f:
            f.write(f"Project {project_id} has {len(rooms)} rooms.\n")

            for room in rooms:
                f.write(f"\nRoom: {room.get('room_name')}\n")
                # Check all possible keys that might contain items
                all_keys = set(room.keys())
                for cat in sorted(list(all_keys)):
                    val = room.get(cat)
                    if isinstance(val, list) and len(val) > 0:
                        f.write(f"  Key '{cat}': {len(val)} items\n")
                        for i in val:
                            if isinstance(i, dict):
                                f.write(f"    - {i.get('code')} (x{i.get('quantity', i.get('qty', 1))})\n")
                            else:
                                f.write(f"    - {i}\n")
        print("Extraction analysis written to extraction_analysis.txt")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    project_id = "dd7a5593-42ee-4428-89c1-480320d7c275"
    asyncio.run(check_extraction(project_id))
