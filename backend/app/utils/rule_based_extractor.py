"""
Rule-Based Cabinet Code Extractor
==================================
Extracts and categorizes cabinet SKU codes from blueprint PDFs using:
  1. PyMuPDF  - fast selectable text extraction
  2. NKBA prefix rules - no AI, no API key, no cost, works offline

Performance: typically < 2 seconds for any size drawing set.
"""

import re
import fitz
from typing import Dict, List, Any


# ─── Configuration ───────────────────────────────────────────────────────────

# Known cabinet SKU prefixes for fast code validation
VALID_PREFIXES = re.compile(
    r'^(W|B|SB|VSB|V|T|P|O|UF|F|DW|REF|MICRO|HW|CM|SM|BTK|SHM|OCM|LR|RANGE|HOOD|FL|DISH|S\d|OVD)',
    re.IGNORECASE
)


# ─── Room Detection Patterns ─────────────────────────────────────────────────

# Priority list of room types. We look for the literal string on the page.
# IMPORTANT: More specific / distinct names must come BEFORE generic ones.
# LAUNDRY must come before BATH so that a laundry page whose title block also
# mentions "BATH 3 UPSTAIRS" doesn't get misclassified as Bath 3.
ROOM_TYPES = [
    'GOURMET KITCHEN', 'STANDARD KITCHEN', 'STD KITCHEN', 'OPT KITCHEN', 'KITCHEN', 'KIT', 'GMT KITCHEN',
    'LAUNDRY', 'MUDROOM', 'MUD ROOM', 'PANTRY', 'OFFICE', 'DEN', 'BAR', 'WET BAR', 'POWDER ROOM', 'POWDER', 'PWD',
    'OWNERS BATH', 'MASTER BATH', 'OWN BATH', 'BATH 3', 'BATH 2', 'BATH 1', 'BATH', 'BA 3', 'BA 2', 'BA 1', 'BA',
    'GARAGE',
]

def detect_room_name(text: str) -> str:
    """
    Extract the definitive room name from a page.

    Strategy:
    1. Scan the drawing-footer line (e.g. 'MIH 4031 MAGNOLIA OPT LAUNDRY GR 1951') first —
       it is the most authoritative room identifier on each page.
    2. Then fall back to scanning the full page text using the ROOM_TYPES priority list.
    """
    text_upper = text.upper()

    # ── Step 1: check the footer / title-block line for a definitive label ──
    # Footers typically look like "MIH 4031 MAGNOLIA <ROOM LABEL> GR 1951"
    footer_patterns = [
        r'MIH\s+\d+\s+\w+\s+((?:OPT\s+)?LAUNDRY[\w\s]*?)(?:\s+GR|\s+ALL|\s*$)',
        r'MIH\s+\d+\s+\w+\s+((?:OPT\s+)?GOURMET\s+KITCHEN[\w\s]*?)(?:\s+GR|\s+ALL|\s*$)',
        r'MIH\s+\d+\s+\w+\s+(STD\s+\d+\s+KITCHEN[\w\s]*?)(?:\s+GR|\s+ALL|\s*$)',
        r'MIH\s+\d+\s+\w+\s+(OPT\s+GMT\s+KITCHEN[\w\s]*?)(?:\s+GR|\s+ALL|\s*$)',
    ]
    for fp in footer_patterns:
        m = re.search(fp, text_upper)
        if m:
            label = m.group(1).strip()
            if 'LAUNDRY' in label:
                return 'OPT LAUNDRY'
            if 'GOURMET' in label or 'GMT' in label:
                return 'OPT GOURMET KITCHEN'
            if re.search(r'STD\s+42\s+KITCHEN', label):
                return 'STANDARD 42 KITCHEN'
            if re.search(r'STD\s+\d+\s+KITCHEN', label):
                return 'STANDARD 42 KITCHEN'

    # ── Step 2: look for "STANDARD 42" / "STD 42" kitchen specifically ──
    std42_match = re.search(r'\b((?:STANDARD|STD)\s+42["\']?\s+KITCHEN)', text_upper)
    if std42_match:
        return 'STANDARD 42 KITCHEN'

    # ── Step 3: scan full page text using priority-ordered room type list ──
    for room_type in ROOM_TYPES:
        pattern = rf'\b((?:OPTIONAL\s+|OPT\s+|STANDARD\s+|STD\s+)?{re.escape(room_type)})\b'
        match = re.search(pattern, text_upper)
        if match:
            name = match.group(1).strip()
            if name == 'KIT':
                return 'KITCHEN'
            if name == 'BA':
                return 'BATH'
            return name

    return None


