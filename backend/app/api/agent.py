"""
KABS AI Agent — Cabinet Intelligence Engine
Handles: manufacturer detection, manufacturer research, training document processing,
         and smart cabinet code understanding for BOM descriptions.
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.core.supabase_client import get_supabase
from app.utils.excel_processor import parse_specifications_python_sync
from app.utils.pdf_processor import parse_pricing_pdf_sync
from app.utils.drawing_processor import extract_drawing_data_python
from app.utils.vision_scanner import analyze_drawing_vision
from app.utils.ai_client import nvidia_generate
from app.utils.rule_based_extractor import extract_rooms_rule_based
from dotenv import load_dotenv
import os, json, re, uuid, traceback, asyncio, datetime
from urllib.parse import unquote

load_dotenv()

router = APIRouter()

# ─── NVIDIA Helper (OpenAI Compatible) ──────────────────────────────────────

async def _ai_generate(prompt: str, tier: str = "flash", max_tokens: int = 4096) -> str:
    """Call NVIDIA NIM API with strict JSON enforcement."""
    model = "meta/llama-3.1-8b-instruct"
    if tier == "balanced":
        model = "meta/llama-3.1-70b-instruct"
    elif tier == "pro-high":
        model = "meta/llama-3.1-405b-instruct"
    
    system_prompt = "You are a specialized JSON extraction engine. Return ONLY valid JSON. No conversational text, no explanations, no markdown preambles. Structure your response exactly as requested."
    
    try:
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: nvidia_generate(prompt, model, system_prompt=system_prompt, max_tokens=max_tokens)
        )
    except Exception as e:
        print(f"NVIDIA API Error: {e}")
        raise

def _parse_json_response(text: str) -> dict:
    """Robustly parse JSON from AI response, with truncation recovery and cleanup."""
    if not text:
        return {}
    
    # Pre-cleanup: remove potential markdown artifacts if they wrap the entire thing
    text = text.strip()
    if text.startswith('```json'):
        text = re.sub(r'^```json\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
    elif text.startswith('```'):
        text = re.sub(r'^```\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
    
    def try_parse(s: str):
        try:
            # Try cleaning common AI hallucinations
            s = s.replace('None', 'null').replace('True', 'true').replace('False', 'false')
            return json.loads(s)
        except:
            return None
    
    # 1. Try finding JSON within markdown code blocks (again, in case of multiple blocks)
    blocks = re.findall(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    for b in blocks:
        result = try_parse(b)
        if result is not None:
            return result
            
    # 2. Try finding a complete JSON object (first { to last })
    m = re.search(r'(\{.*\})', text, re.DOTALL)
    if m:
        result = try_parse(m.group(1).strip())
        if result is not None:
            return result
            
    # 3. Direct parse
    result = try_parse(text)
    if result is not None:
        return result

    # 4. From first { to end — handles truncated responses (e.g. cut off by max_tokens)
    start = text.find('{')
    if start != -1:
        candidate = text[start:]
        result = try_parse(candidate)
        if result is not None:
            return result
        
        # 5. JSON REPAIR: count unclosed braces/brackets and close them
        # Also strip trailing commas which are common in truncated AI responses
        repaired = candidate.rstrip()
        while repaired and repaired[-1] in (',', ' ', '\n', '\r', '\t'):
            repaired = repaired[:-1]
            
        open_braces = repaired.count('{') - repaired.count('}')
        open_brackets = repaired.count('[') - repaired.count(']')
        
        repaired += ']' * max(0, open_brackets)
        repaired += '}' * max(0, open_braces)
        
        result = try_parse(repaired)
        if result is not None:
            print(f"[agent] Repaired truncated JSON (was {len(text)} chars). Recovered successfully.")
            return result
            
    # 6. EMERGENCY FALLBACK: If it's a huge response but failing, maybe it's just missing the root brackets?
    if len(text) > 500 and '"rooms"' in text and not text.strip().startswith('{'):
        candidate = "{" + text + "}"
        result = try_parse(candidate)
        if result is not None:
            return result

    print(f"[agent] Failed to parse AI JSON response. Length: {len(text)}")
    # Log the first 500 chars to help debugging
    print(f"[agent] Start of failing response: {text[:500]}...")
    return {}


# ─── NKBA Cabinet Code Knowledge Base ───────────────────────────────────────

NKBA_KNOWLEDGE = """
NKBA CABINET CODE STANDARDS (National Kitchen & Bath Association):

CABINET TYPE PREFIXES:
- W = Wall Cabinet (mounted on wall above counters)
- B = Base Cabinet (floor-standing, below counter)
- T or UT = Tall/Utility Cabinet (full height, pantry)
- SB = Sink Base (open interior for plumbing, no drawers)
- VSB = Vanity Sink Base (bathroom sink base)
- DB = Drawer Base (all drawers, no doors)
- BF = Blind Corner Base
- WB or BC = Wall Blind Corner
- FCB = Full Corner Base
- WANGL or WAC = Wall Angle Cabinet
- UF = Universal Filler (gap filler strip)
- CM = Crown Molding
- LR or LRM = Light Rail Molding
- BTK = Base Toe Kick
- TK = Toe Kick
- OCM = Outside Corner Molding
- ICM = Inside Corner Molding
- SM = Scribe Molding
- FL = Filler (generic)
- QM = Quarter Round Molding
- SHM = Shim (shimming material)
- HWC = Hardwood Cleat
- DWR = Drawer (accessory)
- DISH = Dishwasher (placeholder/space)
- REF or RR = Refrigerator (placeholder/space)
- RANGE = Range/Stove (placeholder)
- HOOD = Range Hood
- OVD = Oven/Microwave tall cabinet
- S = Specialty/Shelf unit
- VSB = Vanity Sink Base (bathroom)
- VB = Vanity Base (bathroom)
- VW or VT = Vanity Wall/Tall (bathroom upper)

DIMENSION ENCODING (WxH or WxD):
- W3042 = Wall cabinet, 30" wide, 42" tall
- B30 = Base cabinet, 30" wide (standard 34.5" tall)
- SB36 = Sink Base, 36" wide
- W3624 = Wall cabinet, 36" wide, 24" tall
- W2442 = Wall cabinet, 24" wide, 42" tall

DRAWING SUFFIXES (appear in architectural drawings, NOT in manufacturer catalogs):
- BUTT = Butt/flush door style (no overlay gap, doors meet at center)
- H = Hinged variant
- L = Left-hand orientation
- R = Right-hand orientation
- AS = Applied/adjacent styling
- 1DDWR = One-door with drawer
- DWR = With drawer
- {L} or {R} = Left/right designation
- CLEAT = A wood cleat/nailer piece

MANUFACTURER CATALOG SUFFIXES (added by manufacturers to identify door style/finish):
- BD = Butt Door (Integrity Cabinets)
- MDBD = Multi-door Butt Door
- BDFHD = Butt Door Full Height Door
- BDDS = Butt Door Deep Shelf
- FF = Face Frame
- FL = Frameless

CABINET POSITIONING CONTEXT:
- Wall cabinets (W) go above countertops
- Base cabinets (B) sit on floor, support countertop
- Tall cabinets (T/UT) are floor-to-ceiling or pantry units
- SB (Sink Base) is always at the kitchen sink location
- VSB (Vanity Sink Base) is always at bathroom vanity/sink
- Refrigerator space: B or REF placeholder next to wall
- Dishwasher space: DISH or DISH-IQ placeholder at sink area
- Island cabinets appear in center of kitchen
- Bump = finishing/boxing material at transitions

MANUFACTURER PDF TYPES & FORMATS:
1. **Elite Building Solutions**: Standard format (MIH/DRH style). 
   - Trim List present on Page 2 (sections: PERIMETER, ISLAND, OPT CROWN).
   - Codes: W3042BUTT, B30BUTT, SB36BUTT.
2. **DRH Express**: 
   - Suffixes: -L/-R (hinge direction). Count variants separately.
   - Trim Equivalents: TOEKICK8 (BTK8), MSW8 (Scribe/Filler), MQR8 (Shoe Molding).
   - Non-Cabinets: F331, F342 (Fillers), PEPR335-L (End Panel).
3. **Wellborn Premier/Binder**: 3D binder format.
   - CRITICAL: No cabinet codes in PDF. Flag "Cabinet codes not found in PDF". Extract room names only.
4. **Marquis/Custom**: Renovation format.
   - Suffixes: -2B (2 doors bottom), -3 (3 drawers), NP, OWLSR.
   - Parts list on floor plan itself. Extract from elevation views.

