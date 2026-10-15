"""
Phase C — Blueprint PDF Parser

Extracts wall dimensions, openings, and appliance callouts from a dimensioned
2020 Design (or similar) PDF plan so the layout generator can auto-populate.

Approach:
  1. Pull all text spans from each page with their (x, y) coordinates.
  2. Regex-match dimension tokens (12'-6", 12'6", 150", 150, etc.).
  3. Regex-match appliance / fixture labels (SINK, DW, RANGE, REF, OVEN,
     WINDOW, DOOR, ...).
  4. Cluster dimensions along the top/bottom/left/right of the page into
     "wall runs" using 1-D proximity on the appropriate axis.
  5. Associate the appliance labels with the nearest wall by Euclidean
     distance from the label's centroid to each wall's midpoint.

This is a heuristic extractor — the output is a draft spec intended to be
reviewed in the Blueprint wizard, NOT auto-applied. The frontend lets the
user tweak everything before generating the layout.
"""

from __future__ import annotations
import re
import math
from dataclasses import dataclass, field


# ─── Dimension parsing ───────────────────────────────────────────────────────

# Match: 12'-6", 12'6", 12'-6 1/2", 12', 150", 150, 6-1/2"
_DIM_RE = re.compile(
    r"""(?x)
    (?:
      (?P<ft>\d+)\s*['′]       # 12' or 12′
      (?:\s*-\s*)?
      (?:(?P<in1>\d+)
         (?:\s+(?P<frac_num>\d+)/(?P<frac_den>\d+))?
         [\"″]?)?
    )
    |
    (?P<inches>\d+(?:\.\d+)?)[\"″]
    """
)

def _dim_token_to_inches(m: re.Match) -> float | None:
    """Convert a matched dimension token to total inches."""
    if m.group('inches') is not None:
        try:
            return float(m.group('inches'))
        except ValueError:
            return None
    try:
        ft = int(m.group('ft') or 0)
        inches = int(m.group('in1') or 0)
        if m.group('frac_num') and m.group('frac_den'):
            inches += int(m.group('frac_num')) / int(m.group('frac_den'))
        return ft * 12 + inches
    except (ValueError, TypeError):
        return None


# Appliance / fixture label patterns (whole-word match, case-insensitive)
_APPLIANCE_PATTERNS = {
    'sink':        re.compile(r'\b(SINK|SNK)\b', re.I),
    'dishwasher':  re.compile(r'\b(DW|DWR|DISHWASHER)\b', re.I),
    'range':       re.compile(r'\b(RANGE|RGE|STOVE|COOKTOP|CT)\b', re.I),
    'fridge':      re.compile(r'\b(REF|FRIDGE|REFR|REFRIG)\b', re.I),
    'oven':        re.compile(r'\b(OVEN|WALL\s*OVEN|WO)\b', re.I),
    'microwave':   re.compile(r'\b(MW|MICRO|MICROWAVE)\b', re.I),
    'hood':        re.compile(r'\b(HOOD|RH)\b', re.I),
}

_OPENING_PATTERNS = {
    'window': re.compile(r'\b(WIN|WINDOW|WDW)\b', re.I),
    'door':   re.compile(r'\b(DR|DOOR|DOORWAY|PASSTHROUGH|PASS-THROUGH)\b', re.I),
}


# ─── Data types ──────────────────────────────────────────────────────────────

@dataclass
class TextSpan:
    text: str
    x: float   # bbox center x (in PDF points)
    y: float
    width: float
    height: float


@dataclass
class ParsedWall:
    id: str
    length_in: float
    axis: str                        # "top" | "bottom" | "left" | "right"
    dimensions_found: list[float] = field(default_factory=list)
    appliances: list[dict] = field(default_factory=list)
    openings: list[dict] = field(default_factory=list)

    def as_spec_dict(self) -> dict:
        return {
            "id": self.id,
            "length_in": round(self.length_in, 2),
            "appliances": self.appliances,
            "openings": self.openings,
        }


# ─── Low-level PDF text extraction ──────────────────────────────────────────

