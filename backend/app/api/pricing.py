from fastapi import APIRouter, UploadFile, File
from app.core.supabase_client import get_supabase
from app.utils.cabinet_utils import (
    compress_sku, detect_category, parse_sku_dimensions,
    find_nearest_cabinet_match, classify_cabinet_type,
    normalize_collection_name, strip_catalog_suffix, strip_drawing_suffix,
    DRAWING_SUFFIX_TO_CATALOG,
)
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
# NEW: Global Cache for fully built lookup maps
# key: manufacturer_id, value: { 'maps': lookup_maps, 'timestamp': time.time() }
GLOBAL_LOOKUP_CACHE = {}

def get_manufacturer_pricing_maps(supabase, manufacturer_id: str, manufacturer_hint: str = ""):
    """
    Returns built lookup maps for a manufacturer, using a global memory cache if available.
    """
    now = datetime.datetime.now().timestamp()
    # Cache for 15 minutes unless re-upload occurs (TODO: bust on file upload)
    if manufacturer_id in GLOBAL_LOOKUP_CACHE:
        entry = GLOBAL_LOOKUP_CACHE[manufacturer_id]
        if now - entry['timestamp'] < 900: # 15 mins
            print(f"DEBUG: Using CACHED lookup maps for {manufacturer_id}")
            return entry['maps']

    print(f"DEBUG: FAILING through to Supabase fetch for {manufacturer_id}")
    pricing_data = []
    page_size = 1000
    
    # 1. Total count
    count_res = supabase.table("manufacturer_pricing").select("id", count="exact").eq("manufacturer_id", manufacturer_id).execute()
    total_mfg_items = count_res.count or 0
    print(f"DEBUG: Loading catalog ({total_mfg_items} items)...")

    # 2. Fetch all rows in 1000-row pages
    off = 0
    while off < total_mfg_items:
        res = supabase.table("manufacturer_pricing").select("id,sku,price,collection_name,door_style") \
            .eq("manufacturer_id", manufacturer_id) \
            .range(off, off + page_size - 1).execute()
        batch = res.data or []
        pricing_data.extend(batch)
        if len(batch) < page_size: break
        off += page_size

    # 3. Build maps
    lookup_maps = _build_lookup_maps(pricing_data)
    
    # 4. Cache and return
    GLOBAL_LOOKUP_CACHE[manufacturer_id] = {
        'maps': lookup_maps,
        'timestamp': now
    }
    return lookup_maps

def _build_lookup_maps(pricing_data: list):
    from app.utils.cabinet_utils import (
        detect_category, strip_catalog_suffix, compress_sku, 
        normalize_collection_name, parse_sku_dimensions, get_cabinet_section,
        classify_cabinet_type
    )
    
    lookup_maps = {
        'local': {}, 'global': {}, 'compressed': {}, 'dim': {},
        'col_skus': {}, 'category_skus': {}, 'category_sums': {},
        'all_catalog_rows': [],
        # NEW: SECTION-INDEXED rows for 10x faster dimension matching
        'section_rows': {} 
    }

    for p in pricing_data:
        sku = str(p['sku']).strip().upper()
        price = float(p.get('price') or 0)
        col = str(p.get('collection_name', '')).strip().upper()
        style = str(p.get('door_style', '')).strip().upper()
        
        sku_base = strip_catalog_suffix(sku)
        ct = classify_cabinet_type(sku_base)
        cs = get_cabinet_section(sku_base)
        
        # NEW: Pre-calculate everything for ultra-fast matching
        dims_p = parse_sku_dimensions(sku_base)
        w_val = dims_p.get('width')
        h_val = dims_p.get('height')
        norm_col = normalize_collection_name(col)
        
        cat = detect_category(sku)
        item = {
            "sku": sku, "price": price, "collection_name": col, "door_style": style,
            "ct": ct, "cs": cs, "w": w_val, "h": h_val,
            "ncol": norm_col, "csku": sku_base,
            "ac": re.sub(r'[^A-Z0-9]', '', sku_base.upper())
        }
        
        lookup_maps['all_catalog_rows'].append(item)
        
        # ── Section Indexing for Fast Nearest Match ──
        if cs:
            if cs not in lookup_maps['section_rows']:
                lookup_maps['section_rows'][cs] = []
            lookup_maps['section_rows'][cs].append(item)
        
        sku_comp_base = compress_sku(sku_base)

        if col and style: lookup_maps['local'][f"{sku}|{col}|{style}"] = item
        if col: lookup_maps['local'][f"{sku}|{col}"] = item
        if col:
            if col not in lookup_maps['col_skus']: lookup_maps['col_skus'][col] = []
            lookup_maps['col_skus'][col].append(sku)

        norm_col = normalize_collection_name(col)
        if norm_col and norm_col != col:
            if norm_col not in lookup_maps['col_skus']:
                lookup_maps['col_skus'][norm_col] = []
            lookup_maps['col_skus'][norm_col].append(sku)
            if col and style: lookup_maps['local'][f"{sku}|{norm_col}|{style}"] = item
            if col: lookup_maps['local'][f"{sku}|{norm_col}"] = item

        if style: lookup_maps['local'][f"{sku}|{style}"] = item

        if sku not in lookup_maps['global'] or price > lookup_maps['global'][sku]['price']:
            lookup_maps['global'][sku] = item
        comp = compress_sku(sku)
        if comp not in lookup_maps['compressed']: lookup_maps['compressed'][comp] = item

        if sku_base and sku_base != sku:
            if col and style: lookup_maps['local'].setdefault(f"{sku_base}|{col}|{style}", item)
            if col: lookup_maps['local'].setdefault(f"{sku_base}|{col}", item)
            if style: lookup_maps['local'].setdefault(f"{sku_base}|{style}", item)
            lookup_maps['global'].setdefault(sku_base, item)
            if sku_comp_base not in lookup_maps['compressed']:
                lookup_maps['compressed'][sku_comp_base] = item
            if norm_col and norm_col != col:
                lookup_maps['local'].setdefault(f"{sku_base}|{norm_col}", item)

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

        dims = parse_sku_dimensions(sku_base if sku_base else sku)
        if dims.get('prefix') and dims.get('width'):
            dim_key = f"{dims['prefix']}|{dims['width']}|{dims.get('height') or ''}"
            if f"{dim_key}|{col}" not in lookup_maps['dim']:
                lookup_maps['dim'][f"{dim_key}|{col}"] = item
            if dim_key not in lookup_maps['dim']:
                lookup_maps['dim'][dim_key] = item
    return lookup_maps

