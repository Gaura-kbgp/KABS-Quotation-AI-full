"""
Catalog API — Self-Training Manufacturer Catalog Ingestion
=========================================================
Endpoints:
  POST /catalog/extract-config      AI extracts config from uploaded PDF/Excel
  POST /catalog/ingest-pricing      Parse pricing file → insert rows into manufacturer_pricing
  GET  /catalog/config/{mfg_id}     Get stored config for a manufacturer
  PUT  /catalog/config/{mfg_id}     Save/update config manually
  GET  /catalog/options/{mfg_id}    Door styles + species + finishes for UI dropdowns
"""

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, BackgroundTasks
from app.core.auth import CurrentUser, get_current_user
from app.core.supabase_client import get_supabase
from app.core.storage import download_bytes, DOCS_BUCKET
from app.utils.catalog_extractor import (
    extract_catalog_config,
    extract_pricing_rows,
    extract_pricing_rows_from_excel,
)
import uuid
import json
import datetime

router = APIRouter()

CATALOG_TABLE = "manufacturer_catalog_config"
PRICING_TABLE = "manufacturer_pricing"

# ─── Ingest job tracker (in-memory, same pattern as SPEC_UPLOAD_JOBS in pricing.py) ──
CATALOG_INGEST_JOBS: dict = {}


# ─── GET: Config for dropdowns ────────────────────────────────────────────────

