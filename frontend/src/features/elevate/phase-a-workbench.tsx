'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { FileUp, Loader2, Plus, Save, Search, Trash2, Download, FileSpreadsheet, ChevronDown, ChevronUp } from 'lucide-react';
import { downloadWorksheetExcel, printWorksheetPdf } from './download-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildWorksheet, customerSummary, type PricingRules, type WorksheetItem } from './pricing';
import { DEFAULT_RULES, effectiveRules, money, PricingRulesForm, type Method } from './pricing-rules-form';
import { validateSkuMatches, savePricingProfile, type Manufacturer, type SavedProfile, type SkuMatchResult } from './actions';

type Row = { key: number; code: string; description: string; qty: string; listPrice: string };

const blankRow = (key: number): Row => ({ key, code: '', description: '', qty: '1', listPrice: '' });

/**
 * Phase A workbench. Staff select a manufacturer + door style, enter items (or import from
 * a 2020 PDF), auto-fill list prices from the catalog, then review the internal worksheet
 * and customer summary under the configured rules.
 */
export function PhaseAWorkbench({ initial, manufacturers }: { initial: SavedProfile | null; manufacturers: Manufacturer[] }) {
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
  const [lookingUp, setLookingUp] = useState(false);
  const [showItems, setShowItems] = useState(true);
  const [skuStatus, setSkuStatus] = useState<Record<string, SkuMatchResult>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manufacturer + door style for SKU price lookup
  const [manufacturerId, setManufacturerId] = useState('');
  const [doorStyle, setDoorStyle] = useState('');
  const [doorStyles, setDoorStyles] = useState<string[]>([]);
  const [loadingStyles, setLoadingStyles] = useState(false);

  useEffect(() => {
    if (!manufacturerId) { setDoorStyles([]); setDoorStyle(''); return; }
    setLoadingStyles(true);
    setDoorStyle('');
    fetch(`/api/backend/api/catalog/options/${manufacturerId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        // Always prefer actual door style names from door_styles array (name field)
        const namedStyles: string[] = (d.door_styles ?? [])
          .map((s: any) => typeof s === 'string' ? s : (s.name ?? ''))
          .filter(Boolean);

        if (namedStyles.length > 0) {
          // Deduplicate while preserving order
          setDoorStyles([...new Set(namedStyles)]);
        } else if (d.price_model === 'price_column') {
          // Fallback: use price column labels (e.g. "Arcdia/Bel-Air") when no named styles
          const cols: string[] = (d.price_columns ?? [])
            .map((c: any) => typeof c === 'string' ? c : (c.label ?? c.id ?? ''))
            .filter(Boolean);
          setDoorStyles(cols);
        } else {
          setDoorStyles([]);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingStyles(false));
  }, [manufacturerId]);

  async function autoFill() {
    const skus = rows.map(r => r.code.trim()).filter(Boolean);
    if (!skus.length || !manufacturerId || !doorStyle) {
      setStatus({ ok: false, text: 'Select a manufacturer and door style first, then enter SKU codes.' });
      return;
    }
    setLookingUp(true);
    setStatus(null);
    try {
      const results = await validateSkuMatches(manufacturerId, doorStyle, skus);
      const statusMap: Record<string, SkuMatchResult> = {};
      for (const r of results) statusMap[r.sku.toUpperCase()] = r;
      setSkuStatus(statusMap);

      const exactCount = results.filter(r => r.status === 'exact').length;
      const variantCount = results.filter(r => r.status === 'variant').length;
      const notFoundCount = results.filter(r => r.status === 'not_found' || r.status === 'wrong_style').length;

      setRows(rs => rs.map(r => {
        const match = statusMap[r.code.trim().toUpperCase()];
        if (match?.status === 'exact' && match.price !== null) {
          return { ...r, listPrice: String(match.price) };
        }
        return r;
      }));

      const parts: string[] = [];
      if (exactCount > 0) parts.push(`${exactCount} exact`);
      if (variantCount > 0) parts.push(`${variantCount} variant`);
      if (notFoundCount > 0) parts.push(`${notFoundCount} not found`);
      setStatus({
        ok: exactCount > 0,
        text: exactCount > 0
          ? `Matched ${parts.join(', ')} of ${skus.length} SKU(s) from the ${doorStyle} catalog.`
          : `No prices found for these SKUs with door style "${doorStyle}". Check the codes and door style selection.`,
      });
    } catch (err: any) {
      setStatus({ ok: false, text: err.message ?? 'Price lookup failed.' });
    } finally {
      setLookingUp(false);
    }
  }

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
      setShowItems(true);

      // Auto-select manufacturer if detected from PDF and not already chosen
      let detectedNote = '';
      if (data.detected_manufacturer && !manufacturerId) {
        const match = manufacturers.find(m =>
          m.name.toLowerCase().includes(data.detected_manufacturer.toLowerCase()) ||
          data.detected_manufacturer.toLowerCase().includes(m.name.toLowerCase())
        );
        if (match) {
          setManufacturerId(match.id);
          detectedNote = ` · Detected manufacturer: ${match.name}`;
        }
      }

      setStatus({ ok: true, text: `Imported ${imported.length} items from PDF (${data.source === 'ai' ? 'AI' : 'rule-based'} extraction, ${data.page_count} pages).${detectedNote}` });
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
        <h3 className="text-sm font-semibold text-slate-900">0. Manufacturer &amp; Door Style</h3>
        <p className="text-xs text-slate-400">Select a manufacturer and door style to auto-fill list prices from the catalog.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Manufacturer</span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              value={manufacturerId}
              onChange={e => setManufacturerId(e.target.value)}
            >
              <option value="">— Select manufacturer —</option>
              {manufacturers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Door Style</span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
              value={doorStyle}
              onChange={e => setDoorStyle(e.target.value)}
              disabled={!manufacturerId || loadingStyles}
            >
              <option value="">
                {loadingStyles ? 'Loading…' : doorStyles.length ? '— Select door style —' : manufacturerId ? 'No styles found' : '—'}
              </option>
              {doorStyles.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">1. Rules</h3>
        <PricingRulesForm rules={rules} onRulesChange={setRules} method={method} onMethodChange={setMethod} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-sky-700 transition-colors"
            onClick={() => setShowItems(v => !v)}
          >
            {showItems ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            2. Items
            {!showItems && rows.filter(r => r.code.trim()).length > 0 && (
              <span className="text-xs font-normal text-slate-400 ml-1">({rows.filter(r => r.code.trim()).length} items)</span>
            )}
            <span className="text-[10px] font-normal text-slate-400 ml-1">(optional)</span>
          </button>
          <div className="flex items-center gap-2 flex-wrap">
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
            {showItems && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={lookingUp || !manufacturerId || !doorStyle}
                  onClick={autoFill}
                  className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                  title={!manufacturerId || !doorStyle ? 'Select manufacturer and door style first' : 'Look up list prices for all entered SKU codes'}
                >
                  {lookingUp ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
                  {lookingUp ? 'Looking up…' : 'Auto-fill prices'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => { setRows([...rows, blankRow(nextKey)]); setNextKey(nextKey + 1); }}>
                  <Plus className="mr-1 h-4 w-4" /> Add item
                </Button>
              </>
            )}
          </div>
        </div>
        {showItems && (
          <>
            <p className="text-xs text-slate-400">
              Import a 2020 Design PDF (manufacturer will be auto-detected), or enter SKU codes manually and click <strong>Auto-fill prices</strong>.
            </p>
        <div className="space-y-2">
          {rows.map((r) => {
            const match = skuStatus[r.code.trim().toUpperCase()];
            return (
              <div key={r.key} className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-2 relative">
                  <Input className="bg-white pr-6" placeholder="Code" value={r.code} onChange={(e) => update(r.key, { code: e.target.value })} />
                  {match && (
                    <span
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                      title={
                        match.status === 'exact' ? `Exact match — $${match.price}` :
                        match.status === 'variant' ? `Variant — suggest ${match.suggestion}` :
                        match.status === 'wrong_style' ? 'SKU exists but not in this door style' :
                        'Not found in catalog'
                      }
                    >
                      {match.status === 'exact'       ? '🟢' :
                       match.status === 'variant'     ? '🟡' :
                       match.status === 'wrong_style' ? '🟠' : '🔴'}
                    </span>
                  )}
                </div>
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
                {match?.status === 'variant' && match.suggestion && (
                  <div className="col-span-12 -mt-1 ml-0 text-xs text-amber-600 pl-0.5">
                    ↳ Closest match in catalog: <strong>{match.suggestion}</strong>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {Object.keys(skuStatus).length > 0 && (
          <p className="text-xs text-slate-400">
            SKU confidence: 🟢 Exact match &nbsp;·&nbsp; 🟡 Variant (similar size) &nbsp;·&nbsp; 🟠 Wrong door style &nbsp;·&nbsp; 🔴 Not in catalog
          </p>
        )}
        {invalidRows > 0 && <p className="text-xs text-amber-600">{invalidRows} item(s) are missing a code, quantity or list price.</p>}
          </>
        )}
      </section>

      <div className="flex items-center gap-3 flex-wrap">
        <Button type="button" className="gradient-button" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save for my company
        </Button>
        {ws && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadWorksheetExcel(ws)}
              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Download Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => printWorksheetPdf(ws)}
              className="border-sky-200 text-sky-700 hover:bg-sky-50 gap-2"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          </>
        )}
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
