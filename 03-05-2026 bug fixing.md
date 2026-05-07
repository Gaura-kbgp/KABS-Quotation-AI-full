# Bug Fixing Report — 03-05-2026

## Overview

Six bugs were identified, planned, and resolved across the KABS Quotation AI system (Next.js frontend + Python FastAPI backend).

---

## Bug 1 & 2 — Incorrect Cabinet Counting / Point System Not Working

**Severity:** Critical

**Problem:**
Universal Fillers (UF\* prefix, e.g. UF342) were being treated identically to full cabinets in the install factor fallback logic. Items with category `Universal Fillers` were assigned `factor = 1.0` and counted toward 3PL cabinet units (`tplInclude = true`), which inflated installation costs and cabinet counts.

**Root Cause:**
Two `useMemo` blocks in `bom-manager-client.tsx` used a combined check:
```typescript
const isCabinetOrFiller = category.includes('Cabinets') || category === 'Universal Fillers';
factor = isCabinetOrFiller ? 1 : isMolding ? 0.1 : 0;
tplInclude = isCabinetOrFiller;
```
This gave fillers the same weight as full cabinet boxes.

**Fix:**
Separated `isFullCabinet` from `isFiller` and applied the correct values per the labor sheet:

| Item Type | Install Factor | Counts for 3PL |
|-----------|---------------|----------------|
| Wall / Base / Tall / Vanity Cabinets | 1.0 | Yes |
| Universal Fillers (UF\*) | 0.1 | No |
| Molding & Trim | 0.1 | No |
| Hardware / Accessories | 0.0 | No |

**Files Changed:**
- `frontend/src/app/quotation-ai/bom/[id]/bom-manager-client.tsx` — two locations (financials `useMemo` + installCalcs `useMemo`)

---

## Bug 3 — Manufacturer Data Issues (1951 Catalog Dropdown)

**Severity:** High

**Problem:**
The "Configure Brands" collection dropdown was showing raw database artifacts alongside the canonical collection names. Entries like `SCB/S` or parenthetical variants like `PREMIUM MAPLE (DURAFROM TEXTURED)` appeared as separate selectable options, making the UI confusing and unreliable.

**Root Cause:**
`fetchManConfig` in `estimator-client.tsx` merged DB results with the static config but did not filter out DB-only collections that don't match the canonical names defined in `manufacturer-config.ts`. All DB collection strings were passed directly into the dropdown.

**Fix:**
For manufacturers that have a static config entry (1951 Cabinetry, Wellborn), the dropdown now uses **only** the canonical static collection names as the authoritative list. DB door styles are pulled in when available for each canonical collection; static styles are the fallback. DB-only artifacts are excluded from display.

**Files Changed:**
- `frontend/src/app/quotation-ai/review/[id]/estimator-client.tsx` — `fetchManConfig` function

---

## Bug 4 — Door Style & Collection Mismatch (Pricing)

**Severity:** High

**Problem:**
Selecting "Premium Maple / Denver Maple" for a 1951 Cabinetry project returned ~$1,077 per unit instead of the correct ~$859. The system was matching against the wrong (higher-priced) collection.

**Root Cause:**
Two compounding issues:
1. The database stores collection names with parenthetical qualifiers (e.g. `"PREMIUM MAPLE (DURAFROM TEXTURED)"`), but the frontend sends the canonical name `"PREMIUM MAPLE"`. The old `normalize_collection_name()` did not strip parenthetical suffixes, so the normalized forms didn't match.
2. When the collection key lookup failed, the pricing engine fell through to the global SKU map, which stores the **highest** price found for each SKU across all collections — picking Elite Cherry pricing instead of Premium Maple.

**Fix:**

`cabinet_utils.py` — `normalize_collection_name()` extended to strip parenthetical qualifiers:
```
"PREMIUM MAPLE (DURAFROM TEXTURED)"  →  "PREMIUM MAPLE"
"ELITE CHERRY (NON TEXTURED)"        →  "ELITE CHERRY"
```

`pricing.py` — Tier 5 fuzzy collection matching rebuilt with a ranked candidate list:
1. Exact normalized match (parentheticals stripped on both sides)
2. Contains-match (one normalized name is a substring of the other)
3. Raw collection key as-is

