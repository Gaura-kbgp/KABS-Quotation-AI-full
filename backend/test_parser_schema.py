import asyncio
import io
import pandas as pd
from app.utils.excel_processor import parse_specifications_python

async def test_parser():
    # Create a dummy Excel in memory
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df = pd.DataFrame([
            ['SPECIALTY CABINETS', ''],
            ['SKU', 'PRICE'],
            ['UF3', '53']
        ])
        df.to_excel(writer, index=False, header=False, sheet_name='FILLER')
    
    file_bytes = output.getvalue()
    records = await parse_specifications_python(file_bytes, "man_123", "file_123")
    
    print(f"Parsed {len(records)} records.")
    for r in records:
        print(f"SKU: {r.get('sku')}, Keys: {list(r.keys())}")
        if 'category_context' in r:
            print("ERROR: category_context STILL PRESENT!")
        else:
            print("SUCCESS: category_context is absent.")

if __name__ == "__main__":
    asyncio.run(test_parser())
