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
    # 1. Get all manufacturers
    try:
        response = supabase.table('manufacturers').select('*').execute()
        manufacturers = response.data
    except Exception as e:
        print(f"Error fetching manufacturers: {e}")
        return

    print('--- MANUFACTURERS ---')
    for m in manufacturers:
        print(f"ID: {m['id']} | Name: {m['name']}")

    # 2. For each, check unique collections and door styles
    for m in manufacturers:
        print(f"\nChecking Manufacturer: {m['name']} ({m['id']})")
        
        try:
            # Fetch a sample of pricing data
            response = supabase.table('manufacturer_pricing') \
                .select('collection_name, door_style') \
                .eq('manufacturer_id', m['id']) \
                .limit(1000) \
                .execute()
            pricing = response.data
        except Exception as e:
            print(f"Error fetching pricing for {m['name']}: {e}")
            continue

        collections = set()
        styles = set()
        for p in pricing:
            if p.get('collection_name'):
                collections.add(p['collection_name'])
            if p.get('door_style'):
                styles.add(p['door_style'])

        print(f"Unique Collections (subset): {list(collections)[:10]}")
        print(f"Unique Styles (subset): {list(styles)[:10]}")
        print(f"Total Sample Size: {len(pricing)}")

if __name__ == "__main__":
    asyncio.run(check())