This ensures the correct collection is found before any global fallback is attempted.

**Files Changed:**
- `backend/app/utils/cabinet_utils.py` — `normalize_collection_name()`
- `backend/app/api/pricing.py` — Tier 5 fuzzy collection matching in `find_best_match()`

---

## Bug 5 — Installation Pricing Shown Separately in Customer PDF

**Severity:** Major UX Issue

**Problem:**
In the Client Invoice PDF view, "INSTALLATION CHARGES" and "DELIVERY / 3PL" appeared as separate visible line items above the TOTAL. The customer-facing document should show installation folded into the total, not broken out as a named charge.

**Root Cause:**
The installation and delivery line items in the PDF template were rendered unconditionally — no check for whether the current view was the client-facing or internal-margin view.

**Fix:**
Both line items are now wrapped in `viewMode === 'internal'`:
- **Client Invoice View:** Installation and delivery are not shown as line items. The TOTAL already includes them via `financials.grandTotal`.
- **Internal Margin View:** Both line items remain visible as before for the dealer's reference.

**Files Changed:**
- `frontend/src/app/quotation-ai/bom/[id]/bom-manager-client.tsx` — lines rendering INSTALLATION CHARGES and DELIVERY / 3PL in the PDF section

---

## Bug 6 — Hardware Not Fully Captured from PDF Pages 2+

**Severity:** High

**Problem:**
Hardware items on page 2 of the Magnolia PDF (a 2D floor plan / hardware schedule) were not being extracted. The system only processed page 0 (floor plan) and page 1 (summary sheet), completely ignoring any additional pages.

**Root Cause:**
`vision_scanner.py` hardcoded processing of exactly two pages. The `analyze_drawing_vision()` function extracted pages 0 and 1 then closed the document. Page 2+ were never scanned. Additionally, the vision prompt described the "hardware" category too narrowly ("Doors, drawers, handles"), causing hardware items to be missed even when they were visible.

**Fix — Full rewrite of `vision_scanner.py`:**

1. **Gemini 2.0 Flash only** — NVIDIA NIM removed as a vision provider. Gemini is the sole AI backend for image analysis.

2. **Python-hybrid extraction strategy** — PyMuPDF text layer extraction runs first on every page at zero API cost:
   - If the text layer yields 3+ recognised cabinet/hardware codes → rule-based extraction only (no API call)
   - If the text layer is sparse (scanned/rasterised drawing) → page rendered as PNG and sent to Gemini

3. **All PDF pages processed:**

   | Page | Prompt Used | Purpose |
   |------|-------------|---------|
   | 0 | `FLOOR_PLAN_PROMPT` | Main cabinet layout |
   | 1 | `SUMMARY_PROMPT` | BOM/accessory summary sheet |
   | 2+ | `EXTRA_PAGE_PROMPT` | Additional floor plans, hardware schedules |

4. **Expanded hardware detection** — prompts now explicitly list all hardware types: DOORS, DRAWERS, HINGES, KNOBS, PULLS, HW-prefixed codes. Hardware items from extra pages are merged (quantities summed) into the matching room.

5. **Smart merging** — extra page results are merged into existing rooms by name match. New rooms from extra pages are appended. Quantities for the same code are summed, not duplicated.

**Files Changed:**
- `backend/app/utils/vision_scanner.py` — complete rewrite

---

## Files Modified Summary

| File | Bugs Fixed |
|------|-----------|
| `frontend/src/app/quotation-ai/bom/[id]/bom-manager-client.tsx` | 1, 2, 5 |
| `frontend/src/app/quotation-ai/review/[id]/estimator-client.tsx` | 3 |
| `backend/app/utils/cabinet_utils.py` | 4 |
| `backend/app/api/pricing.py` | 4 |
| `backend/app/utils/vision_scanner.py` | 6 |

---

## Notes

- After deploying Bug 4 fixes, clear the 15-minute pricing cache via `/api/clear-cache` to force rebuilt lookup maps.
- Bug 1 & 2 changes will retroactively recalculate install costs downward for any existing quote that included Universal Fillers — this is the correct behavior per the labor sheet.
- Bug 6's Python-hybrid approach reduces Gemini API calls significantly for PDFs with rich text layers (trim list pages, structured BOM sheets).
