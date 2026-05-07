"""
Labor & Delivery Charges API
Handles bulk CSV/Excel upload and CRUD for the labor_charges table.
"""
import io
import uuid
import re
import os
from typing import Optional, Any

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

router = APIRouter()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "") or os.environ.get("SUPABASE_KEY", "")


def _supabase():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ─── Constants ────────────────────────────────────────────────────────────────

VALID_CHARGE_TYPES    = {"installation", "delivery", "other"}
VALID_RATE_BASES      = {"per_unit", "per_linear_ft", "percentage", "flat", "per_mile"}
VALID_CAB_CATEGORIES  = {"wall", "base", "tall", "vanity", "hardware", "all"}

# Accepted column header aliases (lowercase)
_COL_ALIASES: dict[str, list[str]] = {
    "notes":            ["notes", "note", "comment", "remarks", "description"],
}

_INSTALL_RULE_ALIASES: dict[str, list[str]] = {
    "manufacturer":     ["manufacturer", "brand", "mfg", "factory"],
    "item_code":        ["item_code", "item code", "code", "sku"],
    "item_type":        ["item_type", "item type", "category", "type"],
    "install_factor":   ["install_factor", "install factor", "factor", "points", "point"],
    "include_in_3pl":   ["include_in_3pl", "include in 3pl", "3pl", "cabinet count"],
    "count_basis":      ["count_basis", "count basis", "basis"],
}


def _norm(s: Any) -> str:
    return str(s).strip().lower() if s is not None else ""


def _find_col(headers: list[str], field: str) -> Optional[int]:
    for alias in _COL_ALIASES.get(field, [field]):
        for i, h in enumerate(headers):
            if _norm(h) == alias:
                return i
    return None


def _cell(row: list, idx: Optional[int]) -> str:
    if idx is None or idx >= len(row):
        return ""
    v = row[idx]
    return "" if v is None else str(v).strip()


# ─── CSV/Excel parser ─────────────────────────────────────────────────────────

def _parse_matrix(matrix: list[list]) -> tuple[list[dict], list[str]]:
    """Convert a raw list-of-lists to validated labor charge records."""
    if len(matrix) < 2:
        return [], ["File has no data rows (need at least a header + one data row)."]

    headers = [str(c or "").strip() for c in matrix[0]]
    col_name  = _find_col(headers, "name")
    col_type  = _find_col(headers, "charge_type")
    col_cat   = _find_col(headers, "cabinet_category")
    col_basis = _find_col(headers, "rate_basis")
    col_rate  = _find_col(headers, "rate")
    col_notes = _find_col(headers, "notes")

    if col_name is None:
        return [], [f"Missing required 'Name' column. Found: {', '.join(headers)}"]
    if col_rate is None:
        return [], [f"Missing required 'Rate' column. Found: {', '.join(headers)}"]

    records: list[dict] = []
    warnings: list[str] = []

    for row_idx, row in enumerate(matrix[1:], start=2):
        name = _cell(row, col_name)
        if not name or name.upper() in ("NAN", "NONE", "NULL"):
            continue

        raw_rate = re.sub(r"[^\d.]", "", _cell(row, col_rate))
        if not raw_rate:
            warnings.append(f"Row {row_idx}: '{name}' skipped — no numeric rate")
            continue
        try:
            rate = float(raw_rate)
        except ValueError:
            warnings.append(f"Row {row_idx}: '{name}' skipped — invalid rate '{raw_rate}'")
            continue

        charge_type = _norm(_cell(row, col_type)) if col_type is not None else "installation"
        if charge_type not in VALID_CHARGE_TYPES:
            charge_type = "other"

        cabinet_category = _norm(_cell(row, col_cat)) if col_cat is not None else "all"
        if not cabinet_category or cabinet_category not in VALID_CAB_CATEGORIES:
            cabinet_category = "all"

        rate_basis = _norm(_cell(row, col_basis)) if col_basis is not None else "per_unit"
        if rate_basis not in VALID_RATE_BASES:
            rate_basis = "per_unit"

        notes = _cell(row, col_notes) if col_notes is not None else ""

        records.append({
            "id":               str(uuid.uuid4()),
            "name":             name,
            "charge_type":      charge_type,
            "cabinet_category": cabinet_category,
            "rate_basis":       rate_basis,
            "rate":             rate,
            "notes":            notes,
            "is_active":        True,
        })

    return records, warnings


