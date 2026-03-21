import os
import sys
import pandas as pd
import io
import uuid
from dotenv import load_dotenv
from supabase import create_client

sys.path.append(os.path.dirname(__file__))
from app.utils.excel_processor import parse_specifications_python

load_dotenv()
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

async def run_import():
    file_path = r"C:\Users\admin\Downloads\1951 Cabinetry Price Guide - 2025.xlsx"
    manufacturer_id = "3be07931-596a-4fa3-8d39-8d04c36cf4bb" # KOCH / 1951
    file_id = str(uuid.uuid4())
    
    print(f"Reading {file_path}...")
    with open(file_path, "rb") as f:
        file_bytes = f.read()
    
    # 0. Register File
    supabase.table("manufacturer_files").insert({
        "id": file_id,
        "manufacturer_id": manufacturer_id,
        "file_type": "pricing",
        "file_name": os.path.basename(file_path),
        "file_url": "local",
        "file_format": "xlsx"
    }).execute()
    
    print("Parsing Excel...")
    pricing = await parse_specifications_python(file_bytes, manufacturer_id, file_id)
    
    # Filter out invalid prices
    pricing = [p for p in pricing if p.get('price') is not None and str(p.get('price')) != 'nan']
    print(f"Extracted {len(pricing)} VALID records.")
    
    if pricing:
        print("Cleaning old pricing for this manufacturer...")
        supabase.table("manufacturer_pricing").delete().eq("manufacturer_id", manufacturer_id).execute()
        
        print("Inserting records...")
        chunk_size = 500
        for i in range(0, len(pricing), chunk_size):
            chunk = pricing[i : i + chunk_size]
            supabase.table("manufacturer_pricing").insert(chunk).execute()
            print(f"  Inserted {i + len(chunk)} / {len(pricing)}")
            
    print("Done!")

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_import())
