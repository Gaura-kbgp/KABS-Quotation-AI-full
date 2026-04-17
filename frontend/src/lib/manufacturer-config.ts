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
