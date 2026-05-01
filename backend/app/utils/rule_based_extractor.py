"""
Rule-Based Cabinet Code Extractor
==================================
Extracts and categorizes cabinet SKU codes from blueprint PDFs using:
  1. PyMuPDF  — fast selectable text extraction
  2. PDF type detection (Elite, DRH Express, Wellborn Binder, Custom/Marquis)
  3. Trim List detection and section-aware routing
  4. NKBA prefix rules — no AI, no API key, no cost, works offline

Performance: typically < 2 seconds for any size drawing set.
"""

import re
import fitz
from typing import Dict, List, Any, Optional, Tuple


# ─── PDF TYPE DETECTION ───────────────────────────────────────────────────────

PDF_TYPE_ELITE    = "ELITE_STANDARD"
PDF_TYPE_DRH      = "DRH_EXPRESS"
PDF_TYPE_WELLBORN = "WELLBORN_BINDER"
PDF_TYPE_CUSTOM   = "CUSTOM_MARQUIS"
PDF_TYPE_UNKNOWN  = "UNKNOWN"


def detect_pdf_type(full_text: str) -> str:
    """Identify the PDF format from the full document text."""
    t = full_text.upper()

    # Wellborn: 3D binder — no SKU codes, only perspective/elevation labels
    wellborn_signals = sum([
        bool(re.search(r'KITCHEN\s+PERSP', t)),
        bool(re.search(r'REF\s+ELEV|ISLAND\s+ELEV|COOKTOP\s+ELEV', t)),
        bool(re.search(r'CAMPANIA|WESTBAY', t)),
        bool(re.search(r'STANDARD\s+GOURMET|OPTIONAL\s+EXTENDED', t)),
    ])
    code_count = len(re.findall(r'\b[WBS][B]?\d{2,4}', t))
    if wellborn_signals >= 2 and code_count < 10:
        return PDF_TYPE_WELLBORN

    # DRH Express: -L / -R hinge suffixes and DRH-specific trim codes
    drh_signals = sum([
        bool(re.search(r'[A-Z]\d{2,4}-[LR]\b', t)),
        bool(re.search(r'\bTOEKICK8\b', t)),
        bool(re.search(r'\bMSW8\b', t)),
        bool(re.search(r'\bMQR8\b', t)),
        bool(re.search(r'\bF3[34]\d\b', t)),
        bool(re.search(r'\bPEPR\d', t)),
        bool(re.search(r'\bREF\.2D\.', t)),
        bool(re.search(r'DR\s*HORTON\s+EXPRESS|DRH\s+EXPRESS', t)),
    ])
    if drh_signals >= 3:
        return PDF_TYPE_DRH

    # Custom / Marquis / Renovation: -2B, -3, NP, OWLSR suffixes; FREPU codes
    custom_signals = sum([
        bool(re.search(r'[A-Z]\d{2,4}-[23]B?\b', t)),
        bool(re.search(r'\bFREPU\d', t)),
        bool(re.search(r'OWLSR|NPOWLSR', t)),
        bool(re.search(r'\bBEP-', t)),
        bool(re.search(r'DOVETAIL|ROBERTSON\s+RENOV|MARQUIS', t)),
        bool(re.search(r'\bBMWDWR\d', t)),
    ])
    if custom_signals >= 2:
        return PDF_TYPE_CUSTOM

    # Elite Standard: BUTT suffix, BACK-B48, WTEP, Elite Building Solutions
    elite_signals = sum([
        bool(re.search(r'\w+BUTT\b', t)),
        bool(re.search(r'BACK-B48|BACKB48', t)),
        bool(re.search(r'\bWTEP\d', t)),
        bool(re.search(r'ELITE\s+BUILDING\s+SOLUTIONS', t)),
        bool(re.search(r'\bTRIM\s+LIST\b', t)),
        bool(re.search(r'\bOCM8BLD\b', t)),
    ])
    if elite_signals >= 2:
        return PDF_TYPE_ELITE

    return PDF_TYPE_UNKNOWN


def has_trim_list(full_text: str) -> bool:
    """Check whether the document contains a Trim List page."""
    return bool(re.search(r'TRIM\s+LIST\b', full_text, re.I))


