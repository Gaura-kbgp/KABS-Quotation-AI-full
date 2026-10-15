'use client';

import { useState, useTransition } from 'react';
import {
  CheckCircle2, Clock, Send, AlertTriangle, ChevronRight, RotateCcw,
  Loader2, MessageSquare, History, ExternalLink, Download,
  FileSpreadsheet, Printer, User, Mail, Phone, MapPin, CalendarDays,
  ShieldCheck, Hash, ClipboardList, XCircle, Info, RefreshCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  manufacturerName?: string;
  sourceFileName?: string;
  pricing?: PricingSnapshot;
  /** Number of billable items with provisional/unconfirmed pricing */
  unconfirmedCount?: number;
}

const FLOW: ReviewStatus[] = ['draft', 'in_review', 'approved', 'sent'];

const STATUS_CONFIG: Record<ReviewStatus, {
  label: string; color: string; bg: string; border: string; dot: string; icon: typeof Clock; step: number;
}> = {
  draft:             { label: 'Draft',             color: 'text-slate-600',   bg: 'bg-white',       border: 'border-slate-200',  dot: 'bg-slate-300',    icon: Clock,         step: 0 },
  in_review:         { label: 'In Review',         color: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200',  dot: 'bg-amber-400',    icon: AlertTriangle, step: 1 },
  changes_requested: { label: 'Changes Requested', color: 'text-orange-700',  bg: 'bg-orange-50',   border: 'border-orange-200', dot: 'bg-orange-500',   icon: AlertTriangle, step: 1 },
  approved:          { label: 'Approved',          color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200',dot: 'bg-emerald-500',  icon: CheckCircle2,  step: 2 },
  sent:              { label: 'Sent to Client',    color: 'text-sky-700',     bg: 'bg-sky-50',      border: 'border-sky-200',    dot: 'bg-sky-500',      icon: Send,          step: 3 },
  accepted:          { label: 'Accepted',          color: 'text-violet-700',  bg: 'bg-violet-50',   border: 'border-violet-200', dot: 'bg-violet-500',   icon: CheckCircle2,  step: 3 },
  rejected:          { label: 'Rejected',          color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200',    dot: 'bg-red-500',      icon: XCircle,       step: 3 },
};

const NEXT_LABEL: Partial<Record<ReviewStatus, string>> = {
  draft:             'Submit for Staff Review',
  in_review:         'Approve Quote',
  changes_requested: 'Resubmit for Review',
  approved:          'Mark as Sent to Client',
};
const REVERT_LABEL: Partial<Record<ReviewStatus, string>> = {
  in_review:         'Back to Draft',
  changes_requested: 'Back to Draft',
  approved:          'Back to Review',
  sent:              'Back to Approved',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortName(email: string) {
  return email.includes('@') ? email.split('@')[0] : email;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function quoteRef(id: string) {
  return 'Q-' + id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

// ─── Excel export ─────────────────────────────────────────────────────────────

async function exportExcel(bom: QuotationReviewPanelProps['bom'], projectName: string, pricing?: PricingSnapshot) {
  const XLSX = await import('xlsx');
  const grandTotal = bom.reduce((s, i) => s + (i.line_total ?? 0), 0);
  const rows: (string | number)[][] = [
    ['KABS Inc. — Cabinet Quotation'],
    [`Project: ${projectName}`],
    [`Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`],
    [],
    ['Room', 'SKU / Code', 'Description', 'Qty', 'Unit Price', 'Line Total'],
    ...bom.map(i => [
      i.room || '',
      i.sku,
      i.description || '',
      i.quantity,
      +(i.sell_price ?? i.list_price ?? 0).toFixed(2),
      +(i.line_total ?? 0).toFixed(2),
    ]),
    [],
    ['', '', '', '', 'Grand Total', +grandTotal.toFixed(2)],
  ];
  if (pricing?.freight) rows.push(['', '', '', '', 'Freight', +pricing.freight.toFixed(2)]);
  if (pricing?.installationCharges) rows.push(['', '', '', '', 'Installation', +pricing.installationCharges.toFixed(2)]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 36 }, { wch: 6 }, { wch: 12 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Quotation BOM');
  XLSX.writeFile(wb, `${projectName.replace(/[^a-z0-9]/gi, '-')}-quote.xlsx`);
}

// ─── PDF / Print export ───────────────────────────────────────────────────────

function printQuotePdf(
  bom: QuotationReviewPanelProps['bom'],
  projectName: string,
  companyName = 'KABS Inc.',
  customerName = '',
  customerEmail = '',
  validUntil = '',
  ref = '',
  pricing?: PricingSnapshot,
) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const grandTotal = bom.reduce((s, i) => s + (i.line_total ?? 0), 0);
  const freight = pricing?.freight ?? 0;
  const install = pricing?.installationCharges ?? 0;
  const taxRate = pricing?.taxRate ?? 0;
  const tax = grandTotal * (taxRate / 100);
  const finalTotal = grandTotal + freight + install + tax;

  const rows = bom.map(i => `
    <tr>
      <td class="room">${i.room || '—'}</td>
      <td class="mono">${i.sku}</td>
      <td>${i.description || '—'}</td>
      <td class="right">${i.quantity}</td>
      <td class="mono right">${fmt(i.sell_price ?? i.list_price ?? 0)}</td>
      <td class="mono right bold">${fmt(i.line_total ?? 0)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <title>${ref || projectName} — Quotation</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#0f172a;padding:36px;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #0f172a;}
    .header .co{font-size:22px;font-weight:900;letter-spacing:-.5px;color:#0f172a;}
    .header .co small{display:block;font-size:10px;font-weight:400;color:#64748b;letter-spacing:.05em;margin-top:2px;}
    .header .meta{text-align:right;font-size:10px;color:#64748b;line-height:1.6;}
    .header .ref{font-size:13px;font-weight:800;color:#0f172a;}
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;}
    .party h3{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px;}
    .party p{font-size:11px;line-height:1.7;color:#334155;}
    .party .name{font-weight:700;font-size:12px;color:#0f172a;}
    table{width:100%;border-collapse:collapse;margin-top:8px;}
    thead tr{background:#f8fafc;}
    th{text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;}
    td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:10.5px;}
    tr:hover td{background:#f8fafc;}
    .room{color:#94a3b8;font-size:10px;}
    .mono{font-family:'Courier New',monospace;}
    .right{text-align:right;}
    .bold{font-weight:700;}
    .totals{margin-top:16px;display:flex;justify-content:flex-end;}
    .totals table{width:280px;}
    .totals td{border:none;padding:3px 8px;color:#475569;}
    .totals .final td{font-weight:900;font-size:14px;color:#0f172a;border-top:2px solid #0f172a;padding-top:8px;}
    .badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;}
    .footer{margin-top:32px;border-top:1px solid #e2e8f0;padding-top:12px;font-size:9px;color:#94a3b8;line-height:1.6;}
    @media print{body{padding:20px;}@page{margin:1.5cm;size:A4 portrait;}}
  </style></head><body>
  <div class="header">
    <div><div class="co">${companyName}<small>Professional Cabinet Quotation</small></div></div>
    <div class="meta">
      <div class="ref">${ref || quoteRef(projectName)}</div>
      <div>Date: ${date}</div>
      ${validUntil ? `<div>Valid until: ${new Date(validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>` : ''}
    </div>
  </div>
  <div class="parties">
    <div class="party"><h3>From</h3><p class="name">${companyName}</p></div>
    <div class="party"><h3>To / Prepared For</h3>
      ${customerName ? `<p class="name">${customerName}</p>` : ''}
      ${customerEmail ? `<p>${customerEmail}</p>` : ''}
      ${!customerName && !customerEmail ? '<p style="color:#94a3b8">—</p>' : ''}
    </div>
  </div>
  <p style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:8px;">${projectName}</p>
  <table>
    <thead><tr>
      <th>Room</th><th>SKU</th><th>Description</th><th class="right">Qty</th>
      <th class="right">Unit Price</th><th class="right">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals"><table>
    <tr><td>Product subtotal</td><td class="right bold mono">${fmt(grandTotal)}</td></tr>
    ${freight ? `<tr><td>Freight / Shipping</td><td class="right mono">${fmt(freight)}</td></tr>` : ''}
    ${install ? `<tr><td>Installation</td><td class="right mono">${fmt(install)}</td></tr>` : ''}
    ${taxRate ? `<tr><td>Sales Tax (${taxRate}%)</td><td class="right mono">${fmt(tax)}</td></tr>` : ''}
    <tr class="final"><td>Grand Total</td><td class="right mono">${fmt(finalTotal)}</td></tr>
  </table></div>
  <div class="footer">
    This quotation is valid for 30 days from the date of issue. Prices are subject to change without notice.
    All orders are subject to KABS Inc. standard terms and conditions. Generated by KABS Quotation AI.
  </div>
  </body></html>`;

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

// ─── Readiness check item ─────────────────────────────────────────────────────

function CheckItem({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className={`flex items-start gap-2.5 text-xs py-1.5 px-3 rounded-lg ${ok ? 'text-emerald-700 bg-emerald-50/60' : 'text-amber-700 bg-amber-50/60'}`}>
      {ok
        ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500" />
        : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />}
      <div>
        <span className="font-semibold">{label}</span>
        {detail && <span className="ml-1 text-[11px] opacity-70">— {detail}</span>}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function QuotationReviewPanel({
  project, bom, companyName = 'KABS Inc.',
  manufacturerName, sourceFileName, pricing,
  unconfirmedCount = 0,
}: QuotationReviewPanelProps) {
  const rawStatus = (project.review_status ?? 'draft') as ReviewStatus;
  const validStatus = (rawStatus in STATUS_CONFIG) ? rawStatus : 'draft';

  const [status, setStatus]           = useState<ReviewStatus>(validStatus);
  const [history, setHistory]         = useState<QuotationReviewEntry[]>(project.review_history ?? []);
  const [note, setNote]               = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showChecklist, setShowChecklist] = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [isPending, startTransition]  = useTransition();

  // Customer details (local state — staff fills in before sending)
  const [customerName, setCustomerName]   = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddr, setCustomerAddr]   = useState('');
  const [validUntil, setValidUntil]       = useState(defaultValidUntil);

  const cfg         = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const Icon        = cfg.icon;
  // For non-main-flow statuses (changes_requested / accepted / rejected), map to nearest FLOW position
  const flowStatus  = FLOW.includes(status) ? status : (status === 'changes_requested' ? 'in_review' : 'sent');
  const currentStep = FLOW.indexOf(flowStatus);
  const nextStatus  = FLOW[currentStep + 1] as ReviewStatus | undefined;
  const prevStatus  = FLOW[currentStep - 1] as ReviewStatus | undefined;
  const isApproved  = status === 'approved' || status === 'sent' || status === 'accepted';
  const isSent      = status === 'sent' || status === 'accepted';
  const hasBom      = bom.length > 0;
  const grandTotal  = bom.reduce((s, i) => s + (i.line_total ?? 0), 0);
  const ref         = quoteRef(project.id);

  // Readiness checks
  const checks = [
    { ok: hasBom,                  label: 'BOM generated',            detail: hasBom ? `${bom.length} line items` : 'Generate BOM first' },
    { ok: unconfirmedCount === 0,  label: 'All prices confirmed',     detail: unconfirmedCount > 0 ? `${unconfirmedCount} item${unconfirmedCount > 1 ? 's' : ''} still provisional` : undefined },
    { ok: !!manufacturerName,      label: 'Manufacturer selected',    detail: manufacturerName ?? 'Not set' },
    { ok: !!project.has_blueprint, label: 'Blueprint / plan attached', detail: project.has_blueprint ? 'Available' : 'Optional — add in Blueprint Mode' },
  ];
  const readyCount = checks.filter(c => c.ok).length;
  const canAdvance = hasBom && (status !== 'draft' || unconfirmedCount === 0);

  function move(toStatus: ReviewStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setReviewStatusAction(project.id, toStatus, note);
      if (res.success) {
        setHistory(h => [...h, { status: toStatus, by: 'You', at: new Date().toISOString(), note: note.trim() }]);
        setStatus(toStatus);
        setNote('');
      } else {
        setError((res as any).error ?? 'Could not update status.');
      }
    });
  }

  return (
    <div className="space-y-4 print:hidden">
      {/* ── Section heading ── */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900">Step 7 — Staff Review & Approval</h3>
          <p className="text-xs text-slate-400">Verify pricing, fill customer details, approve, and deliver the quote.</p>
        </div>
      </div>

      {/* ── Status card ── */}
      <div className={`rounded-2xl border-2 overflow-hidden ${cfg.border}`}>
        {/* Status header bar */}
        <div className={`px-5 py-3 flex items-center justify-between gap-3 flex-wrap ${cfg.bg}`}>
          <div className="flex items-center gap-2.5">
            <Icon className={`w-5 h-5 ${cfg.color}`} />
            <span className={`text-sm font-bold ${cfg.color}`}>{cfg.label}</span>
            <span className="text-[10px] text-slate-400 font-mono bg-white/70 px-2 py-0.5 rounded-full border border-slate-200">{ref}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a href={`/quotation-ai/staff-review/${project.id}`}
              className="flex items-center gap-1 text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-lg hover:bg-sky-100 transition-colors">
              <ExternalLink className="w-3 h-3" /> Full Review Workspace
            </a>
            {project.has_blueprint && (
              <a href={`/quotation-ai/blueprint/${project.id}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-white border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition-colors">
                <ExternalLink className="w-3 h-3" /> Blueprint
              </a>
            )}
            {/* Always-available internal BOM export */}
            {hasBom && (
              <Button type="button" variant="outline" size="sm"
                onClick={() => exportExcel(bom, project.project_name, pricing)}
                className="text-xs gap-1 bg-white border-slate-200 text-slate-600 hover:bg-slate-50">
                <FileSpreadsheet className="w-3.5 h-3.5" /> BOM Excel
              </Button>
            )}
            {/* Customer PDF — available once approved */}
            {isApproved && hasBom && (
              <Button type="button" variant="outline" size="sm"
                onClick={() => printQuotePdf(bom, project.project_name, companyName, customerName, customerEmail, validUntil, ref, pricing)}
                className="text-xs gap-1 bg-white border-sky-300 text-sky-700 hover:bg-sky-50">
                <Printer className="w-3.5 h-3.5" /> Customer PDF
              </Button>
            )}
          </div>
        </div>

        {/* Progress stepper */}
        <div className="px-5 py-3 border-b border-slate-100 bg-white flex items-center gap-0 overflow-x-auto">
          {FLOW.map((s, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            const sc = STATUS_CONFIG[s];
            return (
              <div key={s} className="flex items-center shrink-0">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                  done   ? 'text-emerald-700 bg-emerald-50' :
                  active ? `${sc.color} ${sc.bg}` :
                           'text-slate-300 bg-transparent'
                }`}>
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                    done   ? 'bg-emerald-500 text-white' :
                    active ? `${sc.dot} text-white` :
                             'bg-slate-200 text-slate-400'
                  }`}>
                    {done ? '✓' : i + 1}
                  </div>
                  {sc.label}
                </div>
                {i < FLOW.length - 1 && (
                  <div className={`w-8 h-px mx-1 ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>

        <div className="p-5 space-y-5 bg-white">
          {/* ── Quote summary ── */}
          {hasBom && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-center">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-1">Line Items</p>
                <p className="text-xl font-black text-slate-900">{bom.length}</p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-center">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-1">Unconfirmed</p>
                <p className={`text-xl font-black ${unconfirmedCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {unconfirmedCount}
                </p>
              </div>
              <div className="rounded-xl bg-sky-50 border border-sky-100 px-4 py-3 text-center">
                <p className="text-[10px] font-bold uppercase text-sky-500 tracking-widest mb-1">Grand Total</p>
                <p className="text-xl font-black text-sky-900">{fmt(grandTotal)}</p>
              </div>
            </div>
          )}

          {/* ── Readiness checklist ── */}
          <div>
            <button
              onClick={() => setShowChecklist(v => !v)}
              className="flex items-center gap-2 text-xs font-bold text-slate-600 mb-2 hover:text-slate-900 transition-colors"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Readiness checklist ({readyCount}/{checks.length})
              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                readyCount === checks.length ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {readyCount === checks.length ? 'Ready' : `${checks.length - readyCount} issue${checks.length - readyCount > 1 ? 's' : ''}`}
              </span>
            </button>
            {showChecklist && (
              <div className="space-y-1.5">
                {checks.map((c, i) => <CheckItem key={i} ok={c.ok} label={c.label} detail={c.detail} />)}
              </div>
            )}
          </div>

          {/* ── Customer details ── */}
          {!isSent && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest flex items-center gap-1.5">
                <User className="w-3 h-3" /> Customer / Recipient Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                    <User className="w-3 h-3" /> Customer Name
                  </Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)}
                    placeholder="e.g. John & Sarah Smith"
                    className="h-9 text-sm bg-white border-slate-200 rounded-lg" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Email Address
                  </Label>
                  <Input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)}
                    placeholder="customer@email.com"
                    className="h-9 text-sm bg-white border-slate-200 rounded-lg" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Phone
                  </Label>
                  <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="(555) 000-0000"
                    className="h-9 text-sm bg-white border-slate-200 rounded-lg" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" /> Quote Valid Until
                  </Label>
                  <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                    className="h-9 text-sm bg-white border-slate-200 rounded-lg" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Project / Delivery Address
                  </Label>
                  <Input value={customerAddr} onChange={e => setCustomerAddr(e.target.value)}
                    placeholder="123 Main St, City, State ZIP"
                    className="h-9 text-sm bg-white border-slate-200 rounded-lg" />
                </div>
              </div>
              <p className="text-[10px] text-slate-400 flex items-center gap-1">
                <Info className="w-3 h-3 shrink-0" />
                These details appear on the customer PDF. Not stored — fill in before printing.
              </p>
            </div>
          )}

          {/* ── Note / suggestion field ── */}
          {!isSent && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <MessageSquare className="w-3.5 h-3.5" />
                Review note (saved with status change)
              </div>
              <textarea
                rows={2}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={
                  status === 'draft'     ? 'e.g. Double-check crown moulding qty in Kitchen before review' :
                  status === 'in_review' ? 'e.g. Pricing verified — all SKUs confirmed. Ready to approve.' :
                                          'e.g. Sent by email to client on ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 placeholder:text-slate-300 resize-none focus:outline-none focus:ring-1 focus:ring-sky-300"
              />
            </div>
          )}

          {/* ── Error display ── */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Action row ── */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2">
              {prevStatus && (
                <Button type="button" variant="outline" size="sm"
                  disabled={isPending}
                  onClick={() => move(prevStatus)}
                  className="text-xs gap-1 border-slate-200 text-slate-500 hover:bg-slate-50">
                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  {REVERT_LABEL[status]}
                </Button>
              )}
              {history.length > 0 && (
                <button
                  onClick={() => setShowHistory(v => !v)}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors">
                  <History className="w-3.5 h-3.5" />
                  {history.length} update{history.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isSent && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-sky-700 bg-sky-100 px-3 py-1.5 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Sent to Client
                </span>
              )}
              {nextStatus && (
                <Button type="button" size="sm"
                  disabled={isPending || !canAdvance}
                  onClick={() => move(nextStatus)}
                  title={!hasBom ? 'Generate BOM first' : !canAdvance ? `${unconfirmedCount} prices need confirmation` : undefined}
                  className={`text-sm px-4 py-2 gap-1.5 font-semibold rounded-xl ${
                    nextStatus === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200' :
                    nextStatus === 'sent'     ? 'bg-sky-600 hover:bg-sky-700 text-white shadow-lg shadow-sky-200' :
                                               'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-200'
                  }`}>
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                  {NEXT_LABEL[status]}
                </Button>
              )}
            </div>
          </div>

          {/* ── Review history ── */}
          {showHistory && history.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 divide-y divide-slate-100 overflow-hidden">
              <p className="px-4 py-2 text-xs font-bold text-slate-500 flex items-center gap-1.5 bg-white">
                <History className="w-3.5 h-3.5" /> Review history
              </p>
              {[...history].reverse().map((h, i) => (
                <div key={i} className="px-4 py-3 space-y-1 bg-white">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      STATUS_CONFIG[h.status]?.bg ?? 'bg-slate-50'
                    } ${STATUS_CONFIG[h.status]?.border ?? 'border-slate-200'} ${STATUS_CONFIG[h.status]?.color ?? 'text-slate-600'}`}>
                      {STATUS_CONFIG[h.status]?.label ?? h.status}
                    </span>
                    <span className="text-xs text-slate-600 font-medium">{shortName(h.by)}</span>
                    <span className="text-[10px] text-slate-300 ml-auto">{timeAgo(h.at)}</span>
                  </div>
                  {h.note && (
                    <p className="text-xs text-slate-600 pl-3 border-l-2 border-slate-200">"{h.note}"</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {!hasBom && (
            <p className="text-xs text-slate-400 text-center py-2">Generate the BOM first — then come back here to review and approve.</p>
          )}
        </div>
      </div>
    </div>
  );
}
