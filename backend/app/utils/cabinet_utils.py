import re

# ──────────────────────────────────────────────────────────────────────────────
# NKBA Cabinet Type Taxonomy
# Maps every recognised prefix (upper-case) to a canonical cabinet_type label
# that is later used to scope the "closest-size" search.
# ──────────────────────────────────────────────────────────────────────────────
CABINET_TYPE_MAP = {
    # Wall Cabinets
    "W":    "Wall Cabinet",
    "WB":   "Wall Cabinet with Blind",
    "WC":   "Wall Corner Cabinet",
    "WDC":  "Wall Diagonal Corner Cabinet",
    "WLS":  "Wall Lazy Susan",
    "WR":   "Wall Refrigerator Cabinet",
    "WO":   "Wall Oven Cabinet",
    "WAC":  "Wall Asymmetric Corner Cabinet",
    "WANGL":"Wall Angle Cabinet",
    "WBC":  "Wall Blind Corner Cabinet",

    # Base Cabinets
    "B":    "Base Cabinet",
    "BBC":  "Base Blind Corner Cabinet",
    "BC":   "Base Corner Cabinet",
    "BDC":  "Base Diagonal Corner Cabinet",
    "BFH":  "Base Full Height Cabinet",
    "BLS":  "Base Lazy Susan",
    "LS":   "Lazy Susan Cabinet",
    "BAC":  "Base Asymmetric Corner Cabinet",
    "LBC":  "Lazy Susan Base Corner",

    # Sink / Appliance Bases
    "SB":   "Sink Base",
    "SBN":  "Sink Base",
    "DB":   "Dishwasher Base",
    "DW":   "Dishwasher Return",
    "RB":   "Range Base",

    # Vanity Cabinets
    "V":    "Vanity Base",
    "VSB":  "Vanity Sink Base",
    "VDB":  "Vanity Double Base",
    "VB":   "Vanity Base",
    "V3S":  "Vanity 3-Stack Drawer",

    # Tall / Pantry / Oven / Utility
    "T":    "Tall Cabinet",
    "P":    "Pantry Cabinet",
    "O":    "Oven Cabinet",
    "OVD":  "Oven Tall Cabinet",
    "UTIL": "Utility Cabinet",
    "UT":   "Utility Cabinet",
    "U":    "Utility Cabinet",
    "REF":  "Refrigerator Cabinet",
    "MICRO":"Microwave Cabinet",

    # Specialty / Drawer Bases
    "S":    "Specialty Cabinet",
    "S3S":  "Specialty 3-Stack Cabinet",
    "SD":   "Specialty Double Cabinet",
    "B3S":  "Base 3-Stack Drawer",
    "B4S":  "Base 4-Stack Drawer",
    "DWR":  "Drawer Base",
    "DR":   "Drawer Base",

    # Fillers
    "UF":   "Universal Filler",
    "F":    "Filler",
    "WF":   "Wall Filler",
    "BF":   "Base Filler",
    "TF":   "Tall Filler",
    "VF":   "Vanity Filler",

    # Molding & Trim
    "CM":   "Crown Molding",
    "OCM":  "Outside Corner Molding",
    "SCM":  "Scribe Molding",
    "BTK":  "Base Toe Kick",
    "SHM":  "Shaker Molding",
    "SM":   "Shoe Molding",
    "QM":   "Quarter Round Molding",
    "DM":   "Door Molding",
    "PM":   "Panel Molding",
    "TK":   "Toe Kick",
    "LR":   "Light Rail",
    "RR":   "Return Rail",
    "FL":   "Filler Light Rail",
    "HWC":  "Hardware Cleat / Nailer",
    "CROWN":"Crown Molding",
    "LIGHT RAIL": "Light Rail",
    "SCRBE":"Scribe Bead",
    "SCRM": "Scribe Molding",
    "WTEP": "Wall Toe End Panel",
    "TEP":  "End Panel",
    "EP":   "End Panel",

    # Hardware / Accessories
    "HW":   "Hardware",
    "BACK": "Cabinet Back",
    "BACKB":"Cabinet Back",
    "BACKF":"Cabinet Back",
    "FBP":  "Finished Back Panel",
    "SHELF":"Shelf",
}

# Prefixes sorted longest-first so "VSB" matches before "V", "SB" before "S", etc.
_SORTED_PREFIXES = sorted(CABINET_TYPE_MAP.keys(), key=len, reverse=True)