def _extract_spans(pdf_bytes: bytes, max_pages: int = 999) -> tuple[list[tuple[int, list[TextSpan]]], int]:
    """Return (list of (page_index, [TextSpan]) up to max_pages, total page count in the PDF)."""
    try:
        import pymupdf as fitz  # modern name
    except ImportError:
        import fitz             # type: ignore
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = doc.page_count
    pages = []
    for i in range(min(max_pages, doc.page_count)):
        page = doc[i]
        spans: list[TextSpan] = []
        for block in page.get_text("dict").get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    txt = (span.get("text") or "").strip()
                    if not txt:
                        continue
                    bbox = span.get("bbox", [0, 0, 0, 0])
                    x = (bbox[0] + bbox[2]) / 2
                    y = (bbox[1] + bbox[3]) / 2
                    w = bbox[2] - bbox[0]
                    h = bbox[3] - bbox[1]
                    spans.append(TextSpan(text=txt, x=x, y=y, width=w, height=h))
        pages.append((i, spans))
    doc.close()
    return pages, total_pages


# ─── Wall extraction (heuristic) ────────────────────────────────────────────

def _collect_dimensions(spans: list[TextSpan]) -> list[tuple[TextSpan, float]]:
    """For every span containing a dimension token, return (span, inches)."""
    out = []
    for sp in spans:
        for m in _DIM_RE.finditer(sp.text):
            val = _dim_token_to_inches(m)
            if val and 6 <= val <= 600:   # 6" – 50 ft sanity window
                out.append((sp, val))
    return out


def _cluster_axis(dims: list[tuple[TextSpan, float]], axis: str,
                  page_width: float, page_height: float) -> list[ParsedWall]:
    """Group dimension spans into walls along a given page edge."""
    walls: list[ParsedWall] = []
    EDGE_FRAC = 0.20  # within 20% of edge counts as that edge

    def near_edge(sp: TextSpan) -> bool:
        if axis == 'top':    return sp.y < page_height * EDGE_FRAC
        if axis == 'bottom': return sp.y > page_height * (1 - EDGE_FRAC)
        if axis == 'left':   return sp.x < page_width  * EDGE_FRAC
        if axis == 'right':  return sp.x > page_width  * (1 - EDGE_FRAC)
        return False

    edge_dims = [(sp, v) for sp, v in dims if near_edge(sp)]
    if not edge_dims:
        return walls

    # Walls on top/bottom run horizontally → cluster by x
    # Walls on left/right run vertically   → cluster by y
    key = (lambda t: t[0].x) if axis in ('top', 'bottom') else (lambda t: t[0].y)
    edge_dims.sort(key=key)

    # Simple linear scan: a new wall starts when there is a visual gap
    GAP = 50  # points
    current_group: list[tuple[TextSpan, float]] = []
    groups: list[list[tuple[TextSpan, float]]] = []
    last_pos = None
    for sp, v in edge_dims:
        pos = key((sp, v))
        if last_pos is None or (pos - last_pos) < GAP:
            current_group.append((sp, v))
        else:
            if current_group:
                groups.append(current_group)
            current_group = [(sp, v)]
        last_pos = pos
    if current_group:
        groups.append(current_group)

    for gi, grp in enumerate(groups):
        # Sum the dimensions in this group as the wall length (dimensions
        # labels along a wall typically break into segments that sum to the
        # overall wall length). We take the max of SUM vs single-largest to
        # avoid double-counting when a plan has both segment and overall.
        total = sum(v for _sp, v in grp)
        largest = max(v for _sp, v in grp)
        length = largest if largest >= total * 0.9 else total
        walls.append(ParsedWall(
            id=f"{axis[0].upper()}{gi+1}",
            length_in=length,
            axis=axis,
            dimensions_found=[v for _sp, v in grp],
        ))

    return walls


