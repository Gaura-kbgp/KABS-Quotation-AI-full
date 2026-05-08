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
    // Col C: PREMIUM CHERRY (CHERRY/DFO CHERRY variants) + ELITE MAPLE (CANYON/DURANGO/ELDERIDGE MAPLE)
    // MAPLE variants of ABILENE/BELCOURT/CLAYTON/LUBBOCK are PREMIUM MAPLE → belong in col D
    styles: [
      "ABILENE CHERRY",
      "ABILENE DFO CHERRY",
      "BELCOURT CHERRY",
      "BELCOURT DFO CHERRY",
      "CANYON MAPLE",
      "CANYON DFO MAPLE",
      "CLAYTON CHERRY",
      "CLAYTON DFO CHERRY",
      "DURANGO MAPLE",
      "ELDERIDGE MAPLE",
      "LUBBOCK CHERRY",
      "LUBBOCK DURAFORM (NON-TEXTURED)",
      "OXRIDGE MAPLE",
      "OXRIDGE DFO MAPLE",
    ],
  },
  {
    name: "PRIME CHERRY / PREMIUM MAPLE / PREMIUM PAINTED / PREMIUM DURAFORM (NON-TEXTURED)",
    // Col D: PREMIUM MAPLE (ABILENE/BELCOURT/CLAYTON MAPLE), PAINTED, DURAFORM (NON-TEXTURED)
    styles: [
      "ABILENE CHERRY",
      "ABILENE MAPLE",
      "ABILENE PAINTED",
      "ABILENE DFO CHERRY",
      "ABILENE DFO MAPLE",
      "ABILENE DFO PAINTED",
      "BELCOURT MAPLE",
      "BELCOURT PAINTED",
      "BELCOURT DFO MAPLE",
      "BELCOURT DFO PAINTED",
      "CLAYTON MAPLE",
      "CLAYTON PAINTED",
      "CLAYTON DFO MAPLE",
      "CLAYTON DFO PAINTED",
      "DENVER CHERRY",
      "DENVER MAPLE",
      "DENVER DFO CHERRY",
      "DENVER DFO MAPLE",
      "LUBBOCK DURAFORM (NON-TEXTURED)",
      "LUBBOCK MAPLE",
      "LUBBOCK PAINTED",
      "OXRIDGE MAPLE",
      "OXRIDGE PAINTED",
      "OXRIDGE DFO MAPLE",
      "OXRIDGE DFO PAINTED",
    ],
  },
  {
    name: "PRIME MAPLE / PRIME PAINTED / PRIME DURAFORM",
    // Col E
    styles: [
      "BANDERA MAPLE",
      "BANDERA DFO MAPLE",
      "COOPER MAPLE",
      "COOPER DFO MAPLE",
      "DENVER CHERRY",
      "DENVER MAPLE",
      "DENVER DFO CHERRY",
      "DENVER DFO MAPLE",
    ],
  },
  {
    name: "CHOICE DURAFORM / CHOICE MAPLE / CHOICE PAINTED",
    // Col F
    styles: [
      "BARREN MAPLE",
      "BARREN DURAFORM",
      "BARREN PAINTED",
      "CARSON DURAFORM",
      "CARSON PAINTED",
      "CARSON DFO DURAFORM",
      "CARSON DFO PAINTED",
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