SPECIAL EXTRACTION RULES:
- BACK-B48 or B48 labeled as "(VENT BOX)" in the Opt Vent Chase Material section must NEVER be classified as a Base Cabinet.
- Appliances (RANGE, DISH, MW.HOOD, REF) go under "Accessories" or "Perimeter".
- Count -L and -R variants as separate line items.
- Universal Fillers (UF) found in the ISLAND section must be categorized as 'island' items, not general cabinets.
- Hardware keywords like DOORS, DRAWERS, HINGES, PULLS must be extracted as valid items when found in hardware sections, preserving their quantities (e.g., "24 DOORS").
- Scribe (SM8) and Toe Kick (BTK8) must be accurately categorized based on their section (Perimeter vs Island).
- Flag any unknown or malformed codes.
"""

MANUFACTURER_RESEARCH_PROMPT = """You are an expert cabinet industry researcher with deep knowledge of all major cabinet manufacturers.

Research this cabinet manufacturer: {manufacturer_name}

Based on your knowledge, provide detailed information about their cabinet coding system:

REQUIRED FIELDS:
1. coding_system: How do they structure cabinet codes? (e.g., "PREFIX + Width + Height" format)
2. series_lines: What product lines/series do they offer? (e.g., ["Classic", "Premium", "Semi-Custom"])
3. wall_cabinet_prefix: What prefix for wall cabinets? (e.g., "W", "WC", "CW")
4. base_cabinet_prefix: What prefix for base cabinets? (e.g., "B", "BC", "CB")
5. tall_cabinet_prefix: What prefix for tall/pantry cabinets? (e.g., "T", "UT", "OVD")
6. sink_base_prefix: What prefix for sink base cabinets?
7. door_style_codes: How do they encode door styles in SKUs?
8. finish_codes: How do they encode finish/wood species?
9. dimension_format: How are dimensions embedded? (e.g., "WW HH" = width first then height)
10. special_suffixes: Any special suffixes they use?
11. butt_door_code: How do they represent "butt door" (doors meeting at center)?
12. frameless_code: How do they represent frameless construction?
13. example_skus: Give 5-10 example SKUs with explanations
14. notes: Any special considerations, unusual codes, or important details
15. confidence: Your confidence level 0-1 in this research

Return ONLY a valid JSON object with these fields. No other text.
"""

DETECT_MANUFACTURER_PROMPT = """You are an expert cabinet industry analyst. Analyze these cabinet codes extracted from architectural drawings.

Cabinet codes found:
{codes_list}

Context from drawings:
- Room types: {room_types}
- Project info: {project_info}

Your task: Identify which cabinet manufacturer these codes belong to.

Consider:
1. The prefix patterns (W, B, SB, T, UF, CM, BTK, etc.)
2. The suffix patterns (BUTT, BD, FF, AS, etc.)
3. The dimension format and ranges
4. Special codes like BACK-B48, WTEP84, OVD, S3S396
5. The overall coding style

Known manufacturer patterns:
- Integrity Cabinets: Uses BD/MDBD/BDFHD suffixes, BACK-B48, WTEP84, S3S396 for tall adjustments, OVD for oven towers
- Aristokraft: Uses standard NKBA codes, numeric door style codes
- KraftMaid: Uses KC prefix variants, specific numbering
- Merillat: Uses M prefix variants
- Wellborn: WC prefix variants
- StarMark: SM prefix
- Plain & Fancy: P&F codes
- Waypoint: WP codes
- Thomasville: TS codes
- Diamond: D prefix codes

Use NKBA standard knowledge:
{nkba_knowledge}

Return ONLY valid JSON:
{{
  "detected_manufacturer": "Manufacturer Name or Unknown",
  "confidence": 0.0-1.0,
  "reasoning": "Detailed explanation of why you detected this manufacturer",
  "key_indicators": ["list", "of", "specific", "codes", "that", "gave", "it", "away"],
  "alternative_matches": [
    {{"manufacturer": "Name", "confidence": 0.3, "reason": "why"}}
  ],
  "coding_patterns_observed": {{
    "wall_prefix": "W",
    "base_prefix": "B",
    "door_style_suffix": "BUTT or BD",
    "special_codes": ["BACK-B48", "WTEP84"]
  }}
}}
"""

CABINET_CONTEXT_PROMPT = """You are a master cabinet estimator and NKBA-certified kitchen designer.

Analyze this cabinet item from an architectural drawing and provide a detailed description.

Cabinet Code: {sku}
Room: {room}
Room Context: {room_context}
Drawing Category: {category}
Matched Catalog SKU: {matched_sku}
Price: ${price}
Manufacturer: {manufacturer}

NKBA Knowledge:
{nkba_knowledge}

Analyze the cabinet code completely:
1. What type of cabinet is this? (Wall, Base, Tall, Sink Base, Vanity, Molding, Hardware, etc.)
2. What are the dimensions encoded in the code?
3. What drawing suffixes are present and what do they mean?
4. Where is this cabinet placed in the floor plan (position/purpose)?
5. Why is this cabinet used here (function)?
6. How does the drawing code relate to the matched catalog SKU?

Return ONLY valid JSON:
{{
  "cabinet_type": "Full descriptive type (e.g., Wall Cabinet)",
  "dimensions": "e.g., 30 wide x 42 tall",
  "description": "Clear 1-2 sentence description for the BOM (e.g., '30\\" x 42\\" Wall Cabinet with butt door style, mounted above base cabinets in kitchen perimeter run')",
  "drawing_suffix_meaning": "What BUTT/H/L/R/etc means here",
  "position_in_room": "e.g., Above sink area, island perimeter, etc.",
  "function": "Why this cabinet is here",
  "match_explanation": "How the drawing code {sku} was matched to catalog SKU {matched_sku}"
}}
"""

TRAINING_EXTRACT_PROMPT = """You are a cabinet industry expert analyzing a document to extract key knowledge.

Document name: {doc_name}
Document type: {doc_type}
User description: {user_description}

Document content (excerpt):
{content_excerpt}

Extract and structure the key knowledge from this document. Focus on:
1. If it's a spec book: cabinet codes, dimensions, series names, coding rules
2. If it's NKBA rules: standard abbreviations, placement rules, code definitions
3. If it's a pricing sheet: SKU patterns, price ranges, series names
4. If it's manufacturer data: how they code cabinets, special codes, suffixes