# ──────────────────────────────────────────────────────────────────────────────
# INTEGRITY-SPECIFIC PREFIX NORMALISATION
#
# Integrity Cabinets uses slightly different codes than NKBA standard.
# e.g.  "S3324" (Integrity) ≈ "B3324" (NKBA sink/base variant)
#       "S3S396" = "3-Stack 39×96" pantry variant
# This map translates drawing-PDF prefixes → Integrity-catalog prefixes so the
# dimension engine can find nearest matches inside the Integrity price book.
# ──────────────────────────────────────────────────────────────────────────────
INTEGRITY_PREFIX_ALIASES = {
    # Integrity uses "S" for certain sink-base / specialty codes
    "S3S": "P",    # 3-stack tall/pantry
    "S":   "B",    # Generic specialty → base (Integrity catalog uses B)
    "OVD": "O",    # Oven-tall → Oven cabinet prefix in Integrity
    "HOOD": "W",   # Hood cabinet sits above range, priced as wall
    "BACK": "FBP", # Drawing BACK -> Integrity FBP
    "BACKB":"FBP",
    "BACKF":"FBP",
    "LS":  "BLS",  # Lazy Susan -> Base Lazy Susan
    "WF":  "UF",   # Wall Filler -> Universal Filler
    "BF":  "UF",   # Base Filler -> Universal Filler
    "TF":  "UF",   # Tall Filler -> Universal Filler
    "VF":  "UF",   # Vanity Filler -> Universal Filler
    "B3S": "DB",   # Base 3-stack -> Drawer Base
    "B4S": "DB",   # Base 4-stack -> Drawer Base
    "V3S": "VDB",  # Vanity 3-stack -> Vanity Drawer Base
}


# Integrity & Wellborn append finish/door type suffixes to base codes.
INTEGRITY_CATALOG_SUFFIXES = re.compile(
    r'\s*(FHDDDLX|FHDSDLX|BDFHD|MDBD|SFHD|SDLX|DDLX|FHD|BLD|DWR|DW|MDBD|BD|BUTTDOOR|BUTT|MD|SD|SS|AL|SW|C|S|V|H|VENTBOX|VENT|BOX|AS|BS|CS|LS)$',
    re.IGNORECASE
)

# ──────────────────────────────────────────────────────────────────────────────
# DRAWING PDF SUFFIX BRIDGE
# Maps suffixes found in NKBA drawing PDFs to Integrity catalog suffixes.
# "BUTT" on a drawing = butt-door cabinet = "BD" in Integrity catalog.
# ──────────────────────────────────────────────────────────────────────────────
DRAWING_SUFFIX_TO_CATALOG = {
    'BUTT DOOR': 'BD',
    'BUTT':      'BD',
    'BD':        'BD',
    'LH':        'L',
    'RH':        'R',
    'L':         'L',
    'R':         'R',
}

# ──────────────────────────────────────────────────────────────────────────────
# NKBA CABINET SECTION RULES
# Maps cabinet type label → which section it belongs to.
# Used to cross-validate that a PDF code is in the right section of the catalog.
# Per NKBA standards:
#   Wall: upper cabinets (installed at 54" AFF), W prefix, standard heights 12,15,18,24,30,36,42"
#   Base: lower cabinets (34.5" standard height), B/SB/BBC prefix, standard depth 24"
#   Tall: floor-to-ceiling, T/P/O/UTIL/REF prefix, standard heights 84,90,96"
# ──────────────────────────────────────────────────────────────────────────────
CABINET_SECTIONS = {
    "Wall Cabinet":             "Wall",
    "Wall Cabinet with Blind":  "Wall",
    "Wall Corner Cabinet":      "Wall",
    "Wall Diagonal Corner Cabinet": "Wall",
    "Wall Lazy Susan":          "Wall",
    "Wall Refrigerator Cabinet":"Wall",
    "Wall Oven Cabinet":        "Wall",
    "Wall Asymmetric Corner Cabinet": "Wall",
    "Wall Angle Cabinet":       "Wall",
    "Wall Blind Corner Cabinet":"Wall",

    "Base Cabinet":             "Base",
    "Base Blind Corner Cabinet":"Base",
    "Base Corner Cabinet":      "Base",
    "Base Diagonal Corner Cabinet": "Base",
    "Base Full Height Cabinet": "Base",
    "Base Lazy Susan":          "Base",
    "Lazy Susan Cabinet":       "Base",
    "Base Asymmetric Corner Cabinet": "Base",
    "Lazy Susan Base Corner":   "Base",
    "Sink Base":                "Base",
    "Dishwasher Base":          "Appliance",
    "Dishwasher Return":        "Appliance",
    "Range Base":               "Base",
    "Base 3-Stack Drawer":      "Base",
    "Base 4-Stack Drawer":      "Base",
    "Drawer Base":              "Base",

    "Vanity Base":              "Vanity",
    "Vanity Sink Base":         "Vanity",
    "Vanity Double Base":       "Vanity",
    "Vanity 3-Stack Drawer":    "Vanity",

    "Tall Cabinet":             "Tall",
    "Pantry Cabinet":           "Tall",
    "Oven Cabinet":             "Tall",
    "Oven Tall Cabinet":        "Tall",
    "Utility Cabinet":          "Tall",
    "Refrigerator Cabinet":     "Tall",
    "Microwave Cabinet":        "Tall",

    "Specialty Cabinet":        "Specialty",
    "Specialty 3-Stack Cabinet":"Specialty",
    "Specialty Double Cabinet": "Specialty",

    "Universal Filler":         "Filler",
    "Filler":                   "Filler",
    "Wall Filler":              "Filler",
    "Base Filler":              "Filler",
    "Tall Filler":              "Filler",
    "Vanity Filler":            "Filler",

    "Crown Molding":            "Molding",
    "Outside Corner Molding":   "Molding",
    "Scribe Molding":           "Molding",
    "Base Toe Kick":            "Molding",
    "Shaker Molding":           "Molding",
    "Shoe Molding":             "Molding",
    "Quarter Round Molding":    "Molding",
    "Door Molding":             "Molding",
    "Panel Molding":            "Molding",
    "Toe Kick":                 "Molding",
    "Light Rail":               "Molding",
    "Return Rail":              "Molding",
    "Filler Light Rail":        "Molding",
    "Hardware Cleat / Nailer":  "Molding",
    "Scribe Bead":              "Molding",
    "Wall Toe End Panel":       "Molding",
    "End Panel":                "Molding",
    "Hardware":                 "Hardware",
    "Cabinet Back":             "Hardware",
    "Finished Back Panel":      "Hardware",
    "Shelf":                    "Hardware",
}

