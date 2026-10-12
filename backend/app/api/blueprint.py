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

    # Group items by category so they slot into the room shape the pricing engine expects
    cat_map: dict[str, list[dict]] = {}
    for it in items:
        cat = it["category"]
        cat_map.setdefault(cat, []).append({
            "code": it["code"],
            "qty": it["qty"],
            "notes": it.get("notes", ""),
            "wall": it.get("wall"),
            "position_in": it.get("position_in"),
        })

    data = proj.get("extracted_data") or {}
    rooms = data.get("rooms") or []
    target = next((r for r in rooms if (r.get("room_name") or "").upper() == req.room_name.upper()), None)
    if target is None:
        target = {"room_name": req.room_name, "cabinets": [], "collection": "", "door_style": ""}
        rooms.append(target)

    for cat, cat_items in cat_map.items():
        existing = target.get(cat) or []
        if req.replace_existing:
            target[cat] = cat_items
        else:
            target[cat] = existing + cat_items

    data["rooms"] = rooms
    supabase.table("quotation_projects").update({"extracted_data": data}).eq("id", req.project_id).execute()

    return {"success": True, "room": req.room_name, "added": len(items), "summary": layout["summary"], "warnings": layout["warnings"]}


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
        result = parse_blueprint_pdf(pdf_bytes)
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
