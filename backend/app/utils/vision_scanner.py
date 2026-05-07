import os
import json
import re
import time
import fitz  # PyMuPDF
from dotenv import load_dotenv
import asyncio

# ─────────────────────────────────────────────────────────────────────────────
# Gemini 2.0 Flash — sole vision provider (NVIDIA removed).
# Python-hybrid strategy: rule-based extraction runs first on every page via
# PyMuPDF text layer; Gemini is called for pages where the text layer is sparse
# or produces no usable cabinet codes (e.g., scanned/rasterised drawings).
# All PDF pages are processed — page 0 (floor plan), page 1 (summary sheet),
# and any additional pages (e.g., Magnolia page 2 with hardware details).
# ─────────────────────────────────────────────────────────────────────────────

GEMINI_MODEL = "gemini-2.0-flash"

FLOOR_PLAN_PROMPT = """You are an expert cabinet estimator. Analyze the provided architectural drawing image.
The drawing contains cabinet layouts with SKUs inside boxes.

YOUR TASK:
Scan the drawing and extract CABINETS and ACCESSORIES into structured categories.

CATEGORIES (each room):
- "cabinets": Primary cabinet boxes — ALL W, B, SB, VSB, UF, REF, OVD, MICRO SKUs
- "perimeter": Trim along the wall — BTK, SM, OCM, SCM, LR, TK, RR codes
- "island": Cabinets in the center island
- "hardware": ONLY door/drawer counts and hardware accessories —
              DOORS count, DRAWERS count, DWR codes, SHM codes, HW-prefixed codes,
              knobs, pulls, hinges. NOTHING ELSE goes here.
- "bump": Bump-out cabinet groups
- "opt_crown": Optional crown molding — OCM, CM, HWC codes
- "opt_light_rail": Optional light rail — LR, FL codes
- "vent_chase_material": Vent chase / back panel — BACKB, BACKF, BACK-B codes

CRITICAL RULE — SECTION PLACEMENT (never violate):
  W codes (W3042BUTT, W3624BUTT, W2442BUTT, etc.) → "cabinets" ONLY
  B / SB codes (B30BUTT, SB36BUTT, B24BUTT, etc.)  → "cabinets" ONLY
  VSB codes (VSB3634HBUTT, etc.)                    → "cabinets" ONLY
  REF / OVD codes (REF2D36, OVD3396AS, etc.)        → "cabinets" ONLY
  UF codes (UF3, UF342, UF642, etc.)                → "cabinets" ONLY
  NEVER place any of the above inside "hardware".
  "hardware" contains ONLY: DOORS count, DRAWERS count, DWR*, SHM*, HW-* codes.

CRITICAL RULCRITICAL RULE — EXTRACT ALL CABINETS:
  Do not skip any cabinet code visible in the drawing or trim list.
  
ADDITIONAL RULES:
1. Identify the room name (e.g. "KITCHEN", "MASTER BATH", "OWNERS BATH").
2. **BATHROOMS**: Extract BTK8 and SM8 from perimeter only if they are explicitly visible in the drawing. Do NOT add them if they are not shown.
3. **TOUCHUP**: Preserve format like "2KIT+1SPRAY". Do NOT sum them as a number.
4. **NO DOUBLE COUNTING**: If an item appears in both drawing and list, use trim list qty.
5. **ISLAND**: Items labeled (DW) or (DWR) belong in "island".
6. **ALL PAGES**: Extract everything regardless of page number.

OUTPUT FORMAT (strict JSON, no markdown):
{
  "rooms": [
    {
      "room_name": "KITCHEN",
      "cabinets": [{"code": "W3042BUTT", "quantity": 5}],
      "perimeter": [{"code": "BTK8", "quantity": 4}, {"code": "TOUCHUP", "quantity": "2KIT+1SPRAY"}],
      "island": [{"code": "UF3", "quantity": 1}],
      "hardware": [{"code": "DOORS", "quantity": 27}, {"code": "DRAWERS", "quantity": 6}],
      "bump": [],
      "opt_crown": [],
      "opt_light_rail": [],
      "vent_chase_material": []
    }
  ]
}
N",
      "cabinets": [{"code": "W3042BUTT", "quantity": 5}],
      "perimeter": [{"code": "BTK8", "quantity": 4}],
      "island": [],
      "hardware": [{"code": "DOORS", "quantity": 27}, {"code": "DRAWERS", "quantity": 6}],
      "bump": [],
      "opt_crown": [],
      "opt_light_rail": [],
      "vent_chase_material": []
    }
  ]
}
"""