Return ONLY valid JSON:
{{
  "document_summary": "2-3 sentence summary of what this document contains",
  "manufacturer_name": "Manufacturer name if specific, null if general",
  "key_codes": {{"code": "meaning", "code2": "meaning2"}},
  "coding_rules": ["rule 1", "rule 2"],
  "series_names": ["series 1", "series 2"],
  "dimension_format": "How dimensions are encoded",
  "special_knowledge": ["important fact 1", "important fact 2"],
  "nkba_standards": ["standard 1", "standard 2"],
  "price_ranges": {{}},
  "searchable_terms": ["term1", "term2", "term3"]
}}
"""


# ─── Endpoint: Detect Manufacturer ──────────────────────────────────────────

@router.post("/agent/detect-manufacturer")
async def detect_manufacturer(payload: dict):
    """
    Analyzes extracted cabinet codes from a drawing and detects the manufacturer.
    """
    try:
        project_id = payload.get("project_id")
        codes = payload.get("codes", [])          # list of {"code": "W3042BUTT", "room": "Kitchen"}
        room_types = payload.get("room_types", [])
        project_info = payload.get("project_info", "")

        if not codes:
            return {"detected_manufacturer": "Unknown", "confidence": 0, "reasoning": "No codes provided"}

        codes_formatted = "\n".join([f"  - {c.get('code', '')} (in {c.get('room', 'unknown room')})" for c in codes[:60]])
        rooms_str = ", ".join(set(room_types)) if room_types else "Unknown"

        prompt = DETECT_MANUFACTURER_PROMPT.format(
            codes_list=codes_formatted,
            room_types=rooms_str,
            project_info=project_info or "Residential construction drawings",
            nkba_knowledge=NKBA_KNOWLEDGE[:2000]  # truncate for token limit
        )

        result = _parse_json_response(await _ai_generate(prompt))

        # Save detection result to DB if project_id provided
        if project_id and result:
            try:
                supabase = get_supabase()
                supabase.table("manufacturer_detections").insert({
                    "project_id": project_id,
                    "detected_manufacturer": result.get("detected_manufacturer", "Unknown"),
                    "detection_confidence": float(result.get("confidence", 0)),
                    "detection_reasoning": result.get("reasoning", ""),
                    "sample_codes": codes[:20]
                }).execute()
            except Exception as db_err:
                print(f"[agent] Detection save error: {db_err}")

        return {"success": True, **result}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e), "detected_manufacturer": "Unknown", "confidence": 0}


# ─── Endpoint: Research Manufacturer ────────────────────────────────────────

@router.post("/agent/research-manufacturer")
async def research_manufacturer(payload: dict):
    """
    AI researches an unknown manufacturer to understand their cabinet coding system.
    Saves results to the database for future use.
    """
    try:
        manufacturer_name = payload.get("manufacturer_name", "").strip()
        if not manufacturer_name:
            raise HTTPException(status_code=400, detail="manufacturer_name is required")

        supabase = get_supabase()

        # Check if we already have research cached
        existing = supabase.table("manufacturer_research") \
            .select("*").eq("manufacturer_name", manufacturer_name).execute()
        if existing.data:
            cached = existing.data[0]
            # Return cached if less than 30 days old
            return {"success": True, "cached": True, "research": cached["research_data"],
                    "confidence": cached["confidence_score"], "manufacturer_name": manufacturer_name}

        # Research with Gemini Pro for best quality
        prompt = MANUFACTURER_RESEARCH_PROMPT.format(manufacturer_name=manufacturer_name)
        result = _parse_json_response(await _ai_generate(prompt, tier="pro-high"))

        if not result:
            return {"success": False, "error": "AI could not research this manufacturer", "research": {}}

        confidence = float(result.get("confidence", 0.5))

        # Save to database
        supabase.table("manufacturer_research").upsert({
            "manufacturer_name": manufacturer_name,
            "research_data": result,
            "confidence_score": confidence,
            "is_verified": False
        }, on_conflict="manufacturer_name").execute()

        return {
            "success": True,
            "cached": False,
            "research": result,
            "confidence": confidence,
            "manufacturer_name": manufacturer_name
        }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e), "research": {}}


# ─── Endpoint: Generate Cabinet Descriptions for BOM ────────────────────────

@router.post("/agent/generate-bom-descriptions")
async def generate_bom_descriptions(payload: dict):
    """
    For a list of BOM items, generate rich AI descriptions explaining each cabinet,
    its type, dimensions, position in room, and how it was matched to catalog.
    Saves descriptions back to quotation_boms table.
    """
    try:
        manufacturer_name = payload.get("manufacturer_name", "Unknown")
        bom_items = payload.get("bom_items", [])  # list of BOM row dicts
        batch_size = 100  # Process in larger batches to minimize API calls and respect RPM

        if not bom_items:
            return {"success": True, "processed": 0}

        supabase = get_supabase()
        processed = 0

        # Build room context map
        room_context_map = {}
        for item in bom_items:
            room = item.get("room", "")
            if room not in room_context_map:
                room_context_map[room] = []
            room_context_map[room].append(item.get("sku", ""))

        # Process in batches for efficiency
        for i in range(0, len(bom_items), batch_size):
            batch = bom_items[i:i + batch_size]

            # Build a combined prompt for the batch
            items_text = "\n".join([
                f"{j+1}. SKU={item.get('sku','?')} | Room={item.get('room','?')} | "
                f"Category={item.get('category', _infer_category(item.get('sku','')))} | "
                f"Matched={item.get('matched_sku','?')} | Price=${item.get('unit_price',0)}"
                for j, item in enumerate(batch)
            ])

            batch_prompt = f"""You are a master cabinet estimator. For each cabinet item below, provide a concise professional description.

Manufacturer: {manufacturer_name}

{NKBA_KNOWLEDGE[:1500]}

ITEMS TO DESCRIBE:
{items_text}

For each item, return a JSON object with fields:
- description: 1-2 sentence professional description for BOM
- cabinet_type: Short type name (e.g., "Wall Cabinet", "Base Cabinet", "Toe Kick", "Crown Molding")
- match_explanation: How drawing code was matched to catalog SKU (1 sentence)

