
import sys
import os
# Add backend to sys.path
sys.path.append(os.path.abspath('c:/KAB projects ongoing/Quotation-AI-main/backend'))

from app.api.pricing import find_best_match
from app.utils.cabinet_utils import compress_sku, detect_category

test_pricing = [
    {"sku": "UF392", "price": 159, "collection_name": "UNIVERSAL"},
    {"sku": "UF3", "price": 53, "collection_name": "UNIVERSAL"},
    {"sku": "B24", "price": 300, "collection_name": "TIER 1"}
]

# Build lookup maps as generate_bom would
lookup_maps = {
    'local': {},
    'global': {},
    'compressed': {},
    'category_skus': {},
    'category_sums': {}
}

for p in test_pricing:
    sku = p['sku']
    price = p['price']
    col = p['collection_name']
    cat = detect_category(sku)
    item = {"sku": sku, "price": price, "collection_name": col}
    if col != "UNIVERSAL": lookup_maps['local'][f"{sku}|{col}"] = item
    lookup_maps['global'][sku] = item
    lookup_maps['compressed'][compress_sku(sku)] = item
    if cat not in lookup_maps['category_skus']: lookup_maps['category_skus'][cat] = []
    lookup_maps['category_skus'][cat].append(sku)
    if cat not in lookup_maps['category_sums']: lookup_maps['category_sums'][cat] = [0.0, 0]
    lookup_maps['category_sums'][cat][0] += price
    lookup_maps['category_sums'][cat][1] += 1

try:
    print("Testing exact match (UF392):")
    match, mtype = find_best_match("UF392", "TIER 1", lookup_maps)
    print(f"Match found: {match}, Type: {mtype}")

    print("\nTesting match with noise (UF642 (OVEN)):")
    # Add UF642 to maps for this test
    sku = "UF642"
    price = 117
    lookup_maps['global'][sku] = {"sku": sku, "price": price, "collection_name": "UNIVERSAL"}
    match, mtype = find_best_match("UF642 (OVEN)", "TIER 1", lookup_maps)
    print(f"Match found: {match}, Type: {mtype}")

except Exception as e:
    import traceback
    traceback.print_exc()
