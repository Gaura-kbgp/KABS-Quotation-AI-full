'use server';

import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.cwd(), 'tmp_ai_scan_debug.log');
function logToFile(msg: string) {
  const timestamp = new Date().toISOString();
  try {
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
  } catch (e) {
    console.error('Logging failed:', e);
  }
}

export interface AnalyzeDrawingOutput {
  rooms: any[];
}

/**
 * STEP-WISE FAST SCAN
 * 
 * OLD approach: Split PDF → 9 pages → 9 HTTP calls → 9 AI calls → merge → Smart Agent = ~10 AI calls
 * NEW approach: Send PDF URL → 1 backend call → PyMuPDF extracts all text → 1 AI call = 2 AI calls total
 * 
 * Result: 5-10x faster, more accurate (full document context), no duplicate rooms.
 */
export async function analyzeDrawing(input: {
  pdfDataUri: string;
  projectName?: string;
}): Promise<AnalyzeDrawingOutput> {
  const startTime = Date.now();
  logToFile(`[STEP-WISE SCAN] Starting for: ${input.projectName || 'New Project'}`);
  logToFile(`[STEP-WISE SCAN] PDF URL: ${input.pdfDataUri}`);

  try {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new Error('BACKEND_URL environment variable is not set');
    }

    logToFile(`[STEP-WISE SCAN] Step 1: Trying LOCAL extraction (No API Key)...`);

    // 1. Try LOCAL extraction first (Rule-based, 0 cost, super fast)
    let response = await fetch(`${backendUrl}/api/agent/analyze-drawing-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: input.pdfDataUri,
      }),
      signal: AbortSignal.timeout(30000), // 30s timeout for local
    });

    let result = await response.json();

    // If local found rooms, return immediately!
    if (result.success && result.rooms && result.rooms.length > 0) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logToFile(`[STEP-WISE SCAN] LOCAL extraction success in ${duration}s. Rooms: ${result.rooms.length}`);
      return { rooms: result.rooms };
    }

    logToFile(`[STEP-WISE SCAN] Local found no rooms or failed. Step 2: Falling back to AI extraction...`);

    // 2. Fallback to AI if local found nothing
    response = await fetch(`${backendUrl}/api/agent/analyze-drawing-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: input.pdfDataUri,
      }),
      signal: AbortSignal.timeout(300000), // 5-minute timeout for AI
    });

    if (!response.ok) {
      const errText = await response.text();
      logToFile(`[STEP-WISE SCAN] AI Backend error ${response.status}: ${errText.slice(0, 100)}`);
      throw new Error(`Backend error ${response.status}: ${errText.slice(0, 200)}`);
    }

    result = await response.json();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logToFile(`[STEP-WISE SCAN] AI extraction finished in ${duration}s. Method: ${result.method}. Rooms: ${result.rooms?.length ?? 0}`);

    if (!result.success) {
      logToFile(`[STEP-WISE SCAN] Backend AI reported failure: ${result.error}`);
      throw new Error(`AI Extraction failed: ${result.error}`);
    }

    return { rooms: result.rooms || [] };

  } catch (error: any) {
    logToFile(`[STEP-WISE SCAN] CRITICAL ERROR: ${error.message}`);
    console.error('[analyzeDrawing] Critical error:', error);
    throw error; // Rethrow so the caller knows it failed
  }
}