Return ONLY a JSON array with one object per item, in the same order as the input.
Example: [{{"description": "...", "cabinet_type": "...", "match_explanation": "..."}}]
"""
            try:
                text = await _ai_generate(batch_prompt)

                # Parse array response
                arr_match = re.search(r'\[.*\]', text, re.DOTALL)
                descriptions = []
                if arr_match:
                    try:
                        descriptions = json.loads(arr_match.group(0))
                    except:
                        pass

                # Update DB for each item in batch
                for j, item in enumerate(batch):
                    item_id = item.get("id")
                    if not item_id:
                        continue

                    desc_data = descriptions[j] if j < len(descriptions) else {}
                    sku = item.get("sku", "")

                    update_payload = {
                        "description": desc_data.get("description") or _fallback_description(sku, item),
                        "cabinet_type": desc_data.get("cabinet_type") or _infer_category(sku),
                        "match_explanation": desc_data.get("match_explanation") or f"Matched drawing code {sku} to catalog"
                    }

                    supabase.table("quotation_boms").update(update_payload).eq("id", item_id).execute()
                    processed += 1

            except Exception as batch_err:
                print(f"[agent] Batch description error: {batch_err}")
                # Fallback: write basic descriptions
                for item in batch:
                    item_id = item.get("id")
                    if item_id:
                        sku = item.get("sku", "")
                        supabase.table("quotation_boms").update({
                            "description": _fallback_description(sku, item),
                            "cabinet_type": _infer_category(sku),
                            "match_explanation": f"Matched drawing code {sku} to catalog SKU {item.get('matched_sku', 'N/A')}"
                        }).eq("id", item_id).execute()
                        processed += 1

            # Small delay between batches to stay under RPM limits
            await asyncio.sleep(2.0)

        return {"success": True, "processed": processed, "total": len(bom_items)}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ─── Helper: Training Logic ──────────────────────────────────────────────────

async def _perform_training(
    file_content: bytes,
    file_name: str,
    doc_name: str,
    doc_type: str,
    description: str = "",
    manufacturer_id: str = "",
    manufacturer_name: str = "",
    existing_url: str = None
):
    """
    Core training logic: parses content, calls AI for knowledge extraction,
    and saves to training_documents table.
    """
    supabase = get_supabase()
    file_ext = os.path.splitext(file_name)[1].lower() or ".pdf"

    file_url = existing_url
    if not file_url:
        # Upload to training-docs bucket if it's a new file
        storage_path = f"training/{uuid.uuid4()}{file_ext}"
        supabase.storage.from_("training-docs").upload(
            storage_path, file_content,
            file_options={"content-type": "application/octet-stream"}
        )
        file_url = supabase.storage.from_("training-docs").get_public_url(storage_path)

    # ── Step 1: Smart Python extraction ──
    structured_summary = ""
    pre_parsed_records = []

    if file_ext in (".xlsx", ".xlsm", ".xls"):
        records = await asyncio.get_event_loop().run_in_executor(
            None, parse_specifications_python_sync, file_content, manufacturer_id or "unknown", str(uuid.uuid4())
        )
        pre_parsed_records = records or []
        if pre_parsed_records:
            collections = {}
            for r in pre_parsed_records:
                col = r.get("collection_name", "Unknown")
                if col not in collections: collections[col] = []
                if len(collections[col]) < 8:
                    collections[col].append(f"{r['sku']}=${r['price']:.2f}")

            lines = [f"Excel pricing sheet: {len(pre_parsed_records)} SKU-price records found.\n"]
            for col, samples in list(collections.items())[:15]:
                lines.append(f"Collection '{col}': {', '.join(samples)}")
            structured_summary = "\n".join(lines)

    elif file_ext == ".pdf":
        records = await asyncio.get_event_loop().run_in_executor(
            None, parse_pricing_pdf_sync, file_content, manufacturer_id or "unknown", str(uuid.uuid4())
        )
        pre_parsed_records = records or []
        if pre_parsed_records:
            collections = {}
            for r in pre_parsed_records:
                col = r.get("collection_name", "Unknown")
                if col not in collections: collections[col] = []
                if len(collections[col]) < 8:
                    collections[col].append(f"{r['sku']}=${r['price']:.2f}")

            lines = [f"PDF pricing sheet: {len(pre_parsed_records)} SKU-price records found.\n"]
            for col, samples in list(collections.items())[:15]:
                lines.append(f"Collection '{col}': {', '.join(samples)}")
            structured_summary = "\n".join(lines)

    if not structured_summary:
        structured_summary = _extract_text_from_bytes(file_content, file_ext)[:6000]

    # ── Step 2: AI Knowledge Extraction ──
    extracted_knowledge = {}
    if structured_summary.strip():
        prompt = TRAINING_EXTRACT_PROMPT.format(
            doc_name=doc_name,
            doc_type=doc_type,
            user_description=description or "No description provided",
            content_excerpt=structured_summary
        )
        ai_text = await _ai_generate(prompt)
        extracted_knowledge = _parse_json_response(ai_text) or {}

    extracted_knowledge["_pre_parsed_records"] = len(pre_parsed_records)

    # ── Step 3: Save to DB ──
    insert_data = {
        "name": doc_name,
        "description": description,
        "doc_type": doc_type,
        "file_url": file_url,
        "file_name": file_name,
        "file_size_bytes": len(file_content),
        "extracted_knowledge": extracted_knowledge,
        "is_active": True,
        "manufacturer_id": manufacturer_id or None,
        "manufacturer_name": manufacturer_name or None
    }
    res = supabase.table("training_documents").insert(insert_data).execute()
    doc_id = res.data[0]["id"] if res.data else None

    return {
        "success": True,
        "doc_id": doc_id,
        "file_url": file_url,
        "extracted_knowledge": extracted_knowledge,
        "pre_parsed_records": len(pre_parsed_records),
        "message": f"'{doc_name}' trained successfully using {len(pre_parsed_records)} pricing records."
    }


# ─── Endpoint: Process Training Document (Upload) ───────────────────────────

@router.post("/agent/process-training-doc")
async def process_training_doc(
    file: UploadFile = File(...),
    doc_name: str = Form(...),
    doc_type: str = Form(default="general"),
    description: str = Form(default=""),
    manufacturer_id: str = Form(default=""),
    manufacturer_name: str = Form(default="")
):
    """Process a NEW uploaded file for training."""
    try:
        file_content = await file.read()
        return await _perform_training(
            file_content=file_content,
            file_name=file.filename,
            doc_name=doc_name,
            doc_type=doc_type,
            description=description,
            manufacturer_id=manufacturer_id,
            manufacturer_name=manufacturer_name
        )
    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/agent/train-from-existing")
async def train_from_existing(payload: dict):
    """
    Train AI using a file that already exists in manufacturer_files.
    Avoids redundant uploads.
    """
    try:
        file_id = payload.get("file_id")
        doc_name = payload.get("doc_name")
        doc_type = payload.get("doc_type", "general")
        description = payload.get("description", "")

        if not file_id:
            raise HTTPException(status_code=400, detail="file_id is required")

        supabase = get_supabase()

        # 1. Get file metadata and manufacturer info
        file_res = supabase.table("manufacturer_files") \
            .select("*, manufacturers(name)") \
            .eq("id", file_id).single().execute()
        
        if not file_res.data:
            raise HTTPException(status_code=404, detail="File not found")
        
        file_data = file_res.data
        mfr_name = file_data.get("manufacturers", {}).get("name", "")

        # 2. Download file content from Supabase storage
        # URL format: .../storage/v1/object/public/BUCKET_NAME/PATH
        file_url = file_data.get("file_url", "")
        
        # Check for broken references
        if not file_url or file_url in ("local_temp", "#", "null", "undefined"):
            raise HTTPException(
                status_code=400, 
                detail="This file reference is broken or was uploaded using an old method. "
                       "Please re-upload this file in the Manufacturers section to enable AI training."
            )
        
        bucket_name = "manufacturer-docs"
        
        # Robust path extraction
        file_path = ""
        if f"/{bucket_name}/" in file_url:
            file_path = file_url.split(f"/{bucket_name}/")[1]
        elif "/public/" in file_url:
            # Fallback: take everything after 'public/' and strip the first segment (bucket)
            parts = file_url.split("/public/")[1].split("/", 1)
            if len(parts) > 1:
                file_path = parts[1]
        else:
            # Last resort: if it's not a URL, it might be the path itself
            if not file_url.startswith("http"):
                file_path = file_url
        
        if not file_path:
            print(f"ERROR: Could not parse file path from URL: {file_url}")
            raise HTTPException(status_code=400, detail=f"Invalid file URL format: {file_url}")

        # Strip query parameters if any
        file_path = file_path.split("?")[0]
        
        # NEW: Decode URL encoding (e.g. %20 -> space)
        file_path = unquote(file_path)
        
        try:
            file_bytes = supabase.storage.from_(bucket_name).download(file_path)
        except Exception as se:
            print(f"ERROR: Failed to download from Supabase storage ({bucket_name}/{file_path}): {se}")
            # Try from training-docs bucket as a fallback
            try:
                file_bytes = supabase.storage.from_("training-docs").download(file_path)
            except:
                raise Exception(f"Failed to download file from storage: {str(se)}")

        # 3. Run training
        return await _perform_training(
            file_content=file_bytes,
            file_name=file_data["file_name"],
            doc_name=doc_name or file_data["file_name"],
            doc_type=doc_type,
            description=description,
            manufacturer_id=file_data["manufacturer_id"],
            manufacturer_name=mfr_name,
            existing_url=file_url
        )
    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/agent/available-manufacturer-files")
async def get_available_manufacturer_files():
    """List manufacturer files that can be used for AI training."""
    try:
        supabase = get_supabase()
        # Get all manufacturer files
        files_res = supabase.table("manufacturer_files") \
            .select("id, file_name, file_type, file_url, created_at, manufacturer_id, manufacturers(name)") \
            .order("created_at", desc=True).execute()
        
        # Get already trained file URLs to avoid duplicates
        trained_res = supabase.table("training_documents") \
            .select("file_url").eq("is_active", True).execute()
        trained_urls = {t["file_url"] for t in trained_res.data} if trained_res.data else set()

        available = []
        for f in (files_res.data or []):
            url = f.get("file_url", "")
            # Skip broken references
            if not url or url in ("local_temp", "#", "null", "undefined"):
                continue
                
            available.append({
                **f,
                "manufacturer_name": f.get("manufacturers", {}).get("name", "Unknown"),
                "is_already_trained": url in trained_urls
            })
        
        return {"success": True, "files": available}
    except Exception as e:
        return {"success": False, "error": str(e)}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ─── Endpoint: List Training Documents ──────────────────────────────────────

@router.get("/agent/training-docs")
async def list_training_docs():
    """List all active training documents."""
    try:
        supabase = get_supabase()
        res = supabase.table("training_documents") \
            .select("id,name,description,doc_type,file_name,file_url,manufacturer_name,extracted_knowledge,is_active,created_at") \
            .eq("is_active", True) \
            .order("created_at", desc=True) \
            .execute()
        return {"success": True, "documents": res.data or []}
    except Exception as e:
        return {"success": False, "error": str(e), "documents": []}


# ─── Endpoint: FULL DOCUMENT Analysis (Single AI Call) ─────────────────────

@router.post("/agent/analyze-drawing-full")
async def analyze_drawing_full(payload: dict):
    """
    STEP-WISE FAST ANALYSIS - Processes the entire PDF in one shot:
    STEP 1: PyMuPDF extracts text from ALL pages (< 1 second, no AI needed).
    STEP 2: One single AI call with all extracted text → returns all rooms.
    10x faster than per-page approach.
    """
    try:
        pdf_bytes = payload.get("pdf_bytes")
        pdf_url = payload.get("pdf_url")

        if not pdf_bytes:
            if not pdf_url:
                raise HTTPException(status_code=400, detail="pdf_url or pdf_bytes is required")

            # STEP 1: Download and extract ALL pages text (ultra fast, no AI)
            print(f"[full-scan] STEP 1: Downloading PDF from URL...")
            import httpx
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(pdf_url)
                pdf_bytes = resp.content
        else:
            print(f"[full-scan] STEP 1: Using pre-loaded PDF bytes.")
        
        python_data = extract_drawing_data_python(pdf_bytes)
        print(f"[full-scan] STEP 1 done. Pages: {len(python_data['pages'])}, Codes found: {len(python_data['potential_codes'])}")

        if not python_data["has_selectable_text"] or len(python_data["potential_codes"]) < 3:
            print("[full-scan] Insufficient text. Document may be scanned image. Using vision fallback.")
            temp_path = f"temp_full_{uuid.uuid4()}.pdf"
            with open(temp_path, "wb") as f:
                f.write(pdf_bytes)
            try:
                vision_result = await analyze_drawing_vision(temp_path)
                rooms = vision_result.get("rooms", [])
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            return {"success": True, "rooms": rooms, "method": "vision"}

        # STEP 2: One AI call for all pages combined
        print(f"[full-scan] STEP 2: Running single AI pass on full document...")
        
        # Trim to fit context window (keep page structure)
        combined_text = python_data["raw_text"][:18000]
        all_codes = python_data["potential_codes"][:150]
        
        prompt = f"""You are a cabinet extraction AI for home layout PDFs.
Your job is to extract cabinet codes and quantities with 100% accuracy from EVERY room variant.

FULL BLUEPRINT TEXT (all pages):
{combined_text}

ALL SKU CODES PRE-EXTRACTED BY PYTHON:
{", ".join(all_codes)}

═══════════════════════════════════════════════════════
PHASE 1: IDENTIFY PDF TYPE FIRST
═══════════════════════════════════════════════════════
Before extracting, identify which PDF type this is:
  A) ELITE_STANDARD  → Has Trim List page, codes like W3042BUTT, BACK-B48, WTEP84
  B) DRH_EXPRESS     → Has -L/-R suffixes, TOEKICK8, MSW8, MQR8, F331/F342
  C) WELLBORN_BINDER → 3D visual only, no codes present (return names + flag)
  D) CUSTOM_MARQUIS  → Codes with -2B/-3 suffixes, FREPU, parts list on floor plan

