import os
import json
import re
import time
import base64
import fitz  # PyMuPDF
from typing import List, Dict, Any
from dotenv import load_dotenv
from openai import OpenAI
import asyncio

# We configure inside the function to ensure load_dotenv() has been called in main.py

PROMPT = """You are an expert cabinet estimator. Analyze the provided architectural drawing image.
The drawing contains cabinet layouts with SKUs inside boxes.

YOUR TASK:
Scan the drawing and extract CABINETS and ACCESSORIES into structured categories.

CATEGORIES (each room):
- "cabinets": Primary cabinet boxes (W, B, SB, VSB, UF SKUs)
- "perimeter": Cabinets along the wall
- "island": Cabinets in the center island
- "hardware": Doors, drawers, handles
- "bump", "opt_crown", "opt_light_rail", "vent_chase_material"

RULES:
1. Identify the room name (e.g. "KITCHEN", "MASTER BATH").
2. Extract items into categories listed above.
3. **STRIP PARENTHESES**: Notes like (DW), (VOIDS), (CROWN CLEAT) are NOT part of the code. Strip them.
4. **KEEP MODIFIERS**: BUTT, MD, BLD, BD are PART of the SKU (e.g. W3042BUTT).
5. Clean spaces/special chars from codes. Keep 'X' (e.g. HWC2X4X96).
6. **IGNORE TITLE BLOCK**: Designer names, signatures, company names, and initials printed in the title block (bottom of drawing) are NOT cabinet codes. Common examples to SKIP: "WMCCULLOUGH", "WSMITH", "WJONES", or any person's name formatted as W+surname. These are designers, not cabinets.
7. **KEEP FULL CODES**: For vent chase items like "BACK-B48", keep the full code "BACKB48" and place it in "vent_chase_material", NOT in "cabinets".
8. **ISLAND section**: Items labeled (DW) or (DWR) belong in the "island" array, not "cabinets".

OUTPUT FORMAT:
{
  "rooms": [
    {
      "room_name": "KITCHEN",
      "cabinets": [{"code": "W3042BUTT", "quantity": 5}],
      "perimeter": [{"code": "B24", "quantity": 2}],
      "island": [],
      "hardware": [{"code": "DOORS", "quantity": 27}],
      "bump": [],
      "opt_crown": [],
      "opt_light_rail": [],
      "vent_chase_material": []
    }
  ]
}
"""

SUMMARY_PROMPT = """You are an expert cabinet estimator reading a Bill of Materials (BOM) summary sheet from a kitchen cabinet layout document.

The page contains a structured text list of cabinet accessories grouped by section (PERIMETER, HARDWARE, BUMP, OPT CROWN, OPT LIGHT RAIL, ISLAND, HARDWARE-R, OPT VENT CHASE MATERIAL, etc.).

YOUR TASK:
Extract all items from this summary sheet into the correct categories.

RULES:
1. The room name is shown at the top (e.g. "STANDARD 42 KITCHEN").
2. Map each section to the correct category:
   - PERIMETER → "perimeter"
   - HARDWARE-L, HARDWARE-R, HARDWARE → "hardware"
   - BUMP → "bump"
   - OPT CROWN → "opt_crown"
   - OPT LIGHT RAIL → "opt_light_rail"
   - ISLAND → "island"
   - OPT VENT CHASE MATERIAL → "vent_chase_material"
3. Format: "3-BTK8" means quantity=3, code="BTK8".
4. **STRIP PARENTHESES**: (VOIDS), (DW), (CROWN CLEAT) are notes, not part of the code.
5. **KEEP MODIFIERS**: BLD, BD, BUTT are part of the code (e.g. OCM8BLD).
6. For BACK-B48: code = "BACKB48", category = "vent_chase_material".
7. Combine quantities for the same code across sections (e.g. BTK8 from PERIMETER + ISLAND = total BTK8).
8. **IGNORE** TOUCHUP KIT, TOUCHUP SPRAY, CROWN (VAR OPTS), LIGHT RAIL (VAR OPTS) — these are not priceable SKUs.
9. "48 SHELF ADJ" or "48\" SHELF ADJ" → code = "SHELFADJ48", category = "vent_chase_material".
10. HWC codes (e.g. HWC1X2X94, HWC2X4X96) → category = "opt_crown" if near OPT CROWN section, else "perimeter".

OUTPUT FORMAT (same room structure as the floor plan):
{
  "rooms": [
    {
      "room_name": "STANDARD 42 KITCHEN",
      "cabinets": [],
      "perimeter": [{"code": "BTK8", "quantity": 4}, {"code": "SM8", "quantity": 7}],
      "island": [{"code": "UF3", "quantity": 1}],
      "hardware": [{"code": "DOORS", "quantity": 27}, {"code": "DRAWERS", "quantity": 6}],
      "bump": [{"code": "SHM8", "quantity": 5}],
      "opt_crown": [{"code": "OCM8BLD", "quantity": 3}],
      "opt_light_rail": [],
      "vent_chase_material": [{"code": "BACKB48", "quantity": 1}]
    }
  ]
}
"""

def _parse_json_from_text(text: str) -> dict:
    """Extract JSON from AI response text (handles markdown code blocks)."""
    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except Exception:
            pass
    raw_json_match = re.search(r'(\{.*\})', text, re.DOTALL)
    if raw_json_match:
        try:
            return json.loads(raw_json_match.group(1))
        except Exception:
            pass
    return json.loads(text.strip())