# NKBA standard dimension ranges for sanity checks
NKBA_STANDARD_DIMS = {
    "Wall": {
        "heights": [12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42],
        "widths":  [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48],
    },
    "Base": {
        "heights": [34],  # standard 34.5" → 34 in code
        "widths":  [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48],
    },
    "Tall": {
        "heights": [84, 90, 96],
        "widths":  [18, 21, 24, 27, 30, 33, 36],
    },

}


def clean_sku_for_display(sku: str) -> str:
    if not sku:
        return ''
    return str(sku).upper().strip()


def normalize_sku(sku: str) -> str:
    if not sku:
        return ''
    # Keep spaces to preserve suffixes like "BUTT" for normalization
    return re.sub(r'[^A-Z0-9\s]', '', str(sku).upper()).strip()


def compress_sku(sku: str) -> str:
    if not sku:
        return ''
    return re.sub(r'[^A-Z0-9]', '', str(sku).upper())


def normalize_collection_name(col: str) -> str:
    """
    Normalize a collection name so encoding differences and catalog-specific
    parenthetical suffixes do not prevent matching.

    Examples:
      "Premium Maple (Durafrom Textured)"  -> "PREMIUM MAPLE"
      "ELITE CHERRY (NON TEXTURED)"        -> "ELITE CHERRY"
      "CLASSIC SERIES - 24 DEEP LIST"      -> "CLASSIC SERIES"
      "CHOICE DURAFORM"                    -> "CHOICE DURAFORM"
    """
    if not col:
        return ''
    s = str(col).upper().strip()
    # Replace non-ASCII inch/quote markers with plain double quote
    s = re.sub(r'["“”â€œ]', '"', s)
    # Strip parenthetical qualifiers like "(DURAFROM TEXTURED)", "(NON TEXTURED)", "(TEXTURED)"
    s = re.sub(r'\s*\([^)]*\)', '', s).strip()
    # Strip depth/price suffixes like "- 24 DEEP LIST PRICE", "- 18 IN", etc.
    s = re.sub(r'\s*-\s*\d+["”]?\s*(DEEP|IN|INCH).*', '', s)
    # Remove newlines
    s = s.split('\n')[0].strip()
    return s
# ──────────────────────────────────────────────────────────────────────────────
# Cabinet-type classifier
# ──────────────────────────────────────────────────────────────────────────────

def classify_cabinet_type(sku: str) -> str | None:
    """
    Returns the canonical cabinet type label for a given SKU prefix.
    Returns None for completely unknown codes (accessories, garbage strings, etc.).

    Examples:
        "W3042"     → "Wall Cabinet"
        "VSB3634H"  → "Vanity Sink Base"
        "SB36"      → "Sink Base"
        "BTK8"      → "Base Toe Kick"
        "OCM8 BLD"  → "Outside Corner Molding"
        "REF 2D 36" → "Refrigerator Cabinet"
    """
    s = str(sku or "").upper().strip()
    # Strip annotation suffixes in parens/braces/brackets
    s = re.sub(r'[\(\{\[].*?[\)\}\]]', '', s).strip()
    # Remove common directional/orientation suffixes before matching prefix
    s = re.sub(r'\s+(BUTT|H|L|R|FL|S|D)$', '', s).strip()
    # Collapse all non-alpha-numeric to nothing for pure prefix extraction
    clean = re.sub(r'[^A-Z0-9]', '', s)

    for prefix in _SORTED_PREFIXES:
        p_clean = re.sub(r'[^A-Z0-9]', '', prefix)
        if clean.startswith(p_clean):
            # Extra guard: the char after the prefix must be a digit or end-of-string
            remainder = clean[len(p_clean):]
            if not remainder or remainder[0].isdigit():
                return CABINET_TYPE_MAP[prefix]

    return None  # Unknown / accessory


