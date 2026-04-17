import pandas as pd
import io
import re

# Keywords used to classify price-book column headers
_TIER_KEYS  = ["PRIME", "PREMIUM", "ELITE", "CHOICE", "SELECT", "VALUE", "STANDARD"]
_WOOD_KEYS  = ["CHERRY", "MAPLE", "PAINTED", "DURAFORM", "OAK", "ASH", "HICKORY", "BIRCH", "ALDER", "WALNUT", "WHITE"]

# Single-letter or generic tokens that are NOT meaningful column labels
_SKIP_SINGLES = {
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    'SKU', 'PRICE', 'LIST', 'DESCRIPTION', 'DESC', 'ITEM', 'CODE',
    'NAN', '', 'NONE', 'NULL',
}


def _build_column_header(df: pd.DataFrame, col_idx: int, sku_row_idx: int) -> str:
    """
    Collect all non-empty header cells for `col_idx` from rows 0..sku_row_idx (inclusive),
    deduplicate, filter junk, and return a single combined string.
    """
    seen = []
    seen_set: set = set()
    for h_idx in range(sku_row_idx + 1):
        try:
            cell = df.iloc[h_idx, col_idx]
        except IndexError:
            continue
        if not pd.notna(cell):
            continue
        text = str(cell).strip().upper()
        if not text or text == 'NAN':
            continue
        for line in text.split('\n'):
            line = line.strip()
            # Remove surrounding slashes / bullets that sometimes appear
            line = re.sub(r'^[/\-–•\s]+|[/\-–•\s]+$', '', line)
            if line and line not in seen_set and line not in _SKIP_SINGLES:
                seen.append(line)
                seen_set.add(line)
    return ' | '.join(seen)


def _classify_header(combined: str) -> tuple[str, str]:
    """
    From a combined column header string produce:
      (collection_name, door_style)

    Logic:
    - Detect tier keywords (PRIME, PREMIUM, ELITE, CHOICE, …)
    - Detect wood keywords (CHERRY, MAPLE, PAINTED, DURAFORM, …)
    - Build a human-readable collection_name from what we find
    - door_style defaults to "FACE FRAME" unless "FRAMELESS" is present
    """
    tier_found  = next((t for t in _TIER_KEYS if t in combined), None)
    woods_found = [w for w in _WOOD_KEYS if w in combined]

    if tier_found and len(woods_found) == 1:
        # e.g. "PRIME CHERRY"
        collection_name = f"{tier_found} {woods_found[0]}"
    elif tier_found and len(woods_found) > 1:
        # Multiple woods listed under one tier header (e.g. "PRIME CHERRY / MAPLE / PAINTED")
        # Keep the tier + all woods so the label is fully descriptive
        collection_name = f"{tier_found} {' / '.join(woods_found)}"
    elif tier_found:
        collection_name = tier_found
    elif woods_found:
        collection_name = ' / '.join(woods_found[:4])
    else:
        # Fallback: use the raw combined text, truncated
        collection_name = combined[:100]

    door_style = "FRAMELESS" if "FRAMELESS" in combined else "FACE FRAME"
    return collection_name, door_style


async def parse_specifications_python(file_bytes: bytes, manufacturer_id: str, file_id: str):
    """
    1951 / multi-column Excel pricing parser.

    Correctly handles:
    - Multi-row merged headers (tier on row 1, wood on row 2, etc.)
    - Full SKU suffixes preserved verbatim (B30BD ≠ B30)
    - Multiple price columns per sheet
    - Sheets without recognisable headers (skipped gracefully)
    """
    pricing_records = []

    try:
        xls = pd.ExcelFile(io.BytesIO(file_bytes))

        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
            if df.empty:
                continue

            # ── 1. Locate the SKU anchor row ──────────────────────────────────
            sku_row_idx   = -1
            active_sku_col = -1
            for idx, row in df.iterrows():
                row_list = [
                    str(x).strip().upper() if pd.notna(x) else ""
                    for x in row.tolist()
                ]
                if "SKU" in row_list or "ITEM CODE" in row_list:
                    sku_row_idx    = idx
                    active_sku_col = (
                        row_list.index("SKU")
                        if "SKU" in row_list
                        else row_list.index("ITEM CODE")
                    )
                    break

            if sku_row_idx == -1:
                print(f"Excel Parser: no SKU anchor in sheet '{sheet_name}' — skipping")
                continue

            # ── 2. Build column metadata from all header rows ─────────────────
            matrix_cols: dict[int, dict] = {}
            max_col = min(len(df.columns), active_sku_col + 25)

            for col_idx in range(active_sku_col + 1, max_col):
                combined = _build_column_header(df, col_idx, sku_row_idx)
                if not combined:
                    continue

                collection_name, door_style = _classify_header(combined)

                # Discard columns whose header resolves to a single letter or pure number
                if re.fullmatch(r'[A-Z]|\d+', collection_name.strip()):
                    print(f"Excel Parser: skipping column {col_idx} — trivial label '{collection_name}'")
                    continue

                matrix_cols[col_idx] = {
                    "collection_name": collection_name,
                    "door_style":      door_style,
                }
                print(f"Excel Parser: col {col_idx} → '{collection_name}' / '{door_style}'")

            if not matrix_cols:
                print(f"Excel Parser: no price columns detected in sheet '{sheet_name}'")
                continue

            # ── 3. Scan data rows ─────────────────────────────────────────────
            for idx in range(sku_row_idx + 1, len(df)):
                row     = df.iloc[idx]
                sku_raw = row.iloc[active_sku_col]
                sku     = str(sku_raw).strip().upper() if pd.notna(sku_raw) else ""

                # Skip blanks, pure numbers (page numbers), and NaN artefacts
                if not sku or len(sku) < 2 or sku == 'NAN' or sku.isdigit():
                    continue

                for col_idx, meta in matrix_cols.items():
                    try:
                        raw_val = row.iloc[col_idx]
                        if not pd.notna(raw_val):
                            continue
                        p_str = re.sub(r'[^\d.]', '', str(raw_val))
                        if not p_str:
                            continue
                        price = float(p_str)
                        if price <= 0:
                            continue

                        pricing_records.append({
                            "manufacturer_id":   manufacturer_id,
                            "raw_source_file_id": file_id,
                            "sku":               sku,          # preserved verbatim (B30BD stays B30BD)
                            "price":             price,
                            "collection_name":   meta["collection_name"],
                            "door_style":        meta["door_style"],
                            "created_at":        "now()",
                        })
                    except Exception:
                        continue

        print(f"Excel Parser: extracted {len(pricing_records)} total records")
        return pricing_records

    except Exception as e:
        print(f"Excel Parser Error: {e}")
        return []
