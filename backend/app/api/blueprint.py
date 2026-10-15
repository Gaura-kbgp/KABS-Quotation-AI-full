"""
Phase C — Blueprint Intelligence Engine API

POST /api/blueprint/generate-layout         Pure layout from spec
POST /api/blueprint/apply-to-project        Generate + merge into project
POST /api/blueprint/parse-pdf               Upload a dimensioned PDF → draft spec
POST /api/blueprint/ai-refine               Rule-based layout → AI-reviewed layout
"""

import json
import asyncio
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from typing import Optional

from app.utils.layout_generator import generate_kitchen_layout
from app.utils.blueprint_pdf_parser import parse_blueprint_pdf
from app.core.supabase_client import get_supabase
from app.core.auth import get_current_user, CurrentUser
from app.core.storage import MAX_UPLOAD_BYTES

router = APIRouter()


class LayoutRequest(BaseModel):
    ceiling_height_in: float = 96.0
    walls: list[dict]
    options: Optional[dict] = None


class SkuMatchRequest(BaseModel):
    items: list[dict]
    manufacturer_id: str
    collection: str = ""
    door_style: str = ""


@router.post("/blueprint/generate-layout")
def generate_layout(req: LayoutRequest, user: CurrentUser = Depends(get_current_user)):
    """Pure layout generation — no persistence. Returns proposed cabinet list."""
    try:
        spec = {
            "ceiling_height_in": req.ceiling_height_in,
            "walls": req.walls,
            "options": req.options or {},
        }
        result = generate_kitchen_layout(spec)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Layout generation failed: {e}")


class ApplyToProjectRequest(BaseModel):
    project_id: str
    room_name: str = "KITCHEN"
    spec: dict
    replace_existing: bool = False
    manufacturer_id: Optional[str] = None
    sku_overrides: Optional[dict] = None   # generic_code → manual_sku
    collection: Optional[str] = None
    door_style: Optional[str] = None


@router.post("/blueprint/apply-to-project")
def apply_to_project(req: ApplyToProjectRequest, user: CurrentUser = Depends(get_current_user)):
    """Generate a layout and merge the SKUs into the project's extracted_data.
    The frontend BOM/pricing engine can then quote them."""
    supabase = get_supabase()
    proj = supabase.table("quotation_projects").select("extracted_data") \
        .eq("id", req.project_id).single().execute().data
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    layout = generate_kitchen_layout(req.spec)
    items = layout["items"]
    overrides = req.sku_overrides or {}

    # Group items by category so they slot into the room shape the pricing engine expects
    cat_map: dict[str, list[dict]] = {}
    for it in items:
        cat = it["category"]
        code = it["code"]
        cat_map.setdefault(cat, []).append({
            "code": overrides.get(code, code),   # apply manual SKU override if set
            "qty": it["qty"],
            "notes": it.get("notes", ""),
            "wall": it.get("wall"),
            "position_in": it.get("position_in"),
        })

    data = proj.get("extracted_data") or {}
    rooms = data.get("rooms") or []
    target = next((r for r in rooms if (r.get("room_name") or "").upper() == req.room_name.upper()), None)
    if target is None:
        target = {"room_name": req.room_name, "cabinets": [], "collection": req.collection or "", "door_style": req.door_style or ""}
        rooms.append(target)
    else:
        if req.collection:
            target["collection"] = req.collection
        if req.door_style:
            target["door_style"] = req.door_style

    for cat, cat_items in cat_map.items():
        existing = target.get(cat) or []
        if req.replace_existing:
            target[cat] = cat_items
        else:
            target[cat] = existing + cat_items

    data["rooms"] = rooms
    update_payload: dict = {"extracted_data": data}
    if req.manufacturer_id:
        update_payload["manufacturer_id"] = req.manufacturer_id
    supabase.table("quotation_projects").update(update_payload).eq("id", req.project_id).execute()

    return {"success": True, "room": req.room_name, "added": len(items), "summary": layout["summary"], "warnings": layout["warnings"]}


# ─── SKU Matching ─────────────────────────────────────────────────────────────

