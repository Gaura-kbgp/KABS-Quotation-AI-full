'use client';

import { useRef, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildWorksheet, customerSummary, type WorksheetItem } from './pricing';
import { effectiveRules, money } from './pricing-rules-form';
import { DEFAULT_RULES } from './pricing-rules-form';
import type { SavedProfile } from './actions';

interface Props {
  profile: SavedProfile | null;
}

/**
 * Read-only preview/print of this worksheet as a customer-style quote.
 *
 * This replaces the old ElevateReviewCard's draft→in_review→approved→sent workflow.
 * That workflow tracked approval on `elevate_pricing_profiles`, which is a single
 * row per org (not per quotation) — so it could never reflect the real staff review
 * for a specific customer's quote. The actual approval gate lives on the quotation
 * project itself (QuotationReviewPanel / setReviewStatusAction in
 * app/quotation-ai/actions.ts), which blocks on unconfirmed catalog prices too.
 * This component is now just a convenience print/preview, not an approval step.
 */
export function ElevateQuotePreview({ profile }: Props) {
  const [showQuote, setShowQuote] = useState(false);
  const quoteRef = useRef<HTMLDivElement>(null);

  const items: WorksheetItem[] = (profile?.items ?? []).map(i => ({
    code: i.code,
    description: i.description,
    qty: i.qty,
    listPrice: i.listPrice,
    category: 'cabinet' as const,
  }));

  let ws: ReturnType<typeof buildWorksheet> | null = null;
  try {
    if (items.length > 0) {
      ws = buildWorksheet(items, effectiveRules(profile?.rules ?? DEFAULT_RULES, profile?.method ?? 'markup'));
    }
  } catch { /* ignore */ }

  function printQuote() {
    if (!quoteRef.current) return;
    const html = `<html><head><title>Customer Quote</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:32px;color:#1e293b;}
        h1{font-size:22px;font-weight:900;margin:0 0 4px;}
        .sub{color:#94a3b8;font-size:12px;margin-bottom:24px;}
        table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;}
        th{text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#94a3b8;}
        td{padding:6px 8px;border-bottom:1px solid #f1f5f9;}
        .right{text-align:right;}
        .footer{margin-top:48px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px;}
        @media print{@page{margin:1.5cm;size:A4;}}
      </style></head><body>${quoteRef.current.innerHTML}</body></html>`;
    const existing = document.getElementById('__kabs_print_frame__');
    if (existing) existing.remove();
    const iframe = document.createElement('iframe');
    iframe.id = '__kabs_print_frame__';
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) return;
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 2000);
    }, 400);
  }

  if (!profile?.items?.length) {
    return <p className="text-xs text-slate-400">Add items and save the worksheet above to preview a quote.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
        This worksheet is a pricing calculator only. To actually send a quote to a client,
        use it as a reference while building the project in the main quotation flow —
        staff review and approval happen there, on the project's BOM, not here.
      </div>

      {ws && (
        <Button type="button" variant="outline" size="sm"
          onClick={() => setShowQuote(v => !v)}
          className="text-xs gap-1 border-slate-200 text-slate-600 hover:bg-slate-100">
          <FileText className="w-3.5 h-3.5" />
          {showQuote ? 'Hide preview' : 'Preview as quote'}
        </Button>
      )}

      {showQuote && ws && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-semibold text-slate-600">Worksheet preview</span>
            <Button type="button" variant="ghost" size="sm" onClick={printQuote} className="text-xs h-7 gap-1">
              <Printer className="w-3 h-3" /> Print / Save PDF
            </Button>
          </div>
          <div ref={quoteRef} className="p-5">
            <h1 className="text-xl font-black text-slate-900 mb-0.5">Cabinet Quotation</h1>
            <p className="text-xs text-slate-400 mb-5">
              {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            <table className="w-full text-sm mb-5">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400 uppercase tracking-wide">
                  <th className="pb-1.5 pr-3">Item</th>
                  <th className="pb-1.5 pr-3">Description</th>
                  <th className="pb-1.5 pr-3 text-right">Qty</th>
                  <th className="pb-1.5 text-right">Unit</th>
                  <th className="pb-1.5 pl-3 text-right">Extended</th>
                </tr>
              </thead>
              <tbody>
                {ws.lines.map((line, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 pr-3 font-mono text-xs">{line.code}</td>
                    <td className="py-1 pr-3 text-slate-500 text-xs">{line.description || '—'}</td>
                    <td className="py-1 pr-3 text-right">{line.qty}</td>
                    <td className="py-1 text-right font-mono text-xs">{money(line.extendedSell / line.qty)}</td>
                    <td className="py-1 pl-3 text-right font-mono text-xs font-medium">{money(line.extendedSell)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-1 text-sm max-w-xs ml-auto">
              {ws.charges.installation > 0 && <div className="flex justify-between"><span className="text-slate-500">Installation</span><span className="font-mono">{money(ws.charges.installation)}</span></div>}
              {ws.charges.delivery > 0     && <div className="flex justify-between"><span className="text-slate-500">Delivery</span><span className="font-mono">{money(ws.charges.delivery)}</span></div>}
              {ws.charges.freight > 0      && <div className="flex justify-between"><span className="text-slate-500">Freight</span><span className="font-mono">{money(ws.charges.freight)}</span></div>}
              {ws.charges.threePl > 0      && <div className="flex justify-between"><span className="text-slate-500">3PL</span><span className="font-mono">{money(ws.charges.threePl)}</span></div>}
              {ws.charges.hardware > 0     && <div className="flex justify-between"><span className="text-slate-500">Hardware</span><span className="font-mono">{money(ws.charges.hardware)}</span></div>}
              {ws.tax > 0                  && <div className="flex justify-between"><span className="text-slate-500">Tax</span><span className="font-mono">{money(ws.tax)}</span></div>}
              <div className="flex justify-between pt-2 border-t border-slate-200 font-bold">
                <span>Total</span>
                <span className="font-mono text-lg">{money(ws.grandTotal)}</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 mt-8 pt-4 border-t border-slate-100">
              This quotation is valid for 30 days. Prices subject to change.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
