"""
Catalog Extractor — AI-powered + rule-based manufacturer catalog ingestion.

Flow:
  1. extract_catalog_config(pdf_bytes, file_type)
       → AI reads 5-10 pages, returns structured JSON config
         (price_model, door_styles, species, finishes, upcharges, price_columns, style_to_collection)

  2. extract_pricing_rows(pdf_bytes, catalog_config)
       → Rule-based parser (using AI-detected format) extracts all SKU rows
         Returns list of {sku, collection_name, door_style, price} ready for manufacturer_pricing table

Supports both:
  - 'collection' model (Wellborn-style)
  - 'price_column' model (Marsh-style — 9 price cols, door style selects the col)
"""

import re
import json
import io
from typing import Any

# ─── NKBA SKU prefix patterns (used to identify data rows) ───────────────────
_SKU_RE = re.compile(
    r'^(W|B|SB|T|UT|BFH|BFHBP|BBP|WCC|CWC|WBP|WBPGL|WBPMD|WCCST|DCB|LSCB|SSCB|'
    r'BCCRH|BCCLH|D3B|D4B|DB|VFH|VB|VS|VD|V3D|OC|RH|F|UF|BT|MWB|'
    r'ASB|EZCB|EZCW|BEC|WEC|WEA|T2D|T3D|WO|WPR|WRC|SH|WCM|LLE|BBP|'
    r'CM|CV|CWN|LCV|MCV|LCWN|TP|QR|STR|SM|TUKT|MADY|METC|SSCM|BCWN|LCWN|DM|BM|'
    r'IBFB|TFB|VFB|FCB|FA|FBFOL|FBSOL|LB|PSD|WTP|'
    r')[A-Z0-9]',
    re.IGNORECASE
)

# Marsh-specific column header order (left→right in the pricing table)
_MARSH_COLUMNS = ["COL_1", "COL_2", "COL_3", "COL_4S", "COL_5", "COL_6", "COL_4F", "COL_7", "COL_8", "COL_9"]
_MARSH_HEADER_PATTERN = re.compile(r'ITEM\s+CODES.*?1\s+2\s+3\s+4S\s+5\s+6\s+4F\s+7\s+8\s+9', re.DOTALL | re.IGNORECASE)
# Strict Marsh SKU: 1-5 letters + 2+ digits + optional letters (e.g. W1212, BLC1884L, WBB96GL)
_MARSH_SKU_RE = re.compile(r'^[A-Z]{1,5}\d{2,}[A-Z0-9]*$', re.IGNORECASE)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _to_float(s: str) -> float | None:
    try:
        return float(re.sub(r'[,$\s]', '', s))
    except Exception:
        return None


def _extract_pdf_text_pages(pdf_bytes: bytes, start: int = 0, end: int | None = None) -> list[str]:
    """Extract text from PDF pages [start, end). Returns list of page strings."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = []
        end_idx = end if end is not None else doc.page_count
        for i in range(start, min(end_idx, doc.page_count)):
            pages.append(doc[i].get_text())
        doc.close()
        return pages
    except Exception as e:
        print(f"[catalog_extractor] PDF read error: {e}")
        return []


# ─── AI Config Extraction ─────────────────────────────────────────────────────

_CONFIG_PROMPT = """You are analyzing pages from a cabinet manufacturer's catalog document.
Extract the catalog configuration as JSON. Return ONLY valid JSON, nothing else.

Analyze these pages and determine:
1. price_model: "collection" if prices are in separate named product lines/collections,
                "price_column" if prices are in numbered columns (like 1,2,3,4S,5,6,4F,7,8,9) mapped to door styles
2. door_styles: list of door style objects
3. species: available wood species
4. finishes: available finishes (stains + paints)
5. upcharges: upcharge rules found
6. price_columns: list of price columns (for price_column model)
7. style_to_collection: map of door_style_name (UPPERCASE) → collection_name or column_id

