import pandas as pd
import io
import re

async def parse_specifications_python(file_bytes: bytes, manufacturer_id: str, file_id: str):
    """
    Ultra-Advanced 1951 Pricing Parser.
    Identifies Collection (Row 1-2) and Door Styles (Row 3) mapping to price columns.
    """
    pricing_records = []
    
    try:
        xls = pd.ExcelFile(io.BytesIO(file_bytes))
        
        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
            if df.empty: continue
            
            sheet_name_upper = sheet_name.upper().strip()
            
            active_sku_col = -1
            # matrix_cols = {col_idx: {"collections": [], "styles": []}}
            matrix_cols = {}
            current_category = ""
            
            # 1. SCAN FOR HEADERS (Usually row 0-5)
            # We look for the "SKU" anchor first.
            sku_row_idx = -1
            for idx, row in df.iterrows():
                row_list = [str(x).strip().upper() if pd.notna(x) else "" for x in row.tolist()]
                if "SKU" in row_list or "ITEM CODE" in row_list:
                    sku_row_idx = idx
                    active_sku_col = row_list.index("SKU") if "SKU" in row_list else row_list.index("ITEM CODE")
                    break
            
            if sku_row_idx == -1: continue
            
            # 2. EXTRACT MATRIX HEADERS
            # We look at rows ABOVE the SKU row for Collection Groupings
            # And the row AT the SKU row for Door Style Groupings? 
            # In the screenshot, SKU is Row 3. Row 1-2 is Collections.
            
            # Let's verify columns B-G
            for col_idx in range(active_sku_col + 1, min(len(df.columns), active_sku_col + 10)):
                col_data = {
                    "collections": [],
                    "styles": []
                }
                
                # Check rows from 0 up to sku_row_idx
                for h_idx in range(sku_row_idx + 1):
                    cell_val = str(df.iloc[h_idx, col_idx]).strip() if pd.notna(df.iloc[h_idx, col_idx]) else ""
                    if not cell_val: continue
                    
                    # Split by newline
                    parts = [p.strip().upper() for p in cell_val.split('\n') if p.strip()]
                    
                    # Heuristic: Collections usually contain CHERRY, MAPLE, PAINTED, DURAFORM
                    # Styles are often names or have 'DFO'
                    for p in parts:
                        if any(k in p for k in ["CHERRY", "MAPLE", "PAINTED", "DURAFORM", "BASE", "OAK", "ASH", "HICKORY"]):
                            # Is it a collection?
                            if any(k in p for k in ["ELITE", "PREMIUM", "PRIME", "CHOICE"]):
                                col_data["collections"].append(p)
                            else:
                                # Might be a door style under that collection
                                col_data["styles"].append(p)
                        else:
                            # Other names like CANYON, ARLENE are styles
                            if p != "SKU" and p != "PRICE" and p != "LIST":
                                col_data["styles"].append(p)
                                
                if col_data["collections"] or col_data["styles"]:
                    # If styles were found but no collection, maybe it's the "BASE" column
                    if not col_data["collections"] and "BASE" in str(df.iloc[0, col_idx]).upper():
                        col_data["collections"] = ["BASE"]
                        
                    matrix_cols[col_idx] = col_data

            # 3. SCAN DATA ROWS
            for idx in range(sku_row_idx + 1, len(df)):
                row = df.iloc[idx]
                sku = str(row[active_sku_col]).strip().upper() if pd.notna(row[active_sku_col]) else ""
                
                if not sku or len(sku) < 2:
                    # Check if it's a category header
                    row_vals = [str(x) for x in row if pd.notna(x)]
                    content = " ".join(row_vals).strip()
                    if content and len(content) > 5 and content.isupper():
                        current_category = content
                    continue
                
                # For each price column in matrix
                for col_idx, metadata in matrix_cols.items():
                    try:
                        p_str = re.sub(r'[^\d.]', '', str(row[col_idx]))
                        if not p_str: continue
                        price = float(p_str)
                        
                        # Generate records for each collection-style pair
                        collections = metadata["collections"] or ["UNIVERSAL"]
                        styles = metadata["styles"] or ["UNIVERSAL"]
                        
                        for c_name in collections:
                            for s_name in styles:
                                pricing_records.append({
                                    "manufacturer_id": manufacturer_id,
                                    "raw_source_file_id": file_id,
                                    "sku": sku,
                                    "price": price,
                                    "collection_name": c_name,
                                    "door_style": s_name,
                                    "created_at": "now()"
                                })
                    except: continue
                    
        return pricing_records
    except Exception as e:
        print(f"Excel Parser Error: {e}")
        return []
