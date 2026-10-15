"""
Display Catalog Extractor
==========================
Handles manufacturer "showroom display" catalog PDFs (e.g. a Marsh dealer
display book like "Chesapeake Bay_Marsh Display R3.pdf"): ONE PDF containing
MULTIPLE distinct room displays, each introduced by a "DISPLAY N: <NAME>"
header with its own DOOR STYLE / FINISH, followed by a floorplan page (often
vector/CAD art with almost no selectable text) and one or more elevation
pages whose cabinet accessory call-outs are written as narrative annotations
("Crown : Str396sh - 2", "f348", "OE TO SKIN BOTTOM OF WALL CABINETS - oe6011").

This is a fundamentally different shape from a single-project NKBA drawing
(which rule_based_extractor.py already handles well via detect_room_name's
ROOM_TYPES list). Treating a display catalog with the generic extractor
merges every "...KITCHEN..." display into one room and loses each display's
own door style — exactly the bug this module fixes.

Pipeline:
  1. detect_display_catalog() — true if 2+ distinct "DISPLAY N:" headers
     are found (the catalog's structural signature).
  2. _segment_displays() — one page range per display, with DOOR STYLE /
     FINISH captured from that display's own header page.
  3. Per display, per page: if the page's text layer is rich enough, reuse
     the existing rule-based extract_page_items()/categorize_code() (keeps
     category rules centralized in rule_based_extractor.py). If the text
     layer is too sparse (CAD/vector floorplan pages carry almost no
     selectable text), render the page to a PNG with PyMuPDF
     (page.get_pixmap — no external OCR binary needed) and ask GPT-4o
     Vision to read the cabinet codes directly off the image.
  4. Each returned room carries its OWN door_style/finish, so downstream
     BOM generation doesn't have to force one project-wide door style onto
     every display (see frontend/src/app/quotation-ai/actions.ts, which
     now prefers a room's own door_style/collection over the global
     dropdown value when the room already has one).
"""

import re
import json
import concurrent.futures
import fitz  # PyMuPDF

from app.utils.rule_based_extractor import (
    extract_page_items,
    categorize_code,
    build_match_key,
    EMPTY_ROOM,
    _ALL_CATS,
    PDF_TYPE_CUSTOM,
)
from app.utils.ai_client import llm_generate


# ─── Display header / style detection ─────────────────────────────────────────

_DISPLAY_HEADER_RE = re.compile(
    r'DISPLAY\s*(\d+)\s*[:\-]?\s*\n?\s*([^\n]{2,80})',
    re.IGNORECASE,
)
_DOOR_STYLE_RE = re.compile(r'DOOR\s+STYLE\s*\n\s*([A-Z0-9 \-]{2,40})', re.IGNORECASE)
_FINISH_RE     = re.compile(r'FINISH\s*\n\s*([A-Z0-9/ &\-]{2,60})', re.IGNORECASE)

# Below this many non-whitespace characters, treat a page as a CAD/vector
# floorplan page with no useful selectable text (needs vision instead).
_SPARSE_TEXT_CHARS = 180


def detect_display_catalog(full_text: str) -> bool:
    """True if the PDF contains 2+ distinct 'DISPLAY N:' sections — the
    structural signature of a manufacturer showroom catalog, as opposed to
    a single-project NKBA drawing."""
    nums = {m.group(1) for m in _DISPLAY_HEADER_RE.finditer(full_text)}
    return len(nums) >= 2


def _clean_display_name(raw: str) -> str:
    # Non-ASCII bytes (e.g. a garbled inch mark after "48") break word
    # boundaries — normalize them to a space rather than truncating on them.
    name = re.sub(r'[^\x20-\x7E]', ' ', raw)
    name = re.sub(r'\s+', ' ', name.strip().upper())
    # The header regex grabs the rest of the line; strip anything after the
    # display label itself if later fields leaked onto the same line.
    name = re.split(r'\bDOOR STYLE\b|\bFINISH\b|\bDEALER\b|\bCONSTRUCTION\b', name)[0].strip()
    name = name.strip(' "\'-')
    return name[:40] if name else "DISPLAY ROOM"