Return this exact structure:
{
  "price_model": "price_column",
  "door_styles": [
    {"name": "Cambridge Birch", "column": "COL_1", "overlay": "Standard", "species": "Birch"},
    {"name": "Atlanta Maple", "column": "COL_4S", "overlay": "Standard", "species": "Maple"}
  ],
  "species": [
    {"name": "Maple", "code": "M", "upcharge_pct": 0},
    {"name": "Cherry", "code": "C", "upcharge_pct": 7}
  ],
  "finishes": [
    {"name": "Jute", "type": "stain", "upcharge_pct": 0},
    {"name": "Alpine", "type": "paint", "upcharge_pct": 15}
  ],
  "upcharges": {
    "plywood_wall": 75, "plywood_base": 110, "plywood_tall": 220,
    "fe_wall": 96, "fe_base": 154, "fe_tall": 340,
    "cherry_pct": 7, "paint_pct": 15, "glaze_pct": 15
  },
  "price_columns": [
    {"id": "COL_1", "label": "Cambridge Birch — Standard Overlay"},
    {"id": "COL_2", "label": "Atlanta/Brunswick/Pinehurst Birch — Standard Overlay"},
    {"id": "COL_3", "label": "Cambridge Maple/Oak — Standard Overlay"},
    {"id": "COL_4S", "label": "Atlanta/Brunswick/Pinehurst Maple/Oak — Standard Overlay"},
    {"id": "COL_5", "label": "Florence Birch — Standard Overlay"},
    {"id": "COL_6", "label": "Florence Maple/Oak — Standard Overlay"},
    {"id": "COL_4F", "label": "Apex Maple/Oak — Full Overlay"},
    {"id": "COL_7", "label": "Hampton/Monroe/Savannah/Jamestown — Full Overlay"},
    {"id": "COL_8", "label": "Arlington/Charleston/Nantucket — Full Overlay"},
    {"id": "COL_9", "label": "Arcadia/Jefferson — Full Overlay"}
  ],
  "style_to_collection": {
    "CAMBRIDGE BIRCH": "COL_1",
    "ATLANTA BIRCH": "COL_2",
    "ATLANTA MAPLE": "COL_4S",
    "HAMPTON MAPLE": "COL_7"
  }
}

For "collection" model (like Wellborn), style_to_collection maps door style to collection name:
  "CANYON MAPLE": "PRIME MAPLE / PRIME PAINTED / PRIME DURAFORM"

