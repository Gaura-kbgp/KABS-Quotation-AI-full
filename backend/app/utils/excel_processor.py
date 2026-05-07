"""
Excel pricing parser — uses python-calamine (Rust) for raw cell reading
instead of openpyxl, giving 10-50x faster load on large files.
"""
import re
import io
from typing import Any

WELLBORN_COLUMNS = {
    1: "ELITE CHERRY / ELITE DURAFORM (TEXTURED)",
    2: "PREMIUM CHERRY / PREMIUM DURAFORM (TEXTURED) / ELITE MAPLE / ELITE PAINTED",
    3: "PRIME CHERRY / PREMIUM MAPLE / PREMIUM PAINTED / PREMIUM DURAFORM (NON-TEXTURED)",
    4: "PRIME MAPLE / PRIME PAINTED / PRIME DURAFORM",
    5: "CHOICE DURAFORM / CHOICE MAPLE / CHOICE PAINTED",
    6: "BASE"
}

WELLBORN_IDS = ["3be07931-596a-4fa3-8d39-8d04c36cf4bb", "4afa4d4e-ff56-4a76-851d-73541f8a58ec"]
_WELLBORN_NAME_KEYWORDS = ("WELLBORN", "1951")

def _is_wellborn(manufacturer_id: str, manufacturer_name: str = "") -> bool:
    """Returns True if this manufacturer uses Wellborn's tiered column pricing format."""
    if manufacturer_id in WELLBORN_IDS:
        return True
    name_upper = manufacturer_name.upper()
    return any(kw in name_upper for kw in _WELLBORN_NAME_KEYWORDS)

try:
    from python_calamine import CalamineWorkbook
    _CALAMINE_OK = True
except ImportError:
    _CALAMINE_OK = False

# Fallback to pandas/openpyxl when calamine not available
import pandas as pd

_TIER_KEYS  = ["PRIME", "PREMIUM", "ELITE", "CHOICE", "SELECT", "VALUE", "STANDARD"]
_WOOD_KEYS  = ["CHERRY", "MAPLE", "PAINTED", "DURAFORM", "OAK", "ASH", "HICKORY",
               "BIRCH", "ALDER", "WALNUT", "WHITE"]
_SKIP_SINGLES = {
    'A','B','C','D','E','F','G','H','I','J',
    'SKU','PRICE','LIST','DESCRIPTION','DESC','ITEM','CODE',
    'NAN','','NONE','NULL',
}

_MIN_PRICE = 0.01


# ─── Header helpers ───────────────────────────────────────────────────────────

def _cell_str(cell: Any) -> str:
    if cell is None:
        return ""
    s = str(cell).strip().upper()
    return "" if s in ("NAN", "NONE", "NULL") else s


def _build_column_header_from_matrix(matrix: list[list], col_idx: int, sku_row_idx: int) -> str:
    seen, seen_set = [], set()
    for h_idx in range(sku_row_idx + 1):
        if h_idx >= len(matrix):
            break
        row = matrix[h_idx]
        if col_idx >= len(row):
            continue
        text = _cell_str(row[col_idx])
        if not text:
            continue
        for line in text.split('\n'):
            line = re.sub(r'^[/\-–•\s]+|[/\-–•\s]+$', '', line.strip())
            if line and line not in seen_set and line not in _SKIP_SINGLES:
                seen.append(line)
                seen_set.add(line)
    return ' | '.join(seen)


def _classify_header(combined: str) -> tuple[str, str]:
    # Find ALL tiers and ALL woods to be more inclusive
    tiers_found = [t for t in _TIER_KEYS if t in combined]
    woods_found = [w for w in _WOOD_KEYS if w in combined]

    if tiers_found and woods_found:
        # Create a combined name like "PRIME PREMIUM CHERRY / MAPLE / PAINTED"
        tier_str = ' '.join(tiers_found)
        wood_str = ' / '.join(woods_found)
        collection_name = f"{tier_str} {wood_str}"
    elif tiers_found:
        collection_name = ' '.join(tiers_found)
    elif woods_found:
        collection_name = ' / '.join(woods_found)
    else:
        # Fallback to the first few terms of the header if no clear tier/wood
        # This helps capture specific collection names or door styles
        collection_name = ' '.join(combined.split(' | ')[:3]).strip()[:100]

    # Also check if any known door style keywords are in the header
    # and append them to the collection name if they aren't already there.
    # This helps when the user selects a specific door style as the 'collection'.
    for word in combined.split(' | '):
        word = word.strip()
        if word and len(word) > 3 and word not in collection_name and any(x in word for x in ["PAINTED", "MAPLE", "CHERRY", "DURAFORM"]):
             if len(collection_name) < 150:
                 collection_name += f" | {word}"

    door_style = "FRAMELESS" if "FRAMELESS" in combined else "FACE FRAME"
    return collection_name, door_style