SUMMARY_PROMPT = """You are an expert cabinet estimator reading a Bill of Materials (BOM) summary sheet.

The page contains a structured text list of cabinet accessories grouped by section
(PERIMETER, HARDWARE, BUMP, OPT CROWN, OPT LIGHT RAIL, ISLAND, HARDWARE-R, OPT VENT CHASE MATERIAL, etc.).

YOUR TASK:
Extract ALL items from this summary sheet into the correct categories.

CRITICAL RULE — SECTION PLACEMENT (never violate):
  Cabinet codes ALWAYS go in "cabinets" regardless of where they appear on the sheet:
    W codes  (W3042BUTT, W3624BUTT, W2442BUTT, W3024BUTT, etc.) → "cabinets"
    B / SB codes (B30BUTT, SB36BUTT, B24BUTT, B15R, etc.)       → "cabinets"
    VSB codes (VSB3634HBUTT, VSB5434HBUTT, VSB4834H, etc.)       → "cabinets"
    REF / OVD codes (REF2D36, OVD3396AS, etc.)                   → "cabinets"
    UF codes (UF3, UF342, UF642, etc.)                           → "cabinets"
  NEVER put any of the above codes inside "hardware", "perimeter", or any other category.
  "hardware" contains ONLY: DOORS count, DRAWERS count, DWR* codes, SHM* codes, HW-* codes.

CRITICAL RULE — DESIGNER NAME IS NOT A CABINET CODE:
  The PDF footer contains text like "Designer: W.McCullough" or "W.Smith".
  WMCCULLOUGH, WSMITH, WJONES, WBROWN, WDAVIS, and all similar designer names
  are PEOPLE'S NAMES, not cabinet codes. Ignore all footer and title-block text.

CRITICAL RULE — EXTRACT ALL CABINETS:
  Never skip a cabinet code. Codes commonly missed — verify you captured ALL of these
  if they appear on the sheet:
    W3624BUTT, W2442BUTT, B24BUTT, REF2D36, VSB codes, UF3, UF342

SECTION → CATEGORY MAPPING (for non-cabinet items):
  - ROOM CABINETS, CABINETS → "cabinets"
  - PERIMETER → "perimeter"
  - HARDWARE-L, HARDWARE-R, HARDWARE → "hardware"
  - BUMP → "bump"
  - OPT CROWN → "opt_crown"
  - OPT LIGHT RAIL → "opt_light_rail"
  - ISLAND → "island"
  - OPT VENT CHASE MATERIAL → "vent_chase_material"

ADDITIONAL RULES:
1. The room name is at the top (e.g. "STANDARD 42 KITCHEN").
2. Format: "3-BTK8" means quantity=3, code="BTK8".
3. **STRIP PARENTHESES**: (VOIDS), (DW), (CROWN CLEAT) are notes, not code.
4. **KEEP MODIFIERS**: BLD, BD, BUTT are part of the code (e.g. OCM8BLD).
5. BACK-B48 → code="BACKB48", category="vent_chase_material".
6. Combine quantities for the same code across all sections.
7. **IGNORE**: TOUCHUP KIT, TOUCHUP SPRAY, CROWN (VAR OPTS), LIGHT RAIL (VAR OPTS).
8. "48 SHELF ADJ" → code="SHELFADJ48", category="vent_chase_material".
9. HWC codes → "opt_crown" if near OPT CROWN section, else "perimeter".
10. **HARDWARE COMPLETENESS**: Extract EVERY hardware item — DOORS count, DRAWERS count,
    hinge codes, knob/pull codes, DWR* codes, SHM* codes, all HW-* codes.
11. **BATHROOMS**: Extract BTK8 and SM8 from perimeter only if explicitly listed. Do NOT infer or add items not shown.
12. **TOUCHUP**: Preserve format like "2KIT+1SPRAY". Do NOT sum them as a number.
13. **FALSE CODES**: Ignore singular "DRAWER", "DOOR", "CABINET".

OUTPUT FORMAT (strict JSON, no markdown):
{
  "rooms": [
    {
      "room_name": "STANDARD 42 KITCHEN",
      "cabinets": [{"code": "W3042BUTT", "quantity": 4}],
      "perimeter": [{"code": "BTK8", "quantity": 4}],
      "island": [],
      "hardware": [{"code": "DOORS", "quantity": 27}, {"code": "DRAWERS", "quantity": 6}],
      "bump": [],
      "opt_crown": [{"code": "OCM8BLD", "quantity": 3}],
      "opt_light_rail": [],
      "vent_chase_material": [{"code": "BACKB48", "quantity": 1}]
    }
  ]
}
"""