# ─── Non-Cabinet Item Rejection Lists ────────────────────────────────────────

# These codes are NEVER cabinets — they are fillers, end panels, trim, or markers
NON_CABINET_EXACT = {
    'F331', 'F342', 'F321', 'F333', 'PEPR335', 'PEPR335L', 'PEPR335R',
    'FALSE', 'BACK-B48', 'BACKB48',
    'WAINSCOT', 'FINENDL', 'FINENDR',
    'CRW34',  # countertop reference
}

NON_CABINET_PREFIXES_RE = re.compile(
    r'^(PEPR\d|BEP-|BBSFW|WAINSCOT|FINEND|BBSFWD|14BBS)',
    re.I,
)

APPLIANCE_CODES_RE = re.compile(
    r'^(RANGE|DISH|MWHOOD|MW\.HOOD|HOOD|RR120|STANISCI|REFRIG)',
    re.I,
)


def is_non_cabinet(code: str) -> bool:
    """Return True if this code should never be classified as a cabinet."""
    c = code.upper().replace(' ', '').replace('-', '').replace('.', '')
    # Check exact rejections (also normalised)
    exact_normalised = {x.upper().replace('-', '').replace('.', '') for x in NON_CABINET_EXACT}
    if c in exact_normalised:
        return True
    if NON_CABINET_PREFIXES_RE.match(code):
        return True
    return False


# ─── Configuration ────────────────────────────────────────────────────────────

VALID_PREFIXES = re.compile(
    r'^(W|B|SB|VSB|V|T|P|O|UF|F|DW|REF|MICRO|HW|CM|SM|BTK|SHM|OCM|LR|RANGE|HOOD|FL|DISH|S\d|OVD)',
    re.IGNORECASE
)


# ─── Room Detection Patterns ──────────────────────────────────────────────────

ROOM_TYPES = [
    'GOURMET KITCHEN', 'STANDARD KITCHEN', 'STD KITCHEN', 'OPT KITCHEN', 'KITCHEN', 'KIT', 'GMT KITCHEN',
    'LAUNDRY', 'MUDROOM', 'MUD ROOM', 'PANTRY', 'OFFICE', 'DEN', 'BAR', 'WET BAR', 'POWDER ROOM', 'POWDER', 'PWD',
    'OWNERS BATH', 'MASTER BATH', 'OWN BATH', 'BATH 3', 'BATH 2', 'BATH 1', 'BATH', 'BA 3', 'BA 2', 'BA 1', 'BA',
    'GARAGE',
]


def detect_room_name(text: str) -> Optional[str]:
    """Extract the definitive room name from a page."""
    text_upper = text.upper()

    # Step 1: Footer line patterns
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

    # Step 2: Standard 42 kitchen
    if re.search(r'\b((?:STANDARD|STD)\s+42["\']?\s+KITCHEN)', text_upper):
        return 'STANDARD 42 KITCHEN'

    # Step 3: Priority list
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


# ─── Section Detection ────────────────────────────────────────────────────────

# Ordered from most-specific to most-generic so the first match wins
TRIM_LIST_SECTIONS = [
    'OPT VENT CHASE MATERIAL',
    'VENT CHASE MATERIAL',
    'OPT VENT CHASE',
    'VENT CHASE',
    'ISLAND BUMP',
    'ISLAND HARDWARE',
    'ISLAND',
    'OPT CROWN',
    'OPTIONAL CROWN',
    'BUMP/BOXING',
    'BUMP BOXING',
    'OPT LIGHT RAIL',
    'OPTIONAL LIGHT RAIL',
    'LIGHT RAIL',
    'HARDWARE',
    'PERIMETER',
    'WALL CABINETS',
    'BASE CABINETS',
    'TALL CABINETS',
    'UNIVERSAL FILLERS',
    'ACCESSORIES',
]

# Regex that matches any of the section headers above
SECTION_PATTERN = re.compile(
    r'\b(' + '|'.join(re.escape(s) for s in TRIM_LIST_SECTIONS) + r')\b',
    re.I
)