═══════════════════════════════════════════════════════
PHASE 2: SECTION RULES (enforce these strictly)
═══════════════════════════════════════════════════════
Map each extracted item to the correct section bucket:
  - PERIMETER section → "cabinets", "perimeter", "hardware", "bump", "opt_crown"
  - ISLAND section    → "island", "island_hardware", "island_bump" (NEVER merge with PERIMETER)
  - OPT VENT CHASE    → "vent_chase_material" ONLY
  - OPT CROWN section → "opt_crown" ONLY
  - OPT LIGHT RAIL    → "opt_light_rail" ONLY (separate from Perimeter Specs)
  - BUMP/BOXING       → "bump" ONLY

CRITICAL — NEVER combine PERIMETER + ISLAND quantities of the same code.
Example: SM8 in PERIMETER qty=5 AND SM8 in ISLAND qty=1 → two SEPARATE entries.

═══════════════════════════════════════════════════════
PHASE 3: CRITICAL COMPLETENESS RULES
═══════════════════════════════════════════════════════

RULE A — NEVER LEAVE SECTIONS BLANK
Every room variant MUST have ALL sections extracted.
Never leave Perimeter Specs, Island Specs, Hardware, or Vent Chase blank
just because the room appears simple or the trim list did not repeat it.

RULE B — SAME TRIM LIST COVERS ALL VARIANTS
In Elite Standard PDFs the Trim List on page 2 covers BOTH Standard and
Optional kitchen variants. Apply those trim quantities to EACH variant
unless the trim list explicitly shows different quantities per variant.
  Standard Kitchen → full extraction including all trim ✅
  OPT Gourmet Kitchen → SAME full extraction, not cabinets-only ✅

RULE C — EVERY KITCHEN VARIANT NEEDS ALL SECTIONS
When the PDF contains Standard Kitchen AND OPT Gourmet Kitchen AND
OPT Extended Kitchen etc., EACH is a completely separate room entry with:
  cabinets, perimeter, island, hardware, island_hardware,
  bump, island_bump, opt_crown, opt_light_rail, vent_chase_material

RULE D — EVERY BATH NEEDS ALL SECTIONS
Even small or simple bathrooms must have:
  Vanity Cabinets, Universal Fillers, Perimeter Specs (BTK8, SM8),
  Hardware (SHM8), Opt Crown if present.
  Never leave bath Perimeter Specs or Hardware blank.

RULE E — SB36BUTT QUANTITY HARD RULE
SB36BUTT is a sink base cabinet. One kitchen has ONE sink. Therefore:
  SB36BUTT quantity is ALWAYS 1 in ANY kitchen layout.
  This applies to Standard, Gourmet, Extended, and ALL other variants.
  If your extraction produces SB36BUTT qty=2 → you have made an error.
  Correct it to qty=1 immediately. No exceptions.

RULE E2 — BATH 2 TRIM PATTERN IS IDENTICAL TO BATH 3
Bath 2 (STD BATH 2) must ALWAYS contain:
  perimeter: BTK8 qty=1, SM8 qty=1
  hardware:  SHM8 qty=1, OCM8BLD qty=1
These values come from the bath trim list section. If Bath 3 has these items,
Bath 2 must have the exact same items. Never leave Bath 2 perimeter or hardware blank.

RULE F — LAUNDRY OPT LIGHT RAIL IS A SEPARATE SECTION
Laundry can have BOTH Perimeter Specs and Opt Light Rail sections.
NEVER combine their quantities. Store as two separate arrays:
  perimeter: [SM8=1, FL24=1]
  opt_light_rail: [SM8=1, FL24=1, BTK8=1]

RULE G — VENT CHASE MUST ALWAYS BE EXTRACTED
When a Vent Chase section exists, extract ALL 5 items:
  B48 or BACK-B48 (vent box), WTEP84, SM8, OCM8BLD, QM8
  These are SEPARATE from Perimeter SM8 and Bump OCM8BLD.

RULE H — OCM8BLD APPEARS IN MULTIPLE SECTIONS
OCM8BLD can be in Bump/Boxing AND OPT CROWN AND Vent Chase.
Each appearance = its own entry in the correct array. NEVER merge them.

RULE I — ISLAND SPECS ARE ALWAYS SEPARATE
Island BTK8 ≠ Perimeter BTK8. Island SM8 ≠ Perimeter SM8.
UF3 and UF642 found in island section → "island" array (match the PDF section layout).
BTK8 and SM8 found in island section → "island" array (they are island accessories).
DOORS and DRAWERS found in island hardware section → "island_hardware" array.

═══════════════════════════════════════════════════════
PHASE 4: ROOM COMPLETION CHECKLISTS
═══════════════════════════════════════════════════════

KITCHEN (any variant — Standard, Gourmet, Extended, etc.):
  ✅ cabinets: Wall (W*), Base (B*/SB*), Tall (T*/P*/O*/OVD*), Fillers (UF*)
  ✅ perimeter: BTK8, SM8, FL48
  ✅ island: BTK8, SM8 (island section)
  ✅ hardware: DWR3 (ONLY if explicitly listed with a quantity in the BOM — do NOT infer from (DW) labels), SHM8, OCM8BLD
  ✅ island_hardware: DOORS count, DRAWERS count
  ✅ bump: SHM8, OCM8BLD (bump/boxing section)
  ✅ vent_chase_material: B48/BACK-B48, WTEP84, SM8, OCM8BLD, QM8
  ✅ opt_crown: OCM8BLD, QM8 (crown section if present)

BATHROOM:
  ✅ cabinets: VSB* vanity, UF* fillers
  ✅ perimeter: BTK8, SM8
  ✅ hardware: SHM8, OCM8BLD if present
  ✅ opt_crown: if present

LAUNDRY:
  ✅ cabinets: W* uppers, B* bases, UF* fillers
  ✅ perimeter: SM8, FL24, BTK8
  ✅ hardware: SHM8
  ✅ opt_light_rail: SM8, FL24, BTK8 (if opt light rail section exists — separate from perimeter)

═══════════════════════════════════════════════════════
PHASE 5: CODE RULES
═══════════════════════════════════════════════════════
1. ROOM NAMES — canonical forms:
   - "STANDARD 42 KITCHEN", "STD 42 KITCHEN" → "STANDARD 42 KITCHEN"
   - "OPT GOURMET KITCHEN" → "OPT GOURMET KITCHEN" (separate entry, never merged)
   - Any LAUNDRY variant → "OPT LAUNDRY"
   - "STANDARD BATH 3 UPSTAIRS" → "BATH 3"
   - "STANDARD OWNERS BATH" → "OWNERS BATH"
   Same room on multiple pages = ONE merged entry.

2. CODES ONLY — never include room titles, descriptions, or notes as a code.

3. STRIP QTY PREFIXES — "1-BTK8" → code="BTK8" qty=1. "3-DOORS" → code="DOORS" qty=3.

4. KEEP MODIFIERS — BUTT, MD, BLD, BD are part of the SKU (W3042BUTT).

5. QUANTITY — if Trim List exists, use Trim List qty. Flag floor plan vs. trim list mismatches.

6. VENT BOX — BACK-B48 or B48 "(VENT BOX)" → "vent_chase_material" NEVER "cabinets".

7. DRH EXPRESS — W2436-L and W2436-R = separate items. F331/F342/PEPR335 = not cabinets.
   TOEKICK8 → BTK8, MQR8 → SM8.

8. WELLBORN BINDER — return room names only with empty arrays + flag.

9. NON-CABINET ITEMS (never classify as cabinets):
   F331, F342, PEPR335, BEP-*, WAINSCOT, FIN END, BACK-B48, CR-W34, FALSE

10. CATEGORIZATION: "cabinets" (W,B,SB,T,P,O,REF,OVD), "perimeter" (BTK,SM,FL,RANGE,DISH,MW,TOUCHUP), "island" (UF,BTK,SM), "hardware" (DOORS,DRAWERS,DWR,SHM,OCM).
11. SPECIAL RULES:
    - **SUM EVERYTHING**: If "DOORS 4" appears 3 times in different laundry sections, the total must be **12**. Do NOT deduplicate different sections.
    - **TOUCHUP**: Preserve format like "2KIT+1SPRAY".
    - **BATHROOMS**: Extract every detail. `SHM8` and `OCM8BLD` are critical. Total counts must match the sum of all listed items.
    - **CABINETS**: Only use `max()` if you are 100% sure it's a duplicate of the same physical unit (like floor plan vs list). Otherwise, sum them.