EXTRA_PAGE_PROMPT = """You are an expert cabinet estimator. This is an additional page (page 2 or later)
from a multi-page architectural drawing set. It may be a room floor plan, vanity/bath layout,
laundry room, hardware schedule, elevation view, or BOM trim list.

YOUR TASK:
Extract ALL cabinet codes, hardware items, and accessories visible on this page.
This page often contains BOTH a floor plan drawing AND an embedded trim list — extract from both.

CRITICAL RULE — SECTION PLACEMENT (never violate):
  Cabinet codes ALWAYS go in "cabinets" regardless of where they appear:
    W codes  (W3042BUTT, W3624BUTT, W2442BUTT, etc.)          → "cabinets"
    B / SB codes (B30BUTT, SB36BUTT, B24BUTT, B15R, etc.)     → "cabinets"
    VSB codes (VSB3634HBUTT, VSB5434HBUTT, VSB4834H, etc.)     → "cabinets"
    REF / OVD codes (REF2D36, OVD3396AS, etc.)                 → "cabinets"
    UF codes (UF3, UF342, UF642, UF392, etc.)                  → "cabinets"
  NEVER put any of the above inside "hardware", "perimeter", or any other category.
  "hardware" contains ONLY: DOORS count, DRAWERS count, DWR* codes, SHM* codes, HW-* codes.

CRITICAL RULE — TRIM LIST SECTIONS:
  This page may have a trim list with sections like:
  PERIMETER → "perimeter"
  HARDWARE  → "hardware" (DOORS count, DRAWERS count, DWR*, SHM*)
  BUMP      → "bump" (SHM*, OCM*)
  OPT CROWN → "opt_crown" (OCM*, HWC*)
  OPT LIGHT RAIL → "opt_light_rail" (LR*, FL*, RR*)
  OPT VENT CHASE MATERIAL → "vent_chase_material" (BACKB*, WTEP*, QM*)
  Extract ALL items from ALL sections, including BUMP items (SHM8, OCM8BLD).
  Do NOT skip items just because they appear in a less prominent section.

CRITICAL RULE — DESIGNER NAME IS NOT A CABINET CODE:
  WMCCULLOUGH, WSMITH, WJONES, and all similar names in the footer are PEOPLE'S NAMES.
  Ignore all footer and title-block text completely.

ADDITIONAL RULES:
- Strip parenthetical notes (VOIDS), (DW), (CROWN CLEAT) — not part of the code.
- Keep modifiers: BUTT, BD, BLD are PART of the code (e.g. W3042BUTT, OCM8BLD).
- BACK-B48 → code="BACKB48", category="vent_chase_material".
- Format "3-BTK8" means quantity=3, code="BTK8".
- Use the room name from the drawing header (e.g. "STD BATH 2", "OPT LAUNDRY").
  If no room name is visible, use "ADDITIONAL PAGE".

OUTPUT FORMAT (strict JSON, no markdown):
{
  "rooms": [
    {
      "room_name": "STD BATH 2",
      "cabinets": [{"code": "VSB5434HBUTT", "quantity": 1}],
      "perimeter": [{"code": "BTK8", "quantity": 1}],
      "island": [],
      "hardware": [{"code": "DOORS", "quantity": 4}],
      "bump": [{"code": "SHM8", "quantity": 1}, {"code": "OCM8BLD", "quantity": 1}],
      "opt_crown": [],
      "opt_light_rail": [],
      "vent_chase_material": []
    }
  ]
}
"""

