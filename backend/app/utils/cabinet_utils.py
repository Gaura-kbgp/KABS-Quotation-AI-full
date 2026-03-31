import re

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

    # 1. Universal Fillers
    if s.startswith('UF') or s.startswith('F'):
        return 'Universal Fillers'

    # 2. Wall Cabinets
    if s.startswith('W'):
        return 'Wall Cabinets'
    
    # 3. Base Cabinets (Standard & Sink)
    if (s.startswith('SB') or s.startswith('B')):
        return 'Base Cabinets'
    
    # 4. Tall Cabinets (Pantry, Oven, Utility, Refrigerator)
    tall_prefixes = ['T', 'P', 'O', 'UTIL', 'REF']
    if any(s.startswith(p) for p in tall_prefixes):
        return 'Tall Cabinets'
    
    # 5. Vanity Cabinets
    if s.startswith('V'):
        return 'Vanity Cabinets'
    
    # 6. Hardwares
    if s.startswith('HW') or 'KNOB' in s or 'PULL' in s or 'HINGE' in s:
        return 'Hardwares'
    
    # 7. Molding & Trim
    molding_prefixes = ['CM', 'M', 'RR', 'OCM', 'SCM', 'BTK', 'SHM', 'SM']
    if any(s.startswith(p) for p in molding_prefixes):
        return 'Molding & Trim'
    
    return 'Accessories'
