'use client';

import { useState, useTransition, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, LayoutDashboard, FileImage, Package, DollarSign,
  FileText, MessageSquare, History, CheckCircle2, Clock, AlertTriangle,
  Send, XCircle, Loader2, Shield, ExternalLink, Printer,
  FileSpreadsheet, ChevronRight, AlertCircle, RefreshCcw,
  Factory, MapPin, User, Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  setReviewStatusAction, updateBomItemAction,
  type ReviewStatus, type QuotationReviewEntry,
} from '@/app/quotation-ai/actions';

// ─── Types ─────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'blueprint' | 'bom' | 'pricing' | 'proposal' | 'comments' | 'history';

interface ManualChecks {
  measurements_verified: boolean;
  skus_checked: boolean;
  uncertainties_resolved: boolean;
  manufacturer_verified: boolean;
  pricing_verified: boolean;
  customer_verified: boolean;
  margins_hidden: boolean;
  version_saved: boolean;
}

const DEFAULT_CHECKS: ManualChecks = {
  measurements_verified: false,
  skus_checked: false,
  uncertainties_resolved: false,
  manufacturer_verified: false,
  pricing_verified: false,
  customer_verified: false,
  margins_hidden: false,
  version_saved: false,
};

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ReviewStatus, {
  label: string; color: string; bg: string; border: string; dot: string;
}> = {
  draft:              { label: 'Draft',              color: 'text-slate-600',   bg: 'bg-white',       border: 'border-slate-200',  dot: 'bg-slate-300' },
  in_review:          { label: 'In Review',          color: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200',  dot: 'bg-amber-400' },
  changes_requested:  { label: 'Changes Requested',  color: 'text-orange-700',  bg: 'bg-orange-50',   border: 'border-orange-200', dot: 'bg-orange-500' },
  approved:           { label: 'Approved',           color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200',dot: 'bg-emerald-500' },
  sent:               { label: 'Sent to Client',     color: 'text-sky-700',     bg: 'bg-sky-50',      border: 'border-sky-200',    dot: 'bg-sky-500' },
  accepted:           { label: 'Accepted',           color: 'text-violet-700',  bg: 'bg-violet-50',   border: 'border-violet-200', dot: 'bg-violet-500' },
  rejected:           { label: 'Rejected',           color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200',    dot: 'bg-red-500' },
};

const WORKFLOW: { status: ReviewStatus; label: string }[] = [
  { status: 'draft',             label: 'Draft' },
  { status: 'in_review',        label: 'In Review' },
  { status: 'approved',         label: 'Approved' },
  { status: 'sent',             label: 'Sent to Client' },
  { status: 'accepted',         label: 'Accepted' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function quoteRef(id: string) {
  return 'Q-' + id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isProvisional(p: string | null | undefined) {
  const v = (p || '').toUpperCase();
  return v.startsWith('NEAREST_DIM') || v === 'CATEGORY_AVERAGE' || v === 'MANUAL_PRICING_REQUIRED' || v === 'ESTIMATED_DOOR_DRAWER';
}

function precisionBadge(p: string | null | undefined) {
  const v = (p || '').toUpperCase();
  if (v === 'EXACT') return <span className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">Exact</span>;
  if (v === 'BRIDGED' || v === 'ALIAS') return <span className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase bg-sky-50 text-sky-700 border border-sky-200">Bridged</span>;
  if (v.startsWith('NEAREST_DIM')) return <span className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase bg-amber-50 text-amber-700 border border-amber-200">≈ Nearest</span>;
  if (v === 'CATEGORY_AVERAGE') return <span className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase bg-orange-50 text-orange-700 border border-orange-200">Category Avg</span>;
  if (v === 'MANUAL_PRICING_REQUIRED') return <span className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase bg-red-50 text-red-700 border border-red-200">Manual</span>;
  return <span className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase bg-slate-100 text-slate-500">—</span>;
}

// ─── Tabs config ─────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview',   label: 'Overview',    icon: LayoutDashboard },
  { id: 'blueprint',  label: 'Blueprint',   icon: FileImage },
  { id: 'bom',        label: 'BOM Review',  icon: Package },
  { id: 'pricing',    label: 'Pricing Audit', icon: DollarSign },
  { id: 'proposal',   label: 'Proposal',    icon: FileText },
  { id: 'comments',   label: 'Comments',    icon: MessageSquare },
  { id: 'history',    label: 'Audit Trail', icon: History },
];

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  project: any;
  bom: any[];
  manufacturerName: string;
}

export function StaffReviewClient({ project, bom: initialBom, manufacturerName }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>('overview');
  const [bom, setBom] = useState(initialBom);
  const [status, setStatus] = useState<ReviewStatus>((project.review_status ?? 'draft') as ReviewStatus);
  const [history, setHistory] = useState<QuotationReviewEntry[]>(project.review_history ?? []);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<ManualChecks>(DEFAULT_CHECKS);
  const [isPending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // ── Computed values ──────────────────────────────────────────────────────

  const billable = useMemo(() => bom.filter(i => i.is_billable !== false), [bom]);
  const unconfirmedCount = useMemo(
    () => billable.filter(i => isProvisional(i.precision_level) && !i.price_confirmed).length,
    [billable],
  );
  const grandTotal = useMemo(() => bom.reduce((s, i) => s + (i.line_total ?? 0), 0), [bom]);
  const rooms = useMemo(() => [...new Set(bom.map(i => i.room).filter(Boolean))], [bom]);
  const extractedRooms: any[] = project.extracted_data?.rooms ?? [];

  // Auto checklist items
  const autoChecks = {
    bom_generated:         bom.length > 0,
    prices_confirmed:      unconfirmedCount === 0,
    manufacturer_selected: !!project.manufacturer_id,
    blueprint_attached:    !!project.has_blueprint,
  };

  const totalChecksOk =
    Object.values(autoChecks).filter(Boolean).length +
    Object.values(checks).filter(Boolean).length;
  const totalChecks = 8;

  // ── Actions ───────────────────────────────────────────────────────────────

  async function advanceStatus(next: ReviewStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setReviewStatusAction(project.id, next, note);
      if (!res.success) {
        setError(res.error);
        return;
      }
      const entry: QuotationReviewEntry = {
        status: next, by: 'Staff', at: new Date().toISOString(), note: note.trim(),
      };
      setHistory(h => [...h, entry]);
      setStatus(next);
      setNote('');
      toast({ title: `Status → ${STATUS_CONFIG[next].label}` });
      router.refresh();
    });
  }

  async function confirmBomItem(id: string) {
    setConfirmingId(id);
    const res = await updateBomItemAction(id, { price_confirmed: true });
    setConfirmingId(null);
    if (res.success) {
      setBom(prev => prev.map(i => i.id === id ? { ...i, price_confirmed: true } : i));
      toast({ title: 'Price confirmed' });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
    }
  }

  // ── Export helpers ────────────────────────────────────────────────────────

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const rows: (string | number)[][] = [
      ['KABS Inc. — Cabinet Quotation'],
      [`Project: ${project.project_name}`],
      [`Ref: ${quoteRef(project.id)}`],
      [`Date: ${new Date().toLocaleDateString()}`],
      [],
      ['Room', 'SKU', 'Description', 'Match', 'Qty', 'Unit Price', 'Line Total', 'Confirmed'],
      ...bom.map(i => [
        i.room || '', i.sku, i.description || '',
        (i.precision_level || '').toUpperCase(),
        i.quantity,
        +(i.sell_price ?? i.list_price ?? 0).toFixed(2),
        +(i.line_total ?? 0).toFixed(2),
        i.price_confirmed ? 'Yes' : 'No',
      ]),
      [],
      ['', '', '', '', '', 'Grand Total', +grandTotal.toFixed(2)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [16, 14, 36, 18, 6, 12, 14, 10].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOM');
    XLSX.writeFile(wb, `${project.project_name.replace(/[^a-z0-9]/gi, '-')}-staff-review.xlsx`);
  }

  function printProposal() {
    const ref = quoteRef(project.id);
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const rows = bom.filter(i => i.is_billable !== false).map(i => `
      <tr>
        <td class="room">${i.room || '—'}</td>
        <td class="mono">${i.sku}</td>
        <td>${i.description || '—'}</td>
        <td class="right">${i.quantity}</td>
        <td class="mono right">${fmt(i.sell_price ?? i.list_price ?? 0)}</td>
        <td class="mono right bold">${fmt(i.line_total ?? 0)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>${ref} — Quotation</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#0f172a;padding:36px;}
      .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #0f172a;}
      .co{font-size:22px;font-weight:900;letter-spacing:-.5px;}
      .co small{display:block;font-size:10px;font-weight:400;color:#64748b;margin-top:2px;}
      .meta{text-align:right;font-size:10px;color:#64748b;line-height:1.6;}
      .ref{font-size:13px;font-weight:800;color:#0f172a;}
      table{width:100%;border-collapse:collapse;margin-top:8px;}
      thead tr{background:#f8fafc;}
      th{text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;}
      td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:10.5px;}
      .room{color:#94a3b8;font-size:10px;} .mono{font-family:'Courier New',monospace;} .right{text-align:right;} .bold{font-weight:700;}
      .totals{margin-top:16px;display:flex;justify-content:flex-end;}
      .totals table{width:260px;}
      .totals td{border:none;padding:3px 8px;color:#475569;}
      .totals .final td{font-weight:900;font-size:14px;color:#0f172a;border-top:2px solid #0f172a;padding-top:8px;}
      .footer{margin-top:32px;border-top:1px solid #e2e8f0;padding-top:12px;font-size:9px;color:#94a3b8;line-height:1.6;}
      @media print{body{padding:20px;}@page{margin:1.5cm;size:A4;}}
    </style></head><body>
    <div class="header">
      <div><div class="co">KABS Inc.<small>Professional Cabinet Quotation</small></div></div>
      <div class="meta"><div class="ref">${ref}</div><div>Date: ${date}</div><div>${project.project_name}</div></div>
    </div>
    <p style="font-size:11px;color:#64748b;margin-bottom:12px;">Manufacturer: ${manufacturerName || '—'}</p>
    <table>
      <thead><tr><th>Room</th><th>SKU</th><th>Description</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals"><table>
      <tr><td>Subtotal</td><td class="right bold mono">${fmt(grandTotal)}</td></tr>
      <tr class="final"><td>Grand Total</td><td class="right mono">${fmt(grandTotal)}</td></tr>
    </table></div>
    <div class="footer">This quotation is valid for 30 days. Generated by KABS Quotation AI.</div>
    </body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); setTimeout(() => iframe.remove(), 2000); }, 400);
  }

  // ── Current status config ─────────────────────────────────────────────────

  const sc = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const workflowIdx = WORKFLOW.findIndex(w => w.status === status);

  // ── Render helpers ────────────────────────────────────────────────────────

  function CheckRow({ ok, label, detail, manual, field }: {
    ok: boolean; label: string; detail?: string; manual?: boolean; field?: keyof ManualChecks;
  }) {
    return (
      <div
        className={`flex items-start gap-2.5 py-2 px-3 rounded-lg cursor-pointer select-none transition-colors ${
          ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50/70 text-amber-800'
        } ${manual ? 'hover:bg-opacity-80' : ''}`}
        onClick={() => {
          if (manual && field) setChecks(c => ({ ...c, [field]: !c[field] }));
        }}
      >
        {ok
          ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
          : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />}
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold">{label}</span>
          {detail && <span className="text-[11px] ml-1.5 opacity-60">— {detail}</span>}
        </div>
        {manual && (
          <span className="text-[9px] font-black uppercase tracking-wider opacity-40 shrink-0">
            {ok ? 'Verified ✓' : 'Click to verify'}
          </span>
        )}
      </div>
    );
  }

  // ── Tabs render ───────────────────────────────────────────────────────────

  function renderOverview() {
    const canApprove = totalChecksOk === totalChecks;
    return (
      <div className="space-y-6">
        {/* Status card */}
        <div className={`rounded-2xl border ${sc.border} ${sc.bg} overflow-hidden`}>
          <div className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${sc.dot}`} />
              <span className={`font-black text-sm ${sc.color}`}>{sc.label}</span>
              <span className="text-[10px] font-mono text-slate-400">{quoteRef(project.id)}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/quotation-ai/bom/${project.id}`}>
                <Button variant="outline" size="sm" className="h-8 rounded-xl border-slate-200 text-slate-600 text-xs font-bold">
                  <ExternalLink className="w-3 h-3 mr-1.5" /> BOM Manager
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={exportExcel} className="h-8 rounded-xl border-slate-200 text-slate-600 text-xs font-bold">
                <FileSpreadsheet className="w-3 h-3 mr-1.5" /> Export Excel
              </Button>
            </div>
          </div>

          {/* 6-step workflow stepper */}
          <div className="px-6 pb-5 pt-1">
            <div className="flex items-center gap-0 overflow-x-auto pb-1">
              {WORKFLOW.map((w, i) => {
                const wSc = STATUS_CONFIG[w.status];
                const done = workflowIdx > i;
                const active = workflowIdx === i;
                return (
                  <div key={w.status} className="flex items-center shrink-0">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                      done ? 'text-emerald-700' : active ? `${wSc.color} bg-white/70` : 'text-slate-300'
                    }`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                        done ? 'bg-emerald-500 text-white' : active ? `${wSc.dot} text-white` : 'bg-slate-200 text-slate-400'
                      }`}>{done ? '✓' : i + 1}</span>
                      {w.label}
                    </div>
                    {i < WORKFLOW.length - 1 && (
                      <div className={`w-6 h-px mx-0.5 ${done ? 'bg-emerald-200' : 'bg-slate-200'}`} />
                    )}
                  </div>
                );
              })}
              {/* Changes Requested branch */}
              {status === 'changes_requested' && (
                <div className="ml-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-orange-50 text-orange-700 text-[11px] font-bold border border-orange-200">
                  <RefreshCcw className="w-3.5 h-3.5" />
                  Changes Requested
                </div>
              )}
              {status === 'rejected' && (
                <div className="ml-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-red-50 text-red-700 text-[11px] font-bold border border-red-200">
                  <XCircle className="w-3.5 h-3.5" />
                  Rejected
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Line Items', value: bom.length, sub: `${rooms.length} rooms`, color: 'text-slate-900' },
            { label: 'Unconfirmed', value: unconfirmedCount, sub: 'need review', color: unconfirmedCount > 0 ? 'text-amber-600' : 'text-emerald-600' },
            { label: 'Manufacturer', value: manufacturerName || '—', sub: project.project_name, color: 'text-sky-700', small: true },
            { label: 'Grand Total', value: fmt(grandTotal), sub: 'cabinet materials', color: 'text-sky-700', small: true },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
              <p className={`${s.small ? 'text-base' : 'text-2xl'} font-black ${s.color} leading-tight`}>{s.value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Pre-approval checklist */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-black uppercase tracking-widest text-slate-600">Pre-Approval Checklist</span>
            </div>
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
              totalChecksOk === totalChecks ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>{totalChecksOk}/{totalChecks}</span>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-3 mb-2">Auto-verified</p>
            <CheckRow ok={autoChecks.bom_generated}         label="BOM generated"         detail={`${bom.length} line items`} />
            <CheckRow ok={autoChecks.prices_confirmed}      label="All prices confirmed"  detail={unconfirmedCount > 0 ? `${unconfirmedCount} still provisional` : 'All confirmed'} />
            <CheckRow ok={autoChecks.manufacturer_selected} label="Manufacturer selected"  detail={manufacturerName || '—'} />
            <CheckRow ok={autoChecks.blueprint_attached}    label="Blueprint / plan attached" detail={project.has_blueprint ? 'Available' : 'Not uploaded'} />

            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-3 mt-4 mb-2">Staff verification (click to confirm)</p>
            <CheckRow ok={checks.measurements_verified}  label="Blueprint measurements & room quantities verified"    manual field="measurements_verified" />
            <CheckRow ok={checks.skus_checked}           label="All cabinet SKUs & substitutions checked"             manual field="skus_checked" />
            <CheckRow ok={checks.uncertainties_resolved} label="Unmatched / uncertain items resolved or hold-documented" manual field="uncertainties_resolved" />
            <CheckRow ok={checks.manufacturer_verified}  label="Manufacturer, door style, species & finish verified"  manual field="manufacturer_verified" />
            <CheckRow ok={checks.pricing_verified}       label="Pricing, discounts, gross margin & charges verified"  manual field="pricing_verified" />
            <CheckRow ok={checks.customer_verified}      label="Customer details, terms & final amount verified"      manual field="customer_verified" />
            <CheckRow ok={checks.margins_hidden}         label="Internal cost & margin hidden from customer PDF"      manual field="margins_hidden" />
            <CheckRow ok={checks.version_saved}          label="Final quotation version & reviewer notes saved"       manual field="version_saved" />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Note */}
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Review note (saved with status change)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
            rows={3}
            placeholder="e.g. All SKUs verified — approved for client proposal."
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          {status === 'draft' && (
            <Button onClick={() => advanceStatus('in_review')} disabled={isPending || !autoChecks.bom_generated}
              className="gradient-button h-11 px-6 font-bold text-sm">
              {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ChevronRight className="w-4 h-4 mr-2" />}
              Submit for Staff Review
            </Button>
          )}
          {status === 'in_review' && (
            <>
              <Button onClick={() => advanceStatus('approved')} disabled={isPending || !canApprove}
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-11 px-6 font-bold text-sm">
                {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Approve Quote
              </Button>
              <Button onClick={() => advanceStatus('changes_requested')} disabled={isPending} variant="outline"
                className="h-11 px-5 border-orange-300 text-orange-700 hover:bg-orange-50 font-bold text-sm">
                <RefreshCcw className="w-4 h-4 mr-2" />
                Request Changes
              </Button>
              <Button onClick={() => advanceStatus('draft')} disabled={isPending} variant="ghost"
                className="h-11 px-4 text-slate-500 text-sm">
                Back to Draft
              </Button>
            </>
          )}
          {status === 'changes_requested' && (
            <>
              <Button onClick={() => advanceStatus('in_review')} disabled={isPending}
                className="gradient-button h-11 px-6 font-bold text-sm">
                {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Resubmit for Review
              </Button>
              <Button onClick={() => advanceStatus('draft')} disabled={isPending} variant="ghost"
                className="h-11 px-4 text-slate-500 text-sm">
                Back to Draft
              </Button>
            </>
          )}
          {status === 'approved' && (
            <>
              <Button onClick={() => advanceStatus('sent')} disabled={isPending}
                className="bg-sky-600 hover:bg-sky-700 text-white h-11 px-6 font-bold text-sm">
                {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Mark as Sent to Client
              </Button>
              <Button onClick={printProposal} variant="outline"
                className="h-11 px-5 border-slate-200 text-slate-600 font-bold text-sm">
                <Printer className="w-4 h-4 mr-2" /> Print Customer Proposal
              </Button>
              <Button onClick={() => advanceStatus('in_review')} disabled={isPending} variant="ghost"
                className="h-11 px-4 text-slate-500 text-sm">
                Back to Review
              </Button>
            </>
          )}
          {status === 'sent' && (
            <>
              <Button onClick={() => advanceStatus('accepted')} disabled={isPending}
                className="bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 font-bold text-sm">
                {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Mark as Accepted by Client
              </Button>
              <Button onClick={() => advanceStatus('rejected')} disabled={isPending} variant="outline"
                className="h-11 px-5 border-red-300 text-red-700 hover:bg-red-50 font-bold text-sm">
                <XCircle className="w-4 h-4 mr-2" /> Mark as Rejected
              </Button>
            </>
          )}
          {(status === 'accepted' || status === 'rejected') && (
            <div className={`px-4 py-2 rounded-xl text-sm font-bold ${sc.color} ${sc.bg} border ${sc.border}`}>
              {sc.label} — quotation closed.
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderBlueprint() {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-bold text-slate-900">{project.project_name}</p>
            <p className="text-xs text-slate-500 mt-0.5">Blueprint status: {project.has_blueprint ? '✅ Attached' : '⚠️ Not uploaded'}</p>
          </div>
          <div className="flex gap-3">
            <Link href={`/quotation-ai/review/${project.id}`} target="_blank">
              <Button variant="outline" size="sm" className="h-9 rounded-xl border-sky-200 text-sky-700 font-bold text-xs">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open AI Extraction View
              </Button>
            </Link>
          </div>
        </div>

        {/* Room breakdown from extracted data */}
        {extractedRooms.length > 0 ? (
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 px-1">Room-wise extraction summary ({extractedRooms.length} rooms)</h3>
            {extractedRooms.map((room: any, i: number) => {
              const cabCount = (room.cabinets || []).reduce((s: number, c: any) => s + (c.quantity || 1), 0);
              const hwCount = (room.hardware || []).reduce((s: number, c: any) => s + (c.quantity || 1), 0);
              const bomRoom = bom.filter(b => b.room === room.room_name);
              const bomTotal = bomRoom.reduce((s, b) => s + (b.line_total ?? 0), 0);
              return (
                <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-sky-400" />
                      <h4 className="font-bold text-slate-900">{room.room_name}</h4>
                      {room.collection && <span className="text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full font-bold">{room.collection}</span>}
                      {room.door_style && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold">{room.door_style}</span>}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-sky-700">{fmt(bomTotal)}</p>
                      <p className="text-[10px] text-slate-400">{bomRoom.length} BOM lines</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    {[
                      { label: 'Cabinets', value: cabCount },
                      { label: 'Hardware', value: hwCount },
                      { label: 'BOM Lines', value: bomRoom.length },
                      { label: 'Unconfirmed', value: bomRoom.filter(b => isProvisional(b.precision_level) && !b.price_confirmed).length },
                    ].map(s => (
                      <div key={s.label} className="bg-slate-50 rounded-xl py-3">
                        <p className="text-xl font-black text-slate-900">{s.value}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-400">
            <FileImage className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-bold">No room data extracted yet</p>
          </div>
        )}
      </div>
    );
  }

  function renderBOM() {
    const byRoom: Record<string, any[]> = {};
    bom.forEach(i => { const r = i.room || 'Unassigned'; if (!byRoom[r]) byRoom[r] = []; byRoom[r].push(i); });
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">{bom.length} line items across {Object.keys(byRoom).length} rooms</p>
            {unconfirmedCount > 0 && (
              <p className="text-xs text-amber-600 font-bold mt-0.5">{unconfirmedCount} items need price confirmation</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-8 rounded-xl border-slate-200 text-slate-600 text-xs font-bold">
            <FileSpreadsheet className="w-3 h-3 mr-1.5" /> Export
          </Button>
        </div>

        {Object.entries(byRoom).map(([roomName, items]) => (
          <div key={roomName} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-xs font-black uppercase tracking-widest text-slate-700">{roomName}</span>
                <span className="text-[10px] text-slate-400">({items.length} items)</span>
              </div>
              <span className="text-xs font-bold text-sky-700">{fmt(items.reduce((s, i) => s + (i.line_total ?? 0), 0))}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 py-2 font-black uppercase tracking-wider text-slate-400">SKU</th>
                    <th className="text-left px-4 py-2 font-black uppercase tracking-wider text-slate-400">Description</th>
                    <th className="text-center px-4 py-2 font-black uppercase tracking-wider text-slate-400">Match</th>
                    <th className="text-right px-4 py-2 font-black uppercase tracking-wider text-slate-400">Qty</th>
                    <th className="text-right px-4 py-2 font-black uppercase tracking-wider text-slate-400">Unit Price</th>
                    <th className="text-right px-4 py-2 font-black uppercase tracking-wider text-slate-400">Total</th>
                    <th className="text-center px-4 py-2 font-black uppercase tracking-wider text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const provisional = isProvisional(item.precision_level);
                    const confirmed = item.price_confirmed;
                    return (
                      <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${provisional && !confirmed ? 'bg-amber-50/30' : ''}`}>
                        <td className="px-4 py-2.5 font-mono font-bold text-slate-900">{item.sku}</td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate" title={item.description}>{item.description || '—'}</td>
                        <td className="px-4 py-2.5 text-center">{precisionBadge(item.precision_level)}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-slate-900">{item.quantity}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-700">{fmt(item.sell_price ?? item.list_price ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">{fmt(item.line_total ?? 0)}</td>
                        <td className="px-4 py-2.5 text-center">
                          {confirmed ? (
                            <span className="text-[9px] font-black bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full border border-emerald-200">✓ Confirmed</span>
                          ) : provisional ? (
                            <button
                              onClick={() => confirmBomItem(item.id)}
                              disabled={confirmingId === item.id}
                              className="text-[9px] font-black bg-amber-50 text-amber-700 px-2 py-1 rounded-full border border-amber-200 hover:bg-amber-100 transition-colors"
                            >
                              {confirmingId === item.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Confirm price'}
                            </button>
                          ) : (
                            <span className="text-[9px] text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderPricing() {
    const byRoom: Record<string, number> = {};
    bom.forEach(i => { if (i.room) byRoom[i.room] = (byRoom[i.room] ?? 0) + (i.line_total ?? 0); });

    const totalList = bom.reduce((s, i) => s + ((i.list_price ?? 0) * i.quantity), 0);
    const totalSell = grandTotal;
    const totalCost = bom.reduce((s, i) => s + ((i.unit_cost ?? 0) * i.quantity), 0);
    const margin = totalCost > 0 ? ((totalSell - totalCost) / totalSell) * 100 : 0;
    const negativeMargIn = bom.filter(i => (i.unit_cost ?? 0) * i.quantity > (i.line_total ?? 0));

    return (
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'List Price Total', value: fmt(totalList), sub: 'catalog list', color: 'text-slate-900' },
            { label: 'Sell Total', value: fmt(totalSell), sub: 'after factor', color: 'text-sky-700' },
            { label: 'Est. Cost', value: fmt(totalCost), sub: 'internal only', color: 'text-slate-500' },
            { label: 'Gross Margin', value: `${margin.toFixed(1)}%`, sub: 'on sell price', color: margin < 20 ? 'text-red-600' : margin < 30 ? 'text-amber-600' : 'text-emerald-600' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
              <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Margin warning */}
        {margin < 20 && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Warning: Gross margin below 20% — review pricing factor and discounts.
          </div>
        )}

        {/* Negative-margin items */}
        {negativeMargIn.length > 0 && (
          <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-red-50 border-b border-red-100">
              <p className="text-xs font-black uppercase tracking-widest text-red-700">Negative-Margin Items ({negativeMargIn.length})</p>
            </div>
            <div className="p-4 space-y-2">
              {negativeMargIn.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs text-red-800">
                  <span className="font-mono font-bold">{i.sku}</span>
                  <span>Cost: {fmt((i.unit_cost ?? 0) * i.quantity)} &gt; Sell: {fmt(i.line_total ?? 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* By room */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
            <p className="text-xs font-black uppercase tracking-widest text-slate-600">Room-wise Breakdown</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-2 font-black uppercase tracking-wider text-slate-400">Room</th>
                <th className="text-right px-5 py-2 font-black uppercase tracking-wider text-slate-400">Sell Total</th>
                <th className="text-right px-5 py-2 font-black uppercase tracking-wider text-slate-400">% of Quote</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byRoom).map(([room, total]) => (
                <tr key={room} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-2.5 font-bold text-slate-900">{room}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-sky-700 font-bold">{fmt(total)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-500">{grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className="px-5 py-3 text-slate-900">Total</td>
                <td className="px-5 py-3 text-right font-mono text-slate-900">{fmt(grandTotal)}</td>
                <td className="px-5 py-3 text-right text-slate-500">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderProposal() {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Customer-facing proposal — internal cost and margin are not shown.</p>
          <div className="flex gap-2">
            {(status === 'approved' || status === 'sent' || status === 'accepted') && (
              <Button onClick={printProposal} size="sm" className="h-9 rounded-xl gradient-button text-xs font-bold">
                <Printer className="w-3.5 h-3.5 mr-1.5" /> Print / Download PDF
              </Button>
            )}
          </div>
        </div>

        {/* Preview card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="bg-slate-900 text-white px-8 py-6 flex justify-between items-start">
            <div>
              <p className="text-xl font-black">KABS Inc.</p>
              <p className="text-slate-400 text-xs mt-1">Professional Cabinet Quotation</p>
            </div>
            <div className="text-right">
              <p className="font-mono font-black text-lg">{quoteRef(project.id)}</p>
              <p className="text-slate-400 text-xs">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          </div>

          {/* Project info */}
          <div className="px-8 py-4 border-b border-slate-100 bg-slate-50">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Project</p>
                <p className="font-bold text-slate-900">{project.project_name}</p>
                {manufacturerName && <p className="text-xs text-slate-500 mt-0.5"><Factory className="w-3 h-3 inline mr-1" />{manufacturerName}</p>}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Prepared by</p>
                <p className="font-bold text-slate-900">KABS Inc.</p>
              </div>
            </div>
          </div>

          {/* BOM table — customer-facing (no cost/margin) */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-5 py-2.5 font-black uppercase tracking-wider text-slate-500">Room</th>
                  <th className="text-left px-5 py-2.5 font-black uppercase tracking-wider text-slate-500">SKU</th>
                  <th className="text-left px-5 py-2.5 font-black uppercase tracking-wider text-slate-500">Description</th>
                  <th className="text-right px-5 py-2.5 font-black uppercase tracking-wider text-slate-500">Qty</th>
                  <th className="text-right px-5 py-2.5 font-black uppercase tracking-wider text-slate-500">Unit Price</th>
                  <th className="text-right px-5 py-2.5 font-black uppercase tracking-wider text-slate-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {bom.filter(i => i.is_billable !== false).map((item, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-2 text-slate-500">{item.room || '—'}</td>
                    <td className="px-5 py-2 font-mono font-bold text-slate-900">{item.sku}</td>
                    <td className="px-5 py-2 text-slate-600">{item.description || '—'}</td>
                    <td className="px-5 py-2 text-right font-bold">{item.quantity}</td>
                    <td className="px-5 py-2 text-right font-mono">{fmt(item.sell_price ?? item.list_price ?? 0)}</td>
                    <td className="px-5 py-2 text-right font-mono font-bold">{fmt(item.line_total ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-8 py-5 flex justify-end border-t border-slate-100">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Cabinet Materials</span>
                <span className="font-mono">{fmt(grandTotal)}</span>
              </div>
              <div className="flex justify-between font-black text-slate-900 pt-2 border-t border-slate-200">
                <span>Grand Total</span>
                <span className="font-mono text-sky-700">{fmt(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-slate-50 border-t border-slate-100">
            <p className="text-[10px] text-slate-400 leading-relaxed">
              This quotation is valid for 30 days from the date of issue. Prices are subject to change without notice.
              All orders are subject to KABS Inc. standard terms and conditions. Generated by KABS Quotation AI.
            </p>
          </div>
        </div>

        {status !== 'approved' && status !== 'sent' && status !== 'accepted' && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Quote must be <strong className="mx-1">Approved</strong> before the customer PDF can be printed.
          </div>
        )}
      </div>
    );
  }

  function renderComments() {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
            <p className="text-xs font-black uppercase tracking-widest text-slate-600">Add Note</p>
          </div>
          <div className="p-5 space-y-3">
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-400"
              rows={3}
              placeholder="Add a review note, correction request, or issue description…"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => advanceStatus('in_review')} disabled={isPending || !note.trim() || status !== 'in_review'}
                className="h-8 rounded-xl gradient-button text-xs font-bold">
                Save Note
              </Button>
              <Button size="sm" variant="outline" onClick={() => advanceStatus('changes_requested')} disabled={isPending || !note.trim() || status !== 'in_review'}
                className="h-8 rounded-xl border-orange-200 text-orange-700 hover:bg-orange-50 text-xs font-bold">
                <RefreshCcw className="w-3 h-3 mr-1" /> Request Changes
              </Button>
            </div>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No comments yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...history].reverse().map((entry, i) => {
              const esc = STATUS_CONFIG[entry.status as ReviewStatus] ?? STATUS_CONFIG.draft;
              return (
                <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${esc.dot}`} />
                      <span className={`text-[11px] font-bold ${esc.color}`}>{esc.label}</span>
                      <span className="text-[11px] text-slate-400">by {entry.by}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">{timeAgo(entry.at)}</span>
                  </div>
                  {entry.note ? (
                    <p className="text-sm text-slate-700 leading-relaxed">{entry.note}</p>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No note provided.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderHistory() {
    return (
      <div className="space-y-4">
        <p className="text-xs text-slate-500">Full audit trail — every status change with who made it and when.</p>
        {history.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No history yet.</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-5 top-0 bottom-0 w-px bg-slate-200" />
            <div className="space-y-4 pl-12">
              {[...history].reverse().map((entry, i) => {
                const esc = STATUS_CONFIG[entry.status as ReviewStatus] ?? STATUS_CONFIG.draft;
                return (
                  <div key={i} className="relative">
                    <div className={`absolute -left-[2.45rem] w-4 h-4 rounded-full border-2 border-white ${esc.dot} shadow-sm`} />
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-black ${esc.color}`}>{esc.label}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500"><User className="w-3 h-3 inline mr-1" />{entry.by}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 shrink-0">{new Date(entry.at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      {entry.note && <p className="text-sm text-slate-700">{entry.note}</p>}
                    </div>
                  </div>
                );
              })}
              <div className="relative">
                <div className="absolute -left-[2.45rem] w-4 h-4 rounded-full border-2 border-white bg-slate-300 shadow-sm" />
                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4">
                  <p className="text-xs text-slate-500"><Clock className="w-3 h-3 inline mr-1" /> Quotation created — <span className="font-mono">{project.project_name}</span></p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-6 h-16 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <Link href={`/quotation-ai/bom/${project.id}`}>
            <Button variant="ghost" size="icon" className="rounded-full h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900">{project.project_name}</h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Staff Review Workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${sc.border} ${sc.bg} ${sc.color}`}>
            <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
            {sc.label}
          </div>
          {manufacturerName && (
            <span className="text-[10px] font-bold text-slate-500 hidden sm:block"><Factory className="w-3 h-3 inline mr-1" />{manufacturerName}</span>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <div className="sticky top-16 z-40 bg-white border-b border-slate-100 px-6 overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {TABS.map(t => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-3.5 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
                  active ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {t.id === 'bom' && unconfirmedCount > 0 && (
                  <span className="ml-1 bg-amber-100 text-amber-700 text-[9px] font-black px-1.5 py-0.5 rounded-full">{unconfirmedCount}</span>
                )}
                {t.id === 'overview' && totalChecksOk < totalChecks && (
                  <span className="ml-1 bg-amber-100 text-amber-700 text-[9px] font-black px-1.5 py-0.5 rounded-full">{totalChecks - totalChecksOk}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {tab === 'overview'   && renderOverview()}
        {tab === 'blueprint'  && renderBlueprint()}
        {tab === 'bom'        && renderBOM()}
        {tab === 'pricing'    && renderPricing()}
        {tab === 'proposal'   && renderProposal()}
        {tab === 'comments'   && renderComments()}
        {tab === 'history'    && renderHistory()}
      </div>
    </div>
  );
}
