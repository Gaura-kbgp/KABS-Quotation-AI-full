'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

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

const RefineBomOutputSchema = z.object({
  corrected_rooms: z.array(RoomSchema),
  explanations: z.array(z.string()),
});

export type RefineBomOutput = z.infer<typeof RefineBomOutputSchema>;

export async function refineBomFlow(input: {
  rooms: any[];
}): Promise<RefineBomOutput> {
  try {
    const response = await ai.generate({
      model: 'googleai/gemini-3.1-flash-lite-preview', 
      output: { schema: RefineBomOutputSchema },
      prompt: [
        {
          text: `You are the Quotation Smart Agent, an expert NKBA cabinet estimator and quality assurance reviewer. 
Your task is to analyze the provided array of Rooms (containing bill of materials items), find any misclassified, missing, or malformed items, and return the CORRECTED array of rooms.

Here is the current state of the BOM:
${JSON.stringify(input.rooms, null, 2)}

------------------------------------------------
SMART AGENT RULES & NKBA STANDARDS
1. **Misclassified Items**: Items are sometimes placed in the wrong array category. Move them to the correct array!
   - "cabinets" array: MUST contain ALL Primary Cabinets (Wall cabinets starting with W, Base cabinets starting with B or SB, Tall cabinets starting with T, O, P, Vanity starting with V, and Universal Fillers starting with UF).
   - "hardware" / "island_hardware" array: MUST contain items like DOORS, DRAWERS, HINGE, TRAY, ROLLOUT, PULLS, KNOBS. If you see a Wall or Base cabinet in here, MOVE IT to "cabinets"!
   - "perimeter" / "island" array: MUST contain accessories like panels (DWR3, REFPANEL), fillers (if not UF), toe kicks (BTK8), shoe molding (SM8).
   - "opt_crown" / "opt_light_rail" / "bump" array: Specifically for moldings like CM8, LR8, SHM8, OCM8.

2. **Fix Formatting**: Ensure all SKU codes are fully uppercase, and have all spaces and special characters removed (e.g. "W3042 BUTT" -> "W3042BUTT").

3. **Check for Errors**: If a code looks like a clear typo from OCR scanning, fix it if it's obvious (e.g. "W3O42" -> "W3042"). 

4. **Explanations**: You MUST provide a list of clear, human-readable strings explaining exactly what you changed (e.g. "Moved B24 from hardware to cabinets in Kitchen", "Cleaned spacing in W3042-BUTT to W3042BUTT").
If everything is perfect, simply return the rooms as-is and an empty explanations array.

Return the final results as structured JSON.` 
        }
      ],
      config: {
        temperature: 0,
      },
    });

    if (!response.output) {
      throw new Error('AI failed to generate results.');
    }

    return response.output;

  } catch (error: any) {
    console.error(`[SMART AGENT ERROR] ${error.message}`);
    throw error;
  }
}