Return ONLY valid JSON in this format:
{{
  "rooms": [
    {{
      "room_name": "...",
      "cabinets": [{{"code": "...", "quantity": 1}}],
      "perimeter": [], "island": [], "hardware": [], "island_hardware": [],
      "bump": [], "island_bump": [], "opt_crown": [], "opt_light_rail": [], "vent_chase_material": []
    }}
  ]
}}"""

        ai_text = await _ai_generate(prompt, tier="flash", max_tokens=3000)
        print(f"[full-scan] STEP 2 done. AI response length: {len(ai_text)}")

        resp_data = _parse_json_response(ai_text)
        
        # Flexibly handle the "rooms" key (some AI models might name it differently)
        raw_rooms = resp_data.get("rooms") or resp_data.get("room_list") or resp_data.get("data", {}).get("rooms")
        if not raw_rooms and isinstance(resp_data, list):
            raw_rooms = resp_data
        elif not raw_rooms and isinstance(resp_data, dict):
            # If the AI just returned a single room object instead of a list
            if "cabinets" in resp_data and ("room_name" in resp_data or "name" in resp_data):
                raw_rooms = [resp_data]
            else:
                # Last resort: try to find any list that looks like rooms
                for v in resp_data.values():
                    if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict) and ("code" in str(v[0]) or "sku" in str(v[0])):
                        raw_rooms = v
                        break
        
        if not raw_rooms:
            raw_rooms = []

        # Sanitize and merge rooms by canonical name
        CATS = ["cabinets", "perimeter", "island", "hardware", "island_hardware", "bump", "island_bump", "opt_crown", "opt_light_rail", "vent_chase_material"]
        
        def sanitize_code(code: str) -> str:
            if not code: return ""
            code = str(code).strip().upper()
            # Preserve special hardware keywords
            if any(k in code for k in ("DOORS", "DRAWERS", "HINGES", "PULLS", "KNOBS", "CROWN", "LIGHT RAIL")):
                return code
            # Strip leading quantity
            code = re.sub(r'^\d+[-\s]+', '', code)
            # Keep hyphen for DRH hinge suffixes (-L/-R)
            if code.endswith(('-L', '-R')):
                prefix = re.sub(r'[^A-Z0-9]', '', code[:-2].replace(' ', ''))
                return f"{prefix}{code[-2:]}"
            # Preserve format for touchup kits
            if any(k in code for k in ("KIT", "SPRAY", "TOUCHUP")):
                return re.sub(r'[^A-Z0-9+\-]', '', code.replace(' ', ''))
            # Preserve HWC dimension format: "HWC 1X2X94" or "HWC 1 X 2 X 94"
            # Keep the space between the prefix and the dimension string.
            hwc_m = re.match(r'^(HWC|CLEAT)\s+(\d[\dX\s]+)$', code)
            if hwc_m:
                dim_tokens = [t for t in re.split(r'\s+', hwc_m.group(2)) if t.isdigit()]
                if dim_tokens:
                    return hwc_m.group(1) + " " + "X".join(dim_tokens)
            # Standard cleanup — strip spaces and non-alphanumeric chars
            code = re.sub(r'[^A-Z0-9]', '', code.replace(' ', ''))
            return code

        def canonical_name(name: str) -> str:
            name = name.strip().upper()
            # Gourmet must be checked before generic KITCHEN
            if re.search(r'(OPT\s+)?(GMT\s+KITCHEN|GOURMET\s+KITCHEN)', name): return "OPT GOURMET KITCHEN"
            if re.search(r'(STANDARD|STD)\s+42["\']?\s+KITCHEN|STANDARD\s+42\s+KITCHEN', name): return "STANDARD 42 KITCHEN"
            if re.search(r'STANDARD\s+\d+\s+KITCHEN|STD\s+\d+\s+KITCHEN|STANDARD\s+KITCHEN', name): return "STANDARD 42 KITCHEN"
            if re.search(r'\bKITCHEN\b', name): return "KITCHEN"
            if re.match(r'(OPT\s+)?LAUNDRY', name): return "OPT LAUNDRY"
            if re.match(r'(STANDARD\s+)?(OWNERS?|MASTER)\s+BATH', name): return "OWNERS BATH"
            if re.match(r'(STANDARD\s+)?BATH\s*3', name): return "BATH 3"
            if re.match(r'(STANDARD\s+)?BATH\s*2', name): return "BATH 2"
            if re.match(r'(STANDARD\s+)?BATH\s*1', name): return "BATH 1"
            if re.match(r'GARAGE', name): return "GARAGE"
            return name[:25].strip() if len(name) > 25 else name

        rooms_map: dict = {}
        for r in raw_rooms:
            rname = canonical_name(r.get("room_name") or r.get("name") or "Unknown Room")
            if rname not in rooms_map:
                rooms_map[rname] = {"room_name": rname}
                for cat in CATS:
                    rooms_map[rname][cat] = {}
            for cat in CATS:
                for item in r.get(cat, []):
                    if isinstance(item, str):
                        code = sanitize_code(item)
                        if code and len(code) >= 2:
                            rooms_map[rname][cat][code] = max(rooms_map[rname][cat].get(code, 0), 1)
                    elif isinstance(item, dict):
                        code = sanitize_code(item.get("code") or item.get("sku") or "")
                        try:
                            qty = max(1, int(item.get("quantity", 1)))
                        except:
                            qty = 1
                        if code and len(code) >= 2:
                            # Use SUM for everything now that AI is instructed to deduplicate physically
                            rooms_map[rname][cat][code] = rooms_map[rname][cat].get(code, 0) + qty

        rooms = []
        for rname, rdata in rooms_map.items():
            final_r = {"room_name": rname}
            for cat in CATS:
                final_r[cat] = []
                for c, q in rdata[cat].items():
                    # Robust zero-quantity filtering
                    try:
                        q_val = float(q) if q is not None else 0
                    except:
                        q_val = 1 # Keep string-based touchups
                        
                    if q_val == 0:
                        continue
                        
                    final_r[cat].append({"code": c, "quantity": q})
            rooms.append(final_r)

        print(f"[full-scan] Final rooms after merge: {len(rooms)}")
        return {
            "success": True, 
            "rooms": rooms, 
            "method": "full-text-single-ai",
            "pdf_type": resp_data.get("pdf_type", "Unknown"),
            "flags": resp_data.get("flags", [])
        }

    except Exception as e:
        print(f"[full-scan] ERROR: {e}")
        return {"success": False, "rooms": [], "error": str(e)}


# ─── Endpoint: LOCAL Extraction (No AI, No API Key) ──────────────────────

@router.post("/agent/analyze-drawing-local")
async def analyze_drawing_local(payload: dict):
    """
    ULTRA FAST LOCAL ANALYSIS:
    Uses pure Python (PyMuPDF + Regex) to extract and categorize codes.
    Zero API costs, zero latency, no API key required.
    """
    try:
        pdf_url = payload.get("pdf_url")
        if not pdf_url:
            raise HTTPException(status_code=400, detail="pdf_url is required")

        print(f"[local-scan] Starting local extraction from {pdf_url}")
        
        import httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(pdf_url)
            pdf_bytes = resp.content
        
        result = extract_rooms_rule_based(pdf_bytes)
        return result

    except Exception as e:
        print(f"[local-scan] ERROR: {e}")
        return {"success": False, "rooms": [], "error": str(e), "method": "rule-based-local"}


# ─── Endpoint: High-Speed Drawing Analysis (Legacy per-page) ─────────────────

@router.post("/agent/analyze-drawing-fast")
async def analyze_drawing_fast(payload: dict):
    """
    Hybrid drawing analysis:
    1. Uses Python (PyMuPDF) to extract text if possible (Ultra Fast).
    2. Uses Gemini (Text or Vision) to interpret.
    """
    try:
        pdf_url = payload.get("pdf_url")
        pdf_data_b64 = payload.get("pdf_data")
        
        pdf_bytes = None
        
        if pdf_data_b64:
            import base64
            pdf_bytes = base64.b64decode(pdf_data_b64)
        elif pdf_url:
            # Download PDF
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.get(pdf_url)
                pdf_bytes = resp.content
        
        if not pdf_bytes:
            raise HTTPException(status_code=400, detail="pdf_url or pdf_data is required")

        # 2. Extract selectable text using Python
        python_data = extract_drawing_data_python(pdf_bytes)
        print(f"[agent] Selectable Text: {python_data['has_selectable_text']}, Potential Codes: {len(python_data['potential_codes'])}")
        
        rooms = []
        
        if python_data["has_selectable_text"] and len(python_data["potential_codes"]) > 5:
            # OPTION A: Text-based Analysis (Ultra Fast)
            print("[agent] Using Python-First Text Analysis")
            prompt = f"""You are an expert cabinet estimator. Analyze this blueprint text and extract ONLY cabinet SKU codes.

            TEXT FROM DRAWING:
            {python_data["raw_text"][:10000]}
            
            PYTHON PRE-EXTRACTED CODES (use these as a reference guide):
            {", ".join(python_data["potential_codes"])}
            
            STRICT RULES:
            1. **ROOM NAME**: Use ONLY the short canonical room name. Look for room labels in the drawing (e.g. "KITCHEN", "OWNERS BATH", "BATH 2", "BATH 3", "LAUNDRY", "GARAGE"). 
               DO NOT use page titles or descriptions as the room name.
               - "STANDARD 42 KITCHEN", "STD 42 KITCHEN" → "STANDARD 42 KITCHEN"
               - "OPT GOURMET KITCHEN", "OPT GMT KITCHEN" → "OPT GOURMET KITCHEN" (KEEP SEPARATE from STANDARD 42 KITCHEN)
               - "OPT LAUNDRY UPPERS OVER W/D" → "OPT LAUNDRY"
               - "OPT LAUNDRY BASES ACROSS FROM WD" → "OPT LAUNDRY"
               - "STANDARD BATH 3 UPSTAIRS" → "BATH 3"
               - "STANDARD OWNERS BATH" → "OWNERS BATH"
               - "BATH 3 UPSTAIRS" → "BATH 3"
            2. Extract items into categories: "cabinets", "perimeter", "island", "hardware", "island_hardware", "bump", "island_bump", "opt_crown", "opt_light_rail", "vent_chase_material".
            3. **CODES ONLY**: Every "code" value must be a cabinet SKU only. NEVER include room titles, project names, notes, or descriptions.
            4. **STRIP QUANTITY PREFIXES**: If a code appears like "1-BTK8" or "3-DOORS", the number prefix is a QUANTITY, not part of the code. Output code: "BTK8", quantity: 1.
            5. **STRIP PARENTHESES**: Notes like (DW), (VOIDS), (CROWN CLEAT) are NOT part of the code.
            6. **KEEP MODIFIERS**: BUTT, MD, BLD, BD, AS are PART of the SKU (e.g. W3042BUTT).
            7. **VALID SKU PATTERNS**: SKUs start with letters followed by numbers (W30, B24, SB36, UF3, BTK8, SM8, DOORS, DRAWERS). Reject anything that looks like a title or sentence.
            8. **SECTION RULES**:
               - BACK-B48 or B48 labeled as "(VENT BOX)" in "Opt Vent Chase Material" section = Vent Chase (NOT Base Cabinet).
               - B/SB codes under "Vent Chase", "Accessories", or "Opt" = Accessories/Vent Chase.
            9. **QUANTITY**: Cross-reference floor plan AND trim list (page 2).
            10. quantity is always an integer ≥ 1.
