import os
import google.generativeai as genai
from typing import List, Dict, Any
import json
import re

from dotenv import load_dotenv

# We configure inside the function to ensure load_dotenv() has been called in main.py

PROMPT = """You are an expert cabinet estimator. Analyze the provided PDF drawing.
The drawing contains cabinet layouts with SKUs inside boxes.

YOUR TASK:
Scan the drawing visually and extract every single cabinet SKU and accessory.
Focus 100% on the VISUAL IMAGE of the boxes and text within them.

1. Identify Room Names (KITCHEN, BATH 1, etc.) from headers/footers/title blocks.
2. Extract every item (cabinets, hardware, fillers, etc.) into a single "cabinets" list for each room.
3. Extract quantities (e.g., "3-BTK8" -> quantity 3, SKU BTK8). Default quantity is 1.

OUTPUT FORMAT (STRICT JSON):
Every extracted item MUST be an object with "code" and "quantity".
{
  "rooms": [
    {
      "room_name": "NAME",
      "cabinets": [
        {"code": "SKU", "quantity": 1}
      ]
    }
  ]
}
"""

import time

async def analyze_drawing_vision(file_path: str):
    log_path = "backend_ai_debug.log"
    with open(log_path, "a") as log:
        log.write(f"\n--- New Scan Start: {time.ctime()} ---\n")
        log.write(f"File: {file_path}\n")

    # Ensure API Key is loaded
    load_dotenv()
    api_key = os.getenv("GOOGLE_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise Exception("GOOGLE_GENAI_API_KEY or GEMINI_API_KEY not found in environment.")
    genai.configure(api_key=api_key)

    try:
        model = genai.GenerativeModel('gemini-3.1-flash-lite-preview') 
        
        # Read file data for inline processing
        with open(file_path, "rb") as f:
            pdf_data = f.read()
        
        # Generate content with inline PDF data
        response = model.generate_content([
            PROMPT,
            {
                "mime_type": "application/pdf",
                "data": pdf_data
            }
        ])
        
        text = response.text
        
        with open(log_path, "a") as log:
            log.write("RAW AI RESPONSE:\n")
            log.write(text + "\n")

        # 1. Try finding JSON within markdown code blocks
        json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except:
                pass
        
        # 2. Try finding anything that looks like a JSON object
        # Using a more robust regex for the outermost braces
        raw_json_match = re.search(r'(\{.*\})', text, re.DOTALL)
        if raw_json_match:
            try:
                return json.loads(raw_json_match.group(1))
            except:
                pass
        
        # 3. Last resort: direct parse
        try:
            return json.loads(text.strip())
        except:
            raise Exception(f"AI returned invalid JSON: {text[:200]}...")
            
    except Exception as e:
        with open(log_path, "a") as log:
            log.write(f"ERROR: {str(e)}\n")
        print(f"Vision Analysis Error: {str(e)}")
        return {"rooms": []}
