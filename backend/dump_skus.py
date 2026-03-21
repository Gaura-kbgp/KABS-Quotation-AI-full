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

def dump_skus():
    project_id = "dd7a5593-42ee-4428-89c1-480320d7c275"
    from app.utils.cabinet_utils import detect_category
    
    try:
        res = supabase.table("quotation_boms").select("*").eq("project_id", project_id).execute()
        items = res.data or []
        
        with open("sku_dump_utf8.txt", "w", encoding="utf-8") as f:
            f.write(f"Project: {project_id}\n")
            f.write(f"Total Items: {len(items)}\n")
            f.write("-" * 40 + "\n")
            for r in items:
                sku = r.get('sku')
                cat = detect_category(sku)
                f.write(f"Room: {r.get('room')} | SKU: {sku} | CAT: {cat}\n")
        print(f"Done. Wrote {len(items)} items to sku_dump_utf8.txt")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    dump_skus()
