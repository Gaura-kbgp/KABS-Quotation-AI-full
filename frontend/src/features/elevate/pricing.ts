/**
 * Phase A pricing engine (pure functions, no I/O).
 *
 * Input: items extracted from a 2020 design PDF or product list (code, description, qty, list price)
 * plus Elevate's rules. Output: an internal worksheet (cost, sell, gross profit) and a
 * customer-facing summary.
 *
 * Every rule here is an ASSUMPTION until Elevate confirms the formula. Each one is named in
 * `PricingRules` so it can be changed without touching the math.
 */

export type Method = 'gp' | 'markup';

export const DEFAULT_RULES: PricingRules = {
  costFactor: 0.45,
  builderDiscountPct: 0,
  grossProfitTargetPct: null,
  markupPct: 20,
  installation: 0,
  delivery: 0,
  freight: 0,
  threePl: 0,
  hardware: 0,
  taxPct: 0,
  taxOnCharges: false,
};

export interface WorksheetItem {
  code: string;
  description: string;
  qty: number;
  listPrice: number; // unit list price from the source document
  category: 'cabinet' | 'trim' | 'hardware' | 'appliance' | 'other';
}

export interface PricingRules {
  /** Cost = list × costFactor. 0.45 means 55% off list (same meaning as the quote page's "Pricing factor"). */
  costFactor: number;
  /** Builder discount on the sell side, in percent (applied to the sell price). */
  builderDiscountPct: number;
  /** Target gross profit on the sell price, in percent. When set, sell = cost / (1 - target). */
  grossProfitTargetPct: number | null;
  /** Used only when no gross-profit target is set: sell = cost × (1 + markupPct / 100). */
  markupPct: number;
  /** Separate, non-product charges. Not part of the cabinet margin. */
  installation: number;
  delivery: number;
  freight: number;
  threePl: number;
  hardware: number;
  taxPct: number;
  /** Whether tax also applies to installation, delivery, freight, 3PL and hardware. */
  taxOnCharges: boolean;
}

export interface WorksheetLine extends WorksheetItem {
  extendedList: number;
  extendedCost: number;
  extendedSell: number;
  grossProfit: number;
}

export interface Worksheet {
  lines: WorksheetLine[];
  totals: {
    list: number;
    cost: number;
    sellBeforeDiscount: number;
    builderDiscount: number;
    productSell: number;
    grossProfit: number;
    grossProfitPct: number;
  };
  charges: { installation: number; delivery: number; freight: number; threePl: number; hardware: number };
  tax: number;
  grandTotal: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function validateRules(r: PricingRules): string[] {
  const errs: string[] = [];
  if (!(r.costFactor > 0 && r.costFactor <= 1)) errs.push('costFactor must be greater than 0 and at most 1');
  if (r.grossProfitTargetPct !== null && !(r.grossProfitTargetPct >= 0 && r.grossProfitTargetPct < 100)) {
    errs.push('grossProfitTargetPct must be at least 0 and below 100');
  }
  if (r.builderDiscountPct < 0 || r.builderDiscountPct >= 100) errs.push('builderDiscountPct must be between 0 and 100');
  if (r.markupPct < 0) errs.push('markupPct cannot be negative');
  return errs;
}

export function buildWorksheet(items: WorksheetItem[], rules: PricingRules): Worksheet {
  const errs = validateRules(rules);
  if (errs.length) throw new Error(errs.join('; '));

  const lines: WorksheetLine[] = items.map((it) => {
    const extendedList = it.listPrice * it.qty;
    const extendedCost = extendedList * rules.costFactor;
    // The GP target is on the price the builder pays, i.e. after the builder discount.
    // So the pre-discount sell is grossed up for that discount.
    const baseSell =
      rules.grossProfitTargetPct !== null
        ? extendedCost / (1 - rules.grossProfitTargetPct / 100) / (1 - rules.builderDiscountPct / 100)
        : extendedCost * (1 + rules.markupPct / 100);
    const extendedSell = baseSell;
    return {
      ...it,
      extendedList: round2(extendedList),
      extendedCost: round2(extendedCost),
      extendedSell: round2(extendedSell),
      grossProfit: round2(extendedSell - extendedCost),
    };
  });

  const list = lines.reduce((s, l) => s + l.extendedList, 0);
  const cost = lines.reduce((s, l) => s + l.extendedCost, 0);
  const sellBeforeDiscount = lines.reduce((s, l) => s + l.extendedSell, 0);
  const builderDiscount = sellBeforeDiscount * (rules.builderDiscountPct / 100);
  const productSell = sellBeforeDiscount - builderDiscount;
  const grossProfit = productSell - cost;

  const charges = {
    installation: round2(rules.installation),
    delivery: round2(rules.delivery),
    freight: round2(rules.freight),
    threePl: round2(rules.threePl),
    hardware: round2(rules.hardware),
  };
  const chargesTotal = Object.values(charges).reduce((s, v) => s + v, 0);
  // Tax always applies to the product sell; the separate charges only when the rule says so.
  const taxBase = productSell + (rules.taxOnCharges ? chargesTotal : 0);
  const tax = round2(taxBase * (rules.taxPct / 100));

  return {
    lines,
    totals: {
      list: round2(list),
      cost: round2(cost),
      sellBeforeDiscount: round2(sellBeforeDiscount),
      builderDiscount: round2(builderDiscount),
      productSell: round2(productSell),
      grossProfit: round2(grossProfit),
      grossProfitPct: productSell > 0 ? round2((grossProfit / productSell) * 100) : 0,
    },
    charges,
    tax,
    grandTotal: round2(productSell + chargesTotal + tax),
  };
}

/** Customer-facing summary: sell side only. Cost and margin never appear here. */
export function customerSummary(ws: Worksheet) {
  return {
    productTotal: ws.totals.productSell,
    charges: ws.charges,
    tax: ws.tax,
    grandTotal: ws.grandTotal,
  };
}