def _parse_install_rules_matrix(matrix: list[list], manufacturers_map: dict[str, str]) -> tuple[list[dict], list[str]]:
    """Convert a raw list-of-lists to validated install rules records."""
    if len(matrix) < 2:
        return [], ["File has no data rows."]

    headers = [str(c or "").strip() for c in matrix[0]]
    col_mfg    = _find_col_custom(headers, _INSTALL_RULE_ALIASES, "manufacturer")
    col_code   = _find_col_custom(headers, _INSTALL_RULE_ALIASES, "item_code")
    col_type   = _find_col_custom(headers, _INSTALL_RULE_ALIASES, "item_type")
    col_factor = _find_col_custom(headers, _INSTALL_RULE_ALIASES, "install_factor")
    col_3pl    = _find_col_custom(headers, _INSTALL_RULE_ALIASES, "include_in_3pl")
    col_basis  = _find_col_custom(headers, _INSTALL_RULE_ALIASES, "count_basis")

    if col_code is None:
        return [], [f"Missing required 'Item Code' column. Found: {', '.join(headers)}"]
    if col_factor is None:
        return [], [f"Missing required 'Install Factor' column. Found: {', '.join(headers)}"]

    records: list[dict] = []
    warnings: list[str] = []

    for row_idx, row in enumerate(matrix[1:], start=2):
        code = _cell(row, col_code)
        if not code or code.upper() in ("NAN", "NONE", "NULL"):
            continue

        mfg_name = _norm(_cell(row, col_mfg))
        mfg_id = None
        if mfg_name:
            # Try exact match or partial
            for name, mid in manufacturers_map.items():
                if mfg_name in name.lower() or name.lower() in mfg_name:
                    mfg_id = mid
                    break
        
        if not mfg_id:
            warnings.append(f"Row {row_idx}: '{code}' skipped — manufacturer '{mfg_name}' not found")
            continue

        raw_factor = re.sub(r"[^\d.]", "", _cell(row, col_factor))
        try:
            factor = float(raw_factor) if raw_factor else 1.0
        except ValueError:
            factor = 1.0

        item_type = _norm(_cell(row, col_type)) or "cabinet"
        include_in_3pl = _cell(row, col_3pl).upper() in ("TRUE", "1", "YES", "Y")
        count_basis = _norm(_cell(row, col_basis)) or "quantity"

        records.append({
            "id":              str(uuid.uuid4()),
            "manufacturer_id": mfg_id,
            "item_code":       code.upper(),
            "item_type":       item_type,
            "install_factor":  factor,
            "include_in_3pl":  include_in_3pl,
            "count_basis":     count_basis,
        })

    return records, warnings


def _find_col_custom(headers: list[str], aliases_dict: dict[str, list[str]], field: str) -> Optional[int]:
    for alias in aliases_dict.get(field, [field]):
        for i, h in enumerate(headers):
            if _norm(h) == alias:
                return i
    return None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/upload-labor")
async def upload_labor(file: UploadFile = File(...)):
    """Parse a CSV or Excel labor sheet and replace all existing rates."""
    file_bytes = await file.read()
    filename = (file.filename or "").lower()

    matrix: list[list] = []
    if filename.endswith(".csv"):
        import csv
        text = file_bytes.decode("utf-8-sig", errors="replace")
        matrix = list(csv.reader(io.StringIO(text)))
    elif filename.endswith((".xlsx", ".xlsm", ".xls")):
        try:
            from python_calamine import CalamineWorkbook
            wb = CalamineWorkbook.from_object(io.BytesIO(file_bytes))
            sheet = wb.get_sheet_by_name(wb.sheet_names[0])
            matrix = sheet.to_python(skip_empty_area=False)
        except ImportError:
            import pandas as pd
            df = pd.read_excel(io.BytesIO(file_bytes), header=None)
            matrix = df.where(df.notna(), None).values.tolist()
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use CSV or Excel (.xlsx/.xlsm).")

    records, warnings = _parse_matrix(matrix)
    if not records:
        return {"success": False, "error": "No valid records parsed.", "warnings": warnings}

    sb = _supabase()

    # Replace all existing records
    sb.table("labor_charges").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    chunk = 200
    for i in range(0, len(records), chunk):
        sb.table("labor_charges").insert(records[i:i + chunk]).execute()

    install_count  = sum(1 for r in records if r["charge_type"] == "installation")
    delivery_count = sum(1 for r in records if r["charge_type"] == "delivery")
    other_count    = len(records) - install_count - delivery_count

    return {
        "success":          True,
        "count":            len(records),
        "installation_count": install_count,
        "delivery_count":   delivery_count,
        "other_count":      other_count,
        "warnings":         warnings,
        "fileName":         file.filename,
    }


