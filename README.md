# KABS Quotation AI - Intelligent Cabinetry Quotation System

KABS Quotation AI is a sophisticated full-stack application designed to automate the cabinetry takeoff and quotation process. By leveraging advanced AI models (Gemini 2.5 Pro & Flash), it extracts cabinet data from blueprint PDFs, matches them with manufacturer pricing guides, and generates professional quotations.

---

## 🚀 Why KABS Quotation AI?

- **Precision Extraction**: Uses a hybrid approach of Vision AI (Gemini) and local PDF analysis to ensure every cabinet in a blueprint is accounted for.
- **Speed**: What used to take hours of manual takeoff now happens in minutes.
- **Accuracy**: Eliminates human error by matching SKUs directly against manufacturer-provided Excel pricing guides.
- **Professionalism**: Automatically generates high-quality, professional A4 PDF quotations ready for client presentation.
- **Scalability**: Designed to handle multiple manufacturers, rooms, and complex cabinetry configurations.

---

## 🏗️ Code Structure & Architecture

The project is split into a modern frontend and a powerful processing backend.

### Root Directory

- `/frontend`: Next.js 15 application.
- `/backend`: FastAPI Python server.
- `/docs`: Project documentation and requirement files.
- `.gitignore`: Configured to exclude heavy dependencies and environment secrets.
- `render.yaml`: Blueprint for automated deployment on Render.

### Frontend Architecture (`/frontend`)

- **Framework**: Next.js 15.5.9 (App Router).
- **Styling**: Tailwind CSS for a premium look and feel.
- **AI Integration**: Google Genkit with Gemini 2.0/1.5 models.
- **Database/Auth**: Supabase (PostgreSQL) and Firebase.
- **Key Modules**:
  - `src/app/quotation-ai`: Main workflow for scanning and reviews.
  - `src/app/admin`: Portal for managing manufacturers and pricing guides.
  - `src/lib/pdf-extractor.ts`: Client-side PDF handling.

### Backend Architecture (`/backend`)

- **Framework**: FastAPI (Python).
- **Core Logic**:
  - `main.py`: API entry point.
  - `excel_processor.py`: Logic for parsing manufacturer pricing guides.
  - `matching_logic.py`: SKU matching algorithm for pricing.
- **Dependencies**: `pandas`, `openpyxl`, `fastapi`, `uvicorn`.

---

## 📖 User Manual: How to Use

### 1. Installation

**Prerequisites**: Node.js, Python 3.9+, Git.

#### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

#### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

### 2. Workflow

1. **Login**: Access the application via the secure portal.
2. **Scan**: Upload a blueprint PDF in the `Quotation AI` section.
3. **Review**: The AI will extract cabinets grouped by room. Review the SKUs, quantities, and add/edit items as needed.
4. **Price Match**: Select a manufacturer and collection. The system matches extracted codes to live pricing.
5. **Proposal**: Click "Generate Proposal" to get a professional PDF quotation.

---

## 🛠️ Developer Information

### Pushing to GitHub Process

If you are initializing or updating the repository:

1. Initialize: `git init`
2. Configure Remotes: `git remote add origin https://github.com/Gaura-kbgp/KABS-Quotation-AI-full.git`
3. Stage: `git add .`
4. Commit: `git commit -m "Your descriptive message"`
5. Push: `git push -u origin main`

### Important Notes

- Ensure `.env` files are not pushed (managed via `.gitignore`).
- Update `requirements.txt` when adding backend libraries.
- Use `npm run build` to verify the frontend is production-ready.

---

## 🌐 Deployment Guide

### One-Click Deployment on Render (Recommended)

This repository includes a `render.yaml` file that automates the deployment of both the frontend and backend.

1. Go to the [Render Dashboard](https://dashboard.render.com/).
2. Click **New** -> **Blueprint**.
3. Select this GitHub repository.
4. Render will automatically detect the `render.yaml` and create two services:
   - **`kabs-quotation-backend`** (FastAPI)
   - **`kabs-quotation-frontend`** (Next.js)
5. Fill in the required **Environment Variables** (API keys, Supabase URLs) in the Render dashboard.
6. Once deployed, the frontend will automatically connect to the backend.

### Original Render / Railway Manual Steps

Best for the **Backend** or full-stack solo deployments.

1. Connect your GitHub repository.
2. Set Build Command: `pip install -r backend/requirements.txt`
3. Set Start Command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables (API keys, DB URLs).

### Deployment on AWS (EC2/Elastic Beanstalk)

1. Launch an Ubuntu EC2 instance.
2. Install Docker or setup a Python environment.
3. Use Nginx as a reverse proxy to point to the FastAPI and Next.js processes.
4. Manage secrets using AWS Secrets Manager.

### Deployment on Vercel

Recommended for the **Frontend**.

1. Import the repository.
2. Vercel automatically detects Next.js.
3. Add environment variables in the Vercel Dashboard.

---

## 🛡️ License & Copyright

© 2026 KABS Design. All rights reserved.