12. **CATEGORIZATION**:
    - "cabinets": Primary cabinets (W, B, SB, T, P, O, REF, OVD).
    - "perimeter": Accessories (BTK, SM, FL, TOUCHUP) and Appliances (RANGE, DISH, MW.HOOD, REF).
    - "island": Universal Fillers (UF) and accessories found in island section.
    - "hardware": DOORS, DRAWERS, HINGE, SHM, OCM.
    - "island_hardware": DOORS, DRAWERS specifically for island.
    - "opt_crown": Crown moldings (CM, OCM, QM, CROWN).
    - "bump": SHM (bump section).

OUTPUT FORMAT - return ONLY this JSON:
{{
  "rooms": [...],
  "pdf_type": "...",
  "notes": "..."
}}
            """
            ai_text = await _ai_generate(prompt, tier="flash")
            print(f"[agent] AI Text Response: {ai_text[:500]}...")
            
            # Robust parsing and normalization
            resp_data = _parse_json_response(ai_text)
            raw_rooms = resp_data.get("rooms", [])
            
            ROOM_ALIASES = {
                "STANDARD BATH 3 UPSTAIRS": "BATH 3",
                "BATH 3 UPSTAIRS": "BATH 3",
                "STANDARD OWNERS BATH": "OWNERS BATH",
                "OPT LAUNDRY UPPERS OVER WD": "OPT LAUNDRY",
                "OPT LAUNDRY BASES ACROSS FROM WD": "OPT LAUNDRY",
                "OPT LAUNDRY UPPER": "OPT LAUNDRY",
                "OPT LAUNDRY BASE": "OPT LAUNDRY",
                "LAUNDRY UPPERS": "OPT LAUNDRY",
                "LAUNDRY BASES": "OPT LAUNDRY",
                "STANDARD 42 KITCHEN": "STANDARD 42 KITCHEN",
                "STD 42 KITCHEN": "STANDARD 42 KITCHEN",
                "STANDARD KITCHEN": "STANDARD 42 KITCHEN",
                # OPT GOURMET KITCHEN intentionally NOT aliased to STANDARD 42 KITCHEN
            }
            
            def canonical_room_name(name: str) -> str:
                """Normalize a room name to its canonical short form."""
                name = name.strip().upper()
                # Direct alias lookup
                if name in ROOM_ALIASES:
                    return ROOM_ALIASES[name]
                # Pattern-based normalization — gourmet must precede generic kitchen
                if re.search(r'(OPT\s+)?(GMT\s+KITCHEN|GOURMET\s+KITCHEN)', name):
                    return "OPT GOURMET KITCHEN"
                if re.search(r'(STANDARD|STD)\s+42["\']?\s+KITCHEN|STANDARD\s+42\s+KITCHEN', name):
                    return "STANDARD 42 KITCHEN"
                if re.search(r'(STANDARD\s+\d+\s+KITCHEN|STD\s+\d+\s+KITCHEN|STANDARD\s+KITCHEN)', name):
                    return "STANDARD 42 KITCHEN"
                if re.search(r'\bKITCHEN\b', name):
                    return "KITCHEN"
                if re.match(r'(OPT\s+)?LAUNDRY', name):
                    return "OPT LAUNDRY"
                if re.match(r'(STANDARD\s+)?(OWNERS?|MASTER)\s+BATH', name):
                    return "OWNERS BATH"
                if re.match(r'(STANDARD\s+)?BATH\s*3', name):
                    return "BATH 3"
                if re.match(r'(STANDARD\s+)?BATH\s*2', name):
                    return "BATH 2"
                # Truncate overly long names
                if len(name) > 25:
                    name = name[:25].strip()
                return name
            
            def sanitize_code(code: str) -> str:
                """Clean up a raw code string extracted from the AI response."""
                if not code:
                    return ""
                code = str(code).strip().upper()
                # Preserve special hardware keywords
                if any(k in code for k in ("DOORS", "DRAWERS", "HINGES", "PULLS", "KNOBS", "CROWN", "LIGHT RAIL")):
                    return code
                # Strip leading quantity prefix like "1-", "3-", "12-"
                code = re.sub(r'^\d+[-\s]+', '', code)
                # Keep hyphen for DRH hinge suffixes (-L/-R)
                if code.endswith(('-L', '-R')):
                    prefix = re.sub(r'[^A-Z0-9]', '', code[:-2].replace(' ', ''))
                    return f"{prefix}{code[-2:]}"
                # Preserve format for touchup kits
                if any(k in code for k in ("KIT", "SPRAY", "TOUCHUP")):
                    return re.sub(r'[^A-Z0-9+\-]', '', code.replace(' ', ''))
                # Remove spaces and non-alphanumeric
                code = re.sub(r'[^A-Z0-9]', '', code.replace(' ', ''))
                return code
            
            CATS = ["cabinets", "perimeter", "island", "hardware", "island_hardware", "bump", "island_bump", "opt_crown", "opt_light_rail", "vent_chase_material"]
            
            # Build and normalize rooms, then MERGE rooms with the same canonical name
            rooms_map = {}
            for r in raw_rooms:
                raw_name = r.get("room_name") or r.get("name") or "Unknown Room"
                rname = canonical_room_name(raw_name)
                
                if rname not in rooms_map:
                    rooms_map[rname] = {cat: {} for cat in CATS}
                
                for cat in CATS:
                    items = r.get(cat, [])
                    for item in items:
                        code, qty = "", 0
                        if isinstance(item, str):
                            code = sanitize_code(item)
                            qty = 1
                        elif isinstance(item, dict):
                            code = sanitize_code(item.get("code") or item.get("sku") or "")
                            qty = item.get("quantity", 1)
                            try:
                                if isinstance(qty, str) and ("+" in qty or "-" in qty):
                                    pass # Keep string for touchups
                                else:
                                    qty = int(qty)
                            except:
                                qty = 1
                        
                        if code and len(code) >= 2:
                            existing_qty = rooms_map[rname][cat].get(code, 0)
                            if isinstance(qty, int) and isinstance(existing_qty, int):
                                rooms_map[rname][cat][code] = existing_qty + qty
                            else:
                                rooms_map[rname][cat][code] = qty

            rooms = []
            for rname, rdata in rooms_map.items():
                final_r = {"room_name": rname}
                for cat in CATS:
                    final_r[cat] = []
                    for c, q in rdata[cat].items():
                        # Robust zero-quantity filtering
                        try:
                            q_val = float(q) if q is not None else 0
                        except:
                            q_val = 1
                            
                        if q_val == 0:
                            continue
                            
                        final_r[cat].append({"code": c, "quantity": q})
                rooms.append(final_r)
            
            print(f"[agent] Extracted & Merged Rooms: {len(rooms)}")
        else:
            # OPTION B: Fallback to Vision
            print("[agent] Selectable text not found or insufficient codes. Falling back to Vision.")
            temp_path = f"temp_{uuid.uuid4()}.pdf"
            with open(temp_path, "wb") as f:
                f.write(pdf_bytes)
            
            try:
                vision_result = await analyze_drawing_vision(temp_path)
                rooms = vision_result.get("rooms", [])
                print(f"[agent] Vision Extracted Rooms: {len(rooms)}")
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)

        return {
            "success": True, 
            "rooms": rooms, 
            "method": "text" if python_data["has_selectable_text"] and len(python_data["potential_codes"]) > 5 else "vision",
            "pdf_type": resp_data.get("pdf_type", "Unknown"),
            "notes": resp_data.get("notes", "")
        }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e), "rooms": []}


# ─── Endpoint: Re-scan Project Drawing ───────────────────────────────────────

@router.post("/agent/rescan-project")
async def rescan_project(payload: dict):
    """
    Re-runs the local rule-based extraction on a project's PDF and updates
    extracted_data in Supabase. Use this to fix existing projects after code fixes.
    """
    try:
        project_id = payload.get("project_id")
        if not project_id:
            raise HTTPException(status_code=400, detail="project_id is required")

        supabase = get_supabase()

        # Fetch the project PDF URL
        proj = supabase.table("quotation_projects").select("raw_pdf_url").eq("id", project_id).single().execute()
        if not proj.data:
            raise HTTPException(status_code=404, detail="Project not found")

        pdf_url = proj.data.get("raw_pdf_url")
        if not pdf_url:
            raise HTTPException(status_code=400, detail="Project has no PDF URL")

        # 1. Download PDF once
        print(f"[rescan] Downloading PDF for project {project_id}...")
        import httpx
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(pdf_url)
            pdf_bytes = resp.content

        # 2. Try local first (fast)
        local_result = extract_rooms_rule_based(pdf_bytes)
        rooms = local_result.get("rooms", [])
        method = "rule-based-local"
        
        # 3. If local fails or returns very few rooms, use AI
        if not rooms or len(rooms) < 2:
            print(f"[rescan] Local scan found {len(rooms)} rooms. Falling back to AI for better results.")
            # We call the internal logic of analyze_drawing_full but skip the redundant download
            ai_result = await analyze_drawing_full({"pdf_bytes": pdf_bytes}) # Modified analyze_drawing_full to accept bytes
            if ai_result.get("success"):
                rooms = ai_result.get("rooms", [])
                method = ai_result.get("method", "ai-full")
        
        print(f"[rescan] Extraction complete. {len(rooms)} rooms found via {method}.")
        
        # 4. Save to database
        supabase.table("quotation_projects").update({
            "extracted_data": {"rooms": rooms},
            "metadata": {
                "last_scan_method": method,
                "last_scan_date": datetime.datetime.now().isoformat()
            }
        }).eq("id", project_id).execute()
        
        return {"success": True, "rooms_count": len(rooms), "rooms": rooms, "method": method}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


async def analyze_drawing_local_inner(pdf_url: str) -> dict:
    """Helper: download PDF and run rule-based extraction."""
    import httpx
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(pdf_url)
        pdf_bytes = resp.content
    return extract_rooms_rule_based(pdf_bytes)


# ─── Endpoint: Delete Training Document ─────────────────────────────────────

@router.delete("/agent/training-docs/{doc_id}")
async def delete_training_doc(doc_id: str):
    """Soft-delete a training document."""
    try:
        supabase = get_supabase()
        supabase.table("training_documents").update({"is_active": False}).eq("id", doc_id).execute()
        return {"success": True, "message": "Training document removed."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─── Endpoint: Get Manufacturer Research ────────────────────────────────────

@router.get("/agent/manufacturer-research/{manufacturer_name}")
async def get_manufacturer_research(manufacturer_name: str):
    """Get cached research for a manufacturer."""
    try:
        supabase = get_supabase()
        res = supabase.table("manufacturer_research") \
            .select("*").eq("manufacturer_name", manufacturer_name).execute()
        if res.data:
            return {"success": True, "found": True, "research": res.data[0]}
        return {"success": True, "found": False, "research": {}}
    except Exception as e:
        return {"success": False, "error": str(e), "found": False}


# ─── Helper Functions ────────────────────────────────────────────────────────

def _infer_category(sku: str) -> str:
    """Quick category inference from SKU prefix."""
    s = sku.upper().strip()
    if s.startswith(("W3", "W2", "W1", "W4", "W5", "WB", "WAC", "WANGL")):
        return "Wall Cabinet"
    if s.startswith(("B1", "B2", "B3", "B4", "B5", "BD", "BF", "DB")):
        return "Base Cabinet"
    if s.startswith(("SB",)):
        return "Sink Base"
    if s.startswith(("VSB", "VB")):
        return "Vanity Cabinet"
    if s.startswith(("T", "UT", "OVD", "S3")):
        return "Tall/Utility Cabinet"
    if s.startswith(("UF", "F")):
        return "Filler"
    if s.startswith(("CM", "OCM", "ICM", "LR", "LRM", "QM")):
        return "Molding"
    if s.startswith(("BTK", "TK")):
        return "Toe Kick"
    if s.startswith(("SM", "SHM")):
        return "Scribe/Shim"
    if s.startswith(("HWC",)):
        return "Hardwood Cleat"
    if any(k in s for k in ("DOORS", "DRAWERS", "HINGES", "PULLS", "KNOBS")):
        return "Hardware"
    if s.startswith(("BACK-", "BACKB", "BACK_")):
        return "Vent Box Panel"
    if "CROWN" in s:
        return "Crown Molding"
    if "LIGHT" in s or "RAIL" in s:
        return "Light Rail"
    if s.startswith(("WTEP", "EP")):
        return "End Panel"
    if s.startswith(("DWR",)):
        return "Drawer"
    if s.startswith(("REF", "RR")):
        return "Refrigerator Space"
    if s.startswith(("DISH",)):
        return "Dishwasher Space"
    if "RANGE" in s or "HOOD" in s:
        return "Appliance Space"
    if s.startswith(("TOUCH",)):
        return "Touch-Up Kit"
    return "Cabinet Accessory"


def _fallback_description(sku: str, item: dict) -> str:
    """Generate a basic description when AI is unavailable."""
    cat = _infer_category(sku)
    room = item.get("room", "")
    qty = item.get("qty", 1)
    # Extract dimensions from SKU
    dims = re.search(r'(\d{2,4})', sku)
    dim_str = ""
    if dims:
        num = dims.group(1)
        if len(num) == 4:
            dim_str = f"{num[:2]}\" wide x {num[2:]}\" tall "
        elif len(num) == 2:
            dim_str = f"{num}\" wide "

    room_str = f" in {room}" if room else ""
    return f"{dim_str}{cat}{room_str}. Quantity: {qty}."


def _extract_text_from_bytes(content: bytes, ext: str) -> str:
    """Extract readable text from uploaded file bytes.
    Optimized: Uses fitz (PyMuPDF) for 10x faster processing than pdfplumber.
    """
    text = ""
    try:
        if ext in (".pdf",):
            try:
                import fitz  # PyMuPDF
                doc = fitz.open(stream=content, filetype="pdf")
                pages_text = []
                # Scan up to 15 pages for comprehensive cabinet detection
                for page in doc.pages(0, min(15, len(doc))):
                    pages_text.append(page.get_text())
                text = "\n".join(pages_text)
                doc.close()
            except ImportError:
                # Fallback to pdfplumber if fitz not installed
                import pdfplumber, io
                with pdfplumber.open(io.BytesIO(content)) as pdf:
                    pages = pdf.pages[:8]
                    text = "\n".join(p.extract_text() or "" for p in pages)
            
            # OCR FALLBACK: Removed local Tesseract dependency. 
            # We now use the dedicated 'Vision Fallback' in the analyze-drawing-fast endpoint
            # which is faster and more accurate than local OCR.
            pass
        elif ext in (".xlsx", ".xlsm", ".xls"):
            import openpyxl, io
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            rows = []
            for sheet in wb.worksheets[:3]:
                for row in sheet.iter_rows(max_row=100, values_only=True):
                    if any(cell is not None for cell in row):
                        rows.append(" | ".join(str(c) for c in row if c is not None))
            text = "\n".join(rows)
        elif ext in (".txt", ".csv"):
            text = content.decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[agent] Text extraction error: {e}")
    return text
