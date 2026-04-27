"""
Excel pricing parser — uses python-calamine (Rust) for raw cell reading
instead of openpyxl, giving 10-50x faster load on large files.
"""
import re
import io
from typing import Any

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
    tier_found  = next((t for t in _TIER_KEYS if t in combined), None)
    woods_found = [w for w in _WOOD_KEYS if w in combined]

    if tier_found and len(woods_found) == 1:
        collection_name = f"{tier_found} {woods_found[0]}"
    elif tier_found and len(woods_found) > 1:
        collection_name = f"{tier_found} {' / '.join(woods_found)}"
    elif tier_found:
        collection_name = tier_found
    elif woods_found:
        collection_name = ' / '.join(woods_found[:4])
    else:
        collection_name = combined[:100]

    door_style = "FRAMELESS" if "FRAMELESS" in combined else "FACE FRAME"
    return collection_name, door_style


# ─── Core sheet parser (works on raw list-of-lists) ──────────────────────────

def _parse_sheet(matrix: list[list], sheet_name: str, manufacturer_id: str,
                 file_id: str) -> list[dict]:
    records = []
    if not matrix:
        return records

    # 1. Find SKU anchor row
    sku_row_idx = sku_col_idx = -1
    for r_idx, row in enumerate(matrix):
        row_upper = [_cell_str(c) for c in row]
        for keyword in ("SKU", "ITEM CODE", "ITEM NO", "ITEM #", "PRODUCT CODE"):
            if keyword in row_upper:
                sku_row_idx = r_idx
                sku_col_idx = row_upper.index(keyword)
                break
        if sku_row_idx != -1:
            break

    if sku_row_idx == -1:
        print(f"Excel Parser: no SKU anchor in sheet '{sheet_name}' — skipping")
        return records

    # 2. Build price-column metadata
    max_col = min(len(matrix[sku_row_idx]), sku_col_idx + 30)
    matrix_cols: dict[int, dict] = {}

    for col_idx in range(sku_col_idx + 1, max_col):
        combined = _build_column_header_from_matrix(matrix, col_idx, sku_row_idx)
        if not combined:
            continue
        if re.fullmatch(r'[A-Z]|\d+', combined.strip()):
            continue
        collection_name, door_style = _classify_header(combined)
        matrix_cols[col_idx] = {"collection_name": collection_name, "door_style": door_style}
        print(f"Excel Parser: col {col_idx} → '{collection_name}' / '{door_style}'")

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
            p_str = re.sub(r'[^\d.]', '', str(raw_val))
            if not p_str:
                continue
            try:
                price = float(p_str)
                if price <= 0:
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
                                     file_id: str) -> list[dict]:
    """
    Sync parser — call via run_in_executor from async context.
    Uses calamine (Rust) when available for maximum speed; falls back to pandas.
    """
    pricing_records: list[dict] = []

    # ── Fast path: calamine (Rust) ────────────────────────────────────────────
    if _CALAMINE_OK:
        try:
            wb = CalamineWorkbook.from_object(io.BytesIO(file_bytes))
            for sheet_name in wb.sheet_names:
                sheet = wb.get_sheet_by_name(sheet_name)
                matrix = sheet.to_python(skip_empty_area=False)  # list[list[Any]]
                records = _parse_sheet(matrix, sheet_name, manufacturer_id, file_id)
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
            # Convert to plain list-of-lists so _parse_sheet can handle it
            matrix = df.where(df.notna(), None).values.tolist()
            records = _parse_sheet(matrix, sheet_name, manufacturer_id, file_id)
            pricing_records.extend(records)
        print(f"Excel Parser (pandas): {len(pricing_records)} total records")
    except Exception as e:
        print(f"Excel Parser Error: {e}")

    return pricing_records


# Keep the async signature so existing callers that await it still work
async def parse_specifications_python(file_bytes: bytes, manufacturer_id: str,
                                      file_id: str) -> list[dict]:
    return parse_specifications_python_sync(file_bytes, manufacturer_id, file_id)
