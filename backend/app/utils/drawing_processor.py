import re
import fitz
from typing import List, Dict, Any

# Known cabinet SKU prefixes for fast code validation
VALID_PREFIXES = re.compile(
    r'^(W|B|SB|VSB|V|T|P|O|UF|F|DW|REF|MICRO|HW|CM|SM|BTK|SHM|OCM|LR|RANGE|HOOD|FL|DISH|S\d|OVD)',
    re.IGNORECASE
)

CABINET_PATTERN = re.compile(r'\b([A-Z]{1,5}[\d][A-Z0-9 .]*(?:BUTT|BLD|MD|BD|AS)?)\b', re.IGNORECASE)

def _is_likely_sku(code: str) -> bool:
    code = code.strip().upper()
    if len(code) < 2 or len(code) > 30:
        return False
    return bool(VALID_PREFIXES.match(code))

def extract_drawing_data_python(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Uses PyMuPDF to extract selectable text from ALL pages of a drawing PDF.
    Returns combined text + per-page data for single-pass AI analysis.
    """
    results = {
        "raw_text": "",
        "potential_codes": [],
        "has_selectable_text": False,
        "pages": []  # Per-page breakdown for room identification
    }
    
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        all_text_parts = []
        all_codes = set()
        
        for page_num, page in enumerate(doc):
            text = page.get_text()
            if text.strip():
                results["has_selectable_text"] = True
                
                # Find potential codes on this page
                raw_matches = CABINET_PATTERN.findall(text)
                page_codes = list({m.upper().strip() for m in raw_matches if _is_likely_sku(m)})
                all_codes.update(page_codes)
                
                all_text_parts.append(f"--- PAGE {page_num + 1} ---\n{text.strip()}")
                results["pages"].append({
                    "page": page_num + 1,
                    "codes": page_codes,
                    "text_snippet": text.strip()[:500]
                })
        
        results["raw_text"] = "\n\n".join(all_text_parts)
        results["potential_codes"] = sorted(all_codes)
        doc.close()
        
    except Exception as e:
        print(f"Python Drawing Extraction Error: {e}")
        
    return results