# Section name → internal category bucket
SECTION_TO_BUCKET = {
    'OPT VENT CHASE MATERIAL': 'vent_chase_material',
    'VENT CHASE MATERIAL':     'vent_chase_material',
    'OPT VENT CHASE':          'vent_chase_material',
    'VENT CHASE':              'vent_chase_material',
    'ISLAND BUMP':             'island_bump',
    'ISLAND HARDWARE':         'island_hardware',
    'ISLAND':                  'island',         # island cabinet/accessories → categorized then placed in island_*
    'OPT CROWN':               'opt_crown',
    'OPTIONAL CROWN':          'opt_crown',
    'BUMP/BOXING':             'bump',
    'BUMP BOXING':             'bump',
    'OPT LIGHT RAIL':          'opt_light_rail',
    'OPTIONAL LIGHT RAIL':     'opt_light_rail',
    'LIGHT RAIL':              'opt_light_rail',
    'HARDWARE':                'hardware',
    'PERIMETER':               None,   # use prefix-based categorization
    'WALL CABINETS':           None,
    'BASE CABINETS':           None,
    'TALL CABINETS':           None,
    'UNIVERSAL FILLERS':       None,
    'ACCESSORIES':             'perimeter',
}

ISLAND_SECTIONS = {'ISLAND', 'ISLAND BUMP', 'ISLAND HARDWARE'}


# ─── NKBA Code Categorization ─────────────────────────────────────────────────

HARDWARE_KEYWORDS = re.compile(
    r'^(DOORS?|DRAWERS?|HINGES?|PULLS?|KNOBS?|TRAY|ROLLOUT|LAZY|POTS?|TRASH|TILT|WASTE|CUTTING|BREAD|IRONING)\b',
    re.I
)
HARDWARE_PREFIXES  = re.compile(r'^(HWC|DWR\d|REFPANEL|PANEL|HDW)', re.I)
OPT_CROWN_RE       = re.compile(r'^(CM|OCM|SCM|QM)', re.I)
OPT_LIGHT_RAIL_RE  = re.compile(r'^(LR|LRM)', re.I)
BUMP_RE            = re.compile(r'^SHM', re.I)
PERIMETER_RE       = re.compile(r'^(BTK|SM\d|FL\d|BACK|WTEP|CLEAT|TOEKICK|MSW|MQR|TOUCHUP|TUKIT|TUPSPRAY)', re.I)

WALL_CABINET    = re.compile(r'^W\d', re.I)
BASE_CABINET    = re.compile(r'^(B\d|SB\d)', re.I)
TALL_CABINET    = re.compile(r'^(T\d|P\d|O\d|UTIL|REF\d|MICRO|OVD)', re.I)
VANITY_CABINET  = re.compile(r'^(V\d|VSB\d)', re.I)
FILLER_CABINET  = re.compile(r'^(UF\d|F\d)', re.I)

REJECT_PATTERNS = re.compile(
    r'^(\d+$|MIH|SARASOTA|MAGNOLIA|STANDARD|OPTIONAL|ELITE|BUILDING|SOLUTIONS|DESIGNER|BLUEPRINT|CEILING|INSTALLATION|PRINTED|DESIGNED|DRAWING|ALL|LAYOUT|ROOM|PROJECT|CLIENT|DATE|PAGE|SECTION)',
    re.I
)


