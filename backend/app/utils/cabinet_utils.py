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
    "WR":   "Wall Refrigerator Cabinet",
    "WO":   "Wall Oven Cabinet",

    # Base Cabinets
    "B":    "Base Cabinet",
    "BBC":  "Base Blind Corner Cabinet",
    "BC":   "Base Corner Cabinet",
    "BDC":  "Base Diagonal Corner Cabinet",
    "BFH":  "Base Full Height Cabinet",

    # Sink / Appliance Bases
    "SB":   "Sink Base",
    "DB":   "Dishwasher Base",
    "DW":   "Dishwasher Return",
    "RB":   "Range Base",

    # Vanity Cabinets
    "V":    "Vanity Base",
    "VSB":  "Vanity Sink Base",
    "VDB":  "Vanity Double Base",

    # Tall / Pantry / Oven / Utility
    "T":    "Tall Cabinet",
    "P":    "Pantry Cabinet",
    "O":    "Oven Cabinet",
    "OVD":  "Oven Tall Cabinet",
    "UTIL": "Utility Cabinet",
    "REF":  "Refrigerator Cabinet",
    "MICRO":"Microwave Cabinet",

    # Specialty
    "S":    "Specialty Cabinet",
    "S3S":  "Specialty 3-Stack Cabinet",
    "SD":   "Specialty Double Cabinet",

    # Fillers
    "UF":   "Universal Filler",
    "F":    "Filler",

    # Molding & Trim  (not cabinets, but we classify for pricing)
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

    # Hardware / Accessories
    "HW":   "Hardware",
    "BACK": "Cabinet Back",
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
    accessory_keywords = ['TOUCHUP', 'KIT', 'SPRAY', 'GLUE', 'FILL', 'DISH-IQ', 'DWR3', 'RANGE', 'HOOD', 'DOORS', 'DRAWERS', 'SHELF', 'BACK-B', 'WTEP']
    if any(k in s for k in accessory_keywords):
        return 'Accessories'

    # 1. Specialized: Molding & Trim (Priority)
    molding_pattern = r'^(CM|M|RR|OCM|SCM|BTK|SHM|SM|QM|DM|PM|TK|SCRBE|SCRM|Scribe|Crown|Base Molding|Outside Corner|Shoe|LR|LIGHT RAIL|FL|HWC|CROWN|LIGHT)'
    if re.match(molding_pattern, s, re.IGNORECASE):
        return 'Molding & Trim'

    # 2. Universal Fillers
    if s.startswith('UF') or s.startswith('F') or 'FILLER' in s:
        return 'Universal Fillers'

    # 3. Vanity Cabinets (Check before Base)
    if s.startswith('V') or 'VANITY' in s:
        return 'Vanity Cabinets'

    # 4. Wall Cabinets
    if s.startswith('W') or 'WALL' in s:
        return 'Wall Cabinets'

    # 5. Sink Bases (Check before generic Base)
    if s.startswith('SB') or 'SINK' in s:
        return 'Base Cabinets'

    # 6. Base Cabinets (Standard)
    # Using regex ^B\d to avoid matching BTK
    if s.startswith('B') and (len(s) == 1 or s[1].isdigit()):
        return 'Base Cabinets'

    # 7. Tall Cabinets (Pantry, Oven, Utility, Refrigerator)
    tall_prefixes = ['T', 'P', 'O', 'UTIL', 'REF', 'UTIL', 'OVD']
    if any(s.startswith(p) for p in tall_prefixes) or 'TALL' in s:
        return 'Tall Cabinets'

    # 8. Hardwares (HWC is Molding, only HW[^C] is Hardwares)
    if (s.startswith('HW') and not s.startswith('HWC')) or 'KNOB' in s or 'PULL' in s or 'HINGE' in s:
        return 'Hardwares'

    return 'Accessories'


