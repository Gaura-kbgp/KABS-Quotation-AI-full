"""
Quick test: simulate what generate_bom does for the project.
"""
import os, sys
sys.path.insert(0, '.')
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])

manufacturer_id = '3be07931-596a-4fa3-8d39-8d04c36cf4bb'

# Project de7ef0d3-be13-4eb9-8d7d-4ce616778b70 rooms
required_cols = {'UNIVERSAL', 'ELITE CHERRY', 'ELITE MAPLE', 'PRIME PAINTED', 'PRIME CHERRY', 'PREMIUM DURAFORM (TEXTURED)', 'PREMIUM MAPLE'}
required_styles = {'UNIVERSAL', 'CANYON CHERRY', 'BELCOURT MAPLE', 'W4242', 'CANYON DFO PAINTED', 'CLAYTON DFO CHERRY', 'DENVER DFO MAPLE', 'CLAYTON MAPLE'}

pricing_data = []
page_size = 1000
seen_ids = set()

def fetch_in_batches(field, values):
    results = []
    off = 0
    while True:
        res = supabase.table("manufacturer_pricing").select("*") \
            .eq("manufacturer_id", manufacturer_id) \
            .in_(field, values) \
            .range(off, off + page_size - 1).execute()
        batch = res.data or []
        results.extend(batch)
        if len(batch) < page_size: break
        off += page_size
        if off > 200000: break
    return results

col_rows = fetch_in_batches("collection_name", list(required_cols))
for row in col_rows:
    row_id = row.get('id')
    if row_id and row_id not in seen_ids:
        seen_ids.add(row_id)
        pricing_data.append(row)

style_rows = fetch_in_batches("door_style", list(required_styles))
for row in style_rows:
    row_id = row.get('id')
    if row_id and row_id not in seen_ids:
        seen_ids.add(row_id)
        pricing_data.append(row)

print(f"Total pricing_data: {len(pricing_data)}")

global_map = {}
for p in pricing_data:
    sku = str(p['sku']).strip().upper()
    price = float(p.get('price', 0))
    # match the generate_bom logic exactly
    item = {"sku": sku, "price": price, "collection_name": p.get('collection_name'), "door_style": p.get('door_style')}
    if sku not in global_map or price > global_map[sku]['price']:
        global_map[sku] = item

for test_sku in ['UF3', 'UF342', 'BTK8', 'SM8']:
    if test_sku in global_map:
        print(f"[{test_sku}] found in global_map: {global_map[test_sku]}")
    else:
        print(f"[{test_sku}] NOT found in global_map")
