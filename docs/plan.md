# KABS Quotation AI — Master Plan

> **Purpose:** Ek hi file madhe sagal kahi. Dar navi conversation madhe pehle he file vach — background, architecture, roadmap, pending tasks, client details sab yeth ahe.
> Last updated: 2026-10-08

---

## 1. Project Overview

**KABS Quotation AI** — Cabinet dealers saathi automated quotation SaaS.
- User architectural PDF drawing upload karto
- System cabinet SKUs extract karto (room-wise)
- Manufacturer pricing catalog se match karto
- Itemized BOM + PDF proposal generate karto

**Current clients / tenants:**
| Client | Status | Notes |
|--------|--------|-------|
| KABS (internal) | Live | Super admin, platform owner |
| Elevate Cabinetry Design | In progress | Rob Nedds, 15 states, Wellborn + Legacy brands, 9000+ projects |
| Chesapeake Bay Cabinet Co. | Lead | Richmond VA, orders from Marsh Cabinets |

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router, React 19), Tailwind CSS, Radix UI |
| Backend | FastAPI (Python 3.11), port 8000 |
| Database | Supabase (Postgres + Storage) |
| AI | OpenAI gpt-4o-mini (flash), gpt-4o (balanced/pro-high) |
| PDF | PyMuPDF (fitz) |
| Fuzzy match | TheFuzz (Levenshtein) |
| Auth | Google OAuth → HS256 JWT `kabs_session` cookie (shared secret between Next.js + FastAPI) |
| Deploy | Docker (start.sh runs both on 3000+8000), Render (render.yaml) |

---

## 3. Key File Map

### Backend
```
backend/
├── main.py                          FastAPI app, 4 routers under /api/
├── app/api/
│   ├── agent.py                     AI endpoints: drawing analysis, BOM descriptions, training
│   ├── pricing.py                   BOM generation, SKU matching (10-tier), catalog upload
│   ├── catalog.py                   Self-training: extract config, ingest pricing, dropdown options
│   └── labor.py                     Labor/delivery charges CRUD
├── app/core/
│   ├── auth.py                      JWT verify, CurrentUser dataclass, profile cache
│   └── supabase_client.py           ScopedClient — auto org_id filter on all tenant tables
└── app/utils/
    ├── ai_client.py                 OpenAI wrapper: llm_generate() with tier selection
    ├── cabinet_utils.py             NKBA taxonomy, compress_sku, parse_sku_dimensions
    ├── rule_based_extractor.py      Zero-cost regex+PyMuPDF extraction
    ├── excel_processor.py           Manufacturer Excel → DB
    ├── pdf_processor.py             Manufacturer pricing PDFs → DB
    ├── drawing_processor.py         Extract text from design PDFs
    └── catalog_extractor.py         AI+rule-based: price guide PDF/Excel → catalog config + pricing rows
```

### Frontend
```
frontend/src/
├── app/
│   ├── quotation-ai/page.tsx        PDF upload form
│   ├── quotation-ai/review/[id]/    Review page: edit rooms, set manufacturer/collection/style
│   ├── quotation-ai/bom/[id]/       BOM editor + PDF proposal generation
│   ├── elevate/page.tsx             Elevate addon dashboard (4 phases shown)
│   └── super-admin/                 Platform admin: clients, training, usage stats
├── ai/flows/
│   └── analyze-drawing-flow.ts      Orchestrates: local extractor → AI fallback
├── features/
│   ├── manufacturers/               Manufacturer CRUD UI + actions
│   └── elevate/
│       ├── pricing.ts               Phase A pricing engine (pure functions)
│       ├── phase-a-workbench.tsx    Staff UI: items table + rules + worksheet
│       ├── pricing-rules-form.tsx   Rules form component
│       └── actions.ts               Save/load pricing profile (DB)
└── lib/
    ├── session.ts                   HS256 JWT sign/verify
    ├── auth.ts                      apiUser(), authFetch(), requireUser()
    └── db.ts                        Tenant-scoped Supabase client
```