def categorize_code(code: str, section_context: str = None) -> Optional[str]:
    """Return the BOM category for a cabinet code, respecting section and PDF type."""
    c = code.strip().upper()
    if not c or len(c) < 2 or len(c) > 30:
        return None
    if REJECT_PATTERNS.match(c):
        return None
    if is_non_cabinet(c):
        return None

    ctx = (section_context or "").upper().strip()

    # ── Section-forced overrides (highest priority) ──────────────────────────
    bucket = SECTION_TO_BUCKET.get(ctx)
    if bucket == 'vent_chase_material':
        return 'vent_chase_material'
    if bucket == 'opt_crown':
        return 'opt_crown'
    if bucket == 'bump':
        return 'bump'
    if bucket == 'opt_light_rail':
        return 'opt_light_rail'
    if bucket == 'island_bump':
        return 'island_bump'
    if bucket == 'island_hardware':
        return 'island_hardware'
    if bucket == 'hardware':
        return 'hardware'

    # ── Vent box rule: BACK-B48 / B48 anywhere near vent context ──────────────
    normalised_c = c.replace('-', '').replace(' ', '')
    if normalised_c in ('BACKB48', 'B48') or 'B48' in normalised_c:
        if 'VENT' in ctx or 'ACCESSORIES' in ctx:
            return 'vent_chase_material'

    # ── ISLAND section: route to island counterparts ─────────────────────────
    in_island = ctx in {k.upper() for k in ISLAND_SECTIONS}

    # ── Prefix-based classification ──────────────────────────────────────────
    if OPT_CROWN_RE.match(c):
        return 'opt_crown'
    if BUMP_RE.match(c):
        return 'island_bump' if in_island else 'bump'
    if OPT_LIGHT_RAIL_RE.match(c):
        return 'opt_light_rail'
    if PERIMETER_RE.match(c):
        # BTK, SM, FL etc. are accessories — island section → island array
        return 'island' if in_island else 'perimeter'
    if HARDWARE_KEYWORDS.match(c) or HARDWARE_PREFIXES.match(c):
        return 'island_hardware' if in_island else 'hardware'

    # Cabinet units (including fillers) always go to cabinets regardless of island section
    if FILLER_CABINET.match(c):
        return 'cabinets'

    # Section-contextual fallbacks
    if ctx == 'UNIVERSAL FILLERS':
        return 'cabinets'
    if ctx == 'OPTIONAL CROWN':
        return 'opt_crown'
    if ctx in ('BUMP/BOXING', 'BUMP BOXING'):
        return 'bump'

    if TALL_CABINET.match(c) or ctx == 'TALL CABINETS':
        return 'cabinets'
    if WALL_CABINET.match(c) or ctx == 'WALL CABINETS':
        return 'cabinets'
    if BASE_CABINET.match(c):
        if 'VENT' in ctx or 'ACCESSORIES' in ctx or 'OPT' in ctx:
            return 'vent_chase_material' if 'VENT' in ctx else 'perimeter'
        return 'cabinets'
    if VANITY_CABINET.match(c):
        return 'cabinets'

    # Appliances → perimeter (accessories slot)
    if APPLIANCE_CODES_RE.match(c):
        return 'island' if in_island else 'perimeter'

    # Generic fallback
    if VALID_PREFIXES.match(c) and any(ch.isdigit() for ch in c):
        return 'cabinets'

    return None


# ─── Code Sanitizer ───────────────────────────────────────────────────────────

VALID_MODIFIERS = {'BUTT', 'BLD', 'MD', 'BD', 'AS', 'SLD', 'FHD', 'DP'}


def sanitize_code(raw: str, pdf_type: str = PDF_TYPE_UNKNOWN) -> str:
    """Clean a raw extracted string into a proper SKU."""
    c = raw.strip()
    # Strip leading quantity prefix like "1-", "2-", "12-"
    c = re.sub(r'^\d+\s*[-]\s*', '', c)
    # Strip parenthetical notes like (DW), (VOIDS)
    c = re.sub(r'\s*\(.*?\)', '', c)

    c_upper = c.upper().strip()

    # DRH Express: preserve -L / -R hinge suffix
    if pdf_type == PDF_TYPE_DRH or re.search(r'-[LR]$', c_upper):
        m_lr = re.match(r'^([A-Z0-9]+)(-[LR])$', c_upper)
        if m_lr:
            prefix = re.sub(r'[^A-Z0-9]', '', m_lr.group(1))
            return f"{prefix}{m_lr.group(2)}"

    # Strip non-alphanumeric (spaces, dots, hyphens) except when part of DRH suffix
    c_upper = re.sub(r'[^A-Z0-9 ]', '', c_upper).strip()
    parts = c_upper.split()
    if not parts:
        return ''

    # If two parts and second is a known modifier, join them
    if len(parts) == 2 and parts[1] in VALID_MODIFIERS:
        c_upper = parts[0] + parts[1]
    else:
        c_upper = parts[0]

    # DRH Express equivalents
    if c_upper == 'TOEKICK8':
        return 'BTK8'
    if c_upper == 'MQR8':
        return 'SM8'

    return c_upper