def _assign_appliances_and_openings(walls: list[ParsedWall], spans: list[TextSpan],
                                     page_width: float, page_height: float):
    """Attach appliance / opening labels to the nearest wall edge."""
    # Compute each wall's midpoint on the page
    def wall_midpoint(w: ParsedWall) -> tuple[float, float]:
        if w.axis == 'top':    return (page_width / 2, page_height * 0.1)
        if w.axis == 'bottom': return (page_width / 2, page_height * 0.9)
        if w.axis == 'left':   return (page_width * 0.1, page_height / 2)
        if w.axis == 'right':  return (page_width * 0.9, page_height / 2)
        return (0, 0)

    midpoints = {w.id: wall_midpoint(w) for w in walls}

    def nearest_wall(sp: TextSpan) -> ParsedWall | None:
        if not walls:
            return None
        return min(walls, key=lambda w: math.hypot(sp.x - midpoints[w.id][0],
                                                   sp.y - midpoints[w.id][1]))

    for sp in spans:
        # Appliances
        for kind, pat in _APPLIANCE_PATTERNS.items():
            if pat.search(sp.text):
                target = nearest_wall(sp)
                if target:
                    # Estimate center along the wall from the label's position
                    # along the wall's primary axis.
                    if target.axis in ('top', 'bottom'):
                        rel = (sp.x - page_width * 0.1) / max(page_width * 0.8, 1)
                    else:
                        rel = (sp.y - page_height * 0.1) / max(page_height * 0.8, 1)
                    rel = max(0.0, min(1.0, rel))
                    center = round(target.length_in * rel, 1)
                    target.appliances.append({
                        "type": kind,
                        "center_in": center,
                        "width_in": 0,  # 0 → generator picks sensible default
                    })
                break
        # Openings
        for kind, pat in _OPENING_PATTERNS.items():
            if pat.search(sp.text):
                target = nearest_wall(sp)
                if target:
                    if target.axis in ('top', 'bottom'):
                        rel = (sp.x - page_width * 0.1) / max(page_width * 0.8, 1)
                    else:
                        rel = (sp.y - page_height * 0.1) / max(page_height * 0.8, 1)
                    rel = max(0.0, min(1.0, rel))
                    start = round(target.length_in * rel, 1)
                    target.openings.append({
                        "type": kind,
                        "start_in": start,
                        "width_in": 36 if kind == 'window' else 32,
                        "sill_height_in": 36 if kind == 'window' else 0,
                    })
                break


# ─── AI fallback parser ──────────────────────────────────────────────────────

_AI_PARSE_PROMPT = """You are reading raw text extracted from a kitchen design drawing PDF.
Below are text spans (text, x, y coordinates) from the drawing.
Extract ALL wall dimensions and appliance locations from this data.

Return STRICT JSON only — no prose, no markdown fences:
{{
  "walls": [
    {{
      "id": "A",
      "length_in": 144,
      "openings": [
        {{"type": "window"|"door", "start_in": 60, "width_in": 36, "sill_height_in": 36}}
      ],
      "appliances": [
        {{"type": "sink"|"dishwasher"|"range"|"cooktop"|"oven"|"fridge"|"microwave"|"hood", "center_in": 78, "width_in": 33}}
      ]
    }}
  ],
  "confidence": "high"|"medium"|"low",
  "notes": "brief explanation of what was found"
}}

Rules:
- Dimensions like 12'-6" = 150 inches, 10' = 120 inches, 96" = 96 inches.
- Assign sequential letter IDs (A, B, C…) to walls.
- If a dimension is ambiguous, pick the most likely kitchen wall length (72–240 inches).
- Only include walls with dimensions found in the text.
- Set confidence "low" if the PDF has few dimensions or only appliance labels.
- Return an empty walls list if no wall dimensions are found.

Text spans from the drawing:
{spans_text}"""


def _ai_parse_spans(spans_by_page: list[tuple[int, list[TextSpan]]]) -> dict | None:
    """Use LLM to parse wall dimensions when heuristics found too little."""
    try:
        from app.utils.ai_client import llm_generate
    except ImportError:
        return None

    # Flatten to a compact text representation
    lines = []
    for page_idx, spans in spans_by_page[:3]:  # first 3 pages only
        for sp in spans:
            lines.append(f"[p{page_idx+1} x={sp.x:.0f} y={sp.y:.0f}] {sp.text}")

    if not lines:
        return None

    spans_text = "\n".join(lines[:400])  # cap tokens
    try:
        raw = llm_generate(
            _AI_PARSE_PROMPT.format(spans_text=spans_text),
            tier="balanced",
            max_tokens=2048,
        )
        import json
        result = json.loads(raw.strip())
        walls = result.get("walls") or []
        if not isinstance(walls, list):
            return None
        return {
            "walls": [
                {
                    "id": str(w.get("id", f"W{i+1}")),
                    "length_in": float(w.get("length_in", 0)),
                    "openings": w.get("openings") or [],
                    "appliances": w.get("appliances") or [],
                }
                for i, w in enumerate(walls)
                if float(w.get("length_in", 0)) > 0
            ],
            "confidence": result.get("confidence", "low"),
            "notes": result.get("notes", ""),
            "source": "ai",
        }
    except Exception:
        return None