# SKU pattern used by the Python rule-based layer to detect cabinet codes in text
_CABINET_CODE_RE = re.compile(
    r'\b((?:W|B|SB|VSB|V|T|P|O|REF|MICRO|UF|F|WF|BF|BTK|TK|OCM|SCM|CM|LR|RR|'
    r'HWC|BACKB|BACKF|WTEP|SM|SHM|QM|QR|EP|TEP|DWR|FL|HW)\d[\w\-]*)\b',
    re.IGNORECASE,
)

_KNOWN_FALSE_POSITIVES = {
    "WMCCULLOUGH", "WSMITH", "WJONES", "WBROWN", "WDAVIS",
    "WJOHNSON", "WWILSON", "WMOORE", "WTAYLOR", "WANDERSON",
    "DRAWER", "DOOR", "CABINET", "VOIDS", "CROWN", "LIGHT", "RAIL",
}

ACCESSORY_KEYS = [
    "perimeter", "island", "hardware", "bump",
    "opt_crown", "opt_light_rail", "vent_chase_material",
]


# ─────────────────────────────────────────────────────────────────────────────
# JSON parsing helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_json_from_text(text: str) -> dict:
    """Extract JSON from Gemini response (handles markdown code blocks)."""
    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except Exception:
            pass
    raw_match = re.search(r'(\{.*\})', text, re.DOTALL)
    if raw_match:
        try:
            return json.loads(raw_match.group(1))
        except Exception:
            pass
    return json.loads(text.strip())


# ─────────────────────────────────────────────────────────────────────────────
# Gemini call (async, runs in thread executor to avoid blocking)
# ─────────────────────────────────────────────────────────────────────────────

async def _call_gemini(prompt: str, image_bytes: bytes, google_key: str, log_path: str) -> str:
    """Send an image + prompt to Gemini 2.0 Flash and return the raw text response."""
    import google.generativeai as genai
    from google.generativeai.types import GenerationConfig

    genai.configure(api_key=google_key)
    model = genai.GenerativeModel(GEMINI_MODEL)
    gen_cfg = GenerationConfig(temperature=0.0, max_output_tokens=4096)

    def _sync_call():
        return model.generate_content(
            [prompt, {"mime_type": "image/png", "data": image_bytes}],
            generation_config=gen_cfg,
        )

    response = await asyncio.get_event_loop().run_in_executor(None, _sync_call)
    text = response.text or ""

    with open(log_path, "a", encoding="utf-8") as log:
        log.write(f"[Gemini {GEMINI_MODEL}] RAW RESPONSE:\n{text}\n---\n")

    return text


# ─────────────────────────────────────────────────────────────────────────────
# Python rule-based layer — extracts codes from the PDF text layer (free, fast)
# ─────────────────────────────────────────────────────────────────────────────

def _extract_codes_from_text(page_text: str) -> list[dict]:
    """
    Parse selectable text from a PDF page and return a list of
    {"code": str, "quantity": int} dicts for any recognised cabinet/hardware codes.
    Quantities default to 1 since the text layer rarely carries explicit counts.
    """
    found = {}
    for m in _CABINET_CODE_RE.finditer(page_text):
        code = m.group(1).upper().strip()
        if code in _KNOWN_FALSE_POSITIVES:
            continue
        # Look for a leading number that might be a quantity (e.g. "4-BTK8" or "4 BTK8")
        qty = 1
        start = m.start()
        prefix = page_text[max(0, start - 6):start].strip()
        qty_m = re.search(r'(\d+)\s*[-–]?\s*$', prefix)
        if qty_m:
            qty = int(qty_m.group(1))
        if code not in found:
            found[code] = 0
        found[code] += qty
    return [{"code": k, "quantity": v} for k, v in found.items()]


