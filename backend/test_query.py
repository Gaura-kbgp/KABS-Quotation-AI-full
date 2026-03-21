import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
s = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])

mfr_id = '3be07931-596a-4fa3-8d39-8d04c36cf4bb'
required_cols = ['ELITE CHERRY', 'PREMIUM DURAFORM (TEXTURED)', 'UNIVERSAL']
required_styles = ['BELCOURT MAPLE', 'UNIVERSAL']

# Test: .in_() with list
print("=== Test: in_() for collection_name ===")
r = s.table('manufacturer_pricing').select('sku,price,collection_name') \
    .eq('manufacturer_id', mfr_id) \
    .in_('collection_name', required_cols) \
    .limit(5).execute()
print(f"Count: {len(r.data)}")
for x in r.data:
    print(x)

print("\n=== Test: in_() for door_style ===")
r2 = s.table('manufacturer_pricing').select('sku,price,door_style') \
    .eq('manufacturer_id', mfr_id) \
    .in_('door_style', required_styles) \
    .limit(5).execute()
print(f"Count: {len(r2.data)}")
for x in r2.data:
    print(x)
