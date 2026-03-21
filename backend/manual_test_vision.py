import asyncio
import os
from app.utils.vision_scanner import analyze_drawing_vision
from dotenv import load_dotenv

async def main():
    load_dotenv()
    # Try to find a file in /tmp/ to test with
    tmp_files = [f for f in os.listdir("/tmp") if f.endswith(".pdf")]
    if not tmp_files:
        print("No PDF files found in /tmp/ to test.")
        return
    
    test_file = os.path.join("/tmp", tmp_files[0])
    print(f"Testing with file: {test_file}")
    
    result = await analyze_drawing_vision(test_file)
    print("--- RESULT ---")
    import json
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