# ─── NKBA SKU Categorization Rules ──────────────────────────────────────────

# Hardware / accessory keyword overrides (checked before prefix rules)
HARDWARE_KEYWORDS = re.compile(
    r'^(DOORS?|DRAWERS?|HINGES?|PULLS?|KNOBS?|TRAY|ROLLOUT|LAZY|POTS?|TRASH|TILT|WASTE|CUTTING|BREAD|IRONING)\b',
    re.I
)

HARDWARE_PREFIXES = re.compile(r'^(HWC|DWR\d|REFPANEL|PANEL|HDW)', re.I)

MOLDING_PREFIXES = re.compile(r'^(CM|LR|LRM|OCM|SCM|QM|SHM|BTK|SM\d)', re.I)
OPT_CROWN_PREFIXES = re.compile(r'^(CM|OCM|SCM|QM)', re.I)
OPT_LIGHT_RAIL_PREFIXES = re.compile(r'^(LR|LRM)', re.I)
BUMP_PREFIXES = re.compile(r'^(SHM)', re.I)
PERIMETER_PREFIXES = re.compile(r'^(BTK|SM\d|FL\d|BACK|WTEP|CLEAT)', re.I)

WALL_CABINET = re.compile(r'^W\d', re.I)
BASE_CABINET = re.compile(r'^(B\d|SB\d)', re.I)
TALL_CABINET = re.compile(r'^(T\d|P\d|O\d|UTIL|REF\d|MICRO|OVD)', re.I)
VANITY_CABINET = re.compile(r'^(V\d|VSB\d)', re.I)
FILLER_CABINET = re.compile(r'^(UF\d|F\d)', re.I)

# Patterns that look like SKU-adjacent text to reject
REJECT_PATTERNS = re.compile(
    r'^(\d+$|MIH|SARASOTA|MAGNOLIA|STANDARD|OPTIONAL|ELITE|BUILDING|SOLUTIONS|DESIGNER|BLUEPRINT|CEILING|INSTALLATION|PRINTED|DESIGNED|DRAWING|ALL|LAYOUT|ROOM|PROJECT|CLIENT|DATE|PAGE)',
    re.I
)


def categorize_code(code: str) -> str:
    """
    Returns the BOM category for a given cabinet code using NKBA rules.
    Returns None if the code should be rejected entirely.
    """
    c = code.strip().upper()
    if not c or len(c) < 2 or len(c) > 25:
        return None
    if REJECT_PATTERNS.match(c):
        return None

    if HARDWARE_KEYWORDS.match(c):
        return 'hardware'
    if HARDWARE_PREFIXES.match(c):
        return 'hardware'
    if OPT_CROWN_PREFIXES.match(c):
        return 'opt_crown'
    if OPT_LIGHT_RAIL_PREFIXES.match(c):
        return 'opt_light_rail'
    if BUMP_PREFIXES.match(c):
        return 'bump'
    if MOLDING_PREFIXES.match(c) or PERIMETER_PREFIXES.match(c):
        return 'perimeter'
    if WALL_CABINET.match(c) or BASE_CABINET.match(c) or TALL_CABINET.match(c) or VANITY_CABINET.match(c) or FILLER_CABINET.match(c):
        return 'cabinets'
    
    # Generic fallback for anything matching our prefix list.
    # Require at least one digit — cabinet codes always encode dimensions.
    # All-letter strings here are text artifacts (e.g., drafter names like "WMCCULLOUGH").
    if VALID_PREFIXES.match(c) and any(ch.isdigit() for ch in c):
        return 'cabinets'

    return None