def _merge_room_results(floor_plan_result: dict, summary_result: dict) -> dict:
    """
    Merge summary page data into floor plan data.
    Summary page provides authoritative accessory counts; floor plan provides cabinet SKUs.
    """
    merged_rooms = list(floor_plan_result.get("rooms", []))
    summary_rooms = summary_result.get("rooms", [])

    ACCESSORY_KEYS = ["perimeter", "island", "hardware", "bump",
                      "opt_crown", "opt_light_rail", "vent_chase_material"]

    for summary_room in summary_rooms:
        s_name = summary_room.get("room_name", "").upper()
        matched = None
        for fp_room in merged_rooms:
            if fp_room.get("room_name", "").upper() == s_name:
                matched = fp_room
                break
        if matched is None:
            merged_rooms.append(summary_room)
            continue

        # Override accessory sections with summary page data (more accurate)
        for key in ACCESSORY_KEYS:
            if summary_room.get(key):
                matched[key] = summary_room[key]

    # Post-process: remove WMCCULLOUGH and other known false positives from all rooms
    BLACKLIST = {"WMCCULLOUGH"}
    for room in merged_rooms:
        for key in ["cabinets"] + ACCESSORY_KEYS:
            if key in room:
                room[key] = [
                    item for item in room[key]
                    if item.get("code", "").upper() not in BLACKLIST
                ]

    return {"rooms": merged_rooms, "smart_agent_explanations": []}


async def _call_ai(prompt: str, image_bytes: bytes, use_nvidia: bool,
                   nvidia_key: str, google_key: str, log_path: str) -> str:
    """Call the appropriate AI model with a prompt and image."""
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    text = ""
    if use_nvidia:
        client = OpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=nvidia_key
        )
        response = client.chat.completions.create(
            model="meta/llama-3.2-11b-vision-instruct",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}}
                ]
            }],
            max_tokens=2048,
            temperature=0.2
        )
        text = response.choices[0].message.content
    elif google_key:
        import google.generativeai as genai
        from google.generativeai.types import GenerationConfig
        genai.configure(api_key=google_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        gen_cfg = GenerationConfig(temperature=0.0)
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: model.generate_content(
                [prompt, {"mime_type": "image/png", "data": image_bytes}],
                generation_config=gen_cfg
            )
        )
        text = response.text
    else:
        raise Exception("No AI API keys found (NVIDIA or Google).")

    with open(log_path, "a") as log:
        log.write(f"RAW AI RESPONSE:\n{text}\n")
    return text


async def analyze_drawing_vision(file_path: str):
    log_path = "backend_ai_debug.log"
    with open(log_path, "a") as log:
        log.write(f"\n--- New Scan Start: {time.ctime()} ---\n")
        log.write(f"File: {file_path}\n")

    load_dotenv()
    nvidia_key = os.getenv("NVIDIA_API_KEY")
    google_key = os.getenv("GOOGLE_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY")
    use_nvidia = bool(nvidia_key and nvidia_key != "your_nvidia_api_key_here")

    try:
        if not file_path.lower().endswith(".pdf"):
            with open(file_path, "rb") as f:
                image_bytes = f.read()
            provider = "NVIDIA" if use_nvidia else "Gemini"
            print(f"[vision] Using {provider} — single image scan")
            text = await _call_ai(PROMPT, image_bytes, use_nvidia, nvidia_key, google_key, log_path)
            return _parse_json_from_text(text)

        # PDF: scan floor plan page (0) + summary page (1) separately
        doc = fitz.open(file_path)
        total_pages = len(doc)
        provider = "NVIDIA" if use_nvidia else "Gemini"
        print(f"[vision] Using {provider} — PDF with {total_pages} pages")

        # Page 0 — floor plan drawing
        pix0 = doc.load_page(0).get_pixmap(matrix=fitz.Matrix(2, 2))
        floor_plan_bytes = pix0.tobytes("png")

        # Page 1 — BOM/summary sheet (if it exists)
        summary_bytes = None
        if total_pages > 1:
            pix1 = doc.load_page(1).get_pixmap(matrix=fitz.Matrix(2, 2))
            summary_bytes = pix1.tobytes("png")

        doc.close()

        # Scan floor plan for cabinet SKUs
        fp_text = await _call_ai(PROMPT, floor_plan_bytes, use_nvidia, nvidia_key, google_key, log_path)
        floor_plan_result = _parse_json_from_text(fp_text)

        if not summary_bytes:
            # No summary page — still strip blacklisted codes
            return _merge_room_results(floor_plan_result, {"rooms": []})

        # Scan summary page for accessory counts
        sum_text = await _call_ai(SUMMARY_PROMPT, summary_bytes, use_nvidia, nvidia_key, google_key, log_path)
        try:
            summary_result = _parse_json_from_text(sum_text)
        except Exception:
            with open(log_path, "a") as log:
                log.write("WARNING: Could not parse summary page JSON — using floor plan only\n")
            summary_result = {"rooms": []}

        return _merge_room_results(floor_plan_result, summary_result)

    except Exception as e:
        with open(log_path, "a") as log:
            log.write(f"ERROR: {str(e)}\n")
        print(f"Vision Analysis Error: {str(e)}")
        return {"rooms": []}