# ─── Public entry point ──────────────────────────────────────────────────────

def parse_blueprint_pdf(pdf_bytes: bytes, max_pages: int = 999) -> dict:
    """
    Parse a dimensioned plan PDF and return a draft spec:
      {
        "walls": [ {id, length_in, appliances, openings}, ... ],
        "page_count_scanned": N,
        "dimensions_found": M,
        "warnings": [...]
      }
    """
    pages, total_pages = _extract_spans(pdf_bytes, max_pages=max_pages)
    if not pages:
        return {"walls": [], "page_count_scanned": 0, "dimensions_found": 0,
                "warnings": ["PDF had no extractable text — may be scanned/image-only; needs OCR."]}

    warnings: list[str] = []
    if total_pages > max_pages:
        # Previously silently dropped: a drawing set with more pages than
        # max_pages had the rest ignored with no indication to the user that
        # part of their plan was never scanned for walls/dimensions.
        warnings.append(
            f"This PDF has {total_pages} pages but only the first {max_pages} were scanned for "
            f"walls/dimensions — pages {max_pages + 1}-{total_pages} were skipped."
        )
    all_walls: list[ParsedWall] = []

    for page_idx, spans in pages:
        if not spans:
            continue
        page_width  = max((sp.x + sp.width / 2) for sp in spans) or 1
        page_height = max((sp.y + sp.height / 2) for sp in spans) or 1

        dims = _collect_dimensions(spans)
        if not dims:
            continue

        for axis in ('top', 'bottom', 'left', 'right'):
            walls = _cluster_axis(dims, axis, page_width, page_height)
            # Prefix wall IDs with page number when multi-page
            if len(pages) > 1:
                for w in walls:
                    w.id = f"P{page_idx+1}_{w.id}"
            _assign_appliances_and_openings(walls, spans, page_width, page_height)
            all_walls.extend(walls)

    # Dedup walls with very similar length on the same axis (common artifact)
    seen: list[ParsedWall] = []
    for w in all_walls:
        if any(abs(w.length_in - s.length_in) < 2 and w.axis == s.axis for s in seen):
            continue
        seen.append(w)

    # AI fallback: when heuristics found fewer than 2 walls, try AI extraction.
    # Complex drawing sets (multiple rooms, non-standard layouts) often have
    # dimension labels that don't sit cleanly near page edges, so the
    # edge-proximity heuristic misses most of them — the AI reads the full
    # text and understands context ("12'-6\" KITCHEN" vs a random number).
    ai_source = False
    if len(seen) < 2:
        ai_result = _ai_parse_spans(pages)
        if ai_result and ai_result.get("walls"):
            seen = []
            for wd in ai_result["walls"]:
                pw = ParsedWall(
                    id=wd["id"],
                    length_in=float(wd["length_in"]),
                    axis="top",
                )
                pw.appliances = wd.get("appliances") or []
                pw.openings = wd.get("openings") or []
                seen.append(pw)
            ai_source = True
            confidence = ai_result.get("confidence", "low")
            if confidence != "high":
                warnings.append(
                    f"AI parser confidence: {confidence}. "
                    + (ai_result.get("notes") or "Review walls carefully before generating.")
                )
            else:
                warnings.append("Walls extracted by AI — review dimensions before generating.")

    if not seen:
        warnings.append("No wall-dimension clusters identified. Try a cleaner page or enter walls manually.")

    return {
        "walls": [w.as_spec_dict() for w in seen],
        "page_count_scanned": len(pages),
        "dimensions_found": sum(len(w.dimensions_found) for w in seen),
        "warnings": warnings,
        "source": "ai" if ai_source else "heuristic",
    }
