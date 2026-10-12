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
from app.core.storage import download_bytes, DOCS_BUCKET, MAX_UPLOAD_BYTES
# Shared with app/api/pricing.py's own cache-bust calls — this router never
# invalidated the /manufacturer-config cache (in-memory dict + on-disk JSON
# file) it also keys off, so correcting a manufacturer's data via Re-train
# or /catalog/ingest-pricing could leave stale dropdown data served
# indefinitely, exactly like the incident this fixed for Integrity Cabinets.
from app.api.pricing import invalidate_manufacturer_cache
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
        if len(pdf_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)")
    elif file_url:
        try:
            pdf_bytes = download_bytes(file_url, DOCS_BUCKET)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read file: {e}")
    else:
        raise HTTPException(status_code=400, detail="Provide file upload or file_url")

    # 3. AI extraction — retry up to 3 times and keep the best result.
    # The AI call is non-deterministic for the same document: re-fixing
    # Marsh's config today, one run found 61 real door styles, another
    # returned "collection" model with 0 — a single bad roll used to be
    # final and silent (looked identical to a legitimately sparse catalog).
    # A new manufacturer hitting a bad roll on its first-ever extraction
    # would otherwise need the exact same manual "try again a few times"
    # workaround used by hand today.
    config = None
    for attempt in range(3):
        cfg = await extract_catalog_config(pdf_bytes, file_type=file_type, manufacturer_name=mfg_name)
        cfg_styles = len(cfg.get("door_styles", []))
        if cfg.get("price_model") in ("collection", "price_column") and (
            config is None or cfg_styles > len(config.get("door_styles", []))
        ):
            config = cfg
        if cfg_styles >= 15:
            break
    if config is None:
        config = cfg  # all attempts came back empty/unknown — surface the last one's diagnostic

    # 4. Save/merge into DB — but only if the AI found something real.
    # manufacturer_catalog_config.price_model has a CHECK constraint allowing
    # only 'collection' or 'price_column'. The AI is instructed (see the
    # anti-hallucination rules in _CONFIG_PROMPT) to return price_model:
    # "unknown" plus an explanation in extraction_notes when the supplied
    # pages don't actually contain a door-style/price table, rather than
    # inventing plausible-looking values — but writing that "unknown" straight
    # to the DB violates the constraint and 500s the whole request, hiding
    # the real "not enough data" message from the user. Skip the write (so
    # any existing good config is left alone) and just hand the diagnostic
    # back to the caller to show.
    price_model = config.get("price_model")
    if price_model not in ("collection", "price_column"):
        return {"success": True, "config": config, "saved": False}

    now = datetime.datetime.utcnow().isoformat()
    existing = supabase.table(CATALOG_TABLE).select("id") \
        .eq("manufacturer_id", manufacturer_id).maybe_single().execute()

    row = {
        "manufacturer_id": manufacturer_id,
        "price_model": price_model,
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

    invalidate_manufacturer_cache(manufacturer_id, supabase.org_id)
    return {"success": True, "config": config, "saved": True}


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
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)")
        file_name = file.filename or "upload"
    elif file_url:
        try:
            file_bytes = download_bytes(file_url, DOCS_BUCKET)
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
            # status must be "error", not "done" — the frontend poller only
            # throws (and shows the real failure message) on status=="error";
            # "done" with rows=0 rendered as a false-positive success toast
            # ("Price Guide Ingested — 0 pricing rows ingested"), hiding a
            # broken extraction (wrong page range, wrong column count, etc.)
            # behind what looked like a successful upload.
            CATALOG_INGEST_JOBS[job_id] = {"status": "error", "progress": 100, "rows": 0, "error": "No pricing rows found — check that the catalog config's price_model/columns match this file."}
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

        invalidate_manufacturer_cache(manufacturer_id, org_id)
        CATALOG_INGEST_JOBS[job_id] = {
            "status": "done", "progress": 100, "rows": inserted, "error": None
        }

    except Exception as e:
        CATALOG_INGEST_JOBS[job_id] = {
            "status": "error", "progress": 0, "rows": 0, "error": str(e)
        }
    finally:
        current_org_id.reset(token)


# ─── POST: SKU confidence validator (Module 3) ───────────────────────────────

@router.post("/catalog/validate-skus")
async def validate_skus(
    payload: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """
    For each SKU in the request, return:
      - exact: found in manufacturer_pricing with the specified door_style
      - variant: base prefix exists but different size/suffix
      - not_found: no match in catalog
    Body: { manufacturer_id, door_style, skus: [str] }
    Response: { results: [{sku, status, price, suggestion}] }
    """
    supabase = get_supabase()
    mfg_id   = payload.get("manufacturer_id", "")
    door     = (payload.get("door_style") or "").upper()
    skus     = [s.upper().strip() for s in (payload.get("skus") or []) if s]

    if not mfg_id or not door or not skus:
        raise HTTPException(status_code=400, detail="manufacturer_id, door_style and skus are required")

    # 1. Fetch all rows for this manufacturer + door_style (cap 10k rows)
    rows_res = supabase.table(PRICING_TABLE).select("sku, price") \
        .eq("manufacturer_id", mfg_id).eq("door_style", door).limit(10000).execute()
    catalog: dict[str, float] = {
        (r["sku"] or "").upper(): float(r["price"] or 0)
        for r in (rows_res.data or [])
    }

    # 2. Also fetch all SKUs for this manufacturer (all door styles) for variant lookup
    all_skus_res = supabase.table(PRICING_TABLE).select("sku") \
        .eq("manufacturer_id", mfg_id).limit(10000).execute()
    all_skus: set[str] = {(r["sku"] or "").upper() for r in (all_skus_res.data or [])}

    results = []
    for sku in skus:
        if sku in catalog:
            results.append({"sku": sku, "status": "exact", "price": catalog[sku], "suggestion": None})
            continue

        # Variant: same alpha prefix, different numeric suffix
        import re
        m = re.match(r'^([A-Z]+)(\d+)(.*)$', sku)
        suggestion = None
        if m:
            prefix = m.group(1)
            suffix = m.group(3)
            # Find closest SKU with same prefix in the catalog (same door style)
            candidates = [s for s in catalog if s.startswith(prefix) and s.endswith(suffix)]
            if not candidates:
                # Try without suffix constraint
                candidates = [s for s in catalog if s.startswith(prefix)]
            if candidates:
                # Pick the one with numeric part closest to requested
                try:
                    target_num = int(m.group(2))
                    candidates.sort(key=lambda s: abs(int(re.search(r'\d+', s).group()) - target_num))
                except Exception:
                    pass
                suggestion = candidates[0]
                results.append({"sku": sku, "status": "variant", "price": None, "suggestion": suggestion})
                continue

        # Check if the SKU exists in any door style for this manufacturer
        if sku in all_skus:
            results.append({"sku": sku, "status": "wrong_style", "price": None,
                            "suggestion": f"SKU exists in catalog but not for door style {door}"})
        else:
            results.append({"sku": sku, "status": "not_found", "price": None, "suggestion": None})

    return {"success": True, "results": results}


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