### Docs
```
docs/
├── plan.md                          ← HE FILE (master reference)
├── elevate-requirements.md          Elevate's 4-phase spec (agreed)
├── multi-tenant-plan.md             Multi-tenancy phases 0-6
├── blueprint.md                     Original app style guide
├── multitenant_001-010_*.sql        DB migration scripts (run in order)
└── supabase_setup.sql               Initial DB setup
```

---

## 4. Core Data Pipeline

```
1. PDF Upload
   POST /api/upload-drawing (Next.js route)
   → PDF → Supabase Storage (private bucket, path: {orgId}/quotations/drawings/{uuid}.pdf)
   → quotation_projects row created (status: 'Processing')

2. Extraction
   analyze-drawing-flow.ts
   → Step 1: POST /api/agent/analyze-drawing-local  (rule-based, 0 cost, 30s timeout)
   → Step 2 fallback: POST /api/agent/analyze-drawing-full  (PyMuPDF + OpenAI, 5min timeout)
   → Returns: { rooms: [{ room_name, cabinets:[], perimeter:[], island:[], hardware:[], ... }] }

3. Review Page
   User selects: manufacturer + collection + door_style per room
   "Smart Agent" button → AI rescan on-demand

4. BOM Generation
   POST /api/generate-bom (proxied to FastAPI)
   → Load manufacturer pricing from Supabase (15-min in-memory cache per org+mfg)
   → 10-tier SKU matching per item
   → Write quotation_boms rows to DB

5. BOM Manager
   Editable table: qty, price, notes
   Labor/install point calculation
   PDF proposal generation (client-side)
```

---

## 5. SKU Matching — 10-Tier Engine (pricing.py)

| Tier | Name | How |
|------|------|-----|
| 1 | EXACT_SPEC | Exact SKU + collection + door_style |
| 2 | BRIDGED | Drawing suffix → catalog (BUTT→BD, LH→L, RH→R) |
| 3 | COMPRESSED | Normalize spaces/punctuation |
| 4 | ALIAS | Moulding aliases (BTK↔TK, OCM↔CM, etc.) |
| 5 | SMART_FUZZY | token_set_ratio ≥ 95% |
| 6 | SMART_DIM_IDENTITY | Same dims + same section, only 1 candidate |
| 7 | DIMENSION_MATCH | Dimension key lookup |
| 8 | NEAREST_DIM | Closest available size |
| 9 | CATEGORY_AVERAGE | Average price of same cabinet category |
| 10 | MANUAL_PRICING_REQUIRED | No match → $0, staff enters manually |

---

## 6. Multi-Tenancy

- Every DB table in `TENANT_TABLES` is auto-scoped to `org_id` via `ScopedClient`
- `current_org_id` is a `ContextVar` set per-request by `get_current_user`
- Two roles: `super_admin` (full platform) and `dealer_admin` (own org only)
- JWT: `sub`=profile_id, `v`=token_version (bumped on password reset → forced sign-out)
- Session: `kabs_session` httpOnly cookie, 7-day TTL, HS256 with shared `SESSION_SECRET`
- Google OAuth only — no email/password

---

## 7. Manufacturers — Current Status

### Wellborn (✅ WORKING)
- Multi-collection structure (Designer, Prestige, etc. → sub-collections)
- Full SKU catalog uploaded in DB
- KABS primary test manufacturer

### Marsh Cabinets (🔧 TO ADD — Chesapeake Bay client)
**Company:** High Point, NC | Orders from Chesapeake Bay Cabinet Co. (Richmond, VA)

**Documents received (Oct 2026):**
- `Marsh_StyleGuide_11.25.pdf` — door styles, species, finishes
- `Marsh-Price-Guide-2026 (1).pdf` — 296 pages, pricing tables
- `Marsh-Spec-Guide-2026 (1).pdf` — 576 pages, cabinet specs + dimensions

**Marsh Pricing Structure (KEY DIFFERENCE from Wellborn):**
- NOT separate collections — ONE catalog with 9 price columns (1, 2, 3, 4S, 5, 6, 4F, 7, 8, 9)
- Standard Overlay: columns 1, 2, 3, 4S, 5, 6
- Full Overlay: columns 4F, 7, 8, 9
- Door style → column mapping:

| Column | Door Styles |
|--------|------------|
| 1 | Cambridge Birch |
| 2 | Atlanta Birch, Brunswick Birch, Pinehurst Birch, Fulton Captiv8 |
| 3 | Cambridge Maple, Cambridge Oak |
| 4S | Atlanta Maple/Oak, Brunswick Maple/Oak, Pinehurst Maple/Oak |
| 5 | Florence Birch |
| 6 | Florence Maple/Oak |
| 4F | Apex Maple/Oak (Full Overlay entry) |
| 7 | Apex Oak, Hampton, Jamestown, Monroe, Savannah, Sedgefield, Summerfield, Wilmington, Wentworth |
| 8 | Arlington, Charleston, Nantucket |
| 9 | Arcadia, Jefferson |
| Captiv8 | Fulton→2(S), Winston→4F(F) |

**Marsh SKU Format:** `[TYPE][WIDTH][HEIGHT][SUFFIX]`
- `W1212` = Wall 12"W × 12"H
- `W2430` = Wall 24"W × 30"H
- `B30` = Base 30"W (standard 34.5"H)
- `W1212GL` = Glass doors | `W2412BP` = Bi-Parting | `W1212MD` = Mullion

**Species:** Oak(O), Birch(B), Maple(M), Cherry(C), PHW, POK, Captiv8(C8)

**Upcharges:**
- Cherry: +7% over Maple list
- Paintable Hardwood / Glazes: +15% over list
- Plywood (PC): +$75 Walls, +$110 Bases, +$220 Talls
- Finished Ends (FE): +$96 Walls, +$154 Bases, +$340 Talls
- Applied Overlay Doors (AOVD): $640/$820/$1600

**What needs to be built for Marsh:**
1. Parse Marsh price guide → CSV with columns: `sku, price1, price2, price3, price4S, price5, price6, price4F, price7, price8, price9, weight, cubes`
2. Add door_style → column mapping table to manufacturer config in DB
3. Modify `_price_rooms()` to do column-based lookup when manufacturer has price-column model
4. Upload Marsh catalog via existing `/api/upload-pricing` endpoint (or new Marsh-specific parser)

---

## 8. Elevate Cabinetry Design — Addon

**Client:** Rob Nedds | 15 states | 9,000+ projects | Brands: Wellborn + Legacy (Integrity, Shiloh)

### 4 Phases (from `docs/elevate-requirements.md`)

#### Phase A — Pricing from 2020 Design PDF or product list
**Status: ✅ COMPLETE**

Files:
- `features/elevate/pricing.ts` — complete pricing engine (pure functions)
- `features/elevate/phase-a-workbench.tsx` — staff UI (items table + rules + worksheet)
- `features/elevate/pricing-rules-form.tsx` — rules form
- `features/elevate/actions.ts` — DB save/load
- `docs/multitenant_010_elevate_pricing.sql` — DB table: `elevate_pricing_profiles`

Pricing formula (coded, rules are ASSUMPTIONS until Elevate confirms):
```
Cost           = list_price × costFactor        (default 0.45 = 55% off list)
Sell (markup)  = cost × (1 + markupPct/100)
Sell (GP)      = cost / (1 - grossProfitTargetPct/100)
Builder disc   = sell × builderDiscountPct/100
Product total  = sell − builder_discount
Charges        = installation + delivery + freight + 3PL + hardware  (flat $, separate)
Tax            = product_total × taxPct/100  (+ charges if taxOnCharges=true)
Grand total    = product_total + charges + tax
```

**Built:** `POST /api/elevate/extract-items` — PyMuPDF rule-based extraction with AI (gpt-4o-mini) fallback. Frontend: "Import 2020 PDF" button in Phase A workbench auto-fills the items table.

#### Phase B — Catalog ingest + SKU matching
**Status: 🟡 KABS ENGINE READY, CATALOGS PENDING**
- Wellborn already in DB and working
- Need: Integrity catalog, Shiloh catalog (Elevate to supply)
- Need: Elevate's hardware/install/delivery/freight/3PL/margin rules

#### Phase C — Dimensioned plan → layout generation
**Status: 🟢 MVP IN PROGRESS — rule-based layout engine landed**

