from fastapi import APIRouter, UploadFile, File
from app.core.supabase_client import get_supabase
from app.utils.cabinet_utils import compress_sku, detect_category
from app.utils.excel_processor import parse_specifications_python
from app.utils.pdf_processor import parse_pricing_pdf
from thefuzz import process, fuzz
import datetime
import uuid
import os
import shutil
import re
import traceback
import json

_CONFIG_CACHE = {}
_MFG_DB_CACHE = {'sku': {}, 'col': {}}

def get_cache_path(mfg_id: str) -> str:
    path = os.path.join(os.path.dirname(__file__), "..", "..", f"mfg_config_{mfg_id}.json")
    return os.path.abspath(path)

router = APIRouter()

def find_best_match(item_code: str, room_collection: str, room_door_style: str, lookup_maps: dict):
    target = str(item_code or "").strip().upper()
    if not target: return None, None
    
    col = str(room_collection or "").strip().upper()
    style = str(room_door_style or "").strip().upper()
    category = detect_category(target)
    
    local_map = lookup_maps.get('local', {})
    global_map = lookup_maps.get('global', {})
    compressed_map = lookup_maps.get('compressed', {})

    log_path = os.path.join(os.path.dirname(__file__), "..", "..", "pricing_match_debug.log")

    def log_match(message):
        try:
            with open(log_path, "a") as f:
                f.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {message}\n")
        except: pass

    def try_match(sku_variant: str, match_type_suffix: str):
        if not sku_variant: return None
        # 1. Strict SKU + Col + Style
        key1 = f"{sku_variant}|{col}|{style}"
        if key1 in local_map:
            log_match(f"MATCH: {key1} (Local Spec)")
            return local_map[key1], f"EXACT_SPEC_{match_type_suffix}"
            
        # 2. Strict SKU + Style
        key2 = f"{sku_variant}|{style}"
        if key2 in local_map:
            log_match(f"MATCH: {key2} (Local Style)")
            return local_map[key2], f"EXACT_STYLE_{match_type_suffix}"
            
        # 3. Strict SKU + Col
        key3 = f"{sku_variant}|{col}"
        if key3 in local_map:
            log_match(f"MATCH: {key3} (Local Col)")
            return local_map[key3], f"EXACT_COL_{match_type_suffix}"
            
        # 4. Global SKU
        if sku_variant in global_map:
            log_match(f"MATCH: {sku_variant} (Global)")
            return global_map[sku_variant], f"EXACT_GLOBAL_{match_type_suffix}"
        return None

    log_match(f"PROBING: {target} (Room: {col} / {style})")

    # TIER 1: ORIGINAL
    match = try_match(target, "ORIGINAL")
    if match: return match

    # TIER 2: CLEAN PARENS (strip (), {}, [])
    clean_target = re.sub(r'[\(\{\[].*?[\)\}\]]', '', target).strip()
    # Strip estimation suffixes too
    clean_target = re.sub(r'\s*(-EST|EST\.)$', '', clean_target).strip()
    
    if clean_target != target:
        log_match(f"TRYING TIER 2 (Clean): {clean_target}")
        match = try_match(clean_target, "CLEANED")
        if match: return match

    # TIER 3: REMOVE NKBA SUFFIXES
    no_suffix_target = re.sub(r'\s*(BUTT|H|L|R|FL|S|D)$', '', clean_target).strip()
    if no_suffix_target != clean_target:
        log_match(f"TRYING TIER 3 (No Suffix): {no_suffix_target}")
        match = try_match(no_suffix_target, "NO_SUFFIX")
        if match: return match

    # TIER 4: COMPRESSED (NEW)
    comp_target = compress_sku(clean_target)
    if comp_target in compressed_map:
        log_match(f"MATCH: {comp_target} (Compressed)")
        return compressed_map[comp_target], "COMPRESSED"

    # TIER 5: FUZZY (Last Resort)
    if col in lookup_maps.get('col_skus', {}):
        choices = lookup_maps['col_skus'][col]
        if choices:
            best_sku, score = process.extractOne(target, choices, scorer=fuzz.ratio)
            if score > 85: # Increased threshold for safety
                log_match(f"MATCH: {best_sku} (Fuzzy {score}%)")
                key = f"{best_sku}|{col}"
                match = local_map.get(key) or local_map.get(f"{best_sku}|{col}|{style}") or global_map.get(best_sku)
                if match: return match, f"FUZZY_{score}"

    log_match(f"FAIL: {target} (Required review)")
    return {
        "sku": f"{target} (Review)",
        "price": 0.0,
        "collection_name": col or "N/A"
    }, "MANUAL_PRICING_REQUIRED"

