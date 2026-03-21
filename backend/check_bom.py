import os
import asyncio
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

async def check_bom(project_id):
    try:
        # Get BOM items
        response = supabase.table('quotation_boms').select('*').eq('project_id', project_id).execute()
        items = response.data
        if not items:
            print(f"No items found for project {project_id}.")
            return
        with open('bom_analysis.txt', 'w') as f:
            f.write(f"Found {len(items)} items for project {project_id}.\n")

            cats = {}
            for i in items:
                sku = i.get('sku')
                from app.utils.cabinet_utils import detect_category
                cat = detect_category(sku)
                
                if cat not in cats: cats[cat] = set()
                cats[cat].add(sku)

            for cat in sorted(cats.keys()):
                skus = sorted(list(cats[cat]))
                f.write(f"\nCategory: {cat} ({len(skus)} unique SKUs)\n")
                f.write(f"  SKUs: {', '.join(skus)}\n")
        print("Analysis written to bom_analysis.txt")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # Use the ID from the screenshot
    project_id = "dd7a5593-42ee-4428-89c1-480320d7c275"
    asyncio.run(check_bom(project_id))