# ─── Code Sanitizer ──────────────────────────────────────────────────────────

# Modifiers that are part of the SKU and must be kept
VALID_MODIFIERS = {'BUTT', 'BLD', 'MD', 'BD', 'AS', 'SLD', 'FHD', 'DP'}

def sanitize_code(raw: str) -> str:
    """Clean a raw extracted code string into a proper SKU."""
    c = raw.strip()
    # Strip leading quantity prefix like "1-", "2-", "12-"
    c = re.sub(r'^\d+\s*[-]\s*', '', c)
    # Strip parenthetical notes like (DW), (VOIDS)
    c = re.sub(r'\s*\(.*?\)', '', c)
    # Strip trailing non-alphanumeric noise
    c = re.sub(r'[^A-Z0-9 ]', '', c.upper()).strip()
    # Normalize spaces: join modifier words
    parts = c.split()
    if not parts: return ''
    
    # If the second part is a known modifier, join it
    if len(parts) >= 2 and parts[1] in VALID_MODIFIERS:
        return parts[0] + parts[1]
    
    return parts[0]


# ─── Page-Level Extractor ────────────────────────────────────────────────────

# Broader pattern to catch SKUs: Prefix (letters) + optionally Digits + optionally Modifiers
# Matches: W3042, B15R, SB36 BUTT, BTK8, UF3, DOORS, B30-BUTT, REF.2D.36
RAW_CODE_PATTERN = re.compile(
    r'\b([A-Z]{1,5}[\d.][-A-Z0-9.]*(?:\s+(?:BUTT|BLD|MD|BD|AS|SLD|DP))?)\b',
    re.IGNORECASE
)

# Quantity prefix pattern: "2-W3042" or "1- B30"
QTY_PREFIX_PATTERN = re.compile(r'(\d+)\s*[-]\s*([A-Z]{1,5}[\d.][-A-Z0-9. ]*)', re.IGNORECASE)
# Quantity suffix pattern: "W3042 (2)" or "B30 x2"
# Negative lookahead prevents matching depth notation like "W3624 X 24 DP" (24 = depth, not qty)
QTY_SUFFIX_PATTERN = re.compile(
    r'([A-Z]{1,5}[\d.][-A-Z0-9. ]*)\s*(?:\(|\bx\s*)(\d+)\b(?!\s*(?:DP\b|DEEP\b|IN\b|INCH\b|\'))',
    re.IGNORECASE
)


def extract_page_items(text: str) -> List[Dict[str, Any]]:
    """
    Extract raw (code, quantity) pairs from a single page of blueprint text.
    Uses quantity prefixes/suffixes when found.
    """
    items = []
    seen_codes = {}  # code → cumulative qty

    # Pass 1: Look for quantity-prefixed codes like "2-W3042"
    for m in QTY_PREFIX_PATTERN.finditer(text):
        qty = int(m.group(1))
        raw = m.group(2).strip()
        code = sanitize_code(raw)
        if code and len(code) >= 2:
            seen_codes[code] = seen_codes.get(code, 0) + qty

    # Pass 2: Look for quantity-suffixed codes like "W3042 (2)"
    for m in QTY_SUFFIX_PATTERN.finditer(text):
        raw = m.group(1).strip()
        qty = int(m.group(2))
        code = sanitize_code(raw)
        if code and len(code) >= 2:
            # Avoid double counting if already found by prefix
            if code not in seen_codes:
                seen_codes[code] = qty

    # Pass 3: Unique standalone codes — each distinct code = qty 1.
    # We intentionally do NOT count occurrences here because the same SKU label
    # can appear multiple times in a floor-plan page (drawn position + annotation),
    # and a separate BOM summary page provides the authoritative quantity via Pass 1.
    # Counting occurrences inflates numbers; unique-presence is the safe fallback.
    standalone_counts: dict = {}
    for m in RAW_CODE_PATTERN.finditer(text):
        raw = m.group(1)
        code = sanitize_code(raw)
        if code and len(code) >= 2 and code not in seen_codes and code not in standalone_counts:
            standalone_counts[code] = 1
    seen_codes.update(standalone_counts)

    for code, qty in seen_codes.items():
        items.append({'code': code, 'quantity': qty})

    return items