Pages to analyze:
"""


async def extract_catalog_config(
    pdf_bytes: bytes,
    file_type: str = "price_guide",
    manufacturer_name: str = "",
    llm_generate_fn=None
) -> dict:
    """
    AI extracts structured catalog config from first N pages of a price guide or style guide PDF.
    Returns config dict with price_model, door_styles, species, finishes, upcharges, etc.
    """
    # Read first 20 pages (covers style guide + pricing header + first price pages)
    pages = _extract_pdf_text_pages(pdf_bytes, 0, 20)
    combined = "\n---PAGE BREAK---\n".join(pages[:20])[:8000]  # Limit tokens

    if not llm_generate_fn:
        try:
            from app.utils.ai_client import llm_generate
            llm_generate_fn = llm_generate
        except ImportError:
            return _fallback_config()

    import asyncio
    prompt = _CONFIG_PROMPT + f"\n\nManufacturer: {manufacturer_name}\n\n{combined}"
    try:
        raw = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: llm_generate_fn(prompt, tier="balanced", max_tokens=3000)
        )
        config = _parse_config_json(raw)
        config["extraction_source"] = "ai_pdf"
        config["extraction_notes"] = f"Extracted from first 20 pages of {file_type}"
        return config
    except Exception as e:
        print(f"[catalog_extractor] AI extraction failed: {e}")
        return _fallback_config()


def _parse_config_json(raw: str) -> dict:
    raw = raw.strip()
    # Strip markdown fences
    if raw.startswith("```"):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
    try:
        return json.loads(raw)
    except Exception:
        # Try finding JSON object in response
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
    return _fallback_config()


def _fallback_config() -> dict:
    return {
        "price_model": "collection",
        "door_styles": [],
        "species": [],
        "finishes": [],
        "upcharges": {},
        "price_columns": [],
        "style_to_collection": {},
        "extraction_source": "manual",
        "extraction_notes": "AI extraction failed — fill in manually"
    }


# ─── Pricing Row Extraction ───────────────────────────────────────────────────

def extract_pricing_rows(pdf_bytes: bytes, catalog_config: dict) -> list[dict]:
    """
    Rule-based extraction of all SKU pricing rows from a price guide PDF.
    Uses catalog_config.price_model to know the table format.

    Returns list of dicts ready for manufacturer_pricing table:
      {sku, collection_name, door_style, price}
    """
    price_model = catalog_config.get("price_model", "collection")

    if price_model == "price_column":
        return _extract_price_column_rows(pdf_bytes, catalog_config)
    else:
        return _extract_collection_rows(pdf_bytes, catalog_config)


# ─── Price-Column Model (Marsh-style) ────────────────────────────────────────

def _extract_price_column_rows(pdf_bytes: bytes, catalog_config: dict) -> list[dict]:
    """
    Parse Marsh-style pricing tables: each row = SKU + 9 prices.
    For each SKU, emit one row per price column.

    Table format detected from page header:
      ITEM CODES   1    2    3   4S    5    6   4F    7    8    9   PAGE  WT  CUBES
    """
    price_columns = catalog_config.get("price_columns", [])
    col_ids = [c["id"] for c in price_columns] if price_columns else _MARSH_COLUMNS

    rows: list[dict] = []
    pages = _extract_pdf_text_pages(pdf_bytes)
    # Skip first ~18 pages (index, warranty, style info)
    data_pages = pages[18:]

    for page_text in data_pages:
        page_rows = _parse_marsh_page(page_text, col_ids)
        rows.extend(page_rows)

    print(f"[catalog_extractor] price_column extraction: {len(rows)} rows from {len(data_pages)} pages")
    return rows


def _parse_marsh_page(page_text: str, col_ids: list[str]) -> list[dict]:
    """
    Parse one page of Marsh pricing table.
    PyMuPDF extracts each value on its own line, so we scan for a SKU token
    then collect the next n_cols numeric values as prices.

    Example extracted text:
        Standard
        W1212
        287
        303
        311
        ...
    """
    rows = []
    lines = [l.strip() for l in page_text.splitlines()]
    n_cols = len(col_ids)
    i = 0

    while i < len(lines):
        line = lines[i]
        if not line:
            i += 1
            continue

        # Check if this line is a Marsh SKU (letters + digits, e.g. W1212, BLC1884L)
        parts = line.split()
        if not parts or not _MARSH_SKU_RE.match(parts[0]):
            i += 1
            continue

        sku = parts[0].upper()
        # Collect numeric values — first check same line, then subsequent lines
        numeric_vals: list[float | None] = []

        # Values already on the SKU line (single-line format fallback)
        for p in parts[1:]:
            if len(numeric_vals) >= n_cols:
                break
            numeric_vals.append(_to_float(p))

        # Continue collecting from following lines if we don't have enough
        j = i + 1
        while len(numeric_vals) < n_cols and j < len(lines):
            nxt = lines[j].strip()
            if not nxt:
                j += 1
                continue
            # Stop if next line is another Marsh SKU
            if _MARSH_SKU_RE.match(nxt.split()[0] if nxt.split() else ''):
                break
            # Try to parse as number (including "—", "•", garbage → None)
            numeric_vals.append(_to_float(nxt))
            j += 1

        if len(numeric_vals) < n_cols:
            i += 1
            continue

        for ci, col_id in enumerate(col_ids):
            price = numeric_vals[ci]
            if price is None or price <= 0:
                continue
            rows.append({
                "sku": sku,
                "collection_name": col_id,
                "door_style": "",
                "price": price,
            })

        i += 1

    return rows


# ─── Collection Model (Wellborn-style) ───────────────────────────────────────

def _extract_collection_rows(pdf_bytes: bytes, catalog_config: dict) -> list[dict]:
    """
    Parse collection-model pricing PDF.
    Expects a table with: SKU  collectionA_price  collectionB_price ...
    or separate sheets per collection.
    """
    rows = []
    pages = _extract_pdf_text_pages(pdf_bytes)
    collections = catalog_config.get("price_columns", [])

    # Try to detect column headers and data rows
    for page_text in pages:
        page_rows = _parse_collection_page(page_text, collections)
        rows.extend(page_rows)

    print(f"[catalog_extractor] collection extraction: {len(rows)} rows")
    return rows


def _parse_collection_page(page_text: str, collections: list[dict]) -> list[dict]:
    rows = []
    col_ids = [c.get("id", c.get("label", "")) for c in collections]
    lines = page_text.splitlines()

    for line in lines:
        line = line.strip()
        if not line or not _SKU_RE.match(line):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        sku = parts[0].upper()
        for i, col_id in enumerate(col_ids):
            if i + 1 >= len(parts):
                break
            price = _to_float(parts[i + 1])
            if price and price > 0:
                rows.append({"sku": sku, "collection_name": col_id, "door_style": "", "price": price})

    return rows


# ─── Excel Pricing Extraction ─────────────────────────────────────────────────

def extract_pricing_rows_from_excel(excel_bytes: bytes, catalog_config: dict) -> list[dict]:
    """
    Parse pricing Excel/CSV for any manufacturer format.
    Detects columns by header names and maps to collection_name.
    """
    try:
        import pandas as pd
        df = pd.read_excel(io.BytesIO(excel_bytes), header=None)
    except Exception:
        try:
            import pandas as pd
            df = pd.read_csv(io.BytesIO(excel_bytes), header=None)
        except Exception as e:
            print(f"[catalog_extractor] Excel read error: {e}")
            return []

    price_columns = catalog_config.get("price_columns", [])
    col_ids = [c["id"] for c in price_columns]

    rows = []
    # Find SKU column (first col with cabinet SKU pattern)
    sku_col = None
    for ci in range(min(5, len(df.columns))):
        vals = df.iloc[:, ci].astype(str)
        matches = vals.apply(lambda v: bool(_SKU_RE.match(v.strip()))).sum()
        if matches > 10:
            sku_col = ci
            break

    if sku_col is None:
        return rows

    price_cols = [c for c in range(len(df.columns)) if c != sku_col][:len(col_ids)]

    for _, row in df.iterrows():
        sku_val = str(row.iloc[sku_col]).strip().upper()
        if not sku_val or not _SKU_RE.match(sku_val):
            continue
        for i, col_id in enumerate(col_ids):
            if i >= len(price_cols):
                break
            price = _to_float(str(row.iloc[price_cols[i]]))
            if price and price > 0:
                rows.append({"sku": sku_val, "collection_name": col_id, "door_style": "", "price": price})

    print(f"[catalog_extractor] Excel extraction: {len(rows)} rows")
    return rows
