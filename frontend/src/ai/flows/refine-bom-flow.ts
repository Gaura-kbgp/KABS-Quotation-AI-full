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

// Client initialization moved inside function for better error handling and to prevent build-time crashes


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

  const apiKey = process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.warn('[SMART AGENT] No API key found (NVIDIA_API_KEY or OPENAI_API_KEY). Using fallback.');
    return buildFallbackOutput(input.rooms);
  }

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: process.env.NVIDIA_API_KEY ? 'https://integrate.api.nvidia.com/v1' : undefined,
  });

  try {

    const prompt = `You are the Quotation Smart Agent — an expert NKBA cabinet estimator and quality-assurance reviewer.
Analyze the BOM rooms below, fix every misclassified / malformed item, and return the corrected data.

CURRENT BOM STATE:
${JSON.stringify(mergedRooms, null, 2)}

═══════════════════════════════════════════════════════
PART 1: CATEGORY ASSIGNMENTS
═══════════════════════════════════════════════════════
"cabinets"           → W* (wall), B*/SB* (base), T*/P*/O*/OVD* (tall), UF*/F* (universal filler)
"perimeter"          → BTK*, SM*, FL*, TOUCHUP*, TUKIT, TUPSPRAY, RANGE*, DISH*, MW.HOOD
"island"             → BTK*, SM* belonging to island section (accessories only — NOT cabinet units)
"hardware"           → DWR3, SHM8, OCM8BLD from hardware/bump section
"island_hardware"    → DOORS, DRAWERS counts for island
"bump"               → SHM* perimeter side ONLY
"island_bump"        → SHM* island side ONLY
"opt_crown"          → OCM*, QM* from OPT CROWN section ONLY
"opt_light_rail"     → LR*, LRM* and laundry opt light rail items (SEPARATE from perimeter)
"vent_chase_material"→ BACK-B48, WTEP*, B48 — NEVER in "cabinets"

═══════════════════════════════════════════════════════
PART 2: SECTION SEPARATION RULES
═══════════════════════════════════════════════════════
1. PERIMETER and ISLAND are ALWAYS separate — never combine same-code quantities.
   ✅ perimeter SM8=5, island SM8=1   ❌ SM8=6 (combined — WRONG)

2. OCM8BLD appears in THREE places: hardware section, opt_crown section, vent_chase_material.
   Each is a separate entry in its own array. Never merge them.

3. SHM8 perimeter → "bump". SHM8 island → "island_bump". Never combined.

4. Laundry "opt_light_rail" is SEPARATE from laundry "perimeter".
   ✅ perimeter: SM8=1, FL24=1    opt_light_rail: SM8=1, FL24=1, BTK8=1
   ❌ perimeter: SM8=2, FL24=2   (combined — WRONG)

5. Vent chase SM8, OCM8BLD, QM8 are separate from perimeter/bump versions.
   Always keep vent_chase_material items in that array only.

═══════════════════════════════════════════════════════
PART 3: COMPLETENESS RULES — NEVER LEAVE BLANK
═══════════════════════════════════════════════════════
RULE — EVERY ROOM VARIANT MUST BE FULLY EXTRACTED.
In Elite Standard PDFs, the Trim List covers BOTH Standard and Optional kitchen variants.
Apply trim quantities to EACH variant unless explicitly different in the trim list.
  Standard Kitchen → full extraction ✅
  OPT Gourmet Kitchen → full extraction (not cabinets-only) ✅

KITCHEN completeness check — each kitchen variant must have:
  ✅ cabinets: walls, bases, talls, fillers
  ✅ perimeter: BTK8, SM8, FL48
  ✅ island: BTK8, SM8
  ✅ hardware: DWR3 (if dishwasher present), SHM8, OCM8BLD
  ✅ island_hardware: DOORS, DRAWERS
  ✅ bump: SHM8, OCM8BLD
  ✅ vent_chase_material: B48/BACK-B48, WTEP84, SM8, OCM8BLD, QM8
  ✅ opt_crown: OCM8BLD, QM8 (if present)

BATHROOM completeness check — every bath must have:
  ✅ cabinets: VSB* vanity, UF* fillers
  ✅ perimeter: BTK8, SM8
  ✅ hardware: SHM8, OCM8BLD if present

LAUNDRY completeness check:
  ✅ cabinets: wall uppers, base, fillers
  ✅ perimeter: SM8, FL24, BTK8
  ✅ hardware: SHM8
  ✅ opt_light_rail: SM8, FL24, BTK8 (separate section if it exists)

If any of these arrays appear empty when they should not be, add a note in explanations.

═══════════════════════════════════════════════════════
PART 4: SPECIAL CODE RULES
═══════════════════════════════════════════════════════
VENT BOX: BACK-B48, BACKB48, B48 → move to "vent_chase_material". Never in "cabinets".

SB36BUTT HARD RULE: One kitchen = one sink = SB36BUTT qty ALWAYS 1.
  This applies to ALL kitchen variants (Standard, Gourmet, Extended, etc.).
  If SB36BUTT qty=2 anywhere → force it to qty=1 and add an explanation. No exceptions.

BATH 2 TRIM PATTERN: STD BATH 2 must ALWAYS have:
  perimeter: BTK8 qty=1, SM8 qty=1
  hardware:  SHM8 qty=1, OCM8BLD qty=1
  Bath 2 follows the exact same trim pattern as Bath 3. If Bath 3 has these items,
  Bath 2 must also have them. If either array is empty in the input, fill it in.

DRH EXPRESS (-L/-R codes present):
  - W2436-L and W2436-R = DIFFERENT items — keep separate, do NOT combine.
  - F331, F342, PEPR335-L = not cabinets → remove from "cabinets".
  - TOEKICK8 → BTK8. MQR8 → SM8. MW.HOOD → "perimeter".

NON-CABINET ITEMS — remove from "cabinets" if found there:
  FALSE, WAINSCOT, FIN END L/R, CR-W34, 1/4 BBS-FW, BACK-B48, F331, F342, PEPR335

FORMATTING: All SKU codes must be UPPERCASE with no spaces (e.g. "W3042 BUTT" → "W3042BUTT").
Exception: keep the hyphen in DRH codes (e.g. "W2436-L").

Remove any item whose code is clearly not a SKU: pure numbers, project titles, sentences.

═══════════════════════════════════════════════════════
SELF-CHECK BEFORE RETURNING (verify each checkbox)
═══════════════════════════════════════════════════════
  □ Every kitchen variant has perimeter, island, hardware, vent_chase_material?
  □ Every bath has perimeter + hardware?
  □ No BACK-B48 / B48 in "cabinets"?
  □ No F331 / F342 / PEPR335 in "cabinets"?
  □ -L and -R variants kept separate?
  □ OCM8BLD NOT merged across bump / opt_crown / vent_chase_material?
  □ SHM8 in bump / island_bump (not in opt_crown)?
  □ Laundry perimeter and opt_light_rail are separate arrays?
  □ Island BTK8/SM8 in "island", NOT added to perimeter totals?
  □ All codes uppercase, no spaces?
  □ SB36BUTT qty verified — flagged if qty>1?
  □ OPT GOURMET KITCHEN SB36BUTT forced to qty=1?
  □ BATH 2 has perimeter (BTK8=1, SM8=1) and hardware (SHM8=1, OCM8BLD=1)?
  □ Any blank sections that should not be blank? If yes → fill them.

If any checkbox fails → fix before returning.

Return ONLY this JSON, no other text:
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
