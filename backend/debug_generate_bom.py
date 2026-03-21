import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client
import re
import datetime

sys.path.append(os.path.dirname(__file__))
from app.utils.cabinet_utils import compress_sku, detect_category

load_dotenv()
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

def find_best_match(item_code, room_collection, lookup_maps):
    target = str(item_code or "").strip().upper()
    col = str(room_collection or "").strip().upper()
    category = detect_category(target)
    clean_target = re.sub(r'\(.*?\)', '', target).strip()
    target_comp = compress_sku(clean_target)
    variants = [target, clean_target, clean_target.replace(" ", ""), target_comp]
    
    for v in variants:
        if f"{v}|{col}" in lookup_maps['local']: return lookup_maps['local'][f"{v}|{col}"], "STRICT_LOCAL"
    for v in variants:
        if v in lookup_maps['global']: return lookup_maps['global'][v], "GLOBAL_CATALOG"
    if target_comp in lookup_maps['compressed']: return lookup_maps['compressed'][target_comp], "COMPRESSED_MATCH"
    
    stats = lookup_maps['category_sums'].get(category)
    if stats and stats[1] > 0:
        return {"sku": f"{category} Est.", "price": stats[0] / stats[1], "collection_name": "CAT_AVG"}, "CATEGORY_FALLBACK"
    return None, None

def debug():
    p_id = "dd7a5593-42ee-4428-89c1-480320d7c275"
    m_id = "3be07931-596a-4fa3-8d39-8d04c36cf4bb"
    
    project = supabase.table("quotation_projects").select("*").eq("id", p_id).single().execute().data
    rooms = project['extracted_data']['rooms']
    pricing_data = supabase.table("manufacturer_pricing").select("*").eq("manufacturer_id", m_id).execute().data
    
    lookup_maps = {'local': {}, 'global': {}, 'compressed': {}, 'category_sums': {}}
    for p in pricing_data:
        sku = str(p['sku']).strip().upper()
        price = float(p['price'])
        col = str(p.get('collection_name', '')).strip().upper()
        cat = detect_category(sku)
        item = {"sku": sku, "price": price, "collection_name": col}
        if col and col != "UNIVERSAL": lookup_maps['local'][f"{sku}|{col}"] = item
        if sku not in lookup_maps['global'] or col == "UNIVERSAL": lookup_maps['global'][sku] = item
        comp = compress_sku(sku)
        if comp not in lookup_maps['compressed']: lookup_maps['compressed'][comp] = item
        if cat not in lookup_maps['category_sums']: lookup_maps['category_sums'][cat] = [0.0, 0]
        lookup_maps['category_sums'][cat][0] += price
        lookup_maps['category_sums'][cat][1] += 1

    bom_items = []
    categories = ['cabinets', 'perimeter', 'island', 'hardware', 'bump', 'opt_crown', 'opt_light_rail', 'vent_chase_material']
    for room in rooms:
        r_name = room.get('room_name')
        r_col = room.get('collection', '').strip().upper()
        for c in categories:
            items = room.get(c, [])
            for i in items:
                match, mtype = find_best_match(i['code'], r_col, lookup_maps)
                if match:
                    qty = float(i.get('quantity', i.get('qty', 1)))
                    price = float(match['price'])
                    bom_items.append({
                        "project_id": p_id,
                        "sku": i['code'],
                        "matched_sku": match['sku'],
                        "qty": qty,
                        "unit_price": price,
                        "line_total": price * qty,
                        "room": r_name,
                        "collection": r_col or match.get('collection_name'),
                        "door_style": room.get('door_style') or 'UNIVERSAL',
                        "price_source": f"Python Debug ({mtype})",
                        "precision_level": mtype,
                        "created_at": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                    })

    print(f"BOM items count: {len(bom_items)}")
    import json
    if bom_items:
        print("SAMPLE ITEM JSON:")
        print(json.dumps(bom_items[0], indent=2))
        print("SAMPLE ITEM 2 JSON:")
        if len(bom_items) > 1: print(json.dumps(bom_items[1], indent=2))

if __name__ == "__main__":
    debug()
