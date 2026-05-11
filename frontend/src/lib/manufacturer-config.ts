/**
 * @fileOverview Hardcoded configuration for specific manufacturers to ensure
 * production stability and bypass database dependencies.
 *
 * Door-style lists are sourced directly from the 1951 Cabinetry Price Guide
 * spreadsheet columns (March 2025 SKU Pricing tab):
 *   Col B → ELITE CHERRY / ELITE DURAFORM (TEXTURED)
 *   Col C → PREMIUM CHERRY / PREMIUM DURAFORM (TEXTURED) / ELITE MAPLE / ELITE PAINTED
 *   Col D → PRIME CHERRY / PREMIUM MAPLE / PREMIUM PAINTED / PREMIUM DURAFORM (NON-TEXTURED)
 *   Col E → PRIME MAPLE / PRIME PAINTED / PRIME DURAFORM
 *   Col F → CHOICE DURAFORM / CHOICE MAPLE / CHOICE PAINTED
 *   Col G → BASE
 */

// Shared collections — Wellborn and 1951 Cabinetry use the same structure.
const WELLBORN_1951_COLLECTIONS = [
  {
    name: "ELITE CHERRY / ELITE DURAFORM (TEXTURED)",
    // Col B: CHERRY and DURAFORM (TEXTURED) variants only — no MAPLE
    styles: [
      "CANYON CHERRY",
      "CANYON DFO CHERRY",
      "CANYON DFO DURAFORM (TEXTURED)",
      "DURANGO CHERRY",
      "ELDERIDGE CHERRY",
    ],
  },
  {
    name: "PREMIUM CHERRY / PREMIUM DURAFORM (TEXTURED) / ELITE MAPLE / ELITE PAINTED",
    // Col C: PREMIUM CHERRY + ELITE MAPLE + ELITE PAINTED (source: Excel row 2 col C)
    styles: [
      "ABILENE CHERRY",
      "ABILENE DFO CHERRY",
      "BELCOURT CHERRY",
      "BELCOURT DFO CHERRY",
      "CANYON MAPLE",
      "CANYON DFO MAPLE",
      "CANYON PAINTED",
      "CANYON DFO PAINTED",
      "CLAYTON CHERRY",
      "CLAYTON DFO CHERRY",
      "DURANGO MAPLE",
      "DURANGO PAINTED",
      "ELDERIDGE MAPLE",
      "ELDERIDGE PAINTED",
      "LUBBOCK DURAFORM (TEXTURED)",
      "LUBBOCK CHERRY",
    ],
  },
  {
    name: "PRIME CHERRY / PREMIUM MAPLE / PREMIUM PAINTED / PREMIUM DURAFORM (NON-TEXTURED)",
    // Col D: PREMIUM MAPLE, PAINTED, DURAFORM (source: Excel row 2 col D)
    styles: [
      "ABILENE DURAFORM",
      "ABILENE DFO DURAFORM",
      "ABILENE MAPLE",
      "ABILENE DFO MAPLE",
      "ABILENE PAINTED",
      "ABILENE DFO PAINTED",
      "BELCOURT MAPLE",
      "BELCOURT DFO MAPLE",
      "BELCOURT PAINTED",
      "BELCOURT DFO PAINTED",
      "CLAYTON MAPLE",
      "CLAYTON DFO MAPLE",
      "CLAYTON PAINTED",
      "CLAYTON DFO PAINTED",
      "DENVER CHERRY",
      "DENVER DFO CHERRY",
      "LUBBOCK DURAFORM (NON-TEXTURED)",
      "LUBBOCK MAPLE",
      "LUBBOCK PAINTED",
      "OXRIDGE MAPLE",
      "OXRIDGE DFO MAPLE",
      "OXRIDGE PAINTED",
      "OXRIDGE DFO PAINTED",
    ],
  },
  {
    name: "PRIME MAPLE / PRIME PAINTED / PRIME DURAFORM",
    // Col E (source: Excel row 2 col E)
    styles: [
      "BANDERA MAPLE",
      "BANDERA DFO MAPLE",
      "BANDERA PAINTED",
      "BANDERA DFO PAINTED",
      "COOPER MAPLE",
      "COOPER DFO MAPLE",
      "COOPER PAINTED",
      "COOPER DFO PAINTED",
      "DENVER DURAFORM",
      "DENVER DFO DURAFORM",
      "DENVER MAPLE",
      "DENVER DFO MAPLE",
      "DENVER PAINTED",
      "DENVER DFO PAINTED",
    ],
  },
  {
    name: "CHOICE DURAFORM / CHOICE MAPLE / CHOICE PAINTED",
    // Col F (source: Excel row 2 col F; CARSON DFO DUAFORM is a typo in the spreadsheet)
    styles: [
      "BARREN DURAFORM",
      "BARREN MAPLE",
      "BARREN PAINTED",
      "CARSON DURAFORM",
      "CARSON DFO DURAFORM",
    ],
  },
  {
    name: "BASE",
    // Col G
    styles: ["BOERNE HARDWOOD"],
  },
];

export const MANUFACTURER_CONFIG: Record<string, {
  collections: {
    name: string;
    styles: string[];
  }[];
}> = {
  "Wellborn":       { collections: WELLBORN_1951_COLLECTIONS },
  "1951 Cabinetry": { collections: WELLBORN_1951_COLLECTIONS },
};

/**
 * Integrity Cabinets series hierarchy.
 * Each series maps to a prefix used to filter the live DB collection names.
 * DB collections for Integrity follow the pattern "SERIES NAME - COLLECTION DETAIL"
 * (e.g. "ELITE - 24 DEEP LIST PRICE", "CLASSIC - BEAD BOARD BLACK").
 * Adding a series here is enough — collections are always pulled live from the DB.
 */
export const INTEGRITY_SERIES: {
  name: string;
  /** Exact upper-case prefix that Integrity DB collection names start with.
   *  Must match what is stored in manufacturer_pricing.collection_name.
   *  e.g. DB stores "CLASSIC SERIES - 24 DEEP LIST PRICE" → prefix = "CLASSIC SERIES" */
  prefix: string;
}[] = [
  { name: "Elite Series",      prefix: "ELITE SERIES" },
  { name: "Classic Series",    prefix: "CLASSIC SERIES" },
  { name: "Manchester Series", prefix: "MANCHESTER SERIES" },
  { name: "Signature Series",  prefix: "SIGNATURE SERIES" },
  { name: "Premier Series",    prefix: "PREMIER SERIES" },
];