def _classify_code_to_key(code: str) -> str:
    """Map a cabinet code to the room dict key it belongs to."""
    c = code.upper()
    if any(c.startswith(p) for p in ["BACKB", "BACKF", "BACK-B", "WTEP", "QM"]):
        return "vent_chase_material"
    if any(c.startswith(p) for p in ["OCM", "CM", "HWC"]):
        return "opt_crown"
    if any(c.startswith(p) for p in ["LR", "RR", "FL"]):
        return "opt_light_rail"
    if any(c.startswith(p) for p in ["BTK", "TK", "SM", "QR", "SCM", "EP", "TEP"]):
        return "perimeter"
    if any(c.startswith(p) for p in ["DWR", "SHM"]):
        return "hardware"
    if c.startswith("HW") or any(kw in c for kw in ["DOOR", "DRAW", "HINGE", "KNOB", "PULL"]):
        return "hardware"
    # Default: treat as a primary cabinet (W, B, SB, VSB, UF, REF, OVD, etc.)
    return "cabinets"


def _build_room_from_text_codes(codes: list[dict], room_name: str = "UNKNOWN") -> dict:
    """Assemble a room dict from a flat list of extracted codes."""
    room: dict = {
        "room_name": room_name,
        "cabinets": [],
        "perimeter": [],
        "island": [],
        "hardware": [],
        "bump": [],
        "opt_crown": [],
        "opt_light_rail": [],
        "vent_chase_material": [],
    }
    for item in codes:
        key = _classify_code_to_key(item["code"])
        room[key].append(item)
    return room


def _text_layer_is_sufficient(page_text: str) -> bool:
    """
    Return True if the PDF page has enough selectable text for rule-based
    extraction to be useful (avoids wasting a Gemini call on a rich text page).
    """
    # Count recognised cabinet-code matches
    matches = list(_CABINET_CODE_RE.finditer(page_text))
    return len(matches) >= 3


# ─────────────────────────────────────────────────────────────────────────────
# Merge helpers
# ─────────────────────────────────────────────────────────────────────────────

def _merge_room_results(base: dict, overlay: dict) -> dict:
    """
    Merge overlay rooms into base rooms.
    - Matching rooms (same name): overlay accessory sections override base;
      cabinet lists are merged (union by code, summing quantities).
    - New rooms in overlay: appended.
    - False-positive codes are stripped from all rooms.
    """
    merged_rooms = list(base.get("rooms", []))
    overlay_rooms = overlay.get("rooms", [])

    for o_room in overlay_rooms:
        o_name = o_room.get("room_name", "").upper()
        matched = next(
            (r for r in merged_rooms if r.get("room_name", "").upper() == o_name),
            None,
        )
        if matched is None:
            merged_rooms.append(o_room)
            continue

        # Merge accessories: overlay wins when non-empty
        for key in ACCESSORY_KEYS:
            if o_room.get(key):
                matched[key] = o_room[key]

        # Merge cabinets: use MAX not SUM to avoid doubling from floor plan vs summary
        existing_codes = {item["code"]: item for item in matched.get("cabinets", [])}
        for item in o_room.get("cabinets", []):
            if item["code"] in existing_codes:
                existing_codes[item["code"]]["quantity"] = max(existing_codes[item["code"]]["quantity"], item["quantity"])
            else:
                existing_codes[item["code"]] = dict(item)
        matched["cabinets"] = list(existing_codes.values())

    # Strip known false positives AND zero quantities from every room
    for room in merged_rooms:
        for key in ["cabinets"] + ACCESSORY_KEYS:
            if key in room:
                room[key] = [
                    it for it in room[key]
                    if it.get("code", "").upper() not in _KNOWN_FALSE_POSITIVES and
                       it.get("quantity") not in (0, "0", 0.0, "0.0", None)
                ]

    return {"rooms": merged_rooms, "smart_agent_explanations": []}


