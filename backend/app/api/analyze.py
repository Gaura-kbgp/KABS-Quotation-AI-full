from fastapi import APIRouter, UploadFile, File, BackgroundTasks
from app.utils.vision_scanner import analyze_drawing_vision
from app.core.supabase_client import get_supabase
import os
import shutil
import uuid

router = APIRouter()

@router.post("/upload-drawing")
async def upload_drawing(project_id: str, file: UploadFile = File(...)):
    # Save file temporarily for processing
    file_id = str(uuid.uuid4())
    temp_path = f"/tmp/{file_id}_{file.filename}"
    os.makedirs("/tmp", exist_ok=True)
    
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        # Perform Vision Analysis
        result = await analyze_drawing_vision(temp_path)
        
        # Update Supabase
        supabase = get_supabase()
        
        log_path = "backend_ai_debug.log"
        with open(log_path, "a") as log:
            log.write(f"Updating Supabase for project {project_id}...\n")

        db_res = supabase.table("quotation_projects").update({
            "extracted_data": result,
            "status": "Reviewing"
        }).eq("id", project_id).execute()
        
        with open(log_path, "a") as log:
            log.write(f"Supabase Update Result: {db_res}\n")
        
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
