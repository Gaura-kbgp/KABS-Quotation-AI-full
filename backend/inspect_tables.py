import os
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

def list_tables():
    with open("sku_dump_utf8.txt", "w", encoding="utf-8") as f:
        f.write("Checking tables...\n")
        project_id = "dd7a5593-42ee-4428-89c1-480320d7c275"
        
        # 1. Print all rooms
        project = supabase.table("quotation_projects").select("*").eq("id", project_id).single().execute().data
        if project:
            rooms = project.get("extracted_data", {}).get("rooms", [])
            f.write(f"Total Rooms: {len(rooms)}\n")
            for i, room in enumerate(rooms):
                f.write(f"Room {i}: {room.get('room_name')} | Collection: {room.get('collection')}\n")
                # Also print first item in cabinets
                cabs = room.get('cabinets', [])
                if cabs:
                    f.write(f"  First Cabinet: {cabs[0]}\n")
        else:
            f.write("Project not found\n")
        
        # 2. Dump BOM
        res = supabase.table("quotation_boms").select("*").eq("project_id", project_id).execute()
        f.write(f"BOM Rows: {len(res.data)}\n")
    print("Done writing to sku_dump_utf8.txt")

if __name__ == "__main__":
    list_tables()