def get_cabinet_section(sku: str) -> str | None:
    """
    Returns the section (Wall/Base/Tall/Vanity/Molding/etc.) for a SKU.
    Used for cross-validation during nearest-match to ensure we stay in the right section.
    """
    cabinet_type = classify_cabinet_type(sku)
    if cabinet_type:
        return CABINET_SECTIONS.get(cabinet_type)
    return None


def strip_catalog_suffix(sku: str) -> str:
    """
    Remove Integrity-specific finish/door suffixes from a catalog SKU so
    dimension matching works against the base code.
    e.g.  W3042BD → W3042,  B30BDFHD → B30,  W3036MDBD → W3036
    """
    return INTEGRITY_CATALOG_SUFFIXES.sub('', sku.upper().strip()).strip()


def strip_drawing_suffix(sku: str) -> str:
    """
    Remove NKBA drawing suffixes (BUTT, H, L, R, etc.) from a PDF SKU.
    e.g.  W3042BUTT → W3042,  B30 BUTT → B30,  W2442 H → W2442, BACKB48VENTBOX -> BACKB48
    """
    s = sku.upper().strip()
    # Remove spaced suffixes: "W3042 BUTT" → "W3042"
    s = re.sub(r'\s+(BUTT DOOR|BUTT|BD|LH|RH|H|L|R|FL|S|D|VENTBOX|VENT|BOX|DW|DWR)$', '', s)
    # Remove concatenated suffixes: "W3042BUTT" → find where digits end
    s = re.sub(r'^([A-Z]+)(\d+)(BUTT|BD|LH|RH|VENTBOX|VENT|BOX|DW|DWR)$', r'\1\2', s)
    return s.strip()
def is_primary_cabinet(sku: str) -> bool:
    s = str(sku or "").upper().strip()
    if not s:
        return False

    primary_prefixes = [
        'W',    # Wall
        'B',    # Base
        'SB',   # Sink Base
        'VSB',  # Vanity Sink Base
        'V',    # Vanity
        'T',    # Tall
        'P',    # Pantry
        'O',    # Oven
        'REF',  # Refrigerator Cabinet
        'DW',   # Dishwasher Return
        'MICRO', # Microwave Cabinet
        'UF'    # Universal Fillers
    ]

    for p in primary_prefixes:
        # Matches prefix followed by numbers (e.g., W3042, B24, UF3)
        regex = rf'^{p}\d+'
        if re.match(regex, s, re.IGNORECASE) or (p == 'UF' and s.startswith('UF')):
            return True
    return False


def detect_category(sku: str) -> str:
    if not sku: return 'Accessories'
    s = str(sku or "").upper().strip()

    # NEW: Handle Estimation/Fallback SKUs (seeded via seed_standard_styles.py)
    if s.endswith('-EST') or s.endswith(' EST.'):
        if s.startswith('W'): return 'Wall Cabinets'
        if s.startswith('B') or s.startswith('SB'): return 'Base Cabinets'
        if s.startswith('V'): return 'Vanity Cabinets'
        if s.startswith('T') or s.startswith('P') or s.startswith('O') or s.startswith('UTIL') or s.startswith('REF'): return 'Tall Cabinets'
        if s.startswith('UF'): return 'Universal Fillers'

    # 0. SPECIFIC ACCESSORIES (Priority keyword matching)
    accessory_keywords = ['TOUCHUP', 'KIT', 'SPRAY', 'GLUE', 'FILL', 'DISH-IQ', 'DWR3', 'RANGE', 'HOOD', 'DOORS', 'DRAWERS', 'SHELF', 'WTEP']
    if any(k in s for k in accessory_keywords):
        return 'Accessories'

    # 1. Specialized: Molding & Trim (Priority)
    molding_pattern = r'^(CM|M|RR|OCM|SCM|BTK|SHM|SKM|SM|QM|DM|PM|TK|SCRBE|SCRM|Scribe|Crown|Base Molding|Outside Corner|Shoe|LR|LIGHT RAIL|FL|HWC|CROWN|LIGHT)'
    if re.match(molding_pattern, s, re.IGNORECASE):
        return 'Molding & Trim'

    # 2. Universal Fillers
    if s.startswith(('UF', 'F', 'WF', 'BF', 'TF', 'VF')) or 'FILLER' in s:
        return 'Universal Fillers'

    # 3. Vanity Cabinets (Check before Base)
    if s.startswith(('V', 'VB', 'VSB', 'VDB', 'V3S')) or 'VANITY' in s:
        return 'Vanity Cabinets'

    # 4. Wall Cabinets
    if s.startswith(('W', 'WC', 'WB', 'WDC', 'WR', 'WO', 'WLS', 'WAC', 'WANGL', 'WBC')) or 'WALL' in s:
        return 'Wall Cabinets'

    # 5. Sink Bases (Check before generic Base)
    if s.startswith('SB') or 'SINK' in s:
        return 'Base Cabinets'

    # 6. Base Cabinets (Standard)
    # Using regex ^B\d to avoid matching BTK
    if s.startswith(('B', 'LS', 'BLS', 'LBC', 'BAC', 'BC', 'BBC', 'BDC', 'BFH', 'B3S', 'B4S', 'DB', 'DWR', 'DR')) and (len(s) <= 2 or s[1].isdigit() or s[2].isdigit() or s.startswith(('LS', 'BLS', 'LBC', 'BAC'))):
        return 'Base Cabinets'

    # 7. Tall Cabinets (Pantry, Oven, Utility, Refrigerator)
    tall_prefixes = ['T', 'P', 'O', 'UTIL', 'UT', 'U', 'REF', 'OVD']
    if any(s.startswith(p) for p in tall_prefixes) or 'TALL' in s:
        return 'Tall Cabinets'

    # 8. Hardwares (HWC is Molding, only HW[^C] is Hardwares)
    if (s.startswith('HW') and not s.startswith('HWC')) or s.startswith('BACK') or s.startswith('FBP') or 'KNOB' in s or 'PULL' in s or 'HINGE' in s:
        return 'Hardwares'

    return 'Accessories'


