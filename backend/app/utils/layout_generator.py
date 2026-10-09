"""
Blueprint Intelligence Engine — Layout Generator (Phase C)

Rule-based NKBA-standard kitchen cabinet layout generator.

Input (JSON):
    {
      "ceiling_height_in": 96,
      "walls": [
        {
          "id": "A",
          "length_in": 144,
          "openings": [
            {"type": "window", "start_in": 60, "width_in": 36, "height_above_floor": 36},
            {"type": "door", "start_in": 0, "width_in": 32, "swing": "in"}
          ],
          "appliances": [
            {"type": "sink", "center_in": 78, "width_in": 33},
            {"type": "dishwasher", "center_in": 110, "width_in": 24}
          ]
        }
      ],
      "options": {
        "wall_cabinet_height_in": 36,
        "toe_kick_in": 4,
        "has_crown": true,
        "has_light_rail": false,
        "allow_fillers": true
      }
    }

Output: list of BOM items ready for the pricing engine.
    [
      {"code": "SB33", "qty": 1, "wall": "A", "position_in": 61.5, "category": "cabinets", "notes": "Sink base"},
      {"code": "B18",  "qty": 1, "wall": "A", "position_in": 95,    "category": "cabinets"},
      ...
    ]
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

# NKBA standard cabinet widths (inches)
BASE_WIDTHS   = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48]
WALL_WIDTHS   = BASE_WIDTHS[:]
SINK_WIDTHS   = [30, 33, 36, 42, 48]        # typical sink base widths
TALL_WIDTHS   = [18, 21, 24, 27, 30, 33, 36]

# Default clearances
DW_WIDTH            = 24    # standard dishwasher opening
RANGE_WIDTH         = 30    # 30" range default (can override)
FRIDGE_WIDTH        = 36    # 36" standard counter-depth fridge
FILLER_MIN          = 1.0
FILLER_MAX          = 3.0
APPLIANCE_CLEARANCE = 0.5   # tiny gap between cabinets and appliances


# ─── Data classes ────────────────────────────────────────────────────────────


@dataclass
class Opening:
    type: str                 # "window" | "door" | "pass_through"
    start_in: float
    width_in: float
    sill_height_in: float = 0.0      # height above floor (for window placement)
    swing: str = "in"


@dataclass
class Appliance:
    type: str                 # "sink" | "dishwasher" | "range" | "cooktop" | "oven" | "fridge" | "microwave" | "hood"
    center_in: float          # center position along the wall
    width_in: float = 0.0     # if omitted, default per type


@dataclass
class Wall:
    id: str
    length_in: float
    openings: list[Opening] = field(default_factory=list)
    appliances: list[Appliance] = field(default_factory=list)
    kind: str = "wall"       # "wall" | "island" | "peninsula"
    # peninsula only: which end attaches to a wall ("left" | "right")
    attached_end: str = "left"


@dataclass
class LayoutOptions:
    ceiling_height_in: float = 96.0
    wall_cabinet_height_in: float = 36.0
    wall_cabinet_bottom_above_floor_in: float = 54.0   # standard
    toe_kick_in: float = 4.0
    has_crown: bool = True
    has_light_rail: bool = False
    allow_fillers: bool = True
    # When a wall is fully enclosed by walls on both ends, use smaller end fillers
    both_ends_enclosed: bool = True


@dataclass
class BomLine:
    code: str
    qty: int
    wall: str
    position_in: float
    category: str
    notes: str = ""

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "qty": self.qty,
            "wall": self.wall,
            "position_in": round(self.position_in, 2),
            "category": self.category,
            "notes": self.notes,
        }


# ─── Core helpers ────────────────────────────────────────────────────────────


def _default_appliance_width(a: Appliance) -> float:
    """Return reasonable default widths when not provided."""
    if a.width_in and a.width_in > 0:
        return a.width_in
    return {
        "sink":        33.0,
        "dishwasher":  DW_WIDTH,
        "range":       RANGE_WIDTH,
        "cooktop":     30.0,
        "oven":        30.0,
        "fridge":      FRIDGE_WIDTH,
        "microwave":   24.0,
        "hood":        30.0,
    }.get(a.type.lower(), 24.0)


def _best_fit_widths(gap_in: float, widths: list[int]) -> list[int]:
    """Greedy fill: use the largest widths that fit until the gap is < 9".
    Returns a list of chosen widths. Any remainder < 9" becomes a filler."""
    chosen: list[int] = []
    remaining = gap_in
    for w in sorted(widths, reverse=True):
        while remaining >= w - 0.01:
            chosen.append(w)
            remaining -= w
            if remaining < widths[0]:
                break
        if remaining < widths[0]:
            break
    return chosen


