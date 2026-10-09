'use client';

import { useRef, useState, useTransition } from 'react';
import { FileUp, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildWorksheet, customerSummary, type PricingRules, type WorksheetItem } from './pricing';
import { DEFAULT_RULES, effectiveRules, money, PricingRulesForm, type Method } from './pricing-rules-form';
import { savePricingProfile, type SavedProfile } from './actions';

type Row = { key: number; code: string; description: string; qty: string; listPrice: string };

const blankRow = (key: number): Row => ({ key, code: '', description: '', qty: '1', listPrice: '' });

/**
 * Phase A workbench. Staff enter items (later: filled from the 2020 PDF or product list),
 * then see the internal worksheet and the customer summary under the current rules.
 */
export function PhaseAWorkbench({ initial }: { initial: SavedProfile | null }) {
  const [rules, setRules] = useState<PricingRules>(initial?.rules ?? DEFAULT_RULES);
  const [method, setMethod] = useState<Method>(initial?.method ?? 'markup');
  const initialRows: Row[] = (initial?.items ?? []).map((i, idx) => ({
    key: idx + 1,
    code: i.code,
    description: i.description,
    qty: String(i.qty),
    listPrice: String(i.listPrice),
  }));
  const [rows, setRows] = useState<Row[]>(initialRows.length ? initialRows : [blankRow(1)]);
  const [nextKey, setNextKey] = useState(initialRows.length + 1);
  const [saving, startSave] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExtract(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so same file can be picked again
    if (fileInputRef.current) fileInputRef.current.value = '';
    setExtracting(true);
    setStatus(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/elevate/extract-items', { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Extraction failed');
      if (!data.items?.length) throw new Error('No items found in this PDF. Try uploading a different export.');
      const imported: Row[] = (data.items as any[]).map((it, i) => ({
        key: nextKey + i,
        code: String(it.code ?? ''),
        description: String(it.description ?? ''),
        qty: String(it.qty ?? 1),
        listPrice: String(it.list_price ?? ''),
      }));
      setRows(imported);
      setNextKey(nextKey + imported.length);
      setStatus({ ok: true, text: `Imported ${imported.length} items from PDF (${data.source === 'ai' ? 'AI' : 'rule-based'} extraction, ${data.page_count} pages).` });
    } catch (err: any) {
      setStatus({ ok: false, text: err.message });
    } finally {
      setExtracting(false);
    }
  }

  function save() {
    setStatus(null);
    startSave(async () => {
      const res = await savePricingProfile({
        rules,
        method,
        items: rows
          .filter((r) => r.code.trim() || r.listPrice)
          .map((r) => ({ code: r.code.trim(), description: r.description.trim(), qty: Number(r.qty) || 0, listPrice: Number(r.listPrice) || 0, category: 'cabinet' as const })),
      });
      setStatus(res.success ? { ok: true, text: 'Saved for your company.' } : { ok: false, text: res.error || 'Could not save.' });
    });
  }

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const items: WorksheetItem[] = rows
    .filter((r) => r.code.trim() || r.listPrice)
    .map((r) => ({
      code: r.code.trim(),
      description: r.description.trim(),
      qty: Number(r.qty) || 0,
      listPrice: Number(r.listPrice) || 0,
      category: 'cabinet',
    }));

  let ws: ReturnType<typeof buildWorksheet> | null = null;
  let error: string | null = null;
  if (items.length > 0) {
    try {
      ws = buildWorksheet(items, effectiveRules(rules, method));
    } catch (e: any) {
      error = e.message;
    }
  }

  const invalidRows = items.filter((i) => !i.code || i.listPrice <= 0 || i.qty <= 0).length;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">1. Rules</h3>
        <PricingRulesForm rules={rules} onRulesChange={setRules} method={method} onMethodChange={setMethod} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-slate-900">2. Items</h3>
          <div className="flex items-center gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleExtract}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={extracting}
              onClick={() => fileInputRef.current?.click()}
              className="border-sky-200 text-sky-700 hover:bg-sky-50"
            >
              {extracting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />}
              {extracting ? 'Extracting…' : 'Import 2020 PDF'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { setRows([...rows, blankRow(nextKey)]); setNextKey(nextKey + 1); }}>
              <Plus className="mr-1 h-4 w-4" /> Add item
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-400">Upload a 2020 Design PDF export to auto-fill this table, or enter items manually.</p>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-12 items-center gap-2">
              <Input className="col-span-2 bg-white" placeholder="Code" value={r.code} onChange={(e) => update(r.key, { code: e.target.value })} />
              <Input className="col-span-4 bg-white" placeholder="Description" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} />
              <Input className="col-span-2 bg-white" type="number" min="0" placeholder="Qty" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
              <Input className="col-span-3 bg-white" type="number" min="0" step="0.01" placeholder="List price" value={r.listPrice} onChange={(e) => update(r.key, { listPrice: e.target.value })} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="col-span-1"
                aria-label="Remove item"
                onClick={() => setRows(rows.length > 1 ? rows.filter((x) => x.key !== r.key) : [blankRow(nextKey)])}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ))}
        </div>
        {invalidRows > 0 && <p className="text-xs text-amber-600">{invalidRows} item(s) are missing a code, quantity or list price.</p>}
      </section>

      <div className="flex items-center gap-3">
        <Button type="button" className="gradient-button" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save for my company
        </Button>
        {status && <span className={`text-sm ${status.ok ? 'text-emerald-600' : 'text-red-600'}`}>{status.text}</span>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {ws && (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">3. Internal worksheet (staff only)</h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">List</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-right">Sell</th>
                    <th className="px-3 py-2 text-right">GP</th>
                  </tr>
                </thead>
                <tbody>
                  {ws.lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono">{l.code}</td>
                      <td className="px-3 py-2">{l.description}</td>
                      <td className="px-3 py-2 text-right">{l.qty}</td>
                      <td className="px-3 py-2 text-right font-mono">{money(l.extendedList)}</td>
                      <td className="px-3 py-2 text-right font-mono">{money(l.extendedCost)}</td>
                      <td className="px-3 py-2 text-right font-mono">{money(l.extendedSell)}</td>
                      <td className="px-3 py-2 text-right font-mono">{money(l.grossProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:w-1/2">
              <dt className="text-slate-500">Cost</dt><dd className="text-right font-mono">{money(ws.totals.cost)}</dd>
              <dt className="text-slate-500">Builder discount</dt><dd className="text-right font-mono">−{money(ws.totals.builderDiscount)}</dd>
              <dt className="text-slate-500">Gross profit</dt>
              <dd className="text-right font-mono">{money(ws.totals.grossProfit)} ({ws.totals.grossProfitPct}%)</dd>
            </dl>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">4. Customer price summary</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:w-1/2">
              <dt className="text-slate-500">Product total</dt><dd className="text-right font-mono">{money(customerSummary(ws).productTotal)}</dd>
              <dt className="text-slate-500">Installation</dt><dd className="text-right font-mono">{money(ws.charges.installation)}</dd>
              <dt className="text-slate-500">Delivery</dt><dd className="text-right font-mono">{money(ws.charges.delivery)}</dd>
              <dt className="text-slate-500">Freight</dt><dd className="text-right font-mono">{money(ws.charges.freight)}</dd>
              <dt className="text-slate-500">3PL</dt><dd className="text-right font-mono">{money(ws.charges.threePl)}</dd>
              <dt className="text-slate-500">Hardware</dt><dd className="text-right font-mono">{money(ws.charges.hardware)}</dd>
              <dt className="text-slate-500">Tax</dt><dd className="text-right font-mono">{money(ws.tax)}</dd>
              <dt className="font-semibold text-slate-900">Total</dt><dd className="text-right font-mono font-semibold">{money(ws.grandTotal)}</dd>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