def parse_sku_dimensions(sku: str) -> dict:
    """Parse dimensions from a cabinet SKU string.
    Handles standard NKBA codes (W3042, B30) as well as
    dimension-encoded codes like HWC 2X4X96 or HWC 1X2X94.
    """
    if not sku: return {'prefix': None, 'width': None, 'height': None, 'depth': None}
    s = str(sku).upper().strip()
    # Strip annotation suffixes in parens/braces
    s = re.sub(r'[\(\{\[].*?[\)\}\]]', '', s).strip()

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
    uf_clean = re.sub(r'[^A-Z0-9]', '', s)
    uf_match = re.match(r'^(UF)(0?)(\d{1,2})(\d{2})$', uf_clean)
    if uf_match:
        return {
            'prefix': 'UF',
            'width': int(uf_match.group(3)),   # e.g. 3 or 6
            'height': int(uf_match.group(4)),  # e.g. 42 or 92
            'depth': None,
        }
    # UF with only width (UF3 = 3" filler, height unknown)
    uf_w_only = re.match(r'^(UF)(\d{1,2})$', uf_clean)
    if uf_w_only:
        return {
            'prefix': 'UF',
            'width': int(uf_w_only.group(2)),
            'height': None,
            'depth': None,
        }

    # ── Pattern C: Standard NKBA (W3042, B30, SB36) ──
    clean = re.sub(r'[^A-Z0-9]', '', s)
    match = re.search(r'^([A-Z]+)(\d{1,2})(\d{2})?(\d{2})?', clean)
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
    find the closest-size cabinet of the SAME cabinet type.

    Algorithm:
    1.  Classify the target's cabinet type (Wall, Base, Sink Base, etc.)
    2.  Apply Integrity-specific prefix aliases if needed
    3.  Among catalog items with the same cabinet type, score by dimension distance
        W: width is primary, height secondary
        B / SB / VSB: width is primary, height secondary
        Tall / Pantry / Oven: height is primary, width secondary
        Molding: length (depth or height) is primary
    4.  Return the catalog item with the lowest weighted score.

    Parameters
    ----------
    target_sku      : The drawing-PDF cabinet code (e.g. "W3042", "VSB3634H")
    catalog_skus    : List of dicts with keys: sku, price, collection_name, door_style
    collection_filter : If given, prefer items from this collection
    manufacturer_hint : "integrity" to enable Integrity-specific alias mappings

    Returns
    -------
    The best-matching catalog dict, or None if no cabinet-type match found.
    """
    if not target_sku or not catalog_skus:
        return None

    # 1. Parse target dimensions
    target_dims = parse_sku_dimensions(target_sku)
    target_type = classify_cabinet_type(target_sku)

    if target_type is None:
        return None  # Unknown type – cannot do a meaningful nearest-match

    target_prefix = target_dims.get('prefix') or ''
    target_w = target_dims.get('width')
    target_h = target_dims.get('height')

    # 2. Apply Integrity alias — translate the drawing prefix to what Integrity
    #    actually uses in their catalog, if a manufacturer hint is provided.
    effective_prefix = target_prefix
    if manufacturer_hint and 'integrity' in manufacturer_hint.lower():
        for alias_from, alias_to in INTEGRITY_PREFIX_ALIASES.items():
            if target_prefix.startswith(alias_from):
                effective_prefix = alias_to + target_prefix[len(alias_from):]
                break

    # 3. Find same-type candidates in the catalog
    def _candidate_type_matches(catalog_sku: str) -> bool:
        ct = classify_cabinet_type(catalog_sku)
        if ct == target_type:
            return True
        # For Integrity, also allow effective_prefix to match catalog
        if effective_prefix and effective_prefix != target_prefix:
            cat_dims = parse_sku_dimensions(catalog_sku)
            cat_pfx = (cat_dims.get('prefix') or '').upper()
            eff_pfx_clean = re.sub(r'[^A-Z0-9]', '', effective_prefix.upper())
            if cat_pfx.startswith(eff_pfx_clean):
                return True
        return False

    candidates = [
        row for row in catalog_skus
        if _candidate_type_matches(str(row.get('sku', '')))
    ]

    # Optional: prioritise collection-filtered candidates
    # Use partial/contains matching because Integrity collection names have
    # newlines and suffixes, e.g. 'CLASSIC SERIES - 24 DEEP\nLIST PRICE'
    if collection_filter:
        col_key = collection_filter.strip().upper().split('\n')[0].strip()  # first line only
        # Remove common suffixes for comparison
        col_key_core = re.sub(r'\s*-\s*\d+\s*(DEEP|INCH|IN).*', '', col_key).strip()
        if col_key_core:
            col_candidates = [
                r for r in candidates
                if col_key_core in str(r.get('collection_name', '')).strip().upper()
            ]
            if col_candidates:
                candidates = col_candidates

    if not candidates:
        return None

    # 4. Score candidates by dimension proximity
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
        dims = parse_sku_dimensions(str(row.get('sku', '')))
        w = dims.get('width')
        h = dims.get('height')

        if target_w is None and target_h is None:
            # No dimensions parseable in target – all same-type candidates equally good
            return 0.0

        if is_molding:
            # For molding, numeric suffix = linear length (stored in width slot)
            tw = target_w or 0
            cw = w or 0
            return abs(tw - cw) * 1.0

        if is_tall:
            # primary = height, secondary = width
            th = target_h or 0
            ch = h or 0
            tw = target_w or 0
            cw = w or 0
            return abs(th - ch) * 2.0 + abs(tw - cw) * 1.0

        if is_filler:
            # Universal Fillers: height is the primary dimension
            # UF342 (3"x42") vs UF396 (3"x96") have very different prices
            tw = target_w or 0
            cw = w or 0
            th = target_h or 0
            ch = h or 0
            if th > 0:
                return abs(th - ch) * 3.0 + abs(tw - cw) * 1.0
            else:
                # Only width known (UF3 with no height) — match by width only
                return abs(tw - cw) * 1.0

        # Standard (Wall / Base / Vanity / Sink Base)
        # primary = width, secondary = height
        tw = target_w or 0
        cw = w or 0
        th = target_h or 0
        ch = h or 0
        return abs(tw - cw) * 2.0 + abs(th - ch) * 1.0

    scored = [(row, score(row)) for row in candidates]
    scored.sort(key=lambda x: x[1])

    best_row, best_score = scored[0]
    return best_row