def _closest_sink_width(opening_width: float) -> int:
    """Pick a sink base that's at least as wide as the sink opening."""
    for w in SINK_WIDTHS:
        if w >= opening_width:
            return w
    return SINK_WIDTHS[-1]


# ─── The main generator ─────────────────────────────────────────────────────


def generate_wall_layout(wall: Wall, opts: LayoutOptions) -> list[BomLine]:
    """
    Generate cabinet layout for a single wall / island / peninsula.
    Algorithm:
      1. Identify fixed anchor segments (appliances occupying floor space).
      2. Split the wall into "runs" of free cabinet-able length between anchors
         and respecting any floor-standing door openings.
      3. Fill each run with base cabinets (greedy width selection) + filler.
      4. Place sink base centered on sink opening (overrides base fill in that span).
      5. Place wall cabinets above everything except range (hood) and above window.

    For `kind == "island"`:
      - Base cabinets on BOTH sides (output doubles)
      - No upper cabinets
      - End panels at both ends
    For `kind == "peninsula"`:
      - Base cabinets on BOTH sides (same as island)
      - No upper cabinets
      - End panel only at the FREE end (opposite of attached_end)
    """
    lines: list[BomLine] = []
    is_island = (wall.kind or "wall").lower() == "island"
    is_peninsula = (wall.kind or "wall").lower() == "peninsula"

    # ─ Appliance anchors (floor-standing or sink above base) ─────────────────
    # Each anchor returns (start, end, kind, meta)
    anchors: list[tuple[float, float, str, dict]] = []
    for a in wall.appliances:
        w = _default_appliance_width(a)
        start = a.center_in - w / 2
        end = a.center_in + w / 2
        anchors.append((start, end, a.type.lower(), {"center_in": a.center_in, "width_in": w}))

    # Door openings consume full floor (no base cab across them)
    for op in wall.openings:
        if op.type.lower() == "door":
            anchors.append((op.start_in, op.start_in + op.width_in, "door_opening", {}))

    anchors.sort(key=lambda t: t[0])

    # ─ Walk the wall left→right, building base-cabinet runs between anchors ──
    cursor = 0.0
    wall_end = wall.length_in

    def place_sink_base(start: float, end: float):
        center = (start + end) / 2
        sb_w = _closest_sink_width(end - start)
        lines.append(BomLine(
            code=f"SB{sb_w}",
            qty=1, wall=wall.id,
            position_in=center - sb_w / 2,
            category="cabinets",
            notes=f"Sink base (sink opening {end-start:.0f}\" at center {center:.0f}\")",
        ))

    def place_dishwasher(start: float, end: float):
        # Dishwashers aren't cabinets. Note it so the quote shows them.
        lines.append(BomLine(
            code="DW_SPACE",
            qty=1, wall=wall.id,
            position_in=start,
            category="appliance_spacer",
            notes=f"Dishwasher 24\" opening ({start:.0f}\"-{end:.0f}\")",
        ))

    def place_range(start: float, end: float):
        lines.append(BomLine(
            code="RANGE_SPACE",
            qty=1, wall=wall.id,
            position_in=start,
            category="appliance_spacer",
            notes=f"Range {end-start:.0f}\" opening ({start:.0f}\"-{end:.0f}\")",
        ))

    def place_fridge(start: float, end: float):
        lines.append(BomLine(
            code="FRIDGE_SPACE",
            qty=1, wall=wall.id,
            position_in=start,
            category="appliance_spacer",
            notes=f"Refrigerator {end-start:.0f}\" opening ({start:.0f}\"-{end:.0f}\")",
        ))

    def fill_bases(start: float, end: float):
        """Fill a gap with base cabinets, add filler if needed."""
        gap = end - start
        if gap < BASE_WIDTHS[0]:
            if opts.allow_fillers and gap >= FILLER_MIN:
                w = min(FILLER_MAX, gap)
                lines.append(BomLine(
                    code=f"UF{int(round(w))}",
                    qty=1, wall=wall.id, position_in=start,
                    category="cabinets", notes=f"Base filler {w:.1f}\" (gap too small for cabinet)",
                ))
            return
        widths = _best_fit_widths(gap, BASE_WIDTHS)
        used = sum(widths)
        remainder = gap - used
        pos = start
        for w in widths:
            lines.append(BomLine(
                code=f"B{w}",
                qty=1, wall=wall.id, position_in=pos,
                category="cabinets", notes=f"Base cabinet {w}\" wide",
            ))
            pos += w
        if opts.allow_fillers and remainder >= FILLER_MIN:
            fw = min(FILLER_MAX, remainder)
            lines.append(BomLine(
                code=f"UF{int(round(fw))}",
                qty=1, wall=wall.id, position_in=pos,
                category="cabinets", notes=f"Base filler {fw:.1f}\" (even out run)",
            ))

    def fill_walls_above(start: float, end: float, skip_above_range: bool = False):
        """Fill the upper wall-cabinet band."""
        if skip_above_range:
            # Over a range, typically hood + flanking wall cabs. Skip for now.
            lines.append(BomLine(
                code="HOOD_SPACE",
                qty=1, wall=wall.id, position_in=start,
                category="appliance_spacer",
                notes=f"Range hood zone ({start:.0f}\"-{end:.0f}\")",
            ))
            return
        gap = end - start
        if gap < WALL_WIDTHS[0]:
            return
        widths = _best_fit_widths(gap, WALL_WIDTHS)
        pos = start
        h = int(opts.wall_cabinet_height_in)
        for w in widths:
            lines.append(BomLine(
                code=f"W{w}{h}",
                qty=1, wall=wall.id, position_in=pos,
                category="cabinets", notes=f"Wall cabinet {w}\"W × {h}\"H",
            ))
            pos += w

    # Walk the wall
    for a_start, a_end, kind, meta in anchors:
        if a_start > cursor:
            fill_bases(cursor, a_start)
        if kind == "sink":
            place_sink_base(a_start, a_end)
        elif kind == "dishwasher":
            place_dishwasher(a_start, a_end)
        elif kind == "range" or kind == "cooktop":
            place_range(a_start, a_end)
        elif kind == "fridge":
            place_fridge(a_start, a_end)
        elif kind == "door_opening":
            pass  # floor space taken by doorway
        else:
            # Unknown appliance — treat as spacer
            lines.append(BomLine(
                code=f"{kind.upper()}_SPACE",
                qty=1, wall=wall.id, position_in=a_start,
                category="appliance_spacer",
                notes=f"{kind} opening ({a_start:.0f}\"-{a_end:.0f}\")",
            ))
        cursor = a_end

    if cursor < wall_end:
        fill_bases(cursor, wall_end)

    # Island / peninsula: duplicate the base cabinets for the back side,
    # add end panels, and skip the entire upper band + crown.
    if is_island or is_peninsula:
        back_side = []
        for bl in list(lines):
            if bl.category == "cabinets" and (bl.code.startswith("B") or bl.code.startswith("SB") or bl.code.startswith("UF")):
                back_side.append(BomLine(
                    code=bl.code, qty=bl.qty, wall=f"{bl.wall}_back",
                    position_in=bl.position_in, category="cabinets",
                    notes=f"{bl.notes} (back side)",
                ))
        lines.extend(back_side)
        # End panels: both ends for island, free end only for peninsula
        if is_island:
            lines.append(BomLine(code="EP", qty=2, wall=wall.id, position_in=0,
                                 category="cabinets", notes="Island end panels (both ends)"))
        else:
            free_end = "right" if (wall.attached_end or "left") == "left" else "left"
            lines.append(BomLine(code="EP", qty=1, wall=wall.id,
                                 position_in=(wall.length_in if free_end == "right" else 0),
                                 category="cabinets",
                                 notes=f"Peninsula end panel ({free_end} / free end)"))
        # Add toe kick and skip upper band + crown
        lines.append(BomLine(
            code="TK96",
            qty=max(1, int(round(wall.length_in / 48))),   # x2 since both sides
            wall=wall.id, position_in=0, category="cabinets",
            notes=f"Toe kick for {wall.length_in/12:.1f} ft {'island' if is_island else 'peninsula'} (both sides)",
        ))
        return lines

    # ─ Upper band ────────────────────────────────────────────────────────────
    # Compute the open upper spans (between windows / fridge-tall / tall ovens)
    tall_blockers = [(a_start, a_end, kind) for (a_start, a_end, kind, _m) in anchors
                     if kind in ("fridge", "oven", "pantry", "tall")]
    window_blockers = [(op.start_in, op.start_in + op.width_in)
                       for op in wall.openings if op.type.lower() == "window"]
    range_zones = [(a_start, a_end) for (a_start, a_end, kind, _m) in anchors
                   if kind in ("range", "cooktop")]

    # Collect sorted "no-fill" zones for upper band
    upper_blockers = sorted(
        [(s, e) for (s, e, _k) in tall_blockers] + window_blockers,
        key=lambda t: t[0]
    )

    cursor = 0.0
    for b_start, b_end in upper_blockers:
        if b_start > cursor:
            fill_walls_above(cursor, b_start)
        cursor = max(cursor, b_end)
    if cursor < wall_end:
        fill_walls_above(cursor, wall_end)

    # Handle range hoods separately — mark the above-range zone as hood
    for r_start, r_end in range_zones:
        lines.append(BomLine(
            code="HOOD_SPACE",
            qty=1, wall=wall.id, position_in=r_start,
            category="appliance_spacer",
            notes=f"Hood/microwave zone above range ({r_start:.0f}\"-{r_end:.0f}\")",
        ))

    # ─ Trim ──────────────────────────────────────────────────────────────────
    if opts.has_crown:
        lines.append(BomLine(
            code="CROWN",
            qty=int(round(wall.length_in / 12)),  # linear feet
            wall=wall.id, position_in=0,
            category="opt_crown",
            notes=f"Crown molding ~{wall.length_in/12:.1f} ft",
        ))
    if opts.has_light_rail:
        lines.append(BomLine(
            code="LIGHT RAIL",
            qty=int(round(wall.length_in / 12)),
            wall=wall.id, position_in=0,
            category="opt_light_rail",
            notes=f"Light rail ~{wall.length_in/12:.1f} ft",
        ))
    # Toe kick: always 1x per wall length-feet
    lines.append(BomLine(
        code="TK96",
        qty=max(1, int(round(wall.length_in / 96))),
        wall=wall.id, position_in=0,
        category="cabinets",
        notes=f"Toe kick for {wall.length_in/12:.1f} ft wall",
    ))

    return lines