# ─── Page-Level Extractor ─────────────────────────────────────────────────────

RAW_CODE_PATTERN = re.compile(
    r'\b([A-Z]{1,5}[\d.][-A-Z0-9.]*(?:\s+(?:BUTT|BLD|MD|BD|AS|SLD|DP))?)\b',
    re.IGNORECASE
)

QTY_PREFIX_PATTERN = re.compile(
    r'(\d+)\s*[-]\s*([A-Z]{1,5}[\d.][-A-Z0-9. ]*)',
    re.IGNORECASE
)

QTY_SUFFIX_PATTERN = re.compile(
    r'([A-Z]{1,5}[\d.][-A-Z0-9. ]*)\s*(?:\(|\bx\s*)(\d+)\b(?!\s*(?:DP\b|DEEP\b|IN\b|INCH\b|\'))',
    re.IGNORECASE
)


def extract_page_items(text: str, pdf_type: str = PDF_TYPE_UNKNOWN) -> List[Dict[str, Any]]:
    """
    Extract (code, quantity, section) triplets from a single page.
    Splits text by section headers to maintain context.
    """
    items = []

    segments: List[Tuple[str, str]] = []
    last_end = 0
    current_section = "General"

    for m in SECTION_PATTERN.finditer(text):
        segments.append((current_section, text[last_end:m.start()]))
        current_section = m.group(0).upper().strip()
        last_end = m.end()
    segments.append((current_section, text[last_end:]))

    for section_name, section_text in segments:
        seen_codes: Dict[str, int] = {}

        # Pass 1: quantity-prefix "3-W3042"
        for m in QTY_PREFIX_PATTERN.finditer(section_text):
            qty = int(m.group(1))
            code = sanitize_code(m.group(2), pdf_type)
            if code and len(code) >= 2 and not REJECT_PATTERNS.match(code):
                seen_codes[code] = seen_codes.get(code, 0) + qty

        # Pass 2: quantity-suffix "W3042 (3)" / "W3042 x3"
        for m in QTY_SUFFIX_PATTERN.finditer(section_text):
            code = sanitize_code(m.group(1), pdf_type)
            qty = int(m.group(2))
            if code and len(code) >= 2 and not REJECT_PATTERNS.match(code):
                if code not in seen_codes:
                    seen_codes[code] = qty

        # Pass 3: standalone occurrences
        standalone: Dict[str, int] = {}
        for m in RAW_CODE_PATTERN.finditer(section_text):
            code = sanitize_code(m.group(1), pdf_type)
            if code and len(code) >= 2 and code not in seen_codes and not REJECT_PATTERNS.match(code):
                standalone[code] = standalone.get(code, 0) + 1
        seen_codes.update(standalone)

        for code, qty in seen_codes.items():
            items.append({'code': code, 'quantity': qty, 'section': section_name})

    return items


# ─── Flags ────────────────────────────────────────────────────────────────────

def build_flags(rooms_map: Dict[str, dict], wellborn_no_codes: bool) -> List[dict]:
    flags = []

    if wellborn_no_codes:
        flags.append({
            "code": "ALL",
            "issue": "Cabinet codes not found in PDF. This is a visual binder only.",
            "action": "Separate specification document required for cabinet codes.",
            "severity": "ERROR",
        })
        return flags

    for room_name, room in rooms_map.items():
        # Flag BACK-B48 if it slipped into cabinets
        for item in room.get('cabinets', []):
            c = item['code'].upper().replace('-', '')
            if c in ('BACKB48', 'B48') or 'BACKB48' in c:
                flags.append({
                    "code": item['code'],
                    "issue": f"BACK-B48 found in 'cabinets' for room '{room_name}'",
                    "action": "Moved to vent_chase_material",
                    "severity": "WARNING",
                })

    return flags


# ─── Main Extraction Function ─────────────────────────────────────────────────

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


def _post_fix_vent_box(rooms_map: Dict[str, dict]) -> None:
    """Move any BACK-B48 / B48 that landed in cabinets into vent_chase_material."""
    for room in rooms_map.values():
        keep = []
        for item in room.get('cabinets', []):
            c = item['code'].upper().replace('-', '')
            if c in ('BACKB48', 'B48') or c.endswith('B48'):
                room['vent_chase_material'].append(item)
            else:
                keep.append(item)
        room['cabinets'] = keep


