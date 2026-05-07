/**
 * @fileOverview Hardcoded configuration for specific manufacturers to ensure
 * production stability and bypass database dependencies.
 */

export const MANUFACTURER_CONFIG: Record<string, {
  collections: {
    name: string;
    styles: string[];
  }[];
}> = {
  "Wellborn": {
    collections: [
      {
        name: "ELITE CHERRY / ELITE DURAFORM (TEXTURED)",
        styles: [
          "CANYON CHERRY", "CANYON MAPLE", "CANYON DFO CHERRY", "CANYON DFO DURAFORM (TEXTURED)",
          "CANYON DFO MAPLE", "DURANGO CHERRY", "DURANGO MAPLE", "ELDERIDGE CHERRY", "ELDERIDGE MAPLE"
        ]
      },
      {
        name: "PREMIUM CHERRY / PREMIUM DURAFORM (TEXTURED) / ELITE MAPLE / ELITE PAINTED",
        styles: [
          "ABILENE CHERRY", "ABILENE MAPLE", "ABILENE DFO CHERRY", "ABILENE DFO MAPLE",
          "BELCOURT CHERRY", "BELCOURT MAPLE", "BELCOURT DFO CHERRY", "BELCOURT DFO MAPLE",
          "CLAYTON CHERRY", "CLAYTON MAPLE", "CLAYTON DFO CHERRY", "CLAYTON DFO MAPLE",
          "LUBBOCK CHERRY", "LUBBOCK DURAFORM (NON-TEXTURED)", "LUBBOCK MAPLE",
          "OXRIDGE MAPLE", "OXRIDGE DFO MAPLE"
        ]
      },
      {
        name: "PRIME CHERRY / PREMIUM MAPLE / PREMIUM PAINTED / PREMIUM DURAFORM (NON-TEXTURED)",
        styles: [
          "ABILENE CHERRY", "ABILENE MAPLE", "ABILENE PAINTED", "ABILENE DFO CHERRY", "ABILENE DFO MAPLE",
          "ABILENE DFO PAINTED", "BELCOURT MAPLE", "BELCOURT PAINTED", "BELCOURT DFO MAPLE",
          "BELCOURT DFO PAINTED", "CLAYTON MAPLE", "CLAYTON PAINTED", "CLAYTON DFO MAPLE",
          "CLAYTON DFO PAINTED", "DENVER CHERRY", "DENVER MAPLE", "DENVER DFO CHERRY",
          "DENVER DFO MAPLE", "LUBBOCK DURAFORM (NON-TEXTURED)", "LUBBOCK MAPLE",
          "LUBBOCK PAINTED", "OXRIDGE MAPLE", "OXRIDGE PAINTED", "OXRIDGE DFO MAPLE",
          "OXRIDGE DFO PAINTED"
        ]
      },
      {
        name: "PRIME MAPLE / PRIME PAINTED / PRIME DURAFORM",
        styles: [
          "BANDERA MAPLE", "BANDERA DFO MAPLE", "COOPER MAPLE", "COOPER DFO MAPLE",
          "DENVER CHERRY", "DENVER MAPLE", "DENVER DFO CHERRY", "DENVER DFO MAPLE"
        ]
      },
      {
        name: "CHOICE DURAFORM / CHOICE MAPLE / CHOICE PAINTED",
        styles: [
          "BARREN MAPLE", "BARREN DURAFORM", "BARREN PAINTED", "CARSON DURAFORM",
          "CARSON PAINTED", "CARSON DFO DURAFORM", "CARSON DFO PAINTED"
        ]
      },
      {
        name: "BASE",
        styles: ["BOERNE HARDWOOD"]
      }
    ]
  },
  "1951 Cabinetry": {
    collections: [
      {
        name: "ELITE CHERRY / ELITE DURAFORM (TEXTURED)",
        styles: [
          "CANYON CHERRY", "CANYON MAPLE", "CANYON DFO CHERRY", "CANYON DFO DURAFORM (TEXTURED)",
          "CANYON DFO MAPLE", "DURANGO CHERRY", "DURANGO MAPLE", "ELDERIDGE CHERRY", "ELDERIDGE MAPLE"
        ]
      },
      {
        name: "PREMIUM CHERRY / PREMIUM DURAFORM (TEXTURED) / ELITE MAPLE / ELITE PAINTED",
        styles: [
          "ABILENE CHERRY", "ABILENE MAPLE", "ABILENE DFO CHERRY", "ABILENE DFO MAPLE",
          "BELCOURT CHERRY", "BELCOURT MAPLE", "BELCOURT DFO CHERRY", "BELCOURT DFO MAPLE",
          "CLAYTON CHERRY", "CLAYTON MAPLE", "CLAYTON DFO CHERRY", "CLAYTON DFO MAPLE",
          "LUBBOCK CHERRY", "LUBBOCK DURAFORM (NON-TEXTURED)", "LUBBOCK MAPLE",
          "OXRIDGE MAPLE", "OXRIDGE DFO MAPLE"
        ]
      },
      {
        name: "PRIME CHERRY / PREMIUM MAPLE / PREMIUM PAINTED / PREMIUM DURAFORM (NON-TEXTURED)",
        styles: [
          "ABILENE CHERRY", "ABILENE MAPLE", "ABILENE PAINTED", "ABILENE DFO CHERRY", "ABILENE DFO MAPLE",
          "ABILENE DFO PAINTED", "BELCOURT MAPLE", "BELCOURT PAINTED", "BELCOURT DFO MAPLE",
          "BELCOURT DFO PAINTED", "CLAYTON MAPLE", "CLAYTON PAINTED", "CLAYTON DFO MAPLE",
          "CLAYTON DFO PAINTED", "DENVER CHERRY", "DENVER MAPLE", "DENVER DFO CHERRY",
          "DENVER DFO MAPLE", "LUBBOCK DURAFORM (NON-TEXTURED)", "LUBBOCK MAPLE",
          "LUBBOCK PAINTED", "OXRIDGE MAPLE", "OXRIDGE PAINTED", "OXRIDGE DFO MAPLE",
          "OXRIDGE DFO PAINTED"
        ]
      },
      {
        name: "PRIME MAPLE / PRIME PAINTED / PRIME DURAFORM",
        styles: [
          "BANDERA MAPLE", "BANDERA DFO MAPLE", "COOPER MAPLE", "COOPER DFO MAPLE",
          "DENVER CHERRY", "DENVER MAPLE", "DENVER DFO CHERRY", "DENVER DFO MAPLE"
        ]
      },
      {
        name: "CHOICE DURAFORM / CHOICE MAPLE / CHOICE PAINTED",
        styles: [
          "BARREN MAPLE", "BARREN DURAFORM", "BARREN PAINTED", "CARSON DURAFORM",
          "CARSON PAINTED", "CARSON DFO DURAFORM", "CARSON DFO PAINTED"
        ]
      },
      {
        name: "BASE",
        styles: ["BOERNE HARDWOOD"]
      }
    ]
  }
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
