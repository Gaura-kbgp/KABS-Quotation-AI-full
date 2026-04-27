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
        name: "Wood Door Collection",
        styles: [
          "Amelia", "Antigua", "Beaumont", "Bedford Square", "Chelsea II",
          "Collins", "Davenport Square", "Florence", "Galena Square", "Hanover",
          "Henlow Square", "Lexington", "Melrose", "Milan", "Millbrook Square",
          "Monterey", "Muriel", "Napa", "New Haven", "Prairie", "Preston",
          "Ridgebrook", "Savannah", "Seville Square", "Sonoma", "Urban", "Wyatt"
        ]
      },
      {
        name: "MDF Door Collection",
        styles: [
          "Arcadia", "Bel-Air", "Alto", "Hancock", "Preston", "Urban", "Amelia",
          "Bedford Square", "Belmont", "Bishop", "Camden Square", "Florence",
          "Galena Square", "Hartford", "Millbrook Square", "Muriel", "Prairie",
          "Saybrook", "Trestle", "Davenport Square", "Harbour", "Henlow Square",
          "Lexington", "Milan", "New Haven", "Sandia", "Seville Square", "Hanover",
          "Napa", "Sonoma", "Morristown", "Antigua", "Beaumont", "Breckenridge",
          "Chelsea II", "Collins", "Marlow", "Melrose", "Midtown", "Monterey",
          "Ridgebrook", "Soho", "Wyatt", "Savannah"
        ]
      },
      {
        name: "Regal Door Collection",
        styles: [
          "Arcadia", "Bel-Air", "Alto", "Hancock", "Preston", "Urban", "Amelia",
          "Bedford Square", "Belmont", "Bishop", "Camden Square", "Florence",
          "Galena Square", "Hartford", "Millbrook Square", "Muriel", "Prairie",
          "Saybrook", "Trestle", "Davenport Square", "Harbour", "Henlow Square",
          "Lexington", "Milan", "New Haven", "Sandia", "Seville Square", "Hanover",
          "Napa", "Sonoma", "Morristown", "Antigua", "Beaumont", "Breckenridge",
          "Chelsea II", "Collins", "Marlow", "Melrose", "Midtown", "Monterey",
          "Ridgebrook", "Soho", "Wyatt", "Savannah"
        ]
      },
      {
        name: "Brilliant Door Collection",
        styles: [
          "Arcadia", "Bel-Air", "Alto", "Hancock", "Preston", "Urban", "Amelia",
          "Bedford Square", "Belmont", "Bishop", "Camden Square", "Florence",
          "Galena Square", "Hartford", "Millbrook Square", "Muriel", "Prairie",
          "Saybrook", "Trestle", "Davenport Square", "Harbour", "Henlow Square",
          "Lexington", "Milan", "New Haven", "Sandia", "Seville Square", "Hanover",
          "Napa", "Sonoma", "Morristown", "Antigua", "Beaumont", "Breckenridge",
          "Chelsea II", "Collins", "Marlow", "Melrose", "Midtown", "Monterey",
          "Ridgebrook", "Soho", "Wyatt", "Savannah"
        ]
      }
    ]
  },
  "1951 Cabinetry": {
    collections: [
      {
        name: "Elite Cherry",
        styles: [
          "Canyon Cherry",
          "Abilene Cherry",
          "Lubbock Cherry"
        ]
      },
      {
        name: "Premium Maple",
        styles: [
          "Bandera Maple",
          "Denver Maple",
          "Cooper Maple"
        ]
      },
      {
        name: "Prime Painted",
        styles: [
          "Oxford White",
          "Alpine White",
          "Snowbound"
        ]
      },
      {
        name: "Choice Durafrom",
        styles: [
          "Choice Maple",
          "Choice Paint"
        ]
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