@router.get("/catalog/config/{manufacturer_id}")
async def get_catalog_config(
    manufacturer_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Return stored catalog config for a manufacturer."""
    supabase = get_supabase()
    res = supabase.table(CATALOG_TABLE).select("*") \
        .eq("manufacturer_id", manufacturer_id).maybe_single().execute()
    res_data = res.data if res else None
    if res_data:
        return {"success": True, "config": res_data}
    return {"success": True, "config": None}


@router.get("/catalog/options/{manufacturer_id}")
async def get_catalog_options(
    manufacturer_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """
    Returns UI dropdown options for the review page:
      { door_styles, species, finishes, price_model, style_to_collection }
    Falls back to reading distinct values from manufacturer_pricing if no config stored.
    """
    supabase = get_supabase()

    # 1. Try stored config first
    res = supabase.table(CATALOG_TABLE).select(
        "price_model,door_styles,species,finishes,style_to_collection,price_columns"
    ).eq("manufacturer_id", manufacturer_id).maybe_single().execute()
    res_cfg = res.data if res else None

    if res_cfg and (res_cfg.get("door_styles") or res_cfg.get("species")):
        return {
            "success": True,
            "source": "catalog_config",
            "price_model": res_cfg.get("price_model", "collection"),
            "door_styles": res_cfg.get("door_styles") or [],
            "species": res_cfg.get("species") or [],
            "finishes": res_cfg.get("finishes") or [],
            "style_to_collection": res_cfg.get("style_to_collection") or {},
            "price_columns": res_cfg.get("price_columns") or [],
        }

    # 2. Fallback: derive from manufacturer_pricing distinct values
    pr = supabase.table(PRICING_TABLE).select("collection_name,door_style") \
        .eq("manufacturer_id", manufacturer_id).limit(5000).execute()
    rows = pr.data or []
    collections = sorted(set(r["collection_name"] for r in rows if r.get("collection_name")))
    door_styles = sorted(set(r["door_style"] for r in rows if r.get("door_style")))

    return {
        "success": True,
        "source": "pricing_table",
        "price_model": "collection",
        "door_styles": [{"name": s} for s in door_styles],
        "species": [],
        "finishes": [],
        "style_to_collection": {},
        "price_columns": [{"id": c, "label": c} for c in collections],
    }


# ─── POST: Extract config (AI) ────────────────────────────────────────────────

@router.post("/catalog/extract-config")
async def extract_config(
    manufacturer_id: str = Form(...),
    file_type: str = Form("price_guide"),    # price_guide | spec_guide | style_guide
    file: UploadFile = File(None),
    file_url: str = Form(None),              # existing storage path
    user: CurrentUser = Depends(get_current_user),
):
    """
    AI reads the uploaded PDF (or existing storage file) and extracts
    catalog config: price_model, door_styles, species, finishes, upcharges.
    Saves result to manufacturer_catalog_config.
    """
    supabase = get_supabase()

    # 1. Get manufacturer name for AI context
    mfg_res = supabase.table("manufacturers").select("name") \
        .eq("id", manufacturer_id).single().execute()
    mfg_name = mfg_res.data.get("name", "") if mfg_res.data else ""

    # 2. Get PDF bytes
    if file:
        pdf_bytes = await file.read()
    elif file_url:
        try:
            pdf_bytes = download_bytes(DOCS_BUCKET, file_url)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read file: {e}")
    else:
        raise HTTPException(status_code=400, detail="Provide file upload or file_url")

    # 3. AI extraction
    config = await extract_catalog_config(pdf_bytes, file_type=file_type, manufacturer_name=mfg_name)

    # 4. Save/merge into DB
    now = datetime.datetime.utcnow().isoformat()
    existing = supabase.table(CATALOG_TABLE).select("id") \
        .eq("manufacturer_id", manufacturer_id).maybe_single().execute()

    row = {
        "manufacturer_id": manufacturer_id,
        "price_model": config.get("price_model", "collection"),
        "door_styles": config.get("door_styles", []),
        "species": config.get("species", []),
        "finishes": config.get("finishes", []),
        "upcharges": config.get("upcharges", {}),
        "price_columns": config.get("price_columns", []),
        "style_to_collection": config.get("style_to_collection", {}),
        "extraction_source": config.get("extraction_source", "ai_pdf"),
        "extraction_notes": config.get("extraction_notes", ""),
        "extracted_at": now,
        "updated_at": now,
    }

    if existing and existing.data:
        supabase.table(CATALOG_TABLE).update(row) \
            .eq("manufacturer_id", manufacturer_id).execute()
    else:
        supabase.table(CATALOG_TABLE).insert(row).execute()

    return {"success": True, "config": config}


# ─── POST: Ingest pricing (background job) ───────────────────────────────────

@router.post("/catalog/ingest-pricing")
async def ingest_pricing(
    background_tasks: BackgroundTasks,
    manufacturer_id: str = Form(...),
    file: UploadFile = File(None),
    file_url: str = Form(None),
    replace_existing: bool = Form(True),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Parse a price guide PDF or Excel and insert rows into manufacturer_pricing.
    Uses stored catalog_config to know the table format.
    Runs as a background job (returns job_id to poll).
    """
    supabase = get_supabase()
    job_id = str(uuid.uuid4())
    CATALOG_INGEST_JOBS[job_id] = {"status": "starting", "progress": 0, "rows": 0, "error": None}

    if file:
        file_bytes = await file.read()
        file_name = file.filename or "upload"
    elif file_url:
        try:
            file_bytes = download_bytes(DOCS_BUCKET, file_url)
            file_name = file_url.split("/")[-1]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read file: {e}")
    else:
        raise HTTPException(status_code=400, detail="Provide file upload or file_url")

    # Get stored config
    cfg_res = supabase.table(CATALOG_TABLE).select("*") \
        .eq("manufacturer_id", manufacturer_id).maybe_single().execute()
    catalog_config = (cfg_res.data if cfg_res else None) or {"price_model": "collection"}

    background_tasks.add_task(
        _run_ingest,
        job_id=job_id,
        manufacturer_id=manufacturer_id,
        file_bytes=file_bytes,
        file_name=file_name,
        catalog_config=catalog_config,
        replace_existing=replace_existing,
        org_id=supabase.org_id,
    )

    return {"success": True, "job_id": job_id}


@router.get("/catalog/ingest-status/{job_id}")
async def ingest_status(
    job_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    job = CATALOG_INGEST_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _run_ingest(
    job_id: str,
    manufacturer_id: str,
    file_bytes: bytes,
    file_name: str,
    catalog_config: dict,
    replace_existing: bool,
    org_id: str,
):
    from app.core.supabase_client import get_supabase as _get_supabase, current_org_id
    import contextvars

    token = current_org_id.set(org_id)
    try:
        supabase = _get_supabase()
        CATALOG_INGEST_JOBS[job_id]["status"] = "parsing"

        is_excel = file_name.lower().endswith((".xlsx", ".xlsm", ".xls", ".csv"))
        if is_excel:
            rows = extract_pricing_rows_from_excel(file_bytes, catalog_config)
        else:
            rows = extract_pricing_rows(file_bytes, catalog_config)

        CATALOG_INGEST_JOBS[job_id]["progress"] = 50
        CATALOG_INGEST_JOBS[job_id]["status"] = "inserting"

        if not rows:
            CATALOG_INGEST_JOBS[job_id] = {"status": "done", "progress": 100, "rows": 0, "error": "No pricing rows found"}
            return

        # Optionally delete existing rows for this manufacturer
        if replace_existing:
            supabase.table(PRICING_TABLE).delete().eq("manufacturer_id", manufacturer_id).execute()

        # Batch insert
        batch_size = 500
        total = len(rows)
        inserted = 0
        for i in range(0, total, batch_size):
            batch = rows[i : i + batch_size]
            db_rows = [
                {
                    "id": str(uuid.uuid4()),
                    "manufacturer_id": manufacturer_id,
                    "sku": r["sku"],
                    "collection_name": r["collection_name"],
                    "door_style": r.get("door_style", ""),
                    "price": r["price"],
                }
                for r in batch
            ]
            supabase.table(PRICING_TABLE).insert(db_rows).execute()
            inserted += len(batch)
            CATALOG_INGEST_JOBS[job_id]["progress"] = 50 + int(50 * inserted / total)

        CATALOG_INGEST_JOBS[job_id] = {
            "status": "done", "progress": 100, "rows": inserted, "error": None
        }

    except Exception as e:
        CATALOG_INGEST_JOBS[job_id] = {
            "status": "error", "progress": 0, "rows": 0, "error": str(e)
        }
    finally:
        current_org_id.reset(token)


# ─── PUT: Manual config save ──────────────────────────────────────────────────

@router.put("/catalog/config/{manufacturer_id}")
async def save_catalog_config(
    manufacturer_id: str,
    payload: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Save manually edited catalog config."""
    supabase = get_supabase()
    now = datetime.datetime.utcnow().isoformat()
    row = {
        "manufacturer_id": manufacturer_id,
        "price_model": payload.get("price_model", "collection"),
        "door_styles": payload.get("door_styles", []),
        "species": payload.get("species", []),
        "finishes": payload.get("finishes", []),
        "upcharges": payload.get("upcharges", {}),
        "price_columns": payload.get("price_columns", []),
        "style_to_collection": payload.get("style_to_collection", {}),
        "extraction_source": "manual",
        "updated_at": now,
    }

    existing = supabase.table(CATALOG_TABLE).select("id") \
        .eq("manufacturer_id", manufacturer_id).maybe_single().execute()
    if existing and existing.data:
        supabase.table(CATALOG_TABLE).update(row).eq("manufacturer_id", manufacturer_id).execute()
    else:
        supabase.table(CATALOG_TABLE).insert(row).execute()

    # Invalidate pricing cache
    from app.api.pricing import GLOBAL_LOOKUP_CACHE
    keys_to_del = [k for k in GLOBAL_LOOKUP_CACHE if manufacturer_id in k]
    for k in keys_to_del:
        del GLOBAL_LOOKUP_CACHE[k]

    return {"success": True}