def _merge_extra_page(main: dict, extra: dict) -> dict:
    """
    Merge hardware and accessories from an extra page into the main result.
    Hardware items are always appended (summed) rather than replaced.
    """
    main_rooms = {r.get("room_name", "").upper(): r for r in main.get("rooms", [])}

    for e_room in extra.get("rooms", []):
        e_name = e_room.get("room_name", "").upper()

        # Find best matching existing room; otherwise pick the first room
        target = main_rooms.get(e_name) or (main.get("rooms") or [None])[0]
        if target is None:
            main.setdefault("rooms", []).append(e_room)
            continue

        for key in ACCESSORY_KEYS:
            e_items = e_room.get(key, [])
            if not e_items:
                continue
            existing = {it["code"]: it for it in target.get(key, [])}
            for item in e_items:
                if item["code"] in existing:
                    existing[item["code"]]["quantity"] += item["quantity"]
                else:
                    existing[item["code"]] = dict(item)
            target[key] = list(existing.values())

        # Merge cabinets from extra pages: use MAX not SUM.
        # Both the floor plan drawing and the trim list page for the same room
        # may list the same cabinet once each — summing would double the count.
        existing_cabs = {it["code"]: it for it in target.get("cabinets", [])}
        for item in e_room.get("cabinets", []):
            if item["code"] in existing_cabs:
                existing_cabs[item["code"]]["quantity"] = max(
                    existing_cabs[item["code"]]["quantity"], item["quantity"]
                )
            else:
                existing_cabs[item["code"]] = dict(item)
        target["cabinets"] = list(existing_cabs.values())

    # Strip known false positives from every room (covers extra-page results)
    for room in main.get("rooms", []):
        for key in ["cabinets"] + ACCESSORY_KEYS:
            if key in room:
                room[key] = [
                    it for it in room[key]
                    if it.get("code", "").upper() not in _KNOWN_FALSE_POSITIVES
                ]

    return main


# ─────────────────────────────────────────────────────────────────────────────
# Page scanning — hybrid: rule-based first, Gemini when needed
# ─────────────────────────────────────────────────────────────────────────────

async def _scan_page_hybrid(
    page,
    prompt: str,
    google_key: str,
    log_path: str,
    page_idx: int,
) -> dict:
    """
    Scan a single fitz page using the Python-hybrid strategy:

    Pages 0–1 (main kitchen floor plan + BOM trim list):
      Rule-based extraction runs first; Gemini is called only when the text
      layer is sparse (< 3 cabinet codes).

    Pages 2+ (extra rooms — bathrooms, laundry, gourmet kitchen, etc.):
      Always use Gemini. These pages often embed a trim list alongside the
      floor plan drawing. Rule-based misses trim-list items whose text is
      partially truncated by the PDF renderer (e.g. BUMP → OCM8BLD).
      When no API key is available, fall back to rule-based.
    """
    page_text = page.get_text("text") or ""
    log_prefix = f"[page {page_idx}]"

    with open(log_path, "a", encoding="utf-8") as log:
        log.write(f"{log_prefix} text_chars={len(page_text)}\n")

    # Use the cheaper hybrid (rule-based first) whenever text is sufficient.
    if _text_layer_is_sufficient(page_text):
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"{log_prefix} Using rule-based extraction (rich text layer)\n")
        codes = _extract_codes_from_text(page_text)
        if codes:
            room = _build_room_from_text_codes(codes, room_name=f"PAGE_{page_idx}_ROOM")
            return {"rooms": [room]}
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"{log_prefix} Rule-based found 0 codes — falling back to Gemini\n")

    if not google_key:
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"{log_prefix} No GEMINI_API_KEY — using rule-based fallback\n")
        codes = _extract_codes_from_text(page_text)
        if codes:
            room = _build_room_from_text_codes(codes, room_name=f"PAGE_{page_idx}_ROOM")
            return {"rooms": [room]}
        return {"rooms": []}

    # Gemini path — render page as high-res PNG
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    image_bytes = pix.tobytes("png")

    with open(log_path, "a", encoding="utf-8") as log:
        log.write(f"{log_prefix} Calling Gemini {GEMINI_MODEL} ({len(image_bytes)//1024}KB image)\n")

    try:
        raw = await _call_gemini(prompt, image_bytes, google_key, log_path)
        return _parse_json_from_text(raw)
    except Exception as exc:
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"{log_prefix} Gemini error: {exc}\n")
        return {"rooms": []}


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