@router.post("/generate-bom")
async def generate_bom(project_id: str, manufacturer_id: str):
    print("DEBUG: generate_bom started")
    try:
        supabase = get_supabase()
        project = supabase.table("quotation_projects").select("*").eq("id", project_id).single().execute().data
        if not project: return {"success": False, "error": "Project not found"}
        rooms = project.get("extracted_data", {}).get("rooms", [])

        # 1. Collect required collections and styles (for room filter)
        required_cols = {'UNIVERSAL'}
        required_styles = {'UNIVERSAL'}
        project_skus = set()
        
        for room in rooms:
            room_col = str(room.get('collection') or '').upper().strip()
            if room_col: required_cols.add(room_col)
            
            # For Integrity, we also need to fetch the combined Series-Wood collection
            wood = str(room.get('wood_species') or '').upper().strip()
            if wood and room_col and " - " not in room_col:
                required_cols.add(f"{room_col} - {wood}")
                
            if room.get('door_style'): required_styles.add(str(room['door_style']).upper().strip())
            
            # 2. Collect all SKUs from any relevant room categories
            for cat in ['cabinets', 'perimeter', 'island', 'hardware', 'island_hardware', 'bump', 'island_bump', 'opt_crown', 'opt_light_rail', 'vent_chase_material']:
                for item in room.get(cat, []):
                    code = str(item.get('code') or '').strip().upper()
                    if code:
                        project_skus.add(code)
                        # Add common variants (clean parens, stripped suffixes) for broad fetch
                        clean = re.sub(r'[\(\{\[].*?[\)\}\]]', '', code).strip()
                        if clean:
                            project_skus.add(clean)
                        no_suffix = re.sub(r'\s*(BUTT|H|L|R|FL|S|D)$', '', clean).strip()
                        if no_suffix:
                            project_skus.add(no_suffix)
        
        print(f"DEBUG: Project SKUs (Targeted): {len(project_skus)}")

        pricing_data = []
        page_size = 1000
        seen_ids = set()

        def fetch_in_batches(field: str, values: list):
            results = []
            if not values: return results
            cache_group = _MFG_DB_CACHE['col'] if field == 'collection_name' else _MFG_DB_CACHE['sku']
            
            uncached = []
            for v in values:
                key = f"{manufacturer_id}:{str(v).upper()}"
                if key in cache_group:
                    results.extend(cache_group[key])
                else:
                    uncached.append(v)

            if not uncached: return results

            for i in range(0, len(uncached), 200):
                chunk = uncached[i : i + 200]
                off = 0
                while True:
                    res = supabase.table("manufacturer_pricing").select("id,sku,price,collection_name,door_style") \
                        .eq("manufacturer_id", manufacturer_id) \
                        .in_(field, chunk) \
                        .range(off, off + page_size - 1).execute()
                    batch = res.data or []
                    for r in batch:
                        val = str(r.get(field) or "").upper()
                        ckey = f"{manufacturer_id}:{val}"
                        if ckey not in cache_group: cache_group[ckey] = []
                        cache_group[ckey].append(r)
                    
                    results.extend(batch)
                    if len(batch) < page_size: break
                    off += page_size
                    if off > 500000: break
                    
            for v in uncached:
                key = f"{manufacturer_id}:{str(v).upper()}"
                if key not in cache_group:
                    cache_group[key] = []
            return results

        # 3. FAST FETCH: Targeted SKUs + Full Collections
        sku_rows = fetch_in_batches("sku", list(project_skus))
        for row in sku_rows:
            r_id = row.get('id')
            if r_id and r_id not in seen_ids:
                seen_ids.add(r_id)
                pricing_data.append(row)

        if required_cols:
            print(f"DEBUG: Fetching full collections: {required_cols}")
            col_rows = fetch_in_batches("collection_name", list(required_cols))
            for row in col_rows:
                r_id = row.get('id')
                if r_id and r_id not in seen_ids:
                    seen_ids.add(r_id)
                    pricing_data.append(row)

        print(f"DEBUG: TOTAL Targeted pricing rows: {len(pricing_data)}")


        lookup_maps = {
            'local': {}, 'global': {}, 'compressed': {}, 
            'col_skus': {}, 'category_skus': {}, 'category_sums': {}
        }
        for p in pricing_data:
            sku = str(p['sku']).strip().upper()
            price = float(p.get('price') or 0)
            col = str(p.get('collection_name', '')).strip().upper()
            style = str(p.get('door_style', '')).strip().upper()
            cat = detect_category(sku)
            item = {"sku": sku, "price": price, "collection_name": col, "door_style": style}
            
            # Indexing: prioritize more specific keys
            if col and style: lookup_maps['local'][f"{sku}|{col}|{style}"] = item
            if col: lookup_maps['local'][f"{sku}|{col}"] = item
            if col:
                if col not in lookup_maps['col_skus']: lookup_maps['col_skus'][col] = []
                lookup_maps['col_skus'][col].append(sku)
            
            if style: lookup_maps['local'][f"{sku}|{style}"] = item
            
            if sku not in lookup_maps['global'] or price > lookup_maps['global'][sku]['price']: 
                lookup_maps['global'][sku] = item
            comp = compress_sku(sku)
            if comp not in lookup_maps['compressed']: lookup_maps['compressed'][comp] = item
            # Index stripped version (remove common suffixes from CATALOG as well)
            stripped = re.sub(r'[\s-]*(BUTT|H|L|R|FL|S|D)$', '', sku).strip()
            if stripped != sku:
                lookup_maps['local'][f"{stripped}|{col}|{style}"] = item
                lookup_maps['local'][f"{stripped}|{col}"] = item
                lookup_maps['local'][f"{stripped}|{style}"] = item
                if stripped not in lookup_maps['global']:
                    lookup_maps['global'][stripped] = item
            
            if cat not in lookup_maps['category_skus']: lookup_maps['category_skus'][cat] = []
            lookup_maps['category_skus'][cat].append(sku)
            if cat not in lookup_maps['category_sums']: lookup_maps['category_sums'][cat] = [0.0, 0]
            lookup_maps['category_sums'][cat][0] += price
            lookup_maps['category_sums'][cat][1] += 1
        
        print(f"DEBUG: Loaded {len(pricing_data)} records. Mean Price: {sum(p['price'] for p in pricing_data)/len(pricing_data) if pricing_data else 0}")
        print(f"DEBUG: Min Price: {min(p['price'] for p in pricing_data) if pricing_data else 0}")
        print(f"DEBUG: Max Price: {max(p['price'] for p in pricing_data) if pricing_data else 0}")

        bom_items = []
        # Filter categories to only essential items requested by user
        categories_to_flatten = ['cabinets', 'perimeter', 'island', 'hardware', 'island_hardware', 'bump', 'island_bump', 'opt_crown', 'opt_light_rail', 'vent_chase_material']
        for room in rooms:
            flat_items = []
            
            # For specific manufacturers like Integrity, we need to map the 'Series' and 'Wood Species' 
            # to the 'Collection Name' format used in the PDF/DB (e.g. "Elite Series - Maple")
            room_col = room.get('collection', '')
            wood = room.get('wood_species', '')
            
            effective_col = room_col
            if manufacturer_id == "4c5206ec-fd02-46cb-81bf-f4663a7333d0" or "integrity" in str(project.get('metadata', {}).get('mfg_name', '')).lower():
                if wood and room_col and " - " not in room_col:
                    effective_col = f"{room_col} - {wood}"
            
            print(f"DEBUG: Processing room: {room.get('room_name')} (Eff Col: {effective_col})")
            for cat in categories_to_flatten: 
                items = room.get(cat, [])
                if items:
                    print(f"  DEBUG: Found {len(items)} items in {cat}")
                flat_items.extend(items)
                
            print(f"DEBUG: Total flat items for room: {len(flat_items)}")
            for item in flat_items:
                match, match_type = find_best_match(item['code'], effective_col, room.get('door_style', ''), lookup_maps)
                if match:
                    qty = int(float(item.get('quantity', item.get('qty', 1))))
                    price = float(match['price'])
                    if str(price) == 'nan': price = 0.0
                    
                    # Round price as requested by user
                    price = round(price)
                    
                    total = price * qty
                    if str(total) == 'nan': total = 0.0
                    total = round(total)
                    
                    bom_items.append({
                        "project_id": project_id,
                        "sku": item['code'],
                        "matched_sku": match['sku'],
                        "qty": qty,
                        "unit_price": price,
                        "line_total": total,
                        "room": room['room_name'],
                        "collection": room.get('collection') or match.get('collection_name'),
                        "door_style": room.get('door_style') or 'UNIVERSAL',
                        "price_source": f"Python Engine ({match_type})",
                        "precision_level": match_type,
                        # Use a simpler date format to avoid any potential datetime conversion issues
                        "created_at": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                    })
        
        print(f"DEBUG: BOM matching finished: {len(bom_items)} items")
        import json
        with open("bom_items_debug.json", "w") as f:
            json.dump(bom_items, f, indent=2)

        supabase.table("quotation_boms").delete().eq("project_id", project_id).execute()
        print("DEBUG: Previous BOM deleted")
        
        if bom_items:
            # Chunk insert if many items
            try:
                for i in range(0, len(bom_items), 500):
                    chunk = bom_items[i : i + 500]
                    supabase.table("quotation_boms").insert(chunk).execute()
                print("DEBUG: New BOM items inserted")
            except Exception as e:
                print(f"DEBUG: Chunk insert failed: {e}. Trying one by one...")
                for item in bom_items:
                    try:
                        supabase.table("quotation_boms").insert(item).execute()
                    except Exception as ie:
                        print(f"DEBUG: FAILED ITEM: {item}")
                        raise ie
            
        # supabase.table("quotation_projects").update({"status": "Priced"}).eq("id", project_id).execute()
        # print("DEBUG: Project status updated")

        return {"success": True, "count": len(bom_items)}
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"DEBUG ERROR: {e}")
        return {"success": False, "error": str(e)}