# ─── Core sheet parser (works on raw list-of-lists) ──────────────────────────

def _parse_sheet(matrix: list[list], sheet_name: str, manufacturer_id: str,
                 file_id: str, manufacturer_name: str = "") -> list[dict]:
    records = []
    if not matrix:
        return records

    # 1. Find SKU anchor row
    sku_row_idx = sku_col_idx = -1
    _SKU_KEYWORDS = (
        "SKU", "ITEM CODE", "ITEM NO", "ITEM #", "ITEM NO.", "PRODUCT CODE",
        "CODE", "ITEM", "PART NO", "PART NO.", "PART NUMBER", "PART #",
        "CATALOG NO", "CATALOG NO.", "CAT NO", "CAT NO.", "CAT #",
        "CATALOG", "MODEL NO", "MODEL NO.", "MODEL NUMBER", "MODEL",
        "NUMBER", "NO.", "DESCRIPTION", "PART",
    )
    for r_idx, row in enumerate(matrix):
        row_upper = [_cell_str(c) for c in row]
        for keyword in _SKU_KEYWORDS:
            if keyword in row_upper:
                sku_row_idx = r_idx
                sku_col_idx = row_upper.index(keyword)
                break
        if sku_row_idx != -1:
            break

    # Fallback: auto-detect column 0 as SKU when there is no header keyword.
    # Trigger when at least 4 of the first 8 data rows have code-like values in
    # col 0 (alphanumeric, 2-20 chars) AND col 1 has at least one positive number.
    if sku_row_idx == -1:
        for r_idx in range(min(8, len(matrix))):
            data_slice = matrix[r_idx + 1: r_idx + 9]
            sku_like = sum(
                1 for dr in data_slice
                if dr and _cell_str(dr[0]) and not _cell_str(dr[0]).isdigit()
                and 2 <= len(_cell_str(dr[0])) <= 20
                and re.search(r'[A-Za-z]', _cell_str(dr[0]))
            )
            if sku_like < 4:
                continue
            has_price = any(
                col_idx < len(dr) and dr[col_idx] is not None
                and re.sub(r'[^\d.]', '', str(dr[col_idx]))
                and float(re.sub(r'[^\d.]', '', str(dr[col_idx])) or 0) > 0
                for dr in data_slice
                for col_idx in range(1, min(5, len(dr)))
            )
            if has_price:
                sku_row_idx = r_idx
                sku_col_idx = 0
                print(f"Excel Parser: auto-detected SKU col=0 in '{sheet_name}' at header row {r_idx}")
                break

    if sku_row_idx == -1:
        print(f"Excel Parser: no SKU anchor in sheet '{sheet_name}' — skipping")
        return records

    # 2. Build price-column metadata
    max_col = min(len(matrix[sku_row_idx]), sku_col_idx + 60)
    matrix_cols: dict[int, dict] = {}

    is_accessory_sheet = any(x in sheet_name.upper() for x in
                             ["ACCESSORY", "FILLER", "OPTION", "SCB", "TRIM", "MOLDING", "HARDWARE", "ACC", "FIL", "MLD", "PRICING"])

    # Track the last known tier-group header so we can inherit it into sub-columns
    # that have an empty row-0 cell due to Excel merged-cell encoding.
    # e.g. "ELITE CHERRY" merged across 5 style sub-columns → only col B has the value;
    # cols C-F inherit "ELITE CHERRY" and combine it with their own row-1 style name.
    last_tier_combined = ""

    _PRICE_HEADER_WORDS = {"PRICE", "LIST", "MSRP", "COST", "RETAIL", "WHOLESALE", "NET"}
    _POINTS_HEADER_WORDS = {"POINTS", "FACTOR", "LABOR", "INSTALL"}

    for col_idx in range(sku_col_idx + 1, max_col):
        combined = _build_column_header_from_matrix(matrix, col_idx, sku_row_idx)

        # Merged-cell inheritance
        if last_tier_combined:
            row0_text = ""
            if len(matrix) > 0 and col_idx < len(matrix[0]):
                row0_text = _cell_str(matrix[0][col_idx])
            if not row0_text and combined:
                combined = last_tier_combined + " | " + combined
            elif not row0_text and not combined:
                combined = last_tier_combined

        # If combined is empty, check keywords or apply Wellborn defaults
        if not combined:
            raw_header_words = set()
            for h_idx in range(sku_row_idx + 1):
                if h_idx < len(matrix) and col_idx < len(matrix[h_idx]):
                    raw_header_words.update(_cell_str(matrix[h_idx][col_idx]).upper().split())
            
            if raw_header_words & _PRICE_HEADER_WORDS:
                combined = "UNIVERSAL"
            elif raw_header_words & _POINTS_HEADER_WORDS:
                combined = "LABOR_POINTS"
            elif _is_wellborn(manufacturer_id, manufacturer_name) and is_accessory_sheet:
                # Wellborn specific mapping for empty headers on accessory sheets
                rel_idx = col_idx - sku_col_idx
                if rel_idx == 1: combined = "UNIVERSAL"
                elif rel_idx == 3: combined = "LABOR_POINTS"

        if not combined or re.fullmatch(r'[A-Z]|\d+', combined.strip()):
            continue

        # Update inherited tier
        row0_val = _cell_str(matrix[0][col_idx]) if col_idx < len(matrix[0]) else ""
        if row0_val and any(t in row0_val for t in _TIER_KEYS + _WOOD_KEYS):
            last_tier_combined = row0_val

        collection_name, door_style = _classify_header(combined)
        
        # Override if explicitly marked as labor points
        if combined == "LABOR_POINTS":
            collection_name, door_style = "LABOR_POINTS", "LABOR_POINTS"

        # WELLBORN SPECIAL HANDLING: Map Column B-G to Collections 1-6
        if _is_wellborn(manufacturer_id, manufacturer_name):
            rel_idx = col_idx - sku_col_idx
            if not is_accessory_sheet:
                if rel_idx in WELLBORN_COLUMNS:
                    collection_name = WELLBORN_COLUMNS[rel_idx]
                    if not door_style:
                        door_style = "BASE" if rel_idx == 6 else "UNIVERSAL"
            else:
                # Wellborn Accessory Sheet: Col B (rel 1) is Price, Col D (rel 3) is Labor Points
                if rel_idx == 1:
                    collection_name, door_style = "UNIVERSAL", "UNIVERSAL"
                elif rel_idx == 3:
                    collection_name, door_style = "LABOR_POINTS", "LABOR_POINTS"
                else:
                    # Skip Weight/Cubic feet columns on accessory sheets
                    continue

        matrix_cols[col_idx] = {"collection_name": collection_name, "door_style": door_style}

    # Accessory-sheet fallback: trust Wellborn mapping if headers missed
    if not matrix_cols and _is_wellborn(manufacturer_id, manufacturer_name) and is_accessory_sheet:
        matrix_cols[sku_col_idx + 1] = {"collection_name": "UNIVERSAL", "door_style": "UNIVERSAL"}
        matrix_cols[sku_col_idx + 3] = {"collection_name": "LABOR_POINTS", "door_style": "LABOR_POINTS"}
    
    if not matrix_cols:
        data_sample = matrix[sku_row_idx + 1: sku_row_idx + 8]
        for col_idx in range(sku_col_idx + 1, max_col):
            # (generic fallback logic remains same but restricted to non-Wellborn or non-accessory)
            for dr in data_sample:
                if col_idx < len(dr) and dr[col_idx] is not None:
                    raw_str = str(dr[col_idx]).strip()
                    if re.search(r'[A-Za-z]', raw_str): continue
                    p_str = re.sub(r'[^\d.]', '', raw_str)
                    try:
                        if p_str and float(p_str) >= 5.0:
                            matrix_cols[col_idx] = {"collection_name": "UNIVERSAL", "door_style": "UNIVERSAL"}
                            break
                    except ValueError: pass

    if not matrix_cols:
        print(f"Excel Parser: no price columns in sheet '{sheet_name}'")
        return records

    # 3. Scan data rows
    for row in matrix[sku_row_idx + 1:]:
        if sku_col_idx >= len(row):
            continue
        sku = _cell_str(row[sku_col_idx])
        if not sku or len(sku) < 2 or sku.isdigit() or sku == 'NAN':
            continue

        for col_idx, meta in matrix_cols.items():
            if col_idx >= len(row):
                continue
            raw_val = row[col_idx]
            if raw_val is None:
                continue
            raw_str = str(raw_val).strip()
            # Cells containing letters are SKU/code values (e.g. "40CFS"), not prices
            if re.search(r'[A-Za-z]', raw_str):
                continue
            p_str = re.sub(r'[^\d.]', '', raw_str)
            if not p_str:
                continue
            try:
                price = float(p_str)
                if price < _MIN_PRICE:
                    continue

                # Wellborn accessory sheets: index each SKU under every tier collection
                # so collection-specific lookups always find the flat price.
                if _is_wellborn(manufacturer_id, manufacturer_name) and is_accessory_sheet:
                    # CRITICAL FIX: Only propagate actual PRICES (not labor points) to all tiers.
                    # Labor points should stay strictly in the LABOR_POINTS collection.
                    if meta["collection_name"] == "LABOR_POINTS":
                        records.append({
                            "manufacturer_id":    manufacturer_id,
                            "raw_source_file_id": file_id,
                            "sku":                sku,
                            "price":              price,
                            "collection_name":    "LABOR_POINTS",
                            "door_style":         "LABOR_POINTS",
                            "created_at":         "now()",
                        })
                    else:
                        for tier_name in list(WELLBORN_COLUMNS.values()) + ["UNIVERSAL"]:
                            records.append({
                                "manufacturer_id":    manufacturer_id,
                                "raw_source_file_id": file_id,
                                "sku":                sku,
                                "price":              price,
                                "collection_name":    tier_name,
                                "door_style":         "UNIVERSAL",
                                "created_at":         "now()",
                            })
                    continue

                records.append({
                    "manufacturer_id":    manufacturer_id,
                    "raw_source_file_id": file_id,
                    "sku":                sku,
                    "price":              price,
                    "collection_name":    meta["collection_name"],
                    "door_style":         meta["door_style"],
                    "created_at":         "now()",
                })
            except Exception:
                continue

    return records


