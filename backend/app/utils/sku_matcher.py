"""
Match a printed cabinet code (from the drawing) against a price guide's SKU list.

Order of attempts:
  1. exact match on the full printed key            -> status "exact"
  2. same key with the L/R orientation removed      -> status "orientation"
     (the price guide has one price for left and right; orientation is kept as an attribute)
  3. nothing found                                  -> status "not_found" (reported, never silently dropped)
"""
import re
from typing import Dict, Optional, Tuple

# Trailing hand marker: "B12L", "B15R", "DWR3 {L}", "RR120FL {R}".
# Requires a digit (or a closing brace) before the L/R, so "RR120FL" keeps its FL.
_ORIENT_RE = re.compile(r'^(?P<base>.*?\d)\s*(?:\{\s*(?P<b>[LR])\s*\}|(?P<a>[LR]))$')


def normalize(text: str) -> str:
    return re.sub(r'\s+', ' ', str(text)).strip().upper()


def split_orientation(key: str) -> Tuple[str, Optional[str]]:
    """'B12L' -> ('B12', 'L');  'DWR3 {L}' -> ('DWR3', 'L');  'RR120FL' -> ('RR120FL', None)."""
    k = normalize(key)
    m = _ORIENT_RE.match(k)
    if not m:
        return k, None
    base = m.group('base').strip()
    side = m.group('b') or m.group('a')
    return base, side


def build_sku_index(sku_texts) -> Dict[str, str]:
    """Maps normalized price-guide SKU text -> original SKU text."""
    index: Dict[str, str] = {}
    for t in sku_texts:
        if t is None:
            continue
        n = normalize(t)
        if n:
            index.setdefault(n, str(t).strip())
    return index


def match_code(match_key: str, sku_index: Dict[str, str]) -> Dict[str, Optional[str]]:
    key = normalize(match_key)
    if key in sku_index:
        return {"status": "exact", "sku": sku_index[key], "orientation": None}

    base, side = split_orientation(key)
    if side and base in sku_index:
        return {"status": "orientation", "sku": sku_index[base], "orientation": side}

    return {"status": "not_found", "sku": None, "orientation": side}
