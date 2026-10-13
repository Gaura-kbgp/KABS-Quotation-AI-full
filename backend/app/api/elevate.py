"""Phase A — 2020 Design PDF / product-list item extractor."""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from app.core.auth import get_current_user
from app.utils.ai_client import llm_generate
import fitz  # PyMuPDF
import re, json, asyncio

router = APIRouter()

# ── helpers ────────────────────────────────────────────────────────────────────

def _extract_text(pdf_bytes: bytes) -> tuple[str, int]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = [page.get_text() for page in doc]
    doc.close()
    return "\n".join(pages), len(pages)


# Matches lines like:  W3030   Wall Cabinet 30x30   1   $285.00
_LINE_RE = re.compile(
    r'^([A-Z][A-Z0-9\-\/\.]{1,29})'   # code
    r'[ \t]{2,}'                        # 2+ whitespace
    r'(.{3,80}?)'                       # description (non-greedy)
    r'[ \t]{2,}'
    r'(\d+(?:\.\d+)?)'                  # qty
    r'[ \t]{2,}'
    r'\$?\s*([\d,]+(?:\.\d{2})?)',      # unit price
    re.MULTILINE,
)

# 2020 Design also exports CSVs / tab-separated lines — try that too
_CSV_RE = re.compile(
    r'^"?([A-Z][A-Z0-9\-\/\.]{1,29})"?'
    r'[,\t]+"?(.{0,200}?)"?'
    r'[,\t]+(\d+(?:\.\d+)?)'
    r'[,\t]+\$?([\d,]+(?:\.\d{2})?)',
    re.MULTILINE,
)

_BOM_MARKERS = ['bill of materials', 'parts list', 'item list', 'product list',
                 'quote items', 'cabinet list', 'order summary']
_END_MARKERS = ['subtotal', 'total:', 'grand total', 'summary', 'customer acknowledgement', 'notes:', 'terms']


def _find_bom_section(text: str) -> str:
    lower = text.lower()
    start = -1
    for m in _BOM_MARKERS:
        i = lower.find(m)
        if i != -1 and (start == -1 or i < start):
            start = i
    section = text[start:] if start != -1 else text
    # Trim at first end-marker that appears after 200 chars
    lower_sec = section.lower()
    best_end = len(section)
    for m in _END_MARKERS:
        ei = lower_sec.find(m, 200)
        if ei != -1 and ei < best_end:
            best_end = ei + 200
    return section[:best_end]


def _parse_price(raw: str) -> float:
    return float(raw.replace(',', '').replace('$', '').strip())


def _rule_based_extract(text: str) -> list[dict]:
    section = _find_bom_section(text)
    items: list[dict] = []

    for pattern in (_LINE_RE, _CSV_RE):
        for m in pattern.finditer(section):
            code = m.group(1).strip()
            desc = m.group(2).strip()
            try:
                qty = float(m.group(3))
                price = _parse_price(m.group(4))
            except ValueError:
                continue
            if price > 0 and qty > 0 and code:
                items.append({'code': code, 'description': desc,
                               'qty': int(qty) if qty == int(qty) else qty,
                               'list_price': price})
        if len(items) >= 2:
            break

    # De-duplicate by code+price (same item may match both patterns)
    seen: set[tuple] = set()
    unique = []
    for it in items:
        key = (it['code'], it['list_price'])
        if key not in seen:
            seen.add(key)
            unique.append(it)
    return unique


async def _ai_extract(text: str) -> list[dict]:
    prompt = f"""You are extracting a cabinet item list from a 2020 Design software PDF export.

PDF text (first 8000 chars):
{text[:8000]}

Extract every line item that is a cabinet, trim piece, moulding, accessory or hardware item.
Return ONLY a JSON array (no markdown fences) of objects:
  {{ "code": "W3030", "description": "Wall Cabinet 30x30", "qty": 1, "list_price": 285.00 }}

Rules:
- Skip section headers, totals, blank lines.
- If qty is missing assume 1.
- Omit items with list_price = 0 or missing.
- code must be the item/SKU code (like W3030, B36, CMOLD-8), not a numeric index.
"""
    # llm_generate is a SYNCHRONOUS call (OpenAI SDK) — run it off the event
    # loop rather than `await`-ing it directly (that raises "object str can't
    # be used in 'await' expression" and silently kills the AI fallback for
    # every PDF that doesn't match the strict rule-based table regex).
    raw = (await asyncio.get_event_loop().run_in_executor(
        None, lambda: llm_generate(prompt, tier='flash')
    )).strip()
    # Strip markdown fences if present
    raw = re.sub(r'^```[a-z]*\n?', '', raw)
    raw = re.sub(r'\n?```$', '', raw).strip()
    return json.loads(raw)


_MANUFACTURER_KEYWORDS: list[tuple[str, list[str]]] = [
    ('Wellborn Cabinet',   ['wellborn']),
    ('Integrity Cabinets', ['integrity cabinets', 'integrity cabinet']),
]

def _detect_manufacturer(text: str) -> str | None:
    lower = text.lower()
    for name, keywords in _MANUFACTURER_KEYWORDS:
        if any(k in lower for k in keywords):
            return name
    return None


def _sanitize(items: list) -> list[dict]:
    cleaned = []
    for it in items:
        code = str(it.get('code', '')).strip()[:80]
        desc = str(it.get('description', '')).strip()[:300]
        try:
            qty = float(it.get('qty', 1))
        except Exception:
            qty = 1.0
        try:
            lp = float(str(it.get('list_price', 0)).replace(',', '').replace('$', ''))
        except Exception:
            lp = 0.0
        if code and lp > 0:
            cleaned.append({
                'code': code,
                'description': desc,
                'qty': max(0, qty),
                'list_price': round(max(0.0, lp), 2),
            })
    return cleaned


# ── endpoint ───────────────────────────────────────────────────────────────────

@router.post("/elevate/extract-items")
async def extract_items(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="PDF file required (.pdf)")

    data = await file.read()
    if len(data) > 30 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 30 MB)")

    text, page_count = _extract_text(data)

    # 1. Try rule-based (free, instant)
    items = _rule_based_extract(text)
    source = 'rule_based'

    # 2. If rule-based found fewer than 2, try AI
    if len(items) < 2:
        try:
            ai_items = await _ai_extract(text)
            if isinstance(ai_items, list) and len(ai_items) > len(items):
                items = ai_items
                source = 'ai'
        except Exception as e:
            print(f"[elevate/extract] AI fallback failed: {e}")

    cleaned = _sanitize(items)
    detected_manufacturer = _detect_manufacturer(text)

    return {
        'success': True,
        'items': cleaned,
        'item_count': len(cleaned),
        'page_count': page_count,
        'source': source,
        'detected_manufacturer': detected_manufacturer,
    }