This is the "Blueprint Intelligence Engine":
- Current KABS: drawing already has `W3030, B30` etc. → extract → price
- Phase C need: drawing has WALL DIMENSIONS (12'6" wall, 8'0" ceiling, sink at center) → generate cabinet layout → SKU list → price
- Blocked (long-term tuning) on: 15-20 completed kitchen examples per manufacturer from Elevate

**Shipped (this session):**
- `backend/app/utils/layout_generator.py` — NKBA rule-based engine
  - Input: JSON wall spec (length, openings, appliances)
  - Algorithm: anchors appliances/openings → fills gaps greedily with standard
    base widths (9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48) +
    fillers 1–3". Upper band fills around windows / tall units; adds HOOD_SPACE
    over range; crown + toe-kick trim lines per wall.
  - Output: list of {code, qty, wall, position_in, category, notes}
- `backend/app/api/blueprint.py` — new router:
  - `POST /api/blueprint/generate-layout` — pure layout, no persistence
  - `POST /api/blueprint/apply-to-project` — generates + merges SKUs into
    `extracted_data.rooms[].cabinets` so existing BOM/pricing engine can quote it
- Registered in `main.py`.

**Shipped (follow-up session):**
- [x] Frontend "Blueprint Mode" wizard at `/quotation-ai/blueprint/[id]`
  - wall/island/peninsula inputs, appliance picker, visual preview with ruler
  - "Blueprint Mode" button added to BOM page header
  - "Apply to Project" merges SKUs into room so BOM/pricing engine quotes them
- [x] PDF extraction (`blueprint_pdf_parser.py` + `POST /api/blueprint/parse-pdf`)
  - PyMuPDF text spans + regex for dims (`12'-6"`, `150"` etc.) + appliance labels
  - Heuristic edge-clustering to group dimensions into wall runs
  - "Import 2020 PDF" button in wizard auto-populates walls
- [x] Island & peninsula support in layout engine
  - Base cabs duplicated for back side (`_back` wall id)
  - End panels: 2× for island, 1× (free end) for peninsula
  - No upper cabinets / crown on islands or peninsulas
- [x] AI-assisted layout refinement (`POST /api/blueprint/ai-refine`)
  - Sends rule-based layout + spec to `llm_generate` for design review
  - Returns {verdict, notes, suggestions} rendered in wizard's amber panel

**Still remaining for Phase C:**
- [ ] Vanity-tall / linen stack logic for bathrooms
- [ ] OCR fallback for scanned/image-only PDFs (easyocr/Tesseract)
- [ ] Multi-page floor-plan support (currently clusters each page separately)
- [ ] Validate against the 15–20 Elevate example kitchens once provided

#### Phase D — Editing + estimate + customer summary
**Status: ⚡ PARTIAL — BOM manager works, Elevate-specific UI needed**
- Depends on Phase A + B + C

### Module 5 — Staff Review & Approval (✅ COMPLETE)
- `features/review/staff-review-panel.tsx` — Review status workflow (Draft → In Review → Approved → Sent)
  - Progress indicator, advance-status button, SKU exception detection
  - "Customer Quote" link opens clean printable view
- `app/quotation-ai/quote/[id]/page.tsx` + `customer-quote-client.tsx` — Customer-facing quote
  - Letterhead, room-by-room BOM table, grand total, print/PDF button
- `setReviewStatusAction()` in `actions.ts` — patches `review_status` on `quotation_projects`
- Panel integrated into review page (`estimator-client.tsx`) at top of review step
- **DB**: uses `review_status` column on `quotation_projects` (add if not present: `ALTER TABLE quotation_projects ADD COLUMN review_status text DEFAULT 'draft';`)

### Waiting on from Elevate (BLOCKED)
- [ ] Integrity, Wellborn, Shiloh price lists (authorized catalogs)
- [ ] 2020 Design PDF sample files (for extraction testing)
- [ ] Actual cost factor, markup/GP rules (currently assumed)
- [ ] Hardware, install, delivery, freight, 3PL, margin rules
- [ ] 15-20 completed kitchen examples per manufacturer
- [ ] Builder-specific templates and discounts

---

## 9. Roadmap — Priority Order

### DONE (this session)
- [x] **Self-training catalog system** — `manufacturer_catalog_config` table (migration 011), `catalog_extractor.py`, `catalog.py` router (5 endpoints), `_price_rooms()` updated to read `style_to_collection` for price-column manufacturers
- [x] **Smart Catalog Config UI** — new card in manufacturer detail page with re-train button, shows door styles / price columns / species / finishes
- [x] **Marsh pricing lookup** — `_price_rooms()` now maps door_style → COL_x via `style_to_collection` from DB

### NOW (still pending)
- [ ] **Run DB migration 011** — execute `docs/multitenant_011_catalog_config.sql` in Supabase
- [ ] **Ingest Marsh catalog** — upload Marsh price guide PDF through new Smart Catalog Config → Re-train → then Pricing Files → Add File to ingest actual rows
- [x] **Phase A: 2020 PDF extractor** — `POST /api/elevate/extract-items`, rule-based + AI fallback, "Import 2020 PDF" button in workbench

### NEXT (after Elevate sends materials)
- [ ] Integrity + Shiloh catalog upload
- [ ] Elevate pricing rules configuration (confirm costFactor, markup, charges)
- [ ] Phase B testing with real Wellborn + Integrity examples

### LATER (larger effort)
- [x] **Phase C: rule-based engine + wizard + PDF parser + island/peninsula + AI refine**
  - Backend: `layout_generator.py`, `blueprint_pdf_parser.py`, `blueprint.py` API
  - Frontend: `/quotation-ai/blueprint/[id]` wizard with visual preview
- [ ] Phase C polish: OCR fallback, vanity/bath, Elevate-example validation
- [ ] Phase D: Elevate-branded estimate + customer summary UI

---

## 10. DB Migration Scripts — Run Order

```
multitenant_001_add_orgs.sql         Organizations + profiles tables
multitenant_002_lockdown.sql         RLS deny-all, org_id on tenant tables
multitenant_003_org_settings.sql     Company settings per org
multitenant_004_private_storage.sql  Make storage buckets private
multitenant_005_audit_log.sql        Audit log table
multitenant_006_usage_events.sql     Usage tracking
multitenant_007_client_stats.sql     Client stats view
multitenant_008_onboarding.sql       Onboarding flags
multitenant_009_signature.sql        Proposal signature fields
multitenant_010_elevate_pricing.sql  elevate_pricing_profiles table
multitenant_011_catalog_config.sql   manufacturer_catalog_config (self-training, door styles, price columns)
```

---

## 11. Environment Variables (required)

```env
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=

# Auth (same value on BOTH frontend and backend)
SESSION_SECRET=                      # Min 32 chars, random

# AI
OPENAI_API_KEY=

# Deployment
BACKEND_URL=                         # e.g. http://localhost:8000 or production URL
CORS_ORIGINS=                        # comma-separated allowed origins

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

---

## 12. Known Issues / Watch Out

| Issue | Detail |
|-------|--------|
| scan_result_*.json files | Saved locally for debugging — DO NOT commit. Already in .gitignore |
| agent_clean.py | Deleted (was duplicate) |
| Scanned PDFs | Image-only PDFs (like Chesapeake Bay invoice `bill-INV61C38131.pdf`) return empty text — need Vision/OCR fallback |
| Large catalogs | Wellborn has 5000+ rows — `_fetch_pricing_data_internal` uses ThreadPoolExecutor + targeted fetch |
| Cache invalidation | `GLOBAL_LOOKUP_CACHE` is 15-min in-memory. On redeploy, cache resets. Per-org keyed. |
| Marsh price column `—` | In price tables, `—` means that door style not available for that SKU variant |

---

## 13. Chesapeake Bay — Order Documents (received Oct 2026)

- `bill-INV61C38131.pdf` — Invoice/bill (image-based, OCR needed to read)
- `Chesapeake Bay_Marsh Display R3.pdf` — Display order from Marsh (showroom setup)
- `CONFIRMATION1333465_00001.PDF` — Marsh order confirmation
- `CONFIRMATION1334466.PDF` — Marsh order confirmation

These are **Marsh Cabinets order documents** — useful as real-world SKU examples for Marsh integration testing.
