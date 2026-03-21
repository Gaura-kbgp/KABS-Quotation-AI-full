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

async def seed():
    try:
        # Get all manufacturers
        response = supabase.table('manufacturers').select('id, name').execute()
        manufacturers = response.data
        print(f"Found {len(manufacturers)} manufacturers.")

        col_b_styles = [
            'CANYON CHERRY', 'ABILENE DFO CHERRY', 'BELCOURT DFO CHERRY', 
            'CLAYTON DFO CHERRY', 'DURANGO CHERRY', 'ELDRIDGE CHERRY', 
            'ELITE CHERRY', 'ELITE DURAFORM (TEXTURED)', 'ELITE PAINTED'
        ]
        col_c_styles = [
            'ABILENE CHERRY', 'BELCOURT CHERRY', 'CLAYTON CHERRY', 'DURANGO CHERRY', 
            'ELDRIDGE CHERRY', 'LUBBOCK CHERRY', 'LUBBOCK DFO CHERRY', 
            'PREMIUM CHERRY', 'PREMIUM DURAFORM (TEXTURED)', 'ELITE MAPLE', 'ELITE PAINTED'
        ]
        # Basic pricing logic (placeholder)
        standard_mapping = {
            "ELITE CHERRY": ["CANYON CHERRY", "ELITE DURAFORM (TEXTURED)", "ELITE MAPLE", "ELITE PAINTED", "PREMIUM CHERRY", "PREMIUM MAPLE", "PREMIUM PAINTED"],
            "ELITE PAINTED": ["ELITE PAINTED", "PREMIUM PAINTED"],
            "PREMIUM CHERRY": ["CANYON CHERRY", "PREMIUM CHERRY"],
            "ELITE MAPLE": ["ELITE MAPLE", "PREMIUM MAPLE"],
            "PRIME CHERRY": ["CANYON CHERRY", "PRIME CHERRY"],
            "PREMIUM PAINTED": ["PREMIUM PAINTED"],
            "PRIME MAPLE": ["PRIME MAPLE", "PREMIUM MAPLE"],
            "BANDERA MAPLE": ["BANDERA MAPLE"],
            "CHOICE MAPLE": ["CHOICE MAPLE"],
            "CARSON DURAFORM": ["CARSON DURAFORM"],
            "BASE": ["BASE"]
        }

        # CATEGORY ESTIMATION SKUs (To ensure BOM fallbacks work)
        estimation_skus = [
            {"sku": "B-EST", "price": 100, "collection_name": "UNIVERSAL"},
            {"sku": "W-EST", "price": 80, "collection_name": "UNIVERSAL"},
            {"sku": "V-EST", "price": 70, "collection_name": "UNIVERSAL"},
            {"sku": "T-EST", "price": 200, "collection_name": "UNIVERSAL"},
            {"sku": "SB-EST", "price": 120, "collection_name": "UNIVERSAL"},
            {"sku": "UF-EST", "price": 40, "collection_name": "UNIVERSAL"},
            {"sku": "CM-EST", "price": 30, "collection_name": "UNIVERSAL"},
            {"sku": "HW-EST", "price": 5, "collection_name": "UNIVERSAL"},
        ]
        col_d_styles = [
            'ABILENE DURAFORM', 'ABILENE DFO MAPLE', 'BELCOURT DFO MAPLE', 'CLAYTON DFO MAPLE', 
            'DURANGO MAPLE', 'ELDRIDGE MAPLE', 'LUBBOCK MAPLE', 
            'PRIME CHERRY', 'PREMIUM MAPLE', 'PREMIUM PAINTED', 'PREMIUM DURAFORM (NON-TEXTURED)'
        ]
        col_e_styles = [
            'BANDERA MAPLE', 'BANDERA PAINTED', 'COOPER MAPLE', 'COOPER PAINTED', 
            'DENVER MAPLE', 'DENVER PAINTED', 'PRIME MAPLE', 'PRIME PAINTED', 'PRIME DURAFORM'
        ]
        col_f_styles = [
            'BARREN DURAFORM', 'BARREN MAPLE', 'BARREN PAINTED', 'CARSON DURAFORM', 
            'CHOICE DURAFORM', 'CHOICE MAPLE', 'CHOICE PAINTED'
        ]
        col_g_styles = ['BASE', 'BOERNE HARDWOOD']

        standard_mapping = {
            'ELITE CHERRY': col_b_styles,
            'ELITE DURAFORM (TEXTURED)': col_b_styles,
            'ELITE PAINTED': col_b_styles,
            'PREMIUM CHERRY': col_c_styles,
            'PREMIUM DURAFORM (TEXTURED)': col_c_styles,
            'ELITE MAPLE': col_c_styles,
            'ELITE PAINTED (C1)': col_c_styles,
            'PRIME CHERRY': col_d_styles,
            'PREMIUM MAPLE': col_d_styles,
            'PREMIUM PAINTED': col_d_styles,
            'PREMIUM DURAFORM (NON-TEXTURED)': col_d_styles,
            'PRIME MAPLE': col_e_styles,
            'PRIME PAINTED': col_e_styles,
            'PRIME DURAFORM': col_e_styles,
            'CHOICE DURAFORM': col_f_styles,
            'CHOICE MAPLE': col_f_styles,
            'CHOICE PAINTED': col_f_styles,
            'BASE': col_g_styles
        }

        total_inserted = 0
        exclude_list = ['UNIVERSAL', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'EST']
        
        for m in manufacturers:
            print(f"Cleaning and Seeding for {m['name']}...")
            
            # 1. DELETE existing records that match the exclude list or are previous SEED records
            try:
                # Delete records matching exclude list or EST suffixes
                for name in exclude_list:
                   supabase.table('manufacturer_pricing').delete().eq('manufacturer_id', m['id']).eq('collection_name', name).execute()
                supabase.table('manufacturer_pricing').delete().eq('manufacturer_id', m['id']).like('sku', '%-EST').execute()
                print(f"  Cleaned up placeholders for {m['name']}.")
            except Exception as e:
                print(f"  Cleanup error for {m['name']}: {e}")

            # 2. INSERT new descriptive records
            records = []
            for c, styles in standard_mapping.items():
                for s in styles:
                    records.append({
                        'manufacturer_id': m['id'],
                        'collection_name': c,
                        'door_style': s,
                        'sku': f'SEED-{c}-{s}',
                        'price': 0,
                        'created_at': 'now()'
                    })
            
            # 3. INSERT Estimation SKUs
            for est in estimation_skus:
                records.append({
                    'manufacturer_id': m['id'],
                    'collection_name': est['collection_name'],
                    'door_style': 'UNIVERSAL',
                    'sku': est['sku'],
                    'price': est['price'],
                    'created_at': 'now()'
                })
            
            # Batch insert
            if records:
                try:
                    res = supabase.table('manufacturer_pricing').insert(records).execute()
                    total_inserted += len(records)
                    print(f"  Inserted {len(records)} records for {m['name']}.")
                except Exception as e:
                    print(f"  Error inserting for {m['name']}: {e}")

        print(f"Seeding completed. Total records inserted: {total_inserted}")

    except Exception as e:
        print(f"Seeding failed: {e}")

if __name__ == "__main__":
    asyncio.run(seed())