@router.post("/blueprint/match-skus")
def match_skus(req: SkuMatchRequest, user: CurrentUser = Depends(get_current_user)):
    """Match blueprint layout codes to a manufacturer catalog and return a SKU schedule.

    Returns three buckets:
      matched    — EXACT or ORIENTATION hit (high confidence)
      substituted — NEAREST_DIM / CLOSE / ESTIMATED hit (review recommended)
      unresolved  — no catalog match; manual pricing required
    """
    try:
        from app.api.pricing import get_manufacturer_pricing_maps, find_best_match
        supabase = get_supabase()
        lookup_maps = get_manufacturer_pricing_maps(supabase, req.manufacturer_id)

        matched: list[dict] = []
        substituted: list[dict] = []
        unresolved: list[dict] = []

        for item in req.items:
            code = str(item.get("code") or "").strip()
            qty = int(item.get("qty") or 1)
            if not code:
                continue

            match, match_type = find_best_match(code, req.collection, req.door_style, lookup_maps)
            mt = match_type or "MANUAL_PRICING_REQUIRED"

            row = {
                "code": code,
                "qty": qty,
                "sku": match.get("sku") if match else None,
                "price": round(float(match.get("price") or 0), 2) if match else 0.0,
                "line_total": round(float(match.get("price") or 0) * qty, 2) if match else 0.0,
                "collection_name": match.get("collection_name", "") if match else "",
                "match_type": mt,
                "wall": item.get("wall"),
                "category": item.get("category"),
            }

            if "EXACT" in mt or "ORIENT" in mt:
                matched.append(row)
            elif mt == "MANUAL_PRICING_REQUIRED":
                unresolved.append(row)
            else:
                substituted.append(row)

        estimated_list = round(
            sum(r["line_total"] for r in matched + substituted), 2
        )

        return {
            "success": True,
            "matched": matched,
            "substituted": substituted,
            "unresolved": unresolved,
            "summary": {
                "total_items": len(matched) + len(substituted) + len(unresolved),
                "matched_count": len(matched),
                "substituted_count": len(substituted),
                "unresolved_count": len(unresolved),
                "estimated_list_price": estimated_list,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SKU matching failed: {e}")


# ─── PDF Parser ───────────────────────────────────────────────────────────────

@router.post("/blueprint/parse-pdf")
async def parse_pdf(file: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)):
    """Extract wall dimensions + appliances from a dimensioned 2020 Design PDF.
    Returns a draft spec the frontend can display for the user to review and tweak."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files accepted")
    try:
        pdf_bytes = await file.read()
        if len(pdf_bytes) < 100:
            raise HTTPException(status_code=400, detail="PDF too small / empty")
        if len(pdf_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)")
        result = parse_blueprint_pdf(pdf_bytes, max_pages=999)
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF parse failed: {e}")


# ─── AI Refinement ────────────────────────────────────────────────────────────

_AI_PROMPT = """You are a kitchen design expert reviewing a rule-based cabinet layout.
The layout was generated from these walls/islands:

{walls_json}

The rule engine produced:

{items_json}

Review the layout and return STRICT JSON only (no prose, no markdown fences) with:
{{
  "verdict": "ok" | "needs_changes",
  "notes": ["short bulletpoint feedback", ...],
  "suggestions": [
    {{"wall": "A", "action": "replace|insert|remove",
      "target_code": "B33", "with_code": "B36",
      "position_in": 48, "reason": "aligns with standard base size for sink"}}
  ]
}}

Be concise. Focus on: NKBA code conformance, ergonomics (sink / DW adjacency,
range clearance 15"+ on one side), standard cabinet sizes, and filler usage.
Do NOT invent prices. Return ONLY the JSON object."""


class AiRefineRequest(BaseModel):
    spec: dict          # walls input used
    items: list[dict]   # rule-based output


@router.post("/blueprint/ai-refine")
def ai_refine(req: AiRefineRequest, user: CurrentUser = Depends(get_current_user)):
    """Pass the rule-based layout through an LLM for design review and suggestions."""
    try:
        from app.utils.ai_client import llm_generate
    except ImportError:
        raise HTTPException(status_code=503, detail="AI client unavailable")

    prompt = _AI_PROMPT.format(
        walls_json=json.dumps(req.spec, indent=2)[:4000],
        items_json=json.dumps(req.items, indent=2)[:4000],
    )
    try:
        raw = llm_generate(prompt, tier="balanced", max_tokens=1500)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

    # Try to parse the JSON reply (strip markdown fences if present)
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        import re as _re
        cleaned = _re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = _re.sub(r"\s*```$", "", cleaned)
    try:
        review = json.loads(cleaned)
    except Exception:
        import re as _re
        m = _re.search(r"\{.*\}", cleaned, _re.DOTALL)
        review = json.loads(m.group()) if m else {"verdict": "parse_error", "raw": raw[:1000]}

    return {"success": True, "review": review}
