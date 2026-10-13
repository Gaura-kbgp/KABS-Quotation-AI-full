'use client';

/**
 * Staff Review & Approval panel for the Quotation AI BOM page.
 * Shows the full approval flow, suggestion notes, review history,
 * blueprint link (if available), and download buttons when approved.
 */

import { useState, useTransition } from 'react';
import {
  CheckCircle2, Clock, Send, AlertTriangle, ChevronRight, RotateCcw,
  Loader2, MessageSquare, History, FileText, ExternalLink, Download,
  FileSpreadsheet, Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setReviewStatusAction, type ReviewStatus, type QuotationReviewEntry } from '@/app/quotation-ai/actions';

interface PricingSnapshot {
  pricingFactor?: number;
  targetMargin?: number;
  discount?: number;
  taxRate?: number;
  freight?: number;
  installationCharges?: number;
}

interface QuotationReviewPanelProps {
  project: {
    id: string;
    project_name: string;
    review_status?: string | null;
    review_history?: QuotationReviewEntry[] | null;
    review_notes?: string | null;
    has_blueprint?: boolean;
  };
  /** Full BOM items — used for Excel/PDF export */
  bom: {
    id: string;
    room?: string;
    sku: string;
    description?: string;
    quantity: number;
    list_price?: number;
    unit_cost?: number;
    line_total?: number;
    sell_price?: number;
  }[];
  companyName?: string;
  /** Manufacturer selected for this project */
  manufacturerName?: string;
  /** Original PDF / file name that was imported */
  sourceFileName?: string;
  /** Pricing rules snapshot */
  pricing?: PricingSnapshot;
}

const FLOW: ReviewStatus[] = ['draft', 'in_review', 'approved', 'sent'];