async def analyze_drawing_vision(file_path: str) -> dict:
    """
    Full PDF analysis using the Python-hybrid + Gemini 2.0 Flash strategy.

    Page layout assumed:
      Page 0  — floor plan drawing      → FLOOR_PLAN_PROMPT
      Page 1  — BOM/summary sheet       → SUMMARY_PROMPT
      Page 2+ — additional floor plans,
                hardware schedules, etc. → EXTRA_PAGE_PROMPT

    Rule-based extraction runs first on each page; Gemini is called only when
    the text layer is sparse (scanned/rasterised drawings).
    """
    log_path = "backend_ai_debug.log"
    with open(log_path, "a", encoding="utf-8") as log:
        log.write(f"\n=== Vision Scan Start: {time.ctime()} ===\n")
        log.write(f"File: {file_path}\n")

    load_dotenv()
    google_key = os.getenv("GOOGLE_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY") or ""

    if not google_key:
        with open(log_path, "a", encoding="utf-8") as log:
            log.write("WARNING: No GEMINI_API_KEY found — Gemini calls will be skipped.\n")

    try:
        # ── Single image file ────────────────────────────────────────────────
        if not file_path.lower().endswith(".pdf"):
            with open(file_path, "rb") as f:
                image_bytes = f.read()
            if not google_key:
                return {"rooms": []}
            print(f"[vision] Gemini {GEMINI_MODEL} — single image scan")
            raw = await _call_gemini(FLOOR_PLAN_PROMPT, image_bytes, google_key, log_path)
            return _parse_json_from_text(raw)

        # ── PDF — process all pages ──────────────────────────────────────────
        doc = fitz.open(file_path)
        total_pages = len(doc)
        print(f"[vision] Gemini {GEMINI_MODEL} hybrid — PDF with {total_pages} page(s)")

        result = {"rooms": []}

        # Page 0: floor plan
        if total_pages >= 1:
            fp_result = await _scan_page_hybrid(
                doc.load_page(0), FLOOR_PLAN_PROMPT, google_key, log_path, 0
            )
            result = _merge_room_results(result, fp_result)

        # Page 1: BOM / summary sheet
        if total_pages >= 2:
            sum_result = await _scan_page_hybrid(
                doc.load_page(1), SUMMARY_PROMPT, google_key, log_path, 1
            )
            result = _merge_room_results(result, sum_result)

        # Pages 2-8: additional floor plans / hardware schedules (cap at 8 for speed)
        for page_idx in range(2, min(total_pages, 8)):
            with open(log_path, "a", encoding="utf-8") as log:
                log.write(f"[page {page_idx}] Processing extra page\n")
            extra_result = await _scan_page_hybrid(
                doc.load_page(page_idx), EXTRA_PAGE_PROMPT, google_key, log_path, page_idx
            )
            result = _merge_extra_page(result, extra_result)

        doc.close()

        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"Final rooms extracted: {[r.get('room_name') for r in result.get('rooms', [])]}\n")

        return result

    except Exception as exc:
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"ERROR in analyze_drawing_vision: {exc}\n")
        print(f"[vision] Error: {exc}")
        return {"rooms": []}