def _segment_displays(doc) -> list[dict]:
    """Return one entry per UNIQUE display_num: [{display_num, display_name,
    door_style, finish, page_start, page_end}].

    Every page in the source PDF repeats "DISPLAY NAME / DISPLAY N: <NAME>"
    in its running header, so a naive per-page scan finds the same display
    N+1 times (once per page) instead of once. We dedupe by display_num,
    keeping the FIRST page a given number appears on as that display's
    header page (door_style/finish live there) and spanning its range up to
    the next NEW display_num.
    """
    first_seen: dict[str, tuple[int, str]] = {}  # display_num -> (page_idx, display_name)
    order: list[str] = []
    for i in range(len(doc)):
        text = doc[i].get_text()
        m = _DISPLAY_HEADER_RE.search(text)
        if not m:
            continue
        dnum = m.group(1)
        if dnum not in first_seen:
            first_seen[dnum] = (i, _clean_display_name(m.group(2)))
            order.append(dnum)

    if not order:
        return []

    segments = []
    n_pages = len(doc)
    for idx, dnum in enumerate(order):
        page_idx, dname = first_seen[dnum]
        page_end = first_seen[order[idx + 1]][0] - 1 if idx + 1 < len(order) else n_pages - 1
        header_text = doc[page_idx].get_text()
        ds_m = _DOOR_STYLE_RE.search(header_text)
        fn_m = _FINISH_RE.search(header_text)
        segments.append({
            "display_num": dnum,
            "display_name": dname,
            "door_style": ds_m.group(1).strip().title() if ds_m else "",
            "finish": fn_m.group(1).strip() if fn_m else "",
            "page_start": page_idx,
            "page_end": page_end,
        })
    return segments


# ─── Vision fallback for sparse-text (CAD/vector) pages ────────────────────────

_VISION_PROMPT = """You are an expert cabinet estimator reading one page from a kitchen/bath \
showroom display drawing (floorplan or elevation). Extract every cabinet SKU code and its \
quantity visible on this page.

Cabinet SKU codes look like: a short letter prefix (1-5 letters) followed by digits, \
optionally with more letters/digits (e.g. W2430, BLC1884L, WBBP96, F330, TK96, SM96, OE6011, \
SHFB96FOL, QR96, SCR96). Ignore room titles, dealer names, door-style names, finish names, \
dimension-only text (e.g. 12'-6"), and generic notes that are not SKU codes.

CRITICAL RULE — "CODE X NUMBER" IS A DIMENSION SUFFIX, NOT A QUANTITY:
  When a number follows a cabinet code with "X" or "x" DIRECTLY attached to it as a label on
  a single cabinet box (e.g. a box in an elevation drawing labeled "WBB96 X 48", or a
  standalone callout "WTP98X22"), the "X <number>" is a WIDTH x HEIGHT dimension suffix that
  is PART OF THE SKU — concatenate it with no space: "WBB96 X 48" -> code "WBB96X48",
  quantity 1. "WTP98X22" -> code "WTP98X22", quantity 1.
  Only treat a number as an actual QUANTITY when it is clearly a count, e.g.:
    - "Crown: lcv144c - 1"  -> code "LCV144C", quantity 1
    - "Scribe: sm96 - 3"    -> code "SM96", quantity 3
    - "2-F330" or "2 x F330" (count written BEFORE the code) -> code "F330", quantity 2
  Rule of thumb: a lone dimension-style box label (code directly followed by "X <number>",
  no dash, no "qty" word, no count written before the code) is almost always a SKU suffix,
  not a quantity — default to quantity 1 in that case.

CRITICAL RULE — SUPERSEDED / CORRECTED CODES:
  If you see a red or handwritten correction note like "UPDATED <OLD_CODE> TO <NEW_CODE> ...
  NOT SHOWN" (or similar wording indicating a code was changed/replaced), the OLD_CODE printed
  elsewhere on the same page (e.g. a label on the floorplan or elevation) has been superseded
  and must be IGNORED. Extract ONLY the NEW_CODE mentioned in the correction note (quantity 1
  unless stated otherwise). Do not output both the old and new code.

If a code has an explicit count nearby (e.g. "Crown: lcv144c - 1", "SM96 x3", "2-F330"), use \
that count as quantity. If no count is shown and it is not a dimension-suffix box label, use \
quantity 1.

Return ONLY this strict JSON, no markdown, no prose:
{"items": [{"code": "SM96", "quantity": 1}, {"code": "F330", "quantity": 1}]}

If you see no cabinet codes at all on this page, return {"items": []}.
"""