def generate_kitchen_layout(spec: dict) -> dict:
    """
    Top-level API. Accepts the JSON spec and returns:
      {"items": [...], "summary": {...}, "warnings": [...]}
    """
    warnings: list[str] = []
    opts = LayoutOptions(**{k: v for k, v in (spec.get("options") or {}).items()
                            if k in LayoutOptions.__dataclass_fields__})
    all_items: list[BomLine] = []

    for raw_wall in spec.get("walls", []):
        wall = Wall(
            id=str(raw_wall.get("id") or f"W{len(all_items)}"),
            length_in=float(raw_wall.get("length_in") or 0),
            openings=[Opening(**op) for op in raw_wall.get("openings", [])],
            appliances=[Appliance(**ap) for ap in raw_wall.get("appliances", [])],
            kind=(raw_wall.get("kind") or "wall"),
            attached_end=(raw_wall.get("attached_end") or "left"),
        )
        if wall.length_in <= 0:
            warnings.append(f"Wall {wall.id}: invalid length, skipped")
            continue
        if wall.length_in < BASE_WIDTHS[0]:
            warnings.append(f"Wall {wall.id}: too short ({wall.length_in}\") for any cabinet")
            continue

        wall_items = generate_wall_layout(wall, opts)
        all_items.extend(wall_items)

    # Rollup summary
    base_cnt = sum(1 for it in all_items if it.code.startswith("B") and it.category == "cabinets" and not it.code.startswith("BF"))
    sink_cnt = sum(1 for it in all_items if it.code.startswith("SB"))
    wall_cnt = sum(1 for it in all_items if it.code.startswith("W") and not it.code.startswith("WB"))
    filler_cnt = sum(1 for it in all_items if it.code.startswith("UF"))

    return {
        "items": [it.as_dict() for it in all_items],
        "summary": {
            "total_items": len(all_items),
            "base_cabinets": base_cnt,
            "wall_cabinets": wall_cnt,
            "sink_bases": sink_cnt,
            "fillers": filler_cnt,
            "walls_processed": len(spec.get("walls", [])),
        },
        "warnings": warnings,
    }