# ─── Public entry point ───────────────────────────────────────────────────────

def parse_specifications_python_sync(file_bytes: bytes, manufacturer_id: str,
                                     file_id: str,
                                     manufacturer_name: str = "") -> list[dict]:
    """
    Sync parser — call via run_in_executor from async context.
    Uses calamine (Rust) when available for maximum speed; falls back to pandas.
    Pass manufacturer_name so Wellborn detection works even when the ID is not
    in the hardcoded WELLBORN_IDS list.
    """
    pricing_records: list[dict] = []

    # ── Fast path: calamine (Rust) ────────────────────────────────────────────
    if _CALAMINE_OK:
        try:
            wb = CalamineWorkbook.from_object(io.BytesIO(file_bytes))
            for sheet_name in wb.sheet_names:
                sheet = wb.get_sheet_by_name(sheet_name)
                matrix = sheet.to_python(skip_empty_area=False)
                records = _parse_sheet(matrix, sheet_name, manufacturer_id, file_id, manufacturer_name)
                pricing_records.extend(records)
            print(f"Excel Parser (calamine): {len(pricing_records)} total records")
            return pricing_records
        except Exception as e:
            print(f"Excel Parser calamine failed ({e}), falling back to pandas")

    # ── Fallback path: pandas + openpyxl ─────────────────────────────────────
    try:
        xls = pd.ExcelFile(io.BytesIO(file_bytes))
        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
            if df.empty:
                continue
            matrix = df.where(df.notna(), None).values.tolist()
            records = _parse_sheet(matrix, sheet_name, manufacturer_id, file_id, manufacturer_name)
            pricing_records.extend(records)
        print(f"Excel Parser (pandas): {len(pricing_records)} total records")
    except Exception as e:
        print(f"Excel Parser Error: {e}")

    return pricing_records


async def parse_specifications_python(file_bytes: bytes, manufacturer_id: str,
                                      file_id: str,
                                      manufacturer_name: str = "") -> list[dict]:
    return parse_specifications_python_sync(file_bytes, manufacturer_id, file_id, manufacturer_name)