def _render_page_png(page) -> bytes:
    """Render a PDF page to PNG bytes at 2× scale using PyMuPDF (no external binary)."""
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    return pix.tobytes("png")


def _vision_call(png_bytes: bytes) -> list[dict]:
    """Call GPT-4o Vision on pre-rendered PNG bytes. Thread-safe: creates its
    own OpenAI client per call."""
    try:
        raw = llm_generate(
            _VISION_PROMPT, tier="balanced", max_tokens=2000,
            image_data=png_bytes, image_mime="image/png",
        )
        cleaned = (raw or "").strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
            cleaned = re.sub(r'\s*```$', '', cleaned)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            # Truncated/malformed response — salvage whatever complete
            # {"code": "...", "quantity": N} objects are present rather than
            # dropping the whole page's extraction to empty.
            items = re.findall(
                r'\{\s*"code"\s*:\s*"([^"]+)"\s*,\s*"quantity"\s*:\s*(\d+)\s*\}', cleaned
            )
            data = {"items": [{"code": c, "quantity": int(q)} for c, q in items]}
            print(f"[display-catalog] Vision JSON malformed — salvaged {len(items)} items via regex")
        out = []
        for it in data.get("items", []):
            code = str(it.get("code", "")).strip().upper()
            try:
                qty = int(it.get("quantity", 1))
            except Exception:
                qty = 1
            if code and len(code) >= 2:
                out.append({"code": code, "quantity": qty})
        return out
    except Exception as e:
        print(f"[display-catalog] Vision call failed: {e}")
        return []


def _vision_extract_page(page) -> list[dict]:
    """Render page and call Vision (single-page convenience wrapper)."""
    return _vision_call(_render_page_png(page))


# ─── Main entry point ──────────────────────────────────────────────────────────

