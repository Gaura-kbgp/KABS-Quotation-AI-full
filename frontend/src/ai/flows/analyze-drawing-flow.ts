'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
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

const ItemSchema = z.object({
  code: z.string(),
  quantity: z.number(),
});

const RoomSchema = z.object({
  room_name: z.string(),
  cabinets: z.array(ItemSchema).optional().default([]),
  perimeter: z.array(ItemSchema).optional().default([]),
  island: z.array(ItemSchema).optional().default([]),
  hardware: z.array(ItemSchema).optional().default([]),
  island_hardware: z.array(ItemSchema).optional().default([]),
  bump: z.array(ItemSchema).optional().default([]),
  island_bump: z.array(ItemSchema).optional().default([]),
  opt_crown: z.array(ItemSchema).optional().default([]),
  opt_light_rail: z.array(ItemSchema).optional().default([]),
  vent_chase_material: z.array(ItemSchema).optional().default([]),
});

const AnalyzeDrawingOutputSchema = z.object({
  rooms: z.array(RoomSchema),
});

export type AnalyzeDrawingOutput = z.infer<typeof AnalyzeDrawingOutputSchema>;

export async function analyzeDrawing(input: {
  pdfDataUri: string;
  projectName?: string;
}): Promise<AnalyzeDrawingOutput> {
  logToFile(`[SCAN START] Project: ${input.projectName || 'New Project'}`);

  try {
    const response = await ai.generate({
      output: { schema: AnalyzeDrawingOutputSchema },
      prompt: [
        { media: { url: input.pdfDataUri, contentType: 'application/pdf' } },
        {
          text: `You are an expert cabinet estimator. Analyze the provided PDF drawing.
Your job is to visually identify and extract cabinet SKUs and accessory data directly from the drawings.

------------------------------------------------
VIRTUAL SCANNER RULES

1. Focus 100% on the VISUAL output of the blueprints.
2. Identify the room name from the drawing header, footer, or title block.
3. Extract items into specific categories for each room:
   - "cabinets": Direct cabinet boxes (e.g. W3042, B24, SB36, VSB36, UF3, fillers, etc.)
   - "perimeter": Perimeter accessory items and moldings (e.g. BTK8, SM8, FL48)
   - "island": Island specific items and moldings.
   - "hardware": DOORS and DRAWERS counts from the PERIMETER / MAIN section ONLY.
   - "island_hardware": DOORS and DRAWERS counts from the ISLAND section ONLY.
   - "bump": Bump / Boxing items from the PERIMETER / MAIN section (e.g. SHM8, OCM8BLD).
   - "island_bump": Bump / Boxing items from the ISLAND section.
   - "opt_crown": Crown molding items.
   - "opt_light_rail": Light rail items.
   - "vent_chase_material": Items for vent chase/box (e.g. BACKB48, SHELF, WTEP84).

4. **CRITICAL — TWO SEPARATE COLUMNS**: The drawing often has TWO SEPARATE columns — one for PERIMETER/MAIN kitchen and one for ISLAND.
   Each column may have its own HARDWARE and BUMP sub-section. Keep them strictly separate.

5. **CRITICAL — PARENTHETICAL NOTES ARE NOT PART OF THE SKU**:
   Drawing notes in parentheses like (DW), (DWR), (VENT BOX), (VAR OPTS), (CROWN CLEAT), (OVEN), (TRIM @ CEILING), (VOIDS) are INSTALLATION NOTES, NOT part of the cabinet code.
   You MUST strip everything in parentheses from the code.
   CORRECT examples:
     "1-UF3 (DW)"          → code = "UF3"         (not "UF3DW")
     "1-UF642 (DWR)"       → code = "UF642"        (not "UF642DWR")
     "4-CROWN (VAR OPTS)"  → code = "CROWN"         (not "CROWNVAROPTS")
     "4-LIGHT RAIL (VAR OPTS)" → code = "LIGHTRAIL" (not "LIGHTRAILVAROPTS")
     "1-BACK-B48 (VENT BOX)"  → code = "BACKB48"   (not "BACKB48VENTBOX")
     "1-QM8 (TRIM @ CEILING)" → code = "QM8"        (not "QM8TRIMCEILING")
     "4-HWC 1X2X94 (CROWN CLEAT)" → code = "HWC1X2X94" (not "HWC1X2X94CROWNCLEAT")
     "1-HWC 2X4X96 (DW)"  → code = "HWC2X4X96"    (not "HWC2X4X96DW")
     "1-FL48 (VOIDS)"      → code = "FL48"          (not "FL48VOIDS")

6. **MODIFIERS THAT ARE PART OF THE SKU** (keep these, append directly):
   - Structural modifiers that are part of the cabinet spec: BUTT, MD, BLD, BD, SD, AS, DP
   - Example: "W3042 BUTT" → "W3042BUTT", "OCM8 BLD" → "OCM8BLD", "OVD3396 AS BUTT" → "OVD3396ASBUTT"
   - Do NOT list "BUTT" as a separate accessory item.

7. **SKU FORMATTING**: Clean all spaces and special characters (like '-', '_', '/') from the final code string.
   Exception: KEEP the 'X' in dimension codes like HWC2X4X96, W3624X24DP.

8. Extract quantities accurately. Sum any duplicates within the same category.
9. NEVER miss the cabinet boxes (W, B, SB, VSB, OVD, REF SKUs) — they are the most important part.
10. **EXHAUSTIVE MULTI-PAGE SCAN**: The document contains MULTIPLE rooms across MULTIPLE pages. Scan every single page and extract every single room. DO NOT stop after the first room.

Return the final results as structured JSON.` }
      ],
      config: {
        temperature: 0,
      },
    });

    if (!response.output) {
      logToFile(`[SCAN ERROR] No output generated by AI.`);
      throw new Error('AI failed to generate results.');
    }

    logToFile(`[SCAN SUCCESS] Found ${response.output.rooms?.length || 0} rooms.`);
    logToFile(JSON.stringify(response.output, null, 2));

    return response.output;

  } catch (error: any) {
    logToFile(`[SCAN CRITICAL] ${error.message}`);
    if (error.stack) logToFile(error.stack);
    return { rooms: [] };
  }
}
