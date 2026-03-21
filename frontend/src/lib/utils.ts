
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function cleanSkuForDisplay(sku: string | any): string {
  if (!sku) return '';
  return String(sku).toUpperCase().trim();
}

export function normalizeSku(sku: string | any): string {
  if (!sku) return '';
  // Keep spaces to preserve suffixes like "BUTT" for normalization
  return String(sku).toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();
}

export function compressSku(sku: string | any): string {
  if (!sku) return '';
  return String(sku).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Determines if an item is a primary cabinet box based on NKBA standard prefixes.
 */
export function isPrimaryCabinet(sku: string): boolean {
  const s = String(sku || "").toUpperCase().trim();
  if (!s) return false;
  
  // Standard NKBA/Architectural Prefixes
  const primaryPrefixes = [
    'W',    // Wall
    'B',    // Base
    'SB',   // Sink Base
    'VSB',  // Vanity Sink Base
    'V',    // Vanity
    'T',    // Tall
    'P',    // Pantry
    'O',    // Oven
    'REF',  // Refrigerator Cabinet
    'DW',   // Dishwasher Return
    'MICRO', // Microwave Cabinet
    'UF'    // Universal Fillers (Elevated to primary as requested)
  ];
  
  return primaryPrefixes.some(p => {
    // Matches prefix followed by numbers (e.g., W3042, B24, UF3)
    const regex = new RegExp(`^${p}\\d+`, 'i');
    return regex.test(s) || (p === 'UF' && s.startsWith('UF'));
  });
}

/**
 * Architectural Categorization Logic (NKBA Aligned).
 * Groups items into specific architectural sections for professional review.
 */
export function detectCategory(sku: string): string {
  if (!sku) return 'Accessories';
  const s = String(sku || "").toUpperCase().trim();
  
  // NEW: Handle Estimation/Fallback SKUs (matching backend)
  if (s.endsWith('-EST') || s.endsWith(' EST.')) {
    if (s.startsWith('W')) return 'Wall Cabinets';
    if (s.startsWith('B') || s.startsWith('SB')) return 'Base Cabinets';
    if (s.startsWith('V')) return 'Vanity Cabinets';
    if (s.startsWith('T') || s.startsWith('P') || s.startsWith('O') || s.startsWith('UTIL') || s.startsWith('REF')) return 'Tall Cabinets';
    if (s.startsWith('UF')) return 'Universal Fillers';
  }

  // 0. SPECIFIC ACCESSORIES (Priority)
  const accessoryKeywords = ['TOUCHUP', 'KIT', 'SPRAY', 'GLUE', 'FILL', 'DISH-IQ', 'DWR3', 'RANGE', 'HOOD', 'DOORS', 'DRAWERS', 'SHELF', 'BACK-B', 'WTEP'];
  if (accessoryKeywords.some(k => s.includes(k))) return 'Accessories';

  // 1. Universal Fillers
  if (s.startsWith('UF') || s.startsWith('F')) return 'Universal Fillers';

  // 2. Wall Cabinets
  if (s.startsWith('W') && /\d/.test(s)) return 'Wall Cabinets';
  
  // 3. Base Cabinets (Standard & Sink)
  if ((s.startsWith('SB') || s.startsWith('B')) && /\d/.test(s)) return 'Base Cabinets';
  
  // 4. Tall Cabinets (Pantry, Oven, Utility)
  if (anyPrefix(s, ['T', 'P', 'O', 'UTIL', 'REF']) && (/\d/.test(s) || s.startsWith('REF') || s.startsWith('UTIL'))) return 'Tall Cabinets';
  
  // 5. Vanity Cabinets
  if (s.startsWith('V') && /\d/.test(s)) return 'Vanity Cabinets';
  
  // 6. Hardwares
  if (s.startsWith('HW') || s.includes('KNOB') || s.includes('PULL') || s.includes('HINGE')) return 'Hardwares';
  
  // 7. Molding & Trim
  if (anyPrefix(s, ['CM', 'M', 'RR', 'OCM', 'SCM', 'BTK', 'SHM', 'SM'])) return 'Molding & Trim';
  
  return 'Accessories';
}

function anyPrefix(s: string, prefixes: string[]): boolean {
  return prefixes.some(p => s.startsWith(p));
}