def parse_sku_dimensions(sku: str) -> dict:
    """Parse dimensions from a cabinet SKU string.
    Handles standard NKBA codes (W3042, B30) as well as
    dimension-encoded codes like HWC 2X4X96 or HWC 1X2X94.
    IMPORTANT: For Integrity catalog SKUs that have finish/door suffixes
    (BD, MDBD, BDFHD, etc.), we strip those first so dimensions parse correctly.
    e.g. W3042MDBD → parse as W3042 → width=30, height=42
         W3042BD   → parse as W3042 → width=30, height=42
    """
    if not sku: return {'prefix': None, 'width': None, 'height': None, 'depth': None}
    s = str(sku).upper().strip()
    # Strip annotation suffixes in parens/braces
    s = re.sub(r'[\(\{\[].*?[\)\}\]]', '', s).strip()

    # ── Strip Integrity catalog suffixes before parsing dimensions ──
    # This ensures W3042BD → W3042, W3036MDBD → W3036
    s_stripped = INTEGRITY_CATALOG_SUFFIXES.sub('', s).strip()
    # Use stripped for dimension parsing if it still has digits
    if s_stripped and re.search(r'\d', s_stripped):
        s = s_stripped

    # ── Pattern C-UT: Utility/Tall with X separator (UT3624 X 93, UT1224 X 84) ──
    # Format: Prefix + Width(2) + Depth(2) + "X" + Height(2)
    clean = re.sub(r'[^A-Z0-9\s]', '', s) # Keep spaces for NxN patterns
    ut_x_m = re.match(r'^(UT|U|T|P)(\d{2})(\d{2})\s*[Xx]\s*(\d{2})', clean)
    if ut_x_m:
        return {
            'prefix': ut_x_m.group(1),
            'width': int(ut_x_m.group(2)),
            'height': int(ut_x_m.group(4)),
            'depth': int(ut_x_m.group(3)),
        }

    # ── Pattern C-REF: Refrigerator codes with door count (REF2D36, REF3D48) ──
    # REF + N doors + D + width — the "N" is door count, NOT the cabinet width
    ref_door_m = re.match(r'^(REF)(\d+)D(\d{2,3})', clean.replace(" ", ""))
    if ref_door_m:
        return {
            'prefix': 'REF',
            'width': int(ref_door_m.group(3)),  # actual width after "D"
            'height': None,
            'depth': None,
        }

    # ── Pattern A: NxNxN format (HWC 2X4X96, HWC 1X2X94) ──
    m3 = re.search(r'(\d+)\s*[Xx]\s*(\d+)\s*[Xx]\s*(\d+)', s)
    if m3:
        prefix_m = re.match(r'^([A-Z]+)', s)
        prefix = prefix_m.group(1) if prefix_m else None
        return {
            'prefix': prefix,
            'width': int(m3.group(1)),
            'height': int(m3.group(2)),
            'depth': int(m3.group(3)),
        }

    # ── Pattern B: NxN format ──
    m2 = re.search(r'(\d+)\s*[Xx]\s*(\d+)', s)
    if m2:
        prefix_m = re.match(r'^([A-Z]+)', s)
        prefix = prefix_m.group(1) if prefix_m else None
        return {
            'prefix': prefix,
            'width': int(m2.group(1)),
            'height': int(m2.group(2)),
            'depth': None,
        }

    # ── Pattern C-UF: Universal Filler codes (UF342, UF642, UF392, UF0342) ──
    # UF codes encode: UF + width(1-2 digits) + height(2 digits)
    # Integrity catalog uses zero-padded: UF0342 = 3" wide × 42" tall
    # Integrity also appends side suffixes: UF3DW, UF642DWR — strip alpha tail
    uf_clean = re.sub(r'[^A-Z0-9]', '', s)
    uf_match = re.match(r'^(UF)(0?)(\d{1,2})(\d{2})(?:[A-Z]+)?$', uf_clean)
    if uf_match:
        return {
            'prefix': 'UF',
            'width': int(uf_match.group(3)),   # e.g. 3 or 6
            'height': int(uf_match.group(4)),  # e.g. 42 or 92
            'depth': None,
        }
    # UF with only width (UF3 = 3" filler, UF3DW = dishwasher-side filler)
    uf_w_only = re.match(r'^(UF)(\d{1,2})(?:[A-Z]+)?$', uf_clean)
    if uf_w_only:
        return {
            'prefix': 'UF',
            'width': int(uf_w_only.group(2)),
            'height': None,
            'depth': None,
        }

    # ── Pattern C: Standard NKBA (W3042, B30, SB36) ──
    # Also handles drawing suffixes: W3042BUTT → clean to W3042 first
    clean_no_draw_sfx = re.sub(r'(BUTT|BUTTDOOR)$', '', clean).strip()
    match = re.search(r'^([A-Z]+)(\d{1,2})(\d{2})?(\d{2})?', clean_no_draw_sfx or clean)
    if not match: return {'prefix': None, 'width': None, 'height': None, 'depth': None}

    prefix = match.group(1)
    w = match.group(2)
    h = match.group(3)
    d = match.group(4)

    return {
        'prefix': prefix,
        'width': int(w) if w else None,
        'height': int(h) if h else None,
        'depth': int(d) if d else None
    }


