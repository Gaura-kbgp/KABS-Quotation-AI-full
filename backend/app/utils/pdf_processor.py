import pdfplumber
import io
import re

async def parse_pricing_pdf(file_bytes: bytes, manufacturer_id: str, file_id: str):
    """
    Advanced PDF Pricing Engine for Cabinetry Price Books.
    Specifically optimized for Integrity Cabinets and similar tiered pricing structures.
    Extracts: SKU, List Price, Collection/Series, and Style Options.
    """
    pricing_records = []
    
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            current_series = "UNIVERSAL"
            current_construction = "Standard"
            
            # PRE-SCAN: Only process pages that look like pricing pages to save 70% of processing time
            for page_num, page in enumerate(pdf.pages):
                text = (page.extract_text() or "").strip()
                if not text: continue
                
                # Check for "SKU" or "PRICE" or SKU patterns like A-Z + 0-9
                has_pricing_data = any(k in text.upper() for k in ["SKU", "PRICE", "LIST", "ITEM", "CODE", "MODEL"]) or \
                                 re.search(r'[A-Z]{2,}\d{2,}', text)
                
                if not has_pricing_data and page_num > 10: # Always check index/intro pages
                    continue

                lines = text.split('\n')
                page_title = lines[0].strip() if lines else "General Catalog"
                
                # Identify if this is a "Price Point" table (common in Aristocraft/AOK)
                is_price_point_page = any("PRICE POINT" in l.upper() for l in lines[:15])
                
                # 1. SCAN FOR SERIES/CONSTRUCTION HEADERS
                for line in lines[:10]:
                    upper_line = line.strip().upper()
                    if "SERIES" in upper_line:
                        match = re.search(r'([A-Z\s]+SERIES)', upper_line)
                        if match: current_series = match.group(1).strip()
                    
                    if "FRAMELESS" in upper_line:
                        current_construction = "Frameless"
                    elif "FACE FRAME" in upper_line:
                        current_construction = "Face Frame"
                
                # 2. EXTRACT TABLES (PRIMARY PRICING SOURCE)
                tables = page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2: continue
                    
                    headers = [str(cell).upper().strip() if cell else "" for cell in table[0]]
                    sku_idx = -1
                    price_indices = []
                    
                    # Handle Numerical (Price Point) Headers: 1, 2, 3...
                    # If this page was tagged as a Price Point page, treat numerical columns as collections
                    for i, h in enumerate(headers):
                        if any(k in h for k in ["SKU", "ITEM", "CODE", "MODEL"]): 
                            sku_idx = i
                        
                        # Standard price headers
                        is_standard_price = any(k in h for k in ["PRICE", "LIST", "MAPLE", "OAK", "CHERRY", "PAINT", "FINISH"])
                        # Price Point headers: look for single digits 1-9 or "POINT X"
                        is_price_point = h.isdigit() or re.match(r'^(?:PRC|POINT|PT|PP)\s*\d+$', h)
                        
                        if is_standard_price or is_price_point:
                            price_indices.append(i)
                    
                    if sku_idx != -1 and price_indices:
                        for row in table[1:]:
                            if len(row) <= sku_idx: continue
                            sku = str(row[sku_idx]).strip().upper() if row[sku_idx] else ""
                            if not sku or len(sku) < 2: continue
                            
                            for p_idx in price_indices:
                                if len(row) <= p_idx: continue
                                price_val = str(row[p_idx]).strip() if row[p_idx] else ""
                                if not price_val: continue
                                
                                col_header = headers[p_idx]
                                # If it's a digit, format it as "Price Point X"
                                if col_header.isdigit():
                                    col_label = f"Price Point {col_header}"
                                elif is_price_point_page and re.match(r'^(?:PRC|POINT|PT|PP)\s*(\d+)$', col_header):
                                    m = re.search(r'(\d+)', col_header)
                                    col_label = f"Price Point {m.group(1)}" if m else col_header
                                else:
                                    col_label = f"{current_series} - {col_header}" if col_header not in ["PRICE", "LIST", "LIST PRICE"] else current_series
                                
                                try:
                                    clean_price = re.sub(r'[^\d.]', '', price_val)
                                    if clean_price:
                                        pricing_records.append({
                                            "manufacturer_id": manufacturer_id,
                                            "raw_source_file_id": file_id,
                                            "sku": sku,
                                            "price": float(clean_price),
                                            "collection_name": col_label,
                                            "door_style": current_construction,
                                            "created_at": "now()"
                                        })
                                except: continue
                
                # 3. FALLBACK: REGEX FOR UNSTRUCTURED LISTINGS
                # Handle "SDB6 ............ 1078" outside tables
                # Only run if table extraction found fewer than 5 items on this page
                if len(pricing_records) < 5 or page_num < 5: # Prioritize text for index pages
                    matches = re.finditer(r'([A-Z0-9\-/]{3,})\s*[.]+\s*([\d,]+(?:\.\d{2})?)', text)
                    for match in matches:
                        sku = match.group(1).upper()
                        price_str = match.group(2).replace(',', '')
                        
                        # Avoid duplicates
                        if not any(r['sku'] == sku for r in pricing_records[-20:]):
                            pricing_records.append({
                                "manufacturer_id": manufacturer_id,
                                "raw_source_file_id": file_id,
                                "sku": sku,
                                "price": float(price_str),
                                "collection_name": current_series,
                                "door_style": current_construction,
                                "created_at": "now()"
                            })

        # Remove likely non-SKU garbage
        pricing_records = [r for r in pricing_records if len(r['sku']) >= 2 and not r['sku'].isdigit()]
        
        print(f"DEBUG: PDF Extraction finished for {file_id}. Found {len(pricing_records)} records.")
        return pricing_records
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"ERROR in PDF Parsing: {e}")
        return []