const STATUS_CONFIG: Record<ReviewStatus, {
  label: string; color: string; bg: string; border: string; dot: string; icon: typeof Clock;
}> = {
  draft:     { label: 'Draft',          color: 'text-slate-600',   bg: 'bg-slate-50',   border: 'border-slate-200', dot: 'bg-slate-300',    icon: Clock },
  in_review: { label: 'In Review',      color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200', dot: 'bg-amber-400',    icon: AlertTriangle },
  approved:  { label: 'Approved',       color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2 },
  sent:      { label: 'Sent to Client', color: 'text-sky-700',     bg: 'bg-sky-50',     border: 'border-sky-200',    dot: 'bg-sky-500',     icon: Send },
};

const NEXT_LABEL: Partial<Record<ReviewStatus, string>> = {
  draft:     'Submit for Review',
  in_review: 'Approve',
  approved:  'Mark as Sent',
};
const REVERT_LABEL: Partial<Record<ReviewStatus, string>> = {
  in_review: 'Back to Draft',
  approved:  'Back to Review',
  sent:      'Back to Approved',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shortName(email: string) {
  return email.split('@')[0];
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

// ─── Excel export ────────────────────────────────────────────────────────────

async function exportExcel(bom: QuotationReviewPanelProps['bom'], projectName: string) {
  const XLSX = await import('xlsx');
  const rows = [
    ['Room', 'SKU', 'Description', 'Qty', 'List', 'Cost', 'Sell', 'Line Total'],
    ...bom.map(i => [
      i.room || '',
      i.sku,
      i.description || '',
      i.quantity,
      +(i.list_price ?? 0).toFixed(2),
      +(i.unit_cost ?? 0).toFixed(2),
      +(i.sell_price ?? 0).toFixed(2),
      +(i.line_total ?? 0).toFixed(2),
    ]),
    [],
    ['', '', '', '', '', '', 'Grand Total',
      +bom.reduce((s, i) => s + (i.line_total ?? 0), 0).toFixed(2)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 32 }, { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BOM');
  XLSX.writeFile(wb, `${projectName.replace(/[^a-z0-9]/gi, '-')}-quote.xlsx`);
}

// ─── PDF / Print export ──────────────────────────────────────────────────────

function printQuotePdf(
  bom: QuotationReviewPanelProps['bom'],
  projectName: string,
  companyName = 'KABS',
) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const grandTotal = bom.reduce((s, i) => s + (i.line_total ?? 0), 0);
  const rows = bom.map(i => `
    <tr>
      <td class="mono">${i.sku}</td>
      <td>${i.description || '—'}</td>
      <td>${i.room || '—'}</td>
      <td class="right">${i.quantity}</td>
      <td class="mono right">${fmt(i.list_price ?? 0)}</td>
      <td class="mono right bold">${fmt(i.line_total ?? 0)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <title>${projectName} — Quotation</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:system-ui,sans-serif;font-size:11px;color:#1e293b;padding:32px;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;}
    .header h1{font-size:20px;font-weight:900;}
    .header .meta{text-align:right;color:#94a3b8;font-size:10px;}
    .project{font-size:13px;color:#475569;margin-bottom:20px;}
    table{width:100%;border-collapse:collapse;margin-top:8px;}
    th{text-align:left;padding:5px 8px;border-bottom:2px solid #e2e8f0;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;}
    td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top;}
    .mono{font-family:'Courier New',monospace;}
    .right{text-align:right;}
    .bold{font-weight:700;}
    .total-row td{border-top:2px solid #1e293b;font-weight:900;font-size:13px;padding-top:8px;}
    .footer{margin-top:32px;border-top:1px solid #e2e8f0;padding-top:10px;font-size:9px;color:#94a3b8;}
    @media print{body{padding:20px;}@page{margin:1.5cm;size:A4 landscape;}}
  </style></head><body>
  <div class="header">
    <div><h1>${companyName}</h1></div>
    <div class="meta"><div>${date}</div></div>
  </div>
  <div class="project"><strong>${projectName}</strong> — Cabinet Quotation</div>
  <table>
    <thead><tr>
      <th>SKU</th><th>Description</th><th>Room</th><th class="right">Qty</th>
      <th class="right">List</th><th class="right">Total</th>
    </tr></thead>
    <tbody>${rows}
      <tr class="total-row">
        <td colspan="4"></td><td class="right">Grand Total</td>
        <td class="mono right">${fmt(grandTotal)}</td>
      </tr>
    </tbody>
  </table>
  <div class="footer">This quotation is valid for 30 days. Prices subject to change. Generated by KABS Quotation AI.</div>
  </body></html>`;

  // Use a hidden iframe — avoids popup blocker entirely
  const existing = document.getElementById('__kabs_print_frame__');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = '__kabs_print_frame__';
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();

  // Give the iframe a moment to render, then print
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // Clean up after the print dialog closes
    setTimeout(() => iframe.remove(), 2000);
  }, 400);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function QuotationReviewPanel({
  project, bom, companyName = 'KABS',
  manufacturerName, sourceFileName, pricing,
}: QuotationReviewPanelProps) {
  const rawStatus = (project.review_status ?? 'draft') as ReviewStatus;
  const validStatus = FLOW.includes(rawStatus) ? rawStatus : 'draft';

  const [status, setStatus]          = useState<ReviewStatus>(validStatus);
  const [history, setHistory]        = useState<QuotationReviewEntry[]>(project.review_history ?? []);
  const [note, setNote]              = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError]            = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const cfg         = STATUS_CONFIG[status];
  const Icon        = cfg.icon;
  const currentStep = FLOW.indexOf(status);
  const nextStatus  = FLOW[currentStep + 1] as ReviewStatus | undefined;
  const prevStatus  = FLOW[currentStep - 1] as ReviewStatus | undefined;
  const isApproved  = status === 'approved' || status === 'sent';

  function move(toStatus: ReviewStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setReviewStatusAction(project.id, toStatus, note);
      if (res.success) {
        const entry: QuotationReviewEntry = {
          status: toStatus,
          by: 'You',
          at: new Date().toISOString(),
          note: note.trim(),
        };
        setHistory(h => [...h, entry]);
        setStatus(toStatus);
        setNote('');
      } else {
        setError((res as any).error ?? 'Could not update status.');
      }
    });
  }

  const grandTotal = bom.reduce((s, i) => s + (i.line_total ?? 0), 0);
  const hasBom     = bom.length > 0;

  return (
    <div className={`rounded-2xl border p-5 space-y-4 ${cfg.bg} ${cfg.border}`}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className={`w-4 h-4 ${cfg.color}`} />
          <span className={`text-sm font-semibold ${cfg.color}`}>
            Review: {cfg.label}
          </span>
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(v => !v)}
              className="flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full hover:bg-slate-200 transition-colors"
            >
              <History className="w-3 h-3" />
              {history.length} update{history.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Blueprint link */}
          {project.has_blueprint && (
            <a
              href={`/quotation-ai/blueprint/${project.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              View Blueprint
            </a>
          )}

          {/* Download — available once approved */}
          {isApproved && hasBom && (
            <>
              <Button type="button" variant="outline" size="sm"
                onClick={() => exportExcel(bom, project.project_name)}
                className="text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Excel
              </Button>
              <Button type="button" variant="outline" size="sm"
                onClick={() => printQuotePdf(bom, project.project_name, companyName)}
                className="text-xs gap-1 border-sky-300 text-sky-700 hover:bg-sky-50">
                <Printer className="w-3.5 h-3.5" />
                PDF
              </Button>
            </>
          )}

          {/* Revert */}
          {prevStatus && (
            <Button type="button" variant="outline" size="sm"
              disabled={isPending || !hasBom}
              onClick={() => move(prevStatus)}
              className="text-xs gap-1 border-slate-300 text-slate-600 hover:bg-slate-100">
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              {REVERT_LABEL[status]}
            </Button>
          )}

          {/* Advance */}
          {nextStatus && (
            <Button type="button" variant="outline" size="sm"
              disabled={isPending || !hasBom}
              onClick={() => move(nextStatus)}
              title={!hasBom ? 'Generate BOM first' : undefined}
              className={`text-xs gap-1 ${
                nextStatus === 'approved' ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' :
                nextStatus === 'sent'     ? 'border-sky-300 text-sky-700 hover:bg-sky-50' :
                                           'border-amber-300 text-amber-700 hover:bg-amber-50'
              }`}>
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
              {NEXT_LABEL[status]}
            </Button>
          )}

          {status === 'sent' && (
            <span className="text-xs font-semibold text-sky-700 bg-sky-100 px-3 py-1 rounded-full">
              ✓ Sent to Client
            </span>
          )}
        </div>
      </div>

      {/* ── Progress ── */}
      <div className="flex items-center gap-1 flex-wrap">
        {FLOW.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full transition-all ${
              i < currentStep   ? 'bg-emerald-500' :
              i === currentStep ? cfg.dot : 'bg-slate-200'
            }`} />
            <span className={`text-[10px] ${i <= currentStep ? 'text-slate-600 font-medium' : 'text-slate-300'}`}>
              {STATUS_CONFIG[s].label}
            </span>
            {i < FLOW.length - 1 && <div className="w-5 h-px bg-slate-200 mx-1" />}
          </div>
        ))}
      </div>

      {/* ── Totals summary ── */}
      {hasBom && (
        <div className="flex items-center gap-4 flex-wrap text-xs bg-white/70 rounded-xl px-4 py-2.5 border border-slate-200">
          <span className="text-slate-400">{bom.length} line item{bom.length !== 1 ? 's' : ''}</span>
          <span className="text-slate-200">|</span>
          <span className="text-slate-500">Grand total:</span>
          <span className="font-mono font-bold text-slate-800 text-sm">{fmt(grandTotal)}</span>
          {!isApproved && (
            <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 ml-auto">
              Approve to unlock download
            </span>
          )}
        </div>
      )}

      {/* ── Suggestion / note field ── */}
      {status !== 'sent' && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <MessageSquare className="w-3.5 h-3.5" />
            Note / suggestion (saved with next status change)
          </div>
          <textarea
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={
              status === 'draft'     ? 'e.g. Check crown moulding qty in Kitchen before review' :
              status === 'in_review' ? 'e.g. Prices verified — approved for sending' :
              'e.g. Sent by email to client on 13 Oct'
            }
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 placeholder:text-slate-300 resize-none focus:outline-none focus:ring-1 focus:ring-sky-300"
          />
          <p className="text-[10px] text-slate-300">Recorded in history when you click Revert or Advance.</p>
        </div>
      )}

      {/* ── Review history ── */}
      {showHistory && history.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          <p className="px-3 py-2 text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" /> Review history
          </p>
          {[...history].reverse().map((h, i) => (
            <div key={i} className="px-3 py-2.5 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                  STATUS_CONFIG[h.status]?.bg ?? 'bg-slate-50'
                } ${STATUS_CONFIG[h.status]?.border ?? 'border-slate-200'} ${STATUS_CONFIG[h.status]?.color ?? 'text-slate-600'}`}>
                  {STATUS_CONFIG[h.status]?.label ?? h.status}
                </span>
                <span className="text-xs text-slate-500 font-medium">{shortName(h.by)}</span>
                <span className="text-[10px] text-slate-300 ml-auto">{timeAgo(h.at)}</span>
              </div>
              {h.note && (
                <p className="text-xs text-slate-600 pl-1 border-l-2 border-slate-200 ml-1">"{h.note}"</p>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {!hasBom && (
        <p className="text-xs text-slate-400">Generate the BOM first — then come back here to review and approve.</p>
      )}
    </div>
  );
}
