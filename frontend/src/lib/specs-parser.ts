import * as XLSX from 'xlsx';

/**
 * EXTREME-FLEXIBILITY UNIVERSAL SCANNER (v99.0)
 * 
 * IMPROVEMENTS:
 * 1. GREEDY HEURISTIC: Aggressively scans for SKUs like UF342 even in complex layouts.
 * 2. ACCESSORY FOCUS: Specifically recognizes "March 2025 Accessory Pricing" as a Universal sheet.
 * 3. MULTI-COLUMN PRICE CAPTURE: Scans adjacent cells more effectively for currency values.
 */
export async function parseSpecifications(buffer: Buffer, manufacturerId: string, fileId: string) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const pricing: any[] = [];
  
  const skuKeywords = ["SKU", "ITEM SKU", "CODE", "MODEL", "ITEM CODE", "PART NUMBER", "CABINET SKU", "MODEL NUMBER", "ITEM", "SKU#"];
  const priceKeywords = ["PRICE", "LIST PRICE", "LIST", "NET", "COST", "MSRP", "TOTAL", "NET PRICE", "VAL"];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;

    // Use header: 1 to get raw grid
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as any[][];
    if (rows.length < 1) continue;

    const currentSheetName = sheetName.toUpperCase().trim();
    const isGlobalSheet = currentSheetName.includes("ACCESSORY") || 
                         currentSheetName.includes("OPTION") || 
                         currentSheetName.includes("FILLER") ||
                         currentSheetName.includes("UNIVERSAL") ||
                         currentSheetName.includes("MOLDING") ||
                         currentSheetName.includes("SKU GUIDE") ||
                         currentSheetName.includes("PRICING");

    console.log(`[Parser v99] Greedy Scan: ${sheetName} (isGlobal: ${isGlobalSheet})`);

    let activeSkuColIdx = -1;
    let activePriceColIdx = -1;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < 1) continue;

      // STAGE 1: DYNAMIC HEADER DISCOVERY
      const foundSkuIdx = row.findIndex(cell => {
        const val = String(cell || "").toUpperCase().trim();
        return skuKeywords.some(k => val === k);
      });

      if (foundSkuIdx !== -1) {
        activeSkuColIdx = foundSkuIdx;
        const foundPriceIdx = row.findIndex((cell, idx) => {
          if (idx === activeSkuColIdx) return false;
          const val = String(cell || "").toUpperCase().trim();
          return priceKeywords.some(k => val.includes(k));
        });
        if (foundPriceIdx !== -1) activePriceColIdx = foundPriceIdx;
        continue; 
      }

      // STAGE 2: ROW-LEVEL CONTENT HEURISTIC
      let extractedSku = "";
      let extractedPrice = 0;

      // Method A: Anchored Search (Found headers)
      if (activeSkuColIdx !== -1 && activePriceColIdx !== -1) {
        extractedSku = String(row[activeSkuColIdx] || "").trim();
        const priceVal = String(row[activePriceColIdx] || "").replace(/[^\d.-]/g, "");
        extractedPrice = parseFloat(priceVal);
      } 
      
      // Method B: Greedy Grid Matcher (For Accessory sheets like the user screenshot)
      if (!extractedSku || isNaN(extractedPrice) || extractedPrice <= 0) {
        const heuristicSkuIdx = row.findIndex(cell => {
          const s = String(cell || "").trim();
          // Matches patterns like UF1, UF342, W30, etc.
          return s.length >= 2 && s.length < 20 && /^[A-Z]{1,4}[A-Z0-9-\s.]{1,15}$/i.test(s);
        });

        if (heuristicSkuIdx !== -1) {
          extractedSku = String(row[heuristicSkuIdx] || "").trim();
          // Search nearby columns (up to 4 columns away) for a number
          for (let i = heuristicSkuIdx + 1; i < Math.min(row.length, heuristicSkuIdx + 5); i++) {
            const rawVal = String(row[i] || "").trim();
            if (!rawVal) continue;
            
            const val = rawVal.replace(/[^\d.-]/g, "");
            const num = parseFloat(val);
            if (!isNaN(num) && num >= 1 && num < 50000) {
              extractedPrice = num;
              break;
            }
          }
        }
      }

      // STAGE 3: COMMIT
      if (extractedSku && !isNaN(extractedPrice) && extractedPrice > 0) {
        const upperSku = extractedSku.toUpperCase();
        if (skuKeywords.some(k => upperSku === k)) continue;

        pricing.push({
          manufacturer_id: manufacturerId,
          collection_name: isGlobalSheet ? "UNIVERSAL" : currentSheetName,
          door_style: "UNIVERSAL",
          sku: upperSku,
          price: extractedPrice,
          raw_source_file_id: fileId,
          created_at: new Date().toISOString()
        });
      }
    }
  }

  console.log(`[Parser v99] Final Count: ${pricing.length} records.`);
  return pricing;
}
