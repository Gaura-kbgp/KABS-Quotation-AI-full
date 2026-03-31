# KABS Quotation AI

An intelligent full-stack platform designed to automate cabinet quotation and bill-of-materials (BOM) generation from architectural drawings and design specifications.

## 🚀 Overview

KABS Quotation AI leverages Google Gemini AI to analyze complex kitchen and bath design drawings (PDFs/Images). It extracts cabinet SKUs, quantities, and room specifications, then matches them against manufacturer-specific pricing catalogs to generate instant, accurate quotations.

### Key Features
- **AI-Powered Extraction**: Automatically identifies cabinets, hardware, and accessories from design documents.
- **Dynamic Pricing Engine**: Matches extracted SKUs against large-scale manufacturer catalogs (100k+ records) with fuzzy matching support.
- **Multi-Room Support**: Organize quotations by room (Kitchen, Master Bath, etc.) with individual and grand totals.
- **PDF Proposal Generation**: Create professional, itemized PDF proposals for clients directly from the browser.
- **Admin Portal**: Manage manufacturers, upload pricing Excel sheets, and configure collection/door style mappings.

---

## 🛠 Tech Stack

### Frontend
- **Framework**: [Next.js 15+](https://nextjs.org/) (App Router, React 19)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [Radix UI](https://www.radix-ui.com/) & [Lucide React](https://lucide.dev/)
- **AI Integration**: [Google Genkit](https://firebase.google.com/docs/genkit)
- **Form Handling**: [React Hook Form](https://react-hook-form.com/) & [Zod](https://zod.dev/)

### Backend
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.11)
- **Database/Auth**: [Supabase](https://supabase.com/) & [Firebase](https://firebase.google.com/)
- **Data Processing**: [Pandas](https://pandas.pydata.org/) & [Openpyxl](https://openpyxl.readthedocs.io/)
- **Fuzzy Matching**: [TheFuzz](https://github.com/seatgeek/thefuzz) (Levenshtein distance)

---

## 📂 Code Structure

### Root Directory
- `frontend/`: Next.js client application.
- `backend/`: FastAPI server and AI processing logic.
- `Dockerfile`: Unified Docker build for both frontend and backend.
- `render.yaml`: Infrastructure-as-code for Render deployment.
- `start.sh`: Orchestration script to run both services in a single container.

### Frontend Details (`/frontend`)
- `src/app/`: Next.js App Router pages (Dashboard, Quotation AI, BOM Review).
- `src/components/`: Reusable UI components (Sidebar, Tables, Dialogs).
- `src/ai/`: [Genkit] AI Flows for document analysis and SKU extraction.
- `src/lib/`: Shared utilities (Supabase client, PDF generation logic).

### Backend Details (`/backend`)
- `app/api/`: REST endpoints for pricing, BOM generation, and file uploads.
- `app/utils/`: Core logic for SKU compression, category detection, and Excel processing.
- `app/core/`: Database connection and configuration.

---

## ⚙️ Installation & Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- Supabase Project (URL & Keys)
- Google Gemini API Key

### 1. Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
# Configure .env with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
python main.py
```

### 2. Frontend Setup
```bash
cd frontend
npm install
# Configure .env with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, GEMINI_API_KEY
npm run dev
```

---

## 🚢 Deployment

The project is designed for **Render** using a unified Docker setup:
1. The Frontend is built as a standalone Next.js server.
2. The Backend runs alongside it on port 8000.
3. Both are served via a single endpoint using the `start.sh` script.

**Deployment Checklist:**
- Ensure all environment variables in `render.yaml` are configured in the Render Dashboard.
- Use a **Starter** plan or higher to handle the AI processing memory requirements.

---

## 📝 Developer Notes
- **SKU Matching**: The pricing engine uses a multi-tier matching strategy (Strict -> Cleaned -> Compressed -> Fuzzy) to ensure high accuracy even with varied manufacturer notations.
- **Performance**: Large manufacturer catalogs are fetched in batches to avoid memory overflow in production environments.
