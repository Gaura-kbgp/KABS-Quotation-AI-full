import os
import asyncio
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not supabase_url or not supabase_key:
    # Attempt to load from the .env file explicitly if not in environment
    print("Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in environment. Checking local .env...")
    load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not supabase_url or not supabase_key:
    print("Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found.")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)

async def check():
    try:
        p_res = supabase.table('manufacturer_pricing') \
            .select('collection_name, door_style') \
            .execute()
        pricing = p_res.data
        
        collections = set()
        styles = set()
        for p in pricing:
            if p.get('collection_name'): collections.add(p['collection_name'])
            if p.get('door_style'): styles.add(p['door_style'])
            
        print(f"--- Global Unique Data ---")
        print(f"Collections: {sorted(list(collections))}")
        print(f"Styles: {sorted(list(styles))}")
        print(f"Total records: {len(pricing)}")

        print("\n--- Verifying Tables ---")
        for table in ['manufacturer_pricing', 'quotation_projects', 'quotation_boms', 'bom_items', 'quotation_items']:
            try:
                res = supabase.table(table).select('count', count='exact').limit(1).execute()
                print(f"Table '{table}': EXISTS ({res.count} rows)")
            except Exception as e:
                print(f"Table '{table}': ERROR: {e}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check())