def extract_rooms_rule_based(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Fully local, API-key-free extraction of cabinet codes from a PDF.

    Phase 1 — Detect PDF type (Elite, DRH Express, Wellborn, Custom)
    Phase 2 — Detect Trim List presence
    Phase 3 — Per-page section-aware extraction
    Phase 4 — Categorize codes with NKBA rules
    Phase 5 — Merge rooms by canonical name
    Phase 6 — Post-fix vent-box misclassifications
    Phase 7 — Build flags
    """
    rooms_map: Dict[str, dict] = {}
    rooms_qty: Dict[str, Dict[str, Dict[str, int]]] = {}
    has_text = False
    last_room_name = None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')

        # ── Phase 1 & 2: collect full text for type detection ──
        all_pages_text = []
        for page in doc:
            all_pages_text.append(page.get_text())
        full_text = "\n".join(all_pages_text)

        pdf_type       = detect_pdf_type(full_text)
        trim_list_flag = has_trim_list(full_text)
        print(f"[rule-extract] PDF type: {pdf_type}, Trim List: {trim_list_flag}")

        # Wellborn binder — no codes to extract
        if pdf_type == PDF_TYPE_WELLBORN:
            doc.close()
            return {
                'success': True,
                'rooms': [],
                'method': 'rule-based-local',
                'pdf_type': pdf_type,
                'has_trim_list': False,
                'flags': build_flags({}, wellborn_no_codes=True),
                'pages_processed': 0,
                'note': 'Cabinet codes not found. Visual binder only. Separate specification document required.',
            }

        # ── Phase 3-4: per-page extraction ────────────────────────────────────
        for page_num, page in enumerate(doc):
            text = all_pages_text[page_num]
            if not text.strip():
                continue
            has_text = True

            room_name = detect_room_name(text)
            if not room_name:
                if last_room_name:
                    room_name = last_room_name
                    print(f"[rule-extract] Page {page_num + 1}: no room found, continuing with '{room_name}'")
                else:
                    room_name = 'KITCHEN'
                    print(f"[rule-extract] Page {page_num + 1}: defaulting to KITCHEN")
            last_room_name = room_name

            if room_name not in rooms_map:
                rooms_map[room_name] = EMPTY_ROOM(room_name)
                rooms_qty[room_name] = {cat: {} for cat in _ALL_CATS}

            items = extract_page_items(text, pdf_type=pdf_type)
            print(f"[rule-extract] Page {page_num + 1} ({room_name}): {len(items)} items")

            for item in items:
                code     = item['code']
                qty      = item['quantity']
                section  = item.get('section', 'General')
                category = categorize_code(code, section_context=section)
                if category:
                    cat_dict = rooms_qty[room_name][category]
                    # Take the maximum qty seen for the same code in the same category
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
            'method': 'rule-based-local',
        }

    # ── Phase 5: convert accumulators to list format ──────────────────────────
    for room_name, cat_dicts in rooms_qty.items():
        for cat, code_qty in cat_dicts.items():
            rooms_map[room_name][cat] = [{'code': c, 'quantity': q} for c, q in code_qty.items()]

    # ── Phase 6: post-fix vent box misclassifications ─────────────────────────
    _post_fix_vent_box(rooms_map)

    rooms = list(rooms_map.values())
    rooms = [r for r in rooms if any(len(r[cat]) > 0 for cat in ['cabinets', 'hardware', 'perimeter', 'island', 'bump', 'opt_crown', 'opt_light_rail', 'vent_chase_material'])]

    # ── Phase 7: flags ────────────────────────────────────────────────────────
    flags = build_flags(rooms_map, wellborn_no_codes=False)

    print(f"[rule-extract] Complete. {len(rooms)} rooms, {len(flags)} flags. PDF type: {pdf_type}")
    return {
        'success': True,
        'rooms': rooms,
        'method': 'rule-based-local',
        'pdf_type': pdf_type,
        'has_trim_list': trim_list_flag,
        'flags': flags,
        'pages_processed': len(rooms_map),
    }