@router.post("/upload-install-rules")
async def upload_install_rules(file: UploadFile = File(...)):
    """Parse an Excel/CSV install rules sheet and upsert them into public.install_rules."""
    try:
        file_bytes = await file.read()
        filename = (file.filename or "").lower()

        matrix: list[list] = []
        if filename.endswith(".csv"):
            import csv
            text = file_bytes.decode("utf-8-sig", errors="replace")
            matrix = list(csv.reader(io.StringIO(text)))
        else:
            try:
                from python_calamine import CalamineWorkbook
                wb = CalamineWorkbook.from_object(io.BytesIO(file_bytes))
                sheet = wb.get_sheet_by_name(wb.sheet_names[0])
                matrix = sheet.to_python(skip_empty_area=False)
            except Exception as e:
                import pandas as pd
                df = pd.read_excel(io.BytesIO(file_bytes), header=None)
                matrix = df.where(df.notna(), None).values.tolist()

        sb = _supabase()
        # Fetch all manufacturers to map names to IDs
        mfg_res = sb.table("manufacturers").select("id, name").execute()
        mfg_map = {m["name"]: m["id"] for m in mfg_res.data} if mfg_res.data else {}

        records, warnings = _parse_install_rules_matrix(matrix, mfg_map)
        if not records:
            return {"success": False, "error": "No valid records parsed.", "warnings": warnings}

        target_mfg_ids = list(set(r["manufacturer_id"] for r in records))
        if target_mfg_ids:
            sb.table("install_rules").delete().in_("manufacturer_id", target_mfg_ids).execute()

        chunk = 200
        for i in range(0, len(records), chunk):
            sb.table("install_rules").insert(records[i:i + chunk]).execute()

        return {
            "success": True,
            "count":   len(records),
            "warnings": warnings,
            "fileName": file.filename,
        }
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"ERROR in upload_install_rules: {error_detail}")
        return {"success": False, "error": f"Internal Server Error: {str(e)}", "detail": error_detail}


@router.get("/labor-rates")
async def get_labor_rates():
    sb = _supabase()
    res = (sb.table("labor_charges")
             .select("*")
             .eq("is_active", True)
             .order("charge_type")
             .order("name")
             .execute())
    return {"rates": res.data or []}


class RateBody(BaseModel):
    name:             Optional[str]   = None
    charge_type:      Optional[str]   = None
    cabinet_category: Optional[str]   = None
    rate_basis:       Optional[str]   = None
    rate:             Optional[float] = None
    notes:            Optional[str]   = None
    is_active:        Optional[bool]  = None


@router.post("/labor-rates")
async def create_labor_rate(body: RateBody):
    sb = _supabase()
    record = {
        "id":               str(uuid.uuid4()),
        "name":             body.name or "Unnamed Charge",
        "charge_type":      body.charge_type or "installation",
        "cabinet_category": body.cabinet_category or "all",
        "rate_basis":       body.rate_basis or "per_unit",
        "rate":             body.rate or 0.0,
        "notes":            body.notes or "",
        "is_active":        True,
    }
    res = sb.table("labor_charges").insert(record).execute()
    return {"success": True, "rate": res.data[0] if res.data else record}


@router.put("/labor-rates/{rate_id}")
async def update_labor_rate(rate_id: str, body: RateBody):
    sb = _supabase()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided to update.")
    res = sb.table("labor_charges").update(updates).eq("id", rate_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Rate not found.")
    return {"success": True, "rate": res.data[0]}


@router.delete("/labor-rates/{rate_id}")
async def delete_labor_rate(rate_id: str):
    _supabase().table("labor_charges").delete().eq("id", rate_id).execute()
    return {"success": True}
