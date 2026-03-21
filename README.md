# KABS Quotation AI - Technical Documentation & User Manual

KABS Quotation AI is a high-precision architectural cabinetry takeoff and pricing platform. It leverages **Gemini 2.5 Pro** and **Gemini 2.5 Flash** for multi-page PDF reasoning and a proprietary **"Universal Jack" Pricing Engine** to automate complex estimations.

---

## 🚀 1. Tech Stack
- **Framework**: Next.js 15 (App Router)
- **AI Engine**: Google Genkit + Gemini 2.5 Pro (Vision) & Gemini 2.5 Flash (Global)
- **Database**: Supabase (PostgreSQL)
- **Processing**: Hybrid Local PDF Anchoring + Vision AI

---

## 📂 2. Application Routes
- `/quotation-ai`: Hybrid PDF Upload & Scan.
- `/quotation-ai/review/[id]`: Review Workstation (Add Rooms/Cabinets, Edit SKUs).
- `/quotation-ai/bom/[id]`: Pricing & Final Proposal Generator.
- `/admin/*`: Manufacturer, Pricing Guide, and NKBA Rule Management.

---

## 📘 3. User Workflow

### Step 1: Scan
1. Upload the Blueprint PDF.
2. The AI uses **Gemini 2.5 Pro** to scan floor plans and cabinetry schedules.

### Step 2: Review
1. The **Cabinets** and **Accessories And Others** are grouped room-wise.
2. Add manual items or rooms using the provided interface.
3. Edit any SKU code or Quantity directly.

### Step 3: Price & Proposal
1. Select the brand and collection.
2. Generate the BOM.
3. Print the final professional A4 Quotation.