def get_cache_path(mfg_id: str) -> str:
    path = os.path.join(os.path.dirname(__file__), "..", "..", f"mfg_config_{mfg_id}.json")
    return os.path.abspath(path)

router = APIRouter()

def find_best_match(item_code: str, room_collection: str, room_door_style: str, lookup_maps: dict, manufacturer_hint: str = ""):
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
        # Disabled file I/O for 10x speed improvement
        # print(f"DEBUG: {message}")
        pass

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

    # TIER 2.5: SUFFIX BRIDGE — map design shorthand suffixes to pricebook codes
    # e.g. "B30 BUTT" → try "B30BD" before falling back to bare "B30"
    # Also handles concatenated: "W3042BUTT" → "W3042BD"
    suffix_m = re.search(r'\s+(BUTT DOOR|BUTT|BD|LH|RH|L|R)$', clean_target)
    if suffix_m:
        suffix_token = suffix_m.group(1).strip()
        base_sku     = clean_target[:suffix_m.start()].strip()
        mapped       = DRAWING_SUFFIX_TO_CATALOG.get(suffix_token)
        if mapped:
            bridged = base_sku + mapped           # e.g. "B30" + "BD" → "B30BD"
            log_match(f"TRYING TIER 2.5 (Suffix Bridge): {bridged}")
            match = try_match(bridged, "BRIDGED")
            if match: return match

    # TIER 2.6: CONCATENATED SUFFIX BRIDGE — handles "W3042BUTT" (no space)
    # Strip concatenated drawing suffixes and probe with catalog suffixes
    stripped_drawing = strip_drawing_suffix(clean_target)
    if stripped_drawing != clean_target:
        log_match(f"TRYING TIER 2.6 (Strip Drawing Suffix): {stripped_drawing}")
        # Try with common Integrity catalog suffixes: BD, MDBD, SD
        for cat_sfx in ['BD', 'MDBD', 'SD', '']:
            probe = stripped_drawing + cat_sfx
            result = try_match(probe, f"DRAW_SFX_{cat_sfx or 'BARE'}")
            if result:
                log_match(f"TIER 2.6 HIT: {probe}")
                return result

    # TIER 3: REMOVE NKBA SUFFIXES
    no_suffix_target = re.sub(r'\s*(BUTT|H|L|R|FL|S|D)$', '', clean_target).strip()
    if no_suffix_target != clean_target:
        log_match(f"TRYING TIER 3 (No Suffix): {no_suffix_target}")
        match = try_match(no_suffix_target, "NO_SUFFIX")
        if match: return match

    # TIER 3.5: MANUFACTURER CATALOG SUFFIX STRIPPING
    # Integrity appends finish/door variants as part of the SKU: BLD, BD, SD, MD, MDBD
    # Drawings add descriptors: DW (dishwasher side), DWR (right), VENTBOX, VENT, BOX
    # e.g. OCM8BLD → OCM8, UF3DW → UF3, BACKB48VENTBOX → BACKB48, UF642DWR → UF642
    _MFG_SUFFIX_RE = re.compile(r'(VENTBOX|VENT|BOX|MDBD|BLD|DWR|DW|BD|SD|MD)$')
    mfg_stripped = _MFG_SUFFIX_RE.sub('', clean_target).strip()
    if mfg_stripped and mfg_stripped != clean_target:
        log_match(f"TRYING TIER 3.5 (Mfg Suffix Strip): {mfg_stripped}")
        result = try_match(mfg_stripped, "MFG_STRIPPED")
        if result: return result
        # Also try with no-suffix applied on top of the stripped form
        mfg_no_sfx = re.sub(r'\s*(BUTT|H|L|R|FL|S|D)$', '', mfg_stripped).strip()
        if mfg_no_sfx != mfg_stripped:
            result = try_match(mfg_no_sfx, "MFG_STRIPPED_CLEAN")
            if result: return result

    # TIER 4: COMPRESSED (NEW)
    comp_target = compress_sku(clean_target)
    if comp_target in compressed_map:
        log_match(f"MATCH: {comp_target} (Compressed)")
        return compressed_map[comp_target], "COMPRESSED"

    # TIER 4.5: MOLDING / TRIM ALIAS PROBING
    # Drawing PDFs use NKBA-standard prefixes; Integrity catalog may use their own.
    # Also probe common catalog suffix variants (BLD, BD, SD) for molding codes.
    # e.g. BTK8 → BTK8BLD, TK8, TK8BLD; FL48 → LR48, LR48BLD; OCM8 → OCM8BLD
    _MOLDING_ALIASES = {
        'BTK': ['BTK', 'TK', 'BK'],      # Base Toe Kick
        'TK':  ['TK', 'BTK'],
        'FL':  ['FL', 'LR', 'FLR'],      # Filler Light Rail
        'LR':  ['LR', 'FL', 'FLR'],      # Light Rail
        'OCM': ['OCM', 'CM', 'OCORNER'], # Outside Corner Molding
        'SCM': ['SCM', 'SM', 'SCRIBE'],  # Scribe Molding
        'CM':  ['CM', 'OCM', 'CROWN'],   # Crown Molding
        'RR':  ['RR', 'LR'],             # Return Rail
    }
    _CATALOG_VARIANTS = ['BLD', 'BD', 'SD', 'MD', 'MDBD', '']
    _alias_prefix_m = re.match(r'^([A-Z]+)(\d+.*)$', clean_target)
    if _alias_prefix_m:
        ap, adigits = _alias_prefix_m.group(1), _alias_prefix_m.group(2)
        # Strip any mfg suffix already on the digits part so we can add clean variants
        adigits_clean = _MFG_SUFFIX_RE.sub('', adigits).strip()
        if ap in _MOLDING_ALIASES:
            for alias in _MOLDING_ALIASES[ap]:
                for variant in _CATALOG_VARIANTS:
                    probe = f"{alias}{adigits_clean}{variant}"
                    if probe != clean_target:
                        result = try_match(probe, f"ALIAS_{alias}_{variant or 'BARE'}")
                        if result:
                            log_match(f"TIER 4.5 HIT: {probe}")
                            return result

    # TIER 5: FUZZY — try against all collection SKUs (normalized collection name)
    # Also try fuzzy match against normalized collection names to handle encoding issues
    norm_col = normalize_collection_name(col)
    # Find the best matching collection key using normalized names
    fuzzy_col_key = col
    if norm_col and col not in lookup_maps.get('col_skus', {}):
        for catalog_col in lookup_maps.get('col_skus', {}).keys():
            if normalize_collection_name(catalog_col) == norm_col:
                fuzzy_col_key = catalog_col
                break
            # Also try contains-match
            if norm_col in normalize_collection_name(catalog_col) or normalize_collection_name(catalog_col) in norm_col:
                fuzzy_col_key = catalog_col
                break

    if fuzzy_col_key in lookup_maps.get('col_skus', {}):
        choices = lookup_maps['col_skus'][fuzzy_col_key]
        if choices:
            # Use the stripped drawing target for fuzzy matching
            fuzzy_target = strip_drawing_suffix(clean_target)
            best_sku, score = process.extractOne(fuzzy_target, choices, scorer=fuzz.ratio)
            if score > 80:  # Slightly lower threshold since we've stripped suffixes
                log_match(f"MATCH: {best_sku} (Fuzzy {score}% via normalized col)")
                key = f"{best_sku}|{fuzzy_col_key}"
                match = local_map.get(key) or local_map.get(f"{best_sku}|{fuzzy_col_key}|{style}") or global_map.get(best_sku)
                if match: return match, f"FUZZY_{score}"

    # TIER 5.5: INTELLIGENT NEAREST-CABINET DIMENSION MATCH
    # ─────────────────────────────────────────────────────────────────────
    # When no exact / fuzzy match is found, classify the cabinet type from
    # the drawing code (Wall, Base, Sink Base, Vanity, Tall, Molding, etc.)
    # and find the geometrically closest same-TYPE+SECTION cabinet in catalog.
    # Collection filter is normalized inside find_nearest_cabinet_match.
    # ─────────────────────────────────────────────────────────────────────
    # Pass ORIGINAL target (with drawing suffixes) so the smart matcher
    # can strip them itself and classify correctly
    cabinet_type = classify_cabinet_type(clean_target) or classify_cabinet_type(target)
    catalog_rows = lookup_maps.get('all_catalog_rows', [])
    if cabinet_type and catalog_rows:
        nearest = find_nearest_cabinet_match(
            target_sku=target,                   # pass original, smart matcher strips suffixes
            catalog_skus=catalog_rows,
            collection_filter=col or None,       # raw col; normalization done inside
            manufacturer_hint=manufacturer_hint,
        )
        if nearest:
            # Try to log what size we landed on
            t_dims = parse_sku_dimensions(strip_drawing_suffix(clean_target))
            cat_sku_clean = strip_catalog_suffix(str(nearest.get('sku', '')))
            n_dims = parse_sku_dimensions(cat_sku_clean)
            tw = t_dims.get('width') or 0
            nw = n_dims.get('width') or 0
            th = t_dims.get('height') or 0
            nh = n_dims.get('height') or 0
            delta_w = f" Δw={abs(tw - nw)}" if (tw and nw) else ""
            # Build a clear price reference string for the frontend
            ref_sku = nearest.get('sku', '')
            ref_col = nearest.get('collection_name', '')
            size_note = ""
            if tw and nw and tw == nw and th and nh and th == nh:
                size_note = ""  # perfect match — no annotation needed
            elif tw and nw and tw != nw:
                size_note = f" (nearest {nw}\" wide)"
            elif th and nh and th != nh:
                size_note = f" (nearest {nh}\" tall)"
            nearest['price_ref'] = f"Ref: {ref_sku}{size_note} [{ref_col}]"
            log_match(f"MATCH: {nearest['sku']} (NearestDim type={cabinet_type}{delta_w})")
            return nearest, f"NEAREST_DIM_{cabinet_type.replace(' ', '_').upper()}"

    # TIER 6: DIMENSION MATCH (Cross-Manufacturer)
    dims = parse_sku_dimensions(clean_target)
    if dims.get('prefix') and dims.get('width'):
        dim_key = f"{dims['prefix']}|{dims['width']}|{dims.get('height') or ''}"
        # Try finding a match in the same collection
        dim_map = lookup_maps.get('dim', {})
        if f"{dim_key}|{col}" in dim_map:
            match = dim_map[f"{dim_key}|{col}"]
            log_match(f"MATCH: {dim_key} (Dimension Col)")
            return match, "DIMENSION_COL"
        
        # Try global dimension match (any collection)
        if dim_key in dim_map:
            match = dim_map[dim_key]
            log_match(f"MATCH: {dim_key} (Dimension Global)")
            return match, "DIMENSION_GLOBAL"

    # TIER 7: CATEGORY FALLBACK  (Better than $0)
    # Even in the avg-price fallback, we resolve the NEAREST real catalog SKU
    # so the designer always sees an actual manufacturer code as the reference.
    cat_sums = lookup_maps.get('category_sums', {})
    if category in cat_sums:
        total_price, count = cat_sums[category]
        if count > 0:
            avg_price = total_price / count

            # Find closest real catalog SKU inside this category
            all_rows = lookup_maps.get('all_catalog_rows', [])
            cat_items = [r for r in all_rows if detect_category(r.get('sku', '')) == category]
            nearest_ref_sku = None
            nearest_ref_col = None
            if cat_items:
                _nearest = find_nearest_cabinet_match(
                    target_sku=clean_target,
                    catalog_skus=cat_items,
                    collection_filter=col or None,
                    manufacturer_hint=manufacturer_hint,
                )
                if _nearest:
                    nearest_ref_sku = _nearest.get('sku', '')
                    nearest_ref_col = _nearest.get('collection_name', '')

            # Use real catalog SKU as matched label; fall back to synthetic only if none found
            matched_label = nearest_ref_sku or f"{target} (Est. {category})"
            if nearest_ref_sku:
                ref_text = f"Catalog Ref: {nearest_ref_sku} [{nearest_ref_col}] (avg. of {count} {category} items)"
            else:
                ref_text = f"Avg. of {count} {category} items in catalog"

            log_match(f"MATCH: {category} (Category Average — catalog ref: {nearest_ref_sku})")
            return {
                "sku": matched_label,
                "price": avg_price,
                "collection_name": col or "N/A",
                "price_ref": ref_text
            }, "CATEGORY_AVERAGE"

    log_match(f"FAIL: {target} (Required review)")
    return {
        "sku": f"{target} (Review)",
        "price": 0.0,
        "collection_name": col or "N/A",
        "price_ref": "No catalog match found — manual pricing required"
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

        # Determine manufacturer hint (for Integrity-specific logic)
        project_mfg_name = str(project.get('metadata', {}).get('mfg_name', '')).lower()
        is_integrity = (
            manufacturer_id == "4c5206ec-fd02-46cb-81bf-f4663a7333d0"
            or "integrity" in project_mfg_name
        )
        mfg_hint = "integrity" if is_integrity else project_mfg_name

        # 3. GET PRICING MAPS (with CACHE)
        start_t = datetime.datetime.now()
        lookup_maps = get_manufacturer_pricing_maps(supabase, manufacturer_id, mfg_hint)
        print(f"DEBUG: Lookup maps ready in {(datetime.datetime.now() - start_t).total_seconds():.2f}s")

        print(f"DEBUG: CATEGORIES DISCOVERED in catalog: {list(lookup_maps['category_sums'].keys())}")
        print(f"DEBUG: Category sums: {lookup_maps['category_sums']}")
        
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
                match, match_type = find_best_match(item['code'], effective_col, room.get('door_style', ''), lookup_maps, manufacturer_hint=mfg_hint)
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
                        # Store full reference string in matched_sku so designer can
                        # always trace which catalog SKU was used for the price.
                        # Format:  "REF_SKU" or "Catalog Ref: REF_SKU [COLLECTION] (note)"
                        "matched_sku": match.get('price_ref') or match['sku'],
                        "qty": qty,
                        "unit_price": price,
                        "line_total": total,
                        "room": room['room_name'],
                        "collection": room.get('collection') or match.get('collection_name'),
                        "door_style": room.get('door_style') or 'UNIVERSAL',
                        "price_source": f"Python Engine ({match_type})",
                        "precision_level": match_type,
                        # NOTE: 'price_reference' column does NOT exist in quotation_boms.
                        # Reference info is encoded in matched_sku above.
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


# ──────────────────────────────────────────────────────────────────────────────
# SHARED HELPERS used by both generate_bom and compare_bom
# ──────────────────────────────────────────────────────────────────────────────

async def _fetch_pricing_data(supabase, manufacturer_id: str, project_skus: set) -> list:
    """Fetch all pricing rows for a manufacturer (full load or targeted SKU fetch)."""
    page_size = 1000
    pricing_data = []
    seen_ids: set = set()

    count_res = supabase.table("manufacturer_pricing").select("id", count="exact").eq("manufacturer_id", manufacturer_id).execute()
    total = count_res.count or 0

    if total < 50000:
        off = 0
        while off < total:
            res = supabase.table("manufacturer_pricing").select("id,sku,price,collection_name,door_style") \
                .eq("manufacturer_id", manufacturer_id).range(off, off + page_size - 1).execute()
            batch = res.data or []
            for row in batch:
                rid = row.get('id')
                if rid and rid not in seen_ids:
                    seen_ids.add(rid)
                    pricing_data.append(row)
            if len(batch) < page_size:
                break
            off += page_size
    else:
        # Targeted SKU fetch for large catalogs
        for i in range(0, len(project_skus), 200):
            chunk = list(project_skus)[i:i + 200]
            off = 0
            while True:
                res = supabase.table("manufacturer_pricing").select("id,sku,price,collection_name,door_style") \
                    .eq("manufacturer_id", manufacturer_id).in_("sku", chunk).range(off, off + page_size - 1).execute()
                batch = res.data or []
                for row in batch:
                    rid = row.get('id')
                    if rid and rid not in seen_ids:
                        seen_ids.add(rid)
                        pricing_data.append(row)
                if len(batch) < page_size:
                    break
                off += page_size

    return pricing_data


def _build_lookup_maps(pricing_data: list) -> dict:
    """Build all lookup maps from a flat list of pricing rows.
    Enhanced with catalog suffix stripping and normalized collection indexing.
    """
    maps = {
        'local': {}, 'global': {}, 'compressed': {}, 'dim': {},
        'col_skus': {}, 'category_sums': {}, 'all_catalog_rows': []
    }
    for p in pricing_data:
        sku   = str(p['sku']).strip().upper()
        price = float(p.get('price') or 0)
        col   = str(p.get('collection_name', '')).strip().upper()
        style = str(p.get('door_style', '')).strip().upper()
        cat   = detect_category(sku)
        item  = {"sku": sku, "price": price, "collection_name": col, "door_style": style}

        maps['all_catalog_rows'].append(item)

        # Stripped base code (W3042BD → W3042) for dimension matching
        sku_base = strip_catalog_suffix(sku)
        sku_comp_base = compress_sku(sku_base)
        norm_col = normalize_collection_name(col)

        if col and style: maps['local'][f"{sku}|{col}|{style}"] = item
        if col:           maps['local'][f"{sku}|{col}"] = item
        if style:         maps['local'][f"{sku}|{style}"] = item
        if col:
            maps['col_skus'].setdefault(col, []).append(sku)

        # Normalized collection name indexing (handles encoding artifacts like \ufffd for ")
        if norm_col and norm_col != col:
            maps['col_skus'].setdefault(norm_col, []).append(sku)
            if col and style: maps['local'][f"{sku}|{norm_col}|{style}"] = item
            if col: maps['local'][f"{sku}|{norm_col}"] = item

        if sku not in maps['global'] or price > maps['global'][sku]['price']:
            maps['global'][sku] = item

        comp = compress_sku(sku)
        if comp not in maps['compressed']:
            maps['compressed'][comp] = item

        # Integrity suffix-stripped base code indexing (W3042BD → also index as W3042)
        if sku_base and sku_base != sku:
            maps['local'].setdefault(f"{sku_base}|{col}|{style}", item)
            maps['local'].setdefault(f"{sku_base}|{col}", item)
            maps['local'].setdefault(f"{sku_base}|{style}", item)
            maps['global'].setdefault(sku_base, item)
            if sku_comp_base not in maps['compressed']:
                maps['compressed'][sku_comp_base] = item
            if norm_col and norm_col != col:
                maps['local'].setdefault(f"{sku_base}|{norm_col}", item)

        # Index stripped-suffix version from the catalog side too
        stripped = re.sub(r'[\s-]*(BUTT|H|L|R|FL|S|D)$', '', sku).strip()
        if stripped != sku:
            maps['local'].setdefault(f"{stripped}|{col}|{style}", item)
            maps['local'].setdefault(f"{stripped}|{col}", item)
            maps['local'].setdefault(f"{stripped}|{style}", item)
            maps['global'].setdefault(stripped, item)

        maps['category_sums'].setdefault(cat, [0.0, 0])
        maps['category_sums'][cat][0] += price
        maps['category_sums'][cat][1] += 1

        dims = parse_sku_dimensions(sku_base if sku_base else sku)
        if dims.get('prefix') and dims.get('width'):
            dk = f"{dims['prefix']}|{dims['width']}|{dims.get('height') or ''}"
            maps['dim'].setdefault(f"{dk}|{col}", item)
            maps['dim'].setdefault(dk, item)

    return maps




def _price_rooms(rooms: list, lookup_maps: dict, manufacturer_id: str, mfg_hint: str, project_id: str) -> list:
    """Match every cabinet in every room against lookup_maps and return BOM item dicts."""
    bom_items = []
    categories_to_flatten = [
        'cabinets', 'perimeter', 'island', 'hardware', 'island_hardware',
        'bump', 'island_bump', 'opt_crown', 'opt_light_rail', 'vent_chase_material'
    ]

    for room in rooms:
        room_col  = room.get('collection', '')
        wood      = room.get('wood_species', '')
        effective_col = room_col
        if manufacturer_id == "4c5206ec-fd02-46cb-81bf-f4663a7333d0" or "integrity" in mfg_hint:
            if wood and room_col and " - " not in room_col:
                effective_col = f"{room_col} - {wood}"

        flat_items = []
        for cat in categories_to_flatten:
            flat_items.extend(room.get(cat, []))

        for item in flat_items:
            match, match_type = find_best_match(
                item['code'], effective_col, room.get('door_style', ''),
                lookup_maps, manufacturer_hint=mfg_hint
            )
            if match:
                qty   = int(float(item.get('quantity', item.get('qty', 1))))
                price = round(float(match['price']))
                bom_items.append({
                    "project_id":     project_id,
                    "sku":            item['code'],
                    "matched_sku":    match.get('price_ref') or match['sku'],
                    "qty":            qty,
                    "unit_price":     price,
                    "line_total":     round(price * qty),
                    "room":           room['room_name'],
                    "collection":     room.get('collection') or match.get('collection_name'),
                    "door_style":     room.get('door_style') or 'UNIVERSAL',
                    "price_source":   f"Python Engine ({match_type})",
                    "precision_level": match_type,
                    "created_at":     datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                })
    return bom_items


@router.post("/compare-bom")
async def compare_bom(body: dict):
    """
    Side-by-side pricing comparison between two manufacturers for the same project.

    Body:
      {
        "project_id": "uuid",
        "manufacturer_a": {"id": "uuid", "collection": "PRIME CHERRY", "door_style": "FACE FRAME"},
        "manufacturer_b": {"id": "uuid", "collection": "MONTEREY",     "door_style": "FACE FRAME"}
      }

    Returns per-row delta and summary totals.
    """
    import asyncio
    try:
        supabase     = get_supabase()
        project_id   = body.get("project_id", "")
        mfr_a        = body.get("manufacturer_a", {})
        mfr_b        = body.get("manufacturer_b", {})

        if not project_id or not mfr_a.get("id") or not mfr_b.get("id"):
            return {"success": False, "error": "project_id, manufacturer_a.id and manufacturer_b.id are required"}

        project = supabase.table("quotation_projects").select("*").eq("id", project_id).single().execute().data
        if not project:
            return {"success": False, "error": "Project not found"}

        base_rooms = project.get("extracted_data", {}).get("rooms", [])

        def make_rooms(collection: str, door_style: str):
            return [
                {**r, "collection": collection, "door_style": door_style}
                for r in base_rooms
            ]

        # Collect all project SKUs for targeted fetch on large catalogs
        project_skus: set = set()
        for r in base_rooms:
            for cat in ['cabinets', 'perimeter', 'island', 'hardware', 'island_hardware',
                        'bump', 'island_bump', 'opt_crown', 'opt_light_rail', 'vent_chase_material']:
                for itm in r.get(cat, []):
                    code = str(itm.get('code') or '').strip().upper()
                    if code:
                        project_skus.add(code)
                        project_skus.add(re.sub(r'[\(\{\[].*?[\)\}\]]', '', code).strip())
                        project_skus.add(re.sub(r'\s*(BUTT|H|L|R|FL|S|D)$', '', code).strip())

        # Fetch pricing for both manufacturers in parallel
        pricing_a, pricing_b = await asyncio.gather(
            _fetch_pricing_data(supabase, mfr_a["id"], project_skus),
            _fetch_pricing_data(supabase, mfr_b["id"], project_skus),
        )

        maps_a = _build_lookup_maps(pricing_a)
        maps_b = _build_lookup_maps(pricing_b)

        mfg_hint_a = "integrity" if mfr_a["id"] == "4c5206ec-fd02-46cb-81bf-f4663a7333d0" else ""
        mfg_hint_b = "integrity" if mfr_b["id"] == "4c5206ec-fd02-46cb-81bf-f4663a7333d0" else ""

        rooms_a = make_rooms(mfr_a.get("collection", "UNIVERSAL"), mfr_a.get("door_style", "UNIVERSAL"))
        rooms_b = make_rooms(mfr_b.get("collection", "UNIVERSAL"), mfr_b.get("door_style", "UNIVERSAL"))

        items_a = _price_rooms(rooms_a, maps_a, mfr_a["id"], mfg_hint_a, project_id)
        items_b = _price_rooms(rooms_b, maps_b, mfr_b["id"], mfg_hint_b, project_id)

        def row_key(item):
            return f"{item['room']}|{item['sku']}|{item['qty']}"

        map_a = {row_key(i): i for i in items_a}
        map_b = {row_key(i): i for i in items_b}
        all_keys = sorted(set(list(map_a.keys()) + list(map_b.keys())))

        rows = []
        for key in all_keys:
            ia = map_a.get(key)
            ib = map_b.get(key)
            base    = ia or ib
            price_a = float(ia["unit_price"]) if ia else 0.0
            price_b = float(ib["unit_price"]) if ib else 0.0
            qty     = int(base["qty"])
            ext_a   = round(price_a * qty)
            ext_b   = round(price_b * qty)
            rows.append({
                "room":         base["room"],
                "sku_original": base["sku"],
                "qty":          qty,
                "sku_a":        ia["matched_sku"] if ia else None,
                "price_a":      price_a,
                "precision_a":  ia["precision_level"] if ia else None,
                "ext_a":        ext_a,
                "sku_b":        ib["matched_sku"] if ib else None,
                "price_b":      price_b,
                "precision_b":  ib["precision_level"] if ib else None,
                "ext_b":        ext_b,
                "delta":        ext_b - ext_a,
            })

        total_a = sum(r["ext_a"] for r in rows)
        total_b = sum(r["ext_b"] for r in rows)
        delta   = total_b - total_a

        return {
            "success": True,
            "rows":    rows,
            "totals": {
                "list_a":    total_a,
                "list_b":    total_b,
                "delta":     delta,
                "delta_pct": round(delta / total_a * 100, 2) if total_a else 0,
            },
        }
    except Exception as e:
        traceback.print_exc()
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
        res = supabase.table("manufacturer_pricing").select("sku", count="exact").limit(1).execute()
        return {
            "success": True,
            "message": "Database connection verified",
            "pricing_count": res.count,
            "sample": res.data
        }
    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


# ──────────────────────────────────────────────────────────────────────────────
# INSTALL RULES  (manufacturer defaults + client overrides)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/install-rules/upload")
async def upload_install_rules(
    file: UploadFile = File(...),
    manufacturer_id: str = None
):
    """
    Bulk-upload install rules from an Excel file.

    Expected columns (case-insensitive):
      Item Code | Item Type | Install Factor | Include in 3PL | Count Basis

    All rows are upserted with the supplied manufacturer_id.
    """
    import io
    try:
        import openpyxl
    except ImportError:
        return {"success": False, "error": "openpyxl not installed on server."}

    if not manufacturer_id:
        return {"success": False, "error": "manufacturer_id query param is required."}

    try:
        contents = await file.read()
        wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
        ws = wb.active

        header_map: dict[str, int] = {}
        header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
        for col_idx, cell_val in enumerate(header_row):
            if cell_val:
                header_map[str(cell_val).strip().lower()] = col_idx

        col_aliases = {
            "item_code":       ["item code", "item_code", "sku", "code"],
            "item_type":       ["item type", "item_type", "type"],
            "install_factor":  ["install factor", "install_factor", "factor"],
            "include_in_3pl":  ["include in 3pl", "include_in_3pl", "3pl"],
            "count_basis":     ["count basis", "count_basis", "basis"],
        }

        def find_col(field: str):
            for alias in col_aliases[field]:
                if alias in header_map:
                    return header_map[alias]
            return None

        col_code    = find_col("item_code")
        col_type    = find_col("item_type")
        col_factor  = find_col("install_factor")
        col_3pl     = find_col("include_in_3pl")
        col_basis   = find_col("count_basis")

        if col_code is None or col_factor is None:
            return {"success": False, "error": "Excel must have 'Item Code' and 'Install Factor' columns."}

        supabase = get_supabase()
        rows_upserted = 0
        rows_skipped = 0

        for row in ws.iter_rows(min_row=2, values_only=True):
            item_code = str(row[col_code]).strip().upper() if row[col_code] else None
            if not item_code or item_code == "NONE":
                rows_skipped += 1
                continue

            try:
                factor = float(row[col_factor]) if row[col_factor] is not None else 1.0
            except (ValueError, TypeError):
                rows_skipped += 1
                continue

            item_type  = str(row[col_type]).strip().lower()  if (col_type  is not None and row[col_type])  else "cabinet"
            count_basis = str(row[col_basis]).strip().lower() if (col_basis is not None and row[col_basis]) else "quantity"

            raw_3pl = row[col_3pl] if col_3pl is not None else True
            if isinstance(raw_3pl, bool):
                include_3pl = raw_3pl
            elif isinstance(raw_3pl, str):
                include_3pl = raw_3pl.strip().upper() not in ("FALSE", "NO", "0", "F", "N")
            else:
                include_3pl = bool(raw_3pl) if raw_3pl is not None else True

            payload = {
                "manufacturer_id": manufacturer_id,
                "item_code":       item_code,
                "item_type":       item_type,
                "install_factor":  factor,
                "include_in_3pl":  include_3pl,
                "count_basis":     count_basis,
            }
            supabase.table("install_rules").upsert(
                payload, on_conflict="manufacturer_id,item_code"
            ).execute()
            rows_upserted += 1

        return {
            "success":       True,
            "rows_upserted": rows_upserted,
            "rows_skipped":  rows_skipped,
        }

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.post("/test-install-rule")
async def test_install_rule(body: dict):
    """
    Test rule lookup for a single item.

    Body: { manufacturer_id, client_name?, item_code, quantity }
    Returns the matched rule, calculated install units, and 3PL inclusion.
    """
    try:
        manufacturer_id = body.get("manufacturer_id", "")
        client_name     = (body.get("client_name") or "").strip()
        item_code       = str(body.get("item_code", "")).strip().upper()
        quantity        = float(body.get("quantity", 1))

        supabase = get_supabase()

        # 1. Check client overrides first
        override = None
        if client_name:
            res = supabase.table("install_rule_overrides") \
                .select("*") \
                .eq("manufacturer_id", manufacturer_id) \
                .eq("client_name", client_name) \
                .eq("item_code", item_code) \
                .limit(1).execute()
            if res.data:
                override = res.data[0]

        # 2. Manufacturer default
        default_rule = None
        res2 = supabase.table("install_rules") \
            .select("*") \
            .eq("manufacturer_id", manufacturer_id) \
            .eq("item_code", item_code) \
            .limit(1).execute()
        if res2.data:
            default_rule = res2.data[0]

        active_rule = override or default_rule
        if not active_rule:
            return {
                "success":      True,
                "found":        False,
                "item_code":    item_code,
                "message":      f"No rule found for item '{item_code}' with manufacturer '{manufacturer_id}'.",
            }

        install_units = quantity * float(active_rule["install_factor"])
        tpl_units     = quantity if active_rule["include_in_3pl"] else 0

        return {
            "success":       True,
            "found":         True,
            "item_code":     item_code,
            "rule_source":   "client_override" if override else "manufacturer_default",
            "rule":          active_rule,
            "quantity":      quantity,
            "install_units": install_units,
            "tpl_units":     tpl_units,
            "include_in_3pl": active_rule["include_in_3pl"],
        }

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