def extract_display_catalog(pdf_bytes: bytes, use_vision: bool = True) -> dict:
    """
    Extract rooms from a multi-display manufacturer catalog PDF.
    One room per DISPLAY section, each carrying its own door_style/finish
    so downstream BOM pricing can use the display's actual style instead of
    one project-wide dropdown value.

    Every non-header page in a display is scanned with GPT-4o Vision rather
    than the legacy text-regex extractor (extract_page_items/categorize_code
    from rule_based_extractor.py). That extractor was built for structured
    NKBA trim lists ("3-BTK8") and is unreliable on this catalog's narrative
    elevation annotations ("Toe plate: TP96 - 2", "OE TO SKIN BOTTOM OF WALL
    CABINETS - oe6011") — it was observed to hallucinate codes (e.g.
    "WBB96 x48") from unrelated footer text like "items 116-126". The
    header page itself (DEALER NAME / DISPLAY NAME / DOOR STYLE / FINISH /
    CONSTRUCTION / DRAWER BOX / PERSPECTIVE) carries no cabinet codes and is
    skipped to save one vision call per display.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        segments = _segment_displays(doc)
        if not segments:
            return {
                "success": False, "rooms": [], "method": "display-catalog",
                "error": "No DISPLAY sections found",
            }

        rooms = []
        vision_pages_used = 0

        if use_vision:
            # ── Phase 1: Pre-render all content pages to PNG bytes (main thread,
            # fast — PyMuPDF pixel ops have no GIL issues here). We do this
            # before the thread pool so the fitz.Document is only accessed from
            # one thread.
            renders: list[tuple[int, int, bytes]] = []  # (seg_idx, page_idx, png)
            for seg_idx, seg in enumerate(segments):
                content_start = seg["page_start"] + 1 if seg["page_end"] > seg["page_start"] else seg["page_start"]
                for page_idx in range(content_start, seg["page_end"] + 1):
                    png = _render_page_png(doc[page_idx])
                    renders.append((seg_idx, page_idx, png))

            # ── Phase 2: Fire Vision API calls in parallel. Each _vision_call
            # creates its own OpenAI client so this is fully thread-safe.
            # Cap at 6 workers to stay within typical API rate limits.
            max_workers = min(6, len(renders)) if renders else 1
            page_items: dict[tuple[int, int], list[dict]] = {}
            if renders:
                with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                    fut_map = {
                        executor.submit(_vision_call, png): (si, pi)
                        for si, pi, png in renders
                    }
                    for fut in concurrent.futures.as_completed(fut_map):
                        key = fut_map[fut]
                        try:
                            page_items[key] = fut.result()
                        except Exception as e:
                            print(f"[display-catalog] parallel vision failed for page {key[1]}: {e}")
                            page_items[key] = []

            vision_pages_used = len(renders)

            # ── Phase 3: Aggregate per-segment results in original order.
            for seg_idx, seg in enumerate(segments):
                room_name = seg["display_name"] or f"DISPLAY {seg['display_num']}"
                room = EMPTY_ROOM(room_name)
                room["door_style"] = seg["door_style"]
                room["finish"] = seg["finish"]
                room["collection"] = ""
                code_qty: dict[str, dict[str, int]] = {cat: {} for cat in _ALL_CATS}

                content_start = seg["page_start"] + 1 if seg["page_end"] > seg["page_start"] else seg["page_start"]
                for page_idx in range(content_start, seg["page_end"] + 1):
                    for item in page_items.get((seg_idx, page_idx), []):
                        cat = categorize_code(item["code"]) or "cabinets"
                        code_qty[cat][item["code"]] = max(
                            code_qty[cat].get(item["code"], 0), item["quantity"]
                        )

                for cat, cq in code_qty.items():
                    room[cat] = [
                        {"code": c, "raw_code": c, "match_key": build_match_key(c), "quantity": q}
                        for c, q in cq.items() if q > 0
                    ]
                if any(len(room[cat]) > 0 for cat in _ALL_CATS):
                    rooms.append(room)

        else:
            # Dry-run / no-API-key path: sequential text regex (fast, no API cost).
            for seg in segments:
                room_name = seg["display_name"] or f"DISPLAY {seg['display_num']}"
                room = EMPTY_ROOM(room_name)
                room["door_style"] = seg["door_style"]
                room["finish"] = seg["finish"]
                room["collection"] = ""
                code_qty = {cat: {} for cat in _ALL_CATS}

                content_start = seg["page_start"] + 1 if seg["page_end"] > seg["page_start"] else seg["page_start"]
                for page_idx in range(content_start, seg["page_end"] + 1):
                    text = doc[page_idx].get_text()
                    if len(text.strip()) >= _SPARSE_TEXT_CHARS:
                        items = extract_page_items(text, pdf_type=PDF_TYPE_CUSTOM)
                        for item in items:
                            cat = categorize_code(item["code"], section_context=item.get("section"))
                            if cat:
                                code_qty[cat][item["code"]] = max(
                                    code_qty[cat].get(item["code"], 0), item["quantity"]
                                )

                for cat, cq in code_qty.items():
                    room[cat] = [
                        {"code": c, "raw_code": c, "match_key": build_match_key(c), "quantity": q}
                        for c, q in cq.items() if q > 0
                    ]
                if any(len(room[cat]) > 0 for cat in _ALL_CATS):
                    rooms.append(room)

        print(f"[display-catalog] {len(segments)} displays found, {len(rooms)} rooms with items, "
              f"{vision_pages_used} pages via vision")

        return {
            "success": True,
            "rooms": rooms,
            "method": "display-catalog-vision" if vision_pages_used else "display-catalog-text",
            "pdf_type": "DISPLAY_CATALOG",
            "has_trim_list": False,
            "flags": [],
            "pages_processed": len(doc),
            "displays_found": len(segments),
            "vision_pages_used": vision_pages_used,
        }
    finally:
        doc.close()
