'use server';

import { z } from 'zod';
import OpenAI from 'openai';

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
  corrected_rooms: z.array(RoomSchema).default([]),
  explanations: z.array(z.string()).optional().default([]),
});

export type RefineBomOutput = z.infer<typeof RefineBomOutputSchema>;

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

/**
 * Safe fallback: coerce raw rooms into RefineBomOutput format without AI.
 * Used when the Smart Agent fails so Supabase always gets written.
 */
function buildFallbackOutput(rooms: any[]): RefineBomOutput {
  const safeRooms = rooms.map(r => {
    const cats = ['cabinets','perimeter','island','hardware','island_hardware','bump','island_bump','opt_crown','opt_light_rail','vent_chase_material'];
    const room: any = { room_name: r.room_name || r.name || 'Unknown Room' };
    cats.forEach(cat => {
      room[cat] = (r[cat] || []).map((item: any) => {
        if (typeof item === 'string') return { code: item, quantity: 1 };
        return { code: String(item.code || item.sku || ''), quantity: Number(item.quantity) || 1 };
      }).filter((i: any) => i.code && i.code.length >= 2);
    });
    return room;
  });
  return { corrected_rooms: safeRooms, explanations: ['Smart Agent skipped - using raw extraction data.'] };
}

/**
 * Normalize a room name to its canonical short form.
 * OPT GOURMET KITCHEN is kept separate from KITCHEN — they are distinct layout options.
 */
function canonicalRoomName(name: string): string {
  const n = (name || '').trim().toUpperCase();
  // Gourmet kitchen must be checked BEFORE the generic KITCHEN catch-all
  if (/OPT\s+(GMT\s+KITCHEN|GOURMET\s+KITCHEN)|GOURMET\s+KITCHEN/.test(n)) return 'OPT GOURMET KITCHEN';
  if (/(?:STANDARD|STD)\s+42["']?\s+KITCHEN|STANDARD\s+42\s+KITCHEN/.test(n)) return 'STANDARD 42 KITCHEN';
  if (/STANDARD\s+\d+\s+KITCHEN|STD\s+\d+\s+KITCHEN|STANDARD\s+KITCHEN/.test(n)) return 'STANDARD 42 KITCHEN';
  if (/\bKITCHEN\b/.test(n)) return 'KITCHEN';
  if (/OPT\s+LAUNDRY|LAUNDRY\s+(UPPERS?|BASES?)|LAUNDRY\s+OVER|LAUNDRY\s+ACROSS/.test(n)) return 'OPT LAUNDRY';
  if (/\bLAUNDRY\b/.test(n)) return 'LAUNDRY';
  if (/STANDARD\s+OWNERS?\s+BATH|OWNERS?\s+BATH|MASTER\s+BATH/.test(n)) return 'OWNERS BATH';
  if (/BATH\s*3/.test(n)) return 'BATH 3';
  if (/BATH\s*2/.test(n)) return 'BATH 2';
  if (/BATH\s*1/.test(n)) return 'BATH 1';
  return n.length > 25 ? n.slice(0, 25).trim() : n;
}

/**
 * Merge rooms with the same canonical name into one.
 */
function mergeRoomsByName(rooms: any[]): any[] {
  const cats = ['cabinets','perimeter','island','hardware','island_hardware','bump','island_bump','opt_crown','opt_light_rail','vent_chase_material'];
  const map: Record<string, any> = {};
  for (const room of rooms) {
    const key = canonicalRoomName(room.room_name || room.name || 'Unknown Room');
    if (!map[key]) {
      map[key] = { room_name: key };
      cats.forEach(c => { map[key][c] = []; });
    }
    cats.forEach(c => {
      const items = room[c] || [];
      map[key][c].push(...items);
    });
  }
  return Object.values(map);
}

export async function refineBomFlow(input: {
  rooms: any[];
}): Promise<RefineBomOutput> {
  // Merge duplicate rooms before processing
  const mergedRooms = mergeRoomsByName(input.rooms);

  // Safety: if no rooms, return empty immediately
  if (!mergedRooms || mergedRooms.length === 0) {
    return { corrected_rooms: [], explanations: ['No rooms to refine.'] };
  }

  try {
    const prompt = `You are the Quotation Smart Agent, an expert NKBA cabinet estimator and quality assurance reviewer. 
Your task is to analyze the provided array of Rooms (containing bill of materials items), find any misclassified, missing, or malformed items, and return the CORRECTED array of rooms.

Here is the current state of the BOM:
${JSON.stringify(mergedRooms, null, 2)}

------------------------------------------------
SMART AGENT RULES & NKBA STANDARDS
1. **Misclassified Items**: Items are sometimes placed in the wrong array category. Move them to the correct array!
   - "cabinets" array: MUST contain ALL Primary Cabinets (Wall cabinets starting with W, Base cabinets starting with B or SB, Tall cabinets starting with T, O, P, Vanity starting with V, and Universal Fillers starting with UF).
   - "hardware" / "island_hardware" array: MUST contain items like DOORS, DRAWERS, HINGE, TRAY, ROLLOUT, PULLS, KNOBS. If you see a Wall or Base cabinet in here, MOVE IT to "cabinets"!
   - "perimeter" / "island" array: MUST contain accessories like panels (DWR3, REFPANEL), fillers (if not UF), toe kicks (BTK8), shoe molding (SM8).
   - "opt_crown" / "opt_light_rail" / "bump" array: Specifically for moldings like CM8, LR8, SHM8, OCM8.

2. **Fix Formatting**: Ensure all SKU codes are fully uppercase, and have all spaces and special characters removed (e.g. "W3042 BUTT" -> "W3042BUTT").
   Examples: "UF3DW" → "UF3", "HWC1X2X94CROWNCLEAT" → "HWC1X2X94", "FL48VOIDS" → "FL48".

3. **Remove Garbage**: Delete any item whose code is clearly not a SKU (e.g. a sentence, a project title, or a number-only string).

4. **Explanations**: Provide a short list of what you changed. If nothing changed, return empty explanations array.

Return ONLY this JSON structure, no other text:
{"corrected_rooms": [...rooms with same structure as input...], "explanations": ["..."]}`;

    const response = await openai.chat.completions.create({
      model: 'meta/llama-3.1-70b-instruct',
      messages: [
        { role: 'system', content: 'You are a JSON-only response engine. Return ONLY valid JSON with no markdown, no explanations outside the JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
      timeout: 45000, // 45-second hard limit — fall back to raw data if NVIDIA is slow
    } as any);

    const content = response.choices[0].message.content;
    if (!content) {
      console.error('[SMART AGENT] Empty response from AI. Using fallback.');
      return buildFallbackOutput(input.rooms);
    }

    try {
      const parsed = JSON.parse(content);
      // Try strict parse first
      return RefineBomOutputSchema.parse(parsed);
    } catch (parseErr: any) {
      // Lenient fallback: try to extract corrected_rooms directly
      console.error(`[SMART AGENT] Zod parse failed: ${parseErr.message}. Attempting lenient extraction.`);
      try {
        const parsed = JSON.parse(content);
        const rawRooms = parsed.corrected_rooms || parsed.rooms || input.rooms;
        return buildFallbackOutput(rawRooms);
      } catch {
        return buildFallbackOutput(input.rooms);
      }
    }

  } catch (error: any) {
    console.error(`[SMART AGENT ERROR] ${error.message}. Using raw extraction as fallback.`);
    // CRITICAL: Never throw - always return usable data so Supabase gets written
    return buildFallbackOutput(input.rooms);
  }
}