# ─── Main Extraction Function (No API Key Required) ──────────────────────────

EMPTY_ROOM = lambda name: {
    'room_name': name,
    'cabinets': [],
    'perimeter': [],
    'island': [],
    'hardware': [],
    'island_hardware': [],
    'bump': [],
    'island_bump': [],
    'opt_crown': [],
    'opt_light_rail': [],
    'vent_chase_material': [],
}


_ALL_CATS = [
    'cabinets', 'perimeter', 'island', 'hardware', 'island_hardware',
    'bump', 'island_bump', 'opt_crown', 'opt_light_rail', 'vent_chase_material',
]


def extract_rooms_rule_based(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Fully local, API-key-free extraction of cabinet codes from a PDF.

    Steps:
      1. PyMuPDF extracts selectable text from each page
      2. Room name is identified per page using keyword patterns
      3. SKUs are extracted using regex and categorized using NKBA rules
      4. Rooms with the same name are merged

    Returns: {"rooms": [...], "method": "rule-based-local", "success": True}
    """
    rooms_map: Dict[str, dict] = {}
    # O(1) accumulator: room → category → code → qty  (avoids O(n) list scan per item)
    rooms_qty: Dict[str, Dict[str, Dict[str, int]]] = {}
    has_text = False
    last_room_name = None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')

        for page_num, page in enumerate(doc):
            text = page.get_text()
            if not text.strip():
                continue

            has_text = True

            # Identify the room on this page
            room_name = detect_room_name(text)

            if not room_name:
                if last_room_name:
                    room_name = last_room_name
                    print(f"[rule-extract] Page {page_num + 1}: no room name found, falling back to '{room_name}'")
                else:
                    room_name = 'KITCHEN'
                    print(f"[rule-extract] Page {page_num + 1}: no room name found on first page, defaulting to 'KITCHEN'")

            last_room_name = room_name

            # Ensure room slot exists
            if room_name not in rooms_map:
                rooms_map[room_name] = EMPTY_ROOM(room_name)
                rooms_qty[room_name] = {cat: {} for cat in _ALL_CATS}

            # Extract all items from this page
            items = extract_page_items(text)
            print(f"[rule-extract] Page {page_num + 1} ({room_name}): {len(items)} items found")

            # Categorize each item.
            # Use max() across pages instead of sum() to prevent double-counting:
            # a floor-plan page contributes standalone qty=1, while the paired BOM
            # summary page contributes explicit qty=N.  max(1, N) = N which is correct.
            # sum(1, N) = N+1 which over-counts by 1 per duplicated code.
            for item in items:
                code = item['code']
                qty = item['quantity']
                category = categorize_code(code)
                if category:
                    cat_dict = rooms_qty[room_name][category]
                    cat_dict[code] = max(cat_dict.get(code, 0), qty)

        doc.close()

    except Exception as e:
        print(f"[rule-extract] ERROR: {e}")
        return {'success': False, 'rooms': [], 'error': str(e), 'method': 'rule-based-local'}

    if not has_text:
        return {
            'success': False,
            'rooms': [],
            'error': 'PDF has no selectable text. Please use a vector/digital PDF, not a scanned image.',
            'method': 'rule-based-local'
        }

    # Convert dict accumulators → list format expected by the rest of the app
    for room_name, cat_dicts in rooms_qty.items():
        for cat, code_qty in cat_dicts.items():
            rooms_map[room_name][cat] = [{'code': c, 'quantity': q} for c, q in code_qty.items()]

    rooms = list(rooms_map.values())
    # Filter out completely empty rooms
    rooms = [r for r in rooms if any(len(r[cat]) > 0 for cat in ['cabinets', 'hardware', 'perimeter', 'island', 'bump', 'opt_crown', 'opt_light_rail'])]

    print(f"[rule-extract] Complete. {len(rooms)} rooms extracted.")
    return {
        'success': True,
        'rooms': rooms,
        'method': 'rule-based-local',
        'pages_processed': len(rooms_map)
    }