# ──────────────────────────────────────────────────────────────────────────────
# INTELLIGENT DIMENSION-BASED NEAREST-CABINET FINDER
# Used by the INTEGRITY (and any manufacturer) pricing engine when no exact
# SKU match is found but we can decode the cabinet type + dimensions.
# ──────────────────────────────────────────────────────────────────────────────

def find_nearest_cabinet_match(
    target_sku: str,
    catalog_skus: list[dict],
    collection_filter: str | None = None,
    manufacturer_hint: str | None = None,
) -> dict | None:
    """
    Given a target SKU (from the drawing PDF) and the full manufacturer catalog,
    find the closest-size cabinet of the SAME cabinet type AND section.

    SMART MATCHING ALGORITHM v2:
    ─────────────────────────────
    1.  Classify the target's cabinet TYPE (Wall, Base, Sink Base, etc.)
        and SECTION (Wall/Base/Tall/Vanity/Molding).
    2.  Parse target dimensions, stripping drawing suffixes (BUTT → BD, etc.)
    3.  Apply Integrity-specific prefix aliases if needed.
    4.  Filter catalog candidates:
        a. Must share the same SECTION (Wall cabs only match Wall cabs)
        b. Collection filter uses normalized fuzzy name matching, not literal string
        c. Falls back gracefully to any-collection if no collection match found
    5.  Score candidates by dimension distance:
        - Primary dimension penalty (×3 weight): width for Wall/Base, height for Tall
        - Secondary dimension penalty (×1 weight)
        - Exact-match bonus (score 0) for perfect dimension match
    6.  Return the catalog item with the lowest weighted score.

    Parameters
    ----------
    target_sku      : The drawing-PDF cabinet code (e.g. "W3042", "VSB3634H", "W3042BUTT")
    catalog_skus    : List of dicts with keys: sku, price, collection_name, door_style
    collection_filter : Raw collection name string from room; will be normalized
    manufacturer_hint : "integrity" to enable Integrity-specific alias mappings

    Returns
    -------
    The best-matching catalog dict, or None if no cabinet-type match found.
    """
    if not target_sku or not catalog_skus:
        return None

    # 1. Strip drawing suffixes first (BUTT, H, L, R) to get clean code
    clean_target = strip_drawing_suffix(target_sku)

    # 1a. Parse target dimensions
    target_dims = parse_sku_dimensions(clean_target)
    target_type = classify_cabinet_type(clean_target)

    if target_type is None:
        # Try the original as last resort
        target_type = classify_cabinet_type(target_sku)
        if target_type is None:
            return None  # Unknown type – cannot do a meaningful nearest-match

    target_section = CABINET_SECTIONS.get(target_type, '')
    target_prefix = target_dims.get('prefix') or ''
    target_w = target_dims.get('width')
    target_h = target_dims.get('height')

    # 2. Apply Prefix aliases — translate drawing prefix to catalog standard
    # e.g. "OVD" (Oven Vertical Door) -> "O" (Oven Cabinet)
    GLOBAL_PREFIX_ALIASES = {
        "OVD": "O",
        "S3S": "P",
        "REF2D": "REF",
        "REF3D": "REF",
        "REF": "UT",  # Refrigerator cabinets often match Utility cabinets in catalogs
        "REP": "REF",
        "REFP": "REF",
    }
    
    effective_prefix = target_prefix
    if effective_prefix in GLOBAL_PREFIX_ALIASES:
        effective_prefix = GLOBAL_PREFIX_ALIASES[effective_prefix]
    elif manufacturer_hint and 'integrity' in manufacturer_hint.lower():
        for alias_from, alias_to in INTEGRITY_PREFIX_ALIASES.items():
            if target_prefix.startswith(alias_from):
                effective_prefix = alias_to + target_prefix[len(alias_from):]
                break


    # ─── Sub-type groupings for strict same-prefix matching ───────────────────
    # We group similar types together so they can match each other during nearest-size search.
    BASE_CABINET_TYPES  = {"Base Cabinet", "Base Blind Corner Cabinet",
                           "Base Corner Cabinet", "Base Diagonal Corner Cabinet",
                           "Base Full Height Cabinet", "Base 3-Stack Drawer", "Base 4-Stack Drawer", "Drawer Base"}
    SINK_BASE_TYPES     = {"Sink Base"}
    VANITY_BASE_TYPES   = {"Vanity Base", "Vanity Sink Base", "Vanity Double Base", "Vanity 3-Stack Drawer"}
    CORNER_CABINET_TYPES = {"Base Corner Cabinet", "Base Blind Corner Cabinet", "Base Diagonal Corner Cabinet", 
                            "Wall Corner Cabinet", "Wall Diagonal Corner Cabinet", "Wall Blind Corner Cabinet",
                            "Wall Lazy Susan", "Base Lazy Susan", "Lazy Susan Cabinet", "Lazy Susan Base Corner",
                            "Wall Asymmetric Corner Cabinet", "Base Asymmetric Corner Cabinet", "Wall Angle Cabinet"}
    FILLER_TYPES        = {"Universal Filler", "Filler", "Wall Filler", "Base Filler", "Tall Filler", "Vanity Filler"}
    TALL_TYPES          = {"Tall Cabinet", "Pantry Cabinet", "Oven Cabinet", "Oven Tall Cabinet", "Utility Cabinet", "Refrigerator Cabinet"}

    # 3. Find same-SECTION candidates in the catalog
    # Use pre-indexed section rows if 'lookup_maps' was provided (faster)
    # the catalog_skus argument can now be a list OR a dict (lookup_maps)
    section_candidates = []
    if isinstance(catalog_skus, dict) and 'section_rows' in catalog_skus:
        # Fast path: use already grouped section rows
        section_candidates = catalog_skus['section_rows'].get(target_section, [])
        # Fallback to all rows if section not found or for legacy calls
        if not section_candidates:
            section_candidates = catalog_skus.get('all_catalog_rows', [])
    else:
        # Legacy path: catalog_skus is just a flat list
        section_candidates = catalog_skus

    def _candidate_section_matches(row: dict) -> bool:
        ct = row.get('ct')
        cs = row.get('cs')
        
        if ct is None:
            # Fallback for legacy calls missing metadata
            catalog_sku = str(row.get('sku', ''))
            catalog_sku_clean = strip_catalog_suffix(catalog_sku)
            ct = classify_cabinet_type(catalog_sku_clean) or classify_cabinet_type(catalog_sku)
            if ct: cs = CABINET_SECTIONS.get(ct, '')

        if ct is None:
            return False

        # ── Group-based matching ─────────────────────────────────────────────
        if target_type in CORNER_CABINET_TYPES:
            return ct in CORNER_CABINET_TYPES
        if target_type in FILLER_TYPES:
            return ct in FILLER_TYPES
        if target_type in TALL_TYPES:
            return ct in TALL_TYPES
        if target_type in BASE_CABINET_TYPES:
            return ct in BASE_CABINET_TYPES
        if target_type in SINK_BASE_TYPES:
            return ct in SINK_BASE_TYPES
        if target_type in VANITY_BASE_TYPES:
            return ct in VANITY_BASE_TYPES

        # ── General section match ─────────────────────────────────────────────
        if cs == target_section and target_section:
            return True
        if ct == target_type:
            return True
        # For Integrity prefix aliases, also allow by effective_prefix
        if effective_prefix and effective_prefix != target_prefix:
            # Note: eff_pfx_clean is calculated once outside for speed
            sku_ac = row.get('ac') or re.sub(r'[^A-Z0-9]', '', (row.get('csku') or ''))
            if sku_ac.startswith(eff_pfx_clean):
                return True
        return False

    # 3.5 Calculate loop invariant for prefix alias
    eff_pfx_clean = ""
    if effective_prefix:
        eff_pfx_clean = re.sub(r'[^A-Z0-9]', '', effective_prefix.upper())

    candidates = [
        row for row in section_candidates
        if _candidate_section_matches(row)
    ]

    if not candidates:
        return None

    # 4. Apply collection filter with NORMALIZED fuzzy matching
    # We normalize both the filter and catalog collection names to strip
    # encoding artifacts ("24\ufffd DEEP" → "CLASSIC SERIES") and depth suffixes.
    if collection_filter:
        normalized_filter = normalize_collection_name(collection_filter)
        if normalized_filter:
            col_candidates = []
            for r in candidates:
                rncol = r.get('ncol') or normalize_collection_name(str(r.get('collection_name', '')))
                if normalized_filter in rncol or rncol in normalized_filter:
                    col_candidates.append(r)
            
            if col_candidates:
                candidates = col_candidates
            # If collection filter produced nothing, fall back to all same-section candidates
            # This is intentional — a price from the right type is better than no price.


    if not candidates:
        return None

    # 5. Score candidates by dimension proximity
    # Determine primary / secondary dimension by type
    TALL_TYPES = {"Tall Cabinet", "Pantry Cabinet", "Oven Cabinet",
                  "Oven Tall Cabinet", "Utility Cabinet", "Refrigerator Cabinet"}
    MOLDING_TYPES = {"Crown Molding", "Outside Corner Molding", "Scribe Molding",
                     "Base Toe Kick", "Shoe Molding", "Quarter Round Molding",
                     "Light Rail", "Toe Kick"}
    FILLER_TYPES = {"Universal Filler", "Filler"}

    is_tall = target_type in TALL_TYPES
    is_molding = target_type in MOLDING_TYPES
    is_filler = target_type in FILLER_TYPES

    def score(row: dict) -> float:
        w = row.get('w')
        h = row.get('h')
        
        if w is None and h is None:
            # Fallback for legacy calls missing metadata
            cat_sku_raw = str(row.get('sku', ''))
            cat_sku_clean = strip_catalog_suffix(cat_sku_raw)
            dims = parse_sku_dimensions(cat_sku_clean)
            w = dims.get('width')
            h = dims.get('height')

        if target_w is None and target_h is None:
            # No dimensions parseable in target – all same-type candidates equally good
            return 0.0

        # Bonus for matching prefix (e.g. REF prefers REF over UT)
        prefix_bonus = 0.0
        row_sku = str(row.get('sku', '')).upper()
        if target_prefix and row_sku.startswith(target_prefix):
            prefix_bonus = -5.0  # Significant bonus for same prefix

        if is_molding:
            # For molding, numeric suffix = linear length (stored in width slot)
            tw = target_w or 0
            cw = w or 0
            return abs(tw - cw) * 1.0 + prefix_bonus

        if is_tall:
            # primary = height (×3), secondary = width (×1)
            th = target_h or 0
            ch = h or 0
            tw = target_w or 0
            cw = w or 0
            
            h_delta = abs(th - ch) if (th and ch) else 0
            w_delta = abs(tw - cw) if (tw and cw) else 0
            
            # If target height is missing (e.g. REF2D36), don't penalize catalog height
            return h_delta * 3.0 + w_delta * 1.0 + prefix_bonus

        if is_filler:
            # Universal Fillers: height is the primary dimension
            tw = target_w or 0
            cw = w or 0
            th = target_h or 0
            ch = h or 0
            if th > 0 and ch > 0:
                return abs(th - ch) * 3.0 + abs(tw - cw) * 1.0 + prefix_bonus
            else:
                return abs(tw - cw) * 1.0 + prefix_bonus

        # Standard (Wall / Base / Vanity / Sink Base)
        tw = target_w or 0
        cw = w or 0
        th = target_h or 0
        ch = h or 0
        width_delta = abs(tw - cw)
        height_delta = abs(th - ch) if (th and ch) else 0

        # Give a strong bonus to exact-width matches
        if tw and cw and tw == cw:
            return height_delta * 0.5 + prefix_bonus
        return width_delta * 3.0 + height_delta * 1.0 + prefix_bonus

    scored = [(row, score(row)) for row in candidates]
    scored.sort(key=lambda x: x[1])

    best_row, best_score_val = scored[0]

    # ── Two-pass: if collection-filtered best has non-trivial dimension gap,
    # also check all same-section candidates (without collection filter) and
    # use the global best if it's significantly better.
    # This handles the case where CLASSIC SERIES doesn't have W3042MDBD but
    # DOOR STYLES ELITE SERIES has W3042BD — the correct height match wins.
    # All same-section candidates are already in section_candidates
    all_section_candidates = section_candidates
    if len(all_section_candidates) > len(candidates):
        all_scored = [(row, score(row)) for row in all_section_candidates]
        all_scored.sort(key=lambda x: x[1])
        global_best_row, global_best_score = all_scored[0]
        # Use global best if it's meaningfully better (at least 2 points improvement)
        if global_best_score < best_score_val - 2.0:
            best_row = global_best_row

    return best_row
