"""
Diagnostic: BACKB48 prefix analysis and catalog lookup
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv; load_dotenv()
from app.core.supabase_client import get_supabase
from app.utils.cabinet_utils import (
    classify_cabinet_type, detect_category, parse_sku_dimensions,
    strip_catalog_suffix, strip_drawing_suffix, normalize_collection_name,
    CABINET_TYPE_MAP, CABINET_SECTIONS
)

INTEGRITY_ID = "4c5206ec-fd02-46cb-81bf-f4663a7333d0"
supabase = get_supabase()

# ── 1. Classification tests ────────────────────────────────────────────────
codes = ["BACKB48", "BACKB48VENTBOX", "BACKB48VENT", "BACKF", "BACK", "BACKB"]
print("=== CLASSIFICATION ANALYSIS ===")
for code in codes:
    ct = classify_cabinet_type(code)
    cat = detect_category(code)
    dims = parse_sku_dimensions(code)
    section = CABINET_SECTIONS.get(ct or '', 'UNKNOWN')
    print(f"  {code:<20}  type={ct or 'NONE':<20}  section={section:<12}  category={cat}  dims={dims}")

# ── 2. Catalog lookup: BACK* items ────────────────────────────────────────
print("\n=== INTEGRITY CATALOG: BACK* SKUs ===")
res = supabase.table("manufacturer_pricing").select("sku,price,collection_name,door_style")\
    .eq("manufacturer_id", INTEGRITY_ID).like("sku", "BACK%").execute()
for r in sorted(res.data or [], key=lambda x: x['sku']):
    print(f"  {r['sku']:<25} ${r['price']:<8.2f}  [{r['collection_name'][:45]}]")

# ── 3. Also check what the strip functions do to BACKB48 ──────────────────
print("\n=== SUFFIX STRIP TESTS ===")
test = "BACKB48"
print(f"  strip_catalog_suffix('{test}') = '{strip_catalog_suffix(test)}'")
print(f"  strip_drawing_suffix('{test}') = '{strip_drawing_suffix(test)}'")
test2 = "BACKB48VENTBOX"
print(f"  strip_catalog_suffix('{test2}') = '{strip_catalog_suffix(test2)}'")
test3 = "BACKB48BOX"
print(f"  strip_catalog_suffix('{test3}') = '{strip_catalog_suffix(test3)}'")

# ── 4. Category sums (to see what avg price we're pulling) ────────────────
print("\n=== WHAT THE FALLBACK USES ===")
print("  BACKB48 → detect_category →", detect_category("BACKB48"))
print("  This means TIER 7 uses avg of ALL Accessories items → $1355 (wrong!)")

# ── 5. Check what prefix should be used ───────────────────────────────────
print("\n=== PREFIX MAP LOOKUP ===")
for pfx_key, pfx_val in CABINET_TYPE_MAP.items():
    if 'Back' in pfx_val or 'back' in pfx_val.lower():
        section = CABINET_SECTIONS.get(pfx_val, 'N/A')
        print(f"  '{pfx_key}' -> '{pfx_val}' (section={section})")