@router.post("/upload-pricing")
async def upload_pricing(manufacturer_id: str, file: UploadFile = File(...)):
    """
    Handles Multi-Sheet Excel Upload and Extraction for Manufacturers.
    """
    file_id = str(uuid.uuid4())
    temp_path = f"/tmp/{file_id}_{file.filename}"
    os.makedirs("/tmp", exist_ok=True)
    
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        # Read file bytes for parser
        with open(temp_path, "rb") as f:
            file_bytes = f.read()
            
        supabase = get_supabase()
        
        # 1. Register file in manufacturer_files to satisfy FK constraint
        supabase.table("manufacturer_files").insert({
            "id": file_id,
            "manufacturer_id": manufacturer_id,
            "file_type": "pricing",
            "file_name": file.filename,
            "file_url": "#", # Placeholder until real storage is used
            "file_format": file.filename.split('.')[-1] if '.' in file.filename else None
        }).execute()
        
        file_ext = file.filename.split('.')[-1].lower() if '.' in file.filename else ""
        
        print(f"DEBUG: Starting pricing extraction for {file.filename} (Ext: {file_ext})")
        if file_ext == "pdf":
            pricing = await parse_pricing_pdf(file_bytes, manufacturer_id, file_id)
        else:
            pricing = await parse_specifications_python(file_bytes, manufacturer_id, file_id)
        
        count = len(pricing)
        print(f"DEBUG: Extraction complete. Found {count} pricing records.")
        
        if count > 0:
            # Chunked insert to handle 50,000+ records safely
            chunk_size = 1000
            for i in range(0, len(pricing), chunk_size):
                chunk = pricing[i : i + chunk_size]
                supabase.table("manufacturer_pricing").insert(chunk).execute()
                # Optional: Log progress
                if (i // chunk_size) % 10 == 0:
                    print(f"DEBUG: Inserted {i + len(chunk)} / {len(pricing)} records...")
            
            # Clear any existing local cache for this manufacturer so it rebuilds on next fetch
            global _CONFIG_CACHE, _MFG_DB_CACHE
            _CONFIG_CACHE.pop(manufacturer_id, None)
            
            # Wipe item match cache to ensure new prices are used
            to_delete_sku = [k for k in _MFG_DB_CACHE['sku'] if k.startswith(f"{manufacturer_id}:")]
            for k in to_delete_sku: del _MFG_DB_CACHE['sku'][k]
            
            to_delete_col = [k for k in _MFG_DB_CACHE['col'] if k.startswith(f"{manufacturer_id}:")]
            for k in to_delete_col: del _MFG_DB_CACHE['col'][k]

            cpath = get_cache_path(manufacturer_id)
            if os.path.exists(cpath):
                try:
                    os.remove(cpath)
                except:
                    pass
            
        return {"success": True, "count": len(pricing), "fileName": file.filename}
        
    except Exception as e:
        print(f"Pricing Upload Error: {str(e)}")
        return {"success": False, "error": str(e)}
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@router.get("/manufacturer-config")
async def get_manufacturer_config(id: str):
    """
    Structured Collection -> Door Styles mapping for the frontend config page.
    Optimized: uses targeted DISTINCT-like query and aggressively caches results.
    """
    try:
        global _CONFIG_CACHE
        if id in _CONFIG_CACHE:
            print("DEBUG: Returning manufacturer config from IN-MEMORY cache")
            return {
                "success": True, 
                "mapping": _CONFIG_CACHE[id]["mapping"],
                "debug": _CONFIG_CACHE[id]["debug"]
            }

        cpath = get_cache_path(id)
        if os.path.exists(cpath):
            try:
                with open(cpath, "r") as f:
                    data = json.load(f)
                _CONFIG_CACHE[id] = data
                print("DEBUG: Returning manufacturer config from DISK cache")
                return {
                    "success": True, 
                    "mapping": data["mapping"],
                    "debug": data["debug"]
                }
            except Exception as e:
                print(f"DEBUG: Failed to read disk cache: {e}")

        supabase = get_supabase()
        mapping = {}
        
        # FAST PATH: Fetch only unique collection_name, door_style pairs
        # Supabase API max limit is 1000 rows by default
        page_size = 1000
        off = 0
        seen_combos = set()
        max_scan = 200000
        
        import time
        start = time.time()
        
        while off < max_scan:
            res = supabase.table("manufacturer_pricing") \
                .select("collection_name, door_style") \
                .eq("manufacturer_id", id) \
                .range(off, off + page_size - 1).execute()
            
            batch = res.data or []
            if not batch: break
            
            for row in batch:
                c_raw = str(row.get('collection_name') or '').strip().upper()
                st_raw = str(row.get('door_style') or '').strip().upper()
                
                if c_raw and st_raw:
                    combo = f"{c_raw}|{st_raw}"
                    if combo in seen_combos:
                        continue
                    seen_combos.add(combo)
                    # print(f"DEBUG COMBO: collection_name='{c_raw}', door_style='{st_raw}'")
                    
                    cols = [s.strip() for s in c_raw.split(',') if s.strip()]
                    styles = [s.strip() for s in st_raw.split(',') if s.strip()]
                    
                    for c in cols:
                        if c not in mapping: mapping[c] = set()
                        for s in styles:
                            mapping[c].add(s)
            
            if len(batch) < page_size: break
            off += page_size

        elapsed = time.time() - start
        print(f"DEBUG: Config fetch completed in {elapsed:.2f}s ({off} rows scanned, {len(seen_combos)} unique combos)")
        print(f"DEBUG: Raw mapping keys (all collections found): {list(mapping.keys())}")
            
        final_mapping = {}
        exclude = {'UNIVERSAL', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'COL B', 'COL C', 'COL D', 'COL E', 'COL F', 'COL G'}
        
        for c, styles in mapping.items():
            if c not in exclude:
                final_mapping[c] = sorted(list(styles))
            else:
                print(f"DEBUG: Excluded collection: '{c}'")
                
        result_data = {
            "mapping": final_mapping,
            "debug": {
                "scan_time_seconds": round(elapsed, 2),
                "unique_combos": len(seen_combos),
                "collections_found": len(final_mapping),
                "cached": False
            }
        }
        
        _CONFIG_CACHE[id] = result_data
        try:
            with open(cpath, "w") as f:
                json.dump(result_data, f)
        except Exception as e:
            print(f"DEBUG: Failed to write disk cache: {e}")

        return {
            "success": True, 
            "mapping": result_data["mapping"],
            "debug": result_data["debug"]
        }

        
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/db-check")
async def db_check():
    """Diagnostic endpoint to verify database connectivity."""
    try:
        supabase = get_supabase()
        # Simple count check to verify RLS and Keys
        res = supabase.table("manufacturer_pricing").select("sku", count="exact").limit(1).execute()
        return {
            "success": True, 
            "message": "Database connection verified", 
            "pricing_count": res.count,
            "sample": res.data
        }
    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


