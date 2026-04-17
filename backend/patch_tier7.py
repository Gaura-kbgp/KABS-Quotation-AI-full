import os

tfile = r'c:\KABS completed project files\KABS-Quotation-AI-full-main\backend\app\api\pricing.py'
with open(tfile, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find TIER 7 start and MANUAL_PRICING_REQUIRED end
tier7_start = None
manual_end = None
for i, line in enumerate(lines):
    if 'TIER 7: CATEGORY FALLBACK' in line:
        tier7_start = i
    if 'MANUAL_PRICING_REQUIRED' in line and tier7_start and i > tier7_start:
        manual_end = i
        break

if tier7_start is None or manual_end is None:
    print(f'ERROR: Could not find block. tier7_start={tier7_start}, manual_end={manual_end}')
    exit(1)

print(f'Replacing lines {tier7_start} to {manual_end}')
for j in range(tier7_start, manual_end+1):
    print(f'  {j}: {repr(lines[j][:80])}')

new_lines = [
    "    # TIER 7: CATEGORY FALLBACK (Better than $0)\n",
    "    # \u2500\u2500 Even here we search for the NEAREST actual catalog SKU so the designer\n",
    "    #    always sees a real manufacturer code (not a fake \"(Est. ...)\" string).\n",
    "    cat_sums = lookup_maps.get('category_sums', {})\n",
    "    if category in cat_sums:\n",
    "        total_price, count = cat_sums[category]\n",
    "        if count > 0:\n",
    "            avg_price = total_price / count\n",
    "\n",
    "            # Find closest real catalog SKU in same category for traceability\n",
    "            catalog_rows = lookup_maps.get('all_catalog_rows', [])\n",
    "            cat_items = [r for r in catalog_rows if detect_category(r.get('sku', '')) == category]\n",
    "            nearest_ref_sku = None\n",
    "            nearest_ref_col = None\n",
    "            if cat_items:\n",
    "                nearest = find_nearest_cabinet_match(\n",
    "                    target_sku=clean_target,\n",
    "                    catalog_skus=cat_items,\n",
    "                    collection_filter=col or None,\n",
    "                    manufacturer_hint=manufacturer_hint,\n",
    "                )\n",
    "                if nearest:\n",
    "                    nearest_ref_sku = nearest.get('sku', '')\n",
    "                    nearest_ref_col = nearest.get('collection_name', '')\n",
    "\n",
    "            ref_sku_label = nearest_ref_sku or f\"{target} (Est. {category})\"\n",
    "            if nearest_ref_sku:\n",
    "                ref_text = f\"Catalog Ref: {nearest_ref_sku} [{nearest_ref_col}] (avg. of {count} {category} items)\"\n",
    "            else:\n",
    "                ref_text = f\"Avg. of {count} {category} items in catalog\"\n",
    "\n",
    "            log_match(f\"MATCH: {category} (Category Average \u2014 nearest catalog ref: {nearest_ref_sku})\")\n",
    "            return {\n",
    "                \"sku\": ref_sku_label,           # Real catalog SKU shown in matched_sku column\n",
    "                \"price\": avg_price,\n",
    "                \"collection_name\": col or \"N/A\",\n",
    "                \"price_ref\": ref_text\n",
    "            }, \"CATEGORY_AVERAGE\"\n",
    "\n",
    "    log_match(f\"FAIL: {target} (Required review)\")\n",
    "    return {\n",
    "        \"sku\": f\"{target} (Review)\",\n",
    "        \"price\": 0.0,\n",
    "        \"collection_name\": col or \"N/A\",\n",
    "        \"price_ref\": \"No catalog match found \u2014 manual pricing required\"\n",
    "    }, \"MANUAL_PRICING_REQUIRED\"\n",
]

lines = lines[:tier7_start] + new_lines + lines[manual_end+1:]

with open(tfile, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f'SUCCESS: replaced {manual_end-tier7_start+1} lines with {len(new_lines)} new lines')
