'use client';

import type { Method, PricingRules } from './pricing';

export { DEFAULT_RULES, type Method } from './pricing';

/** The rules as the engine should see them, for the chosen sell-price method. */
export function effectiveRules(rules: PricingRules, method: Method): PricingRules {
  return { ...rules, grossProfitTargetPct: method === 'gp' ? rules.grossProfitTargetPct ?? 0 : null };
}

export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface Props {
  rules: PricingRules;
  onRulesChange: (r: PricingRules) => void;
  method: Method;
  onMethodChange: (m: Method) => void;
}

/** Controlled form for Elevate's pricing assumptions. The parent holds the state. */
export function PricingRulesForm({ rules, onRulesChange, method, onMethodChange }: Props) {
  const num = (key: keyof PricingRules) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onRulesChange({ ...rules, [key]: e.target.value === '' ? 0 : Number(e.target.value) });

  const field = (label: string, key: keyof PricingRules, hint: string) => (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        type="number"
        step="0.01"
        value={rules[key] as number}
        onChange={num(key)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
      />
      <span className="block text-xs text-slate-400">{hint}</span>
    </label>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {field('Cost factor', 'costFactor', 'Cost = list × this. 0.45 = 55% off list (same as the quote page).')}
      {field('Builder discount (%)', 'builderDiscountPct', 'Applied to the sell price.')}

      <div className="space-y-2 text-sm md:col-span-2">
        <span className="font-medium text-slate-700">Sell price method</span>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2">
            <input type="radio" name="method" checked={method === 'markup'} onChange={() => onMethodChange('markup')} />
            Markup on cost
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="method" checked={method === 'gp'} onChange={() => onMethodChange('gp')} />
            Gross-profit target
          </label>
        </div>
      </div>

      {method === 'markup'
        ? field('Markup (%)', 'markupPct', 'Sell = cost × (1 + markup).')
        : field('Gross-profit target (%)', 'grossProfitTargetPct', 'Measured on the price after builder discount.')}

      {field('Installation ($)', 'installation', 'Separate from the cabinet margin.')}
      {field('Delivery ($)', 'delivery', 'Separate amount.')}
      {field('Freight ($)', 'freight', 'Separate amount.')}
      {field('3PL ($)', 'threePl', 'Separate amount.')}
      {field('Hardware ($)', 'hardware', 'Separate amount.')}
      {field('Tax (%)', 'taxPct', 'Sales tax rate.')}

      <label className="flex items-start gap-2 text-sm md:col-span-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={rules.taxOnCharges}
          onChange={(e) => onRulesChange({ ...rules, taxOnCharges: e.target.checked })}
        />
        <span>
          <span className="font-medium text-slate-700">Tax also applies to installation, delivery, freight, 3PL and hardware</span>
          <span className="block text-xs text-slate-400">Off = tax only on the product sell.</span>
        </span>
      </label>
    </div>
  );
}
