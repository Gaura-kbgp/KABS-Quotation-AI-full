'use client';

import { useState, useTransition, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Send, XCircle,
  Loader2, ChevronRight, RefreshCcw, AlertCircle,
  FileSpreadsheet, Printer, ExternalLink, Clock,
  Package, History, ChevronDown, ChevronUp, MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  setReviewStatusAction, updateBomItemAction,
  type ReviewStatus, type QuotationReviewEntry,
} from '@/app/quotation-ai/actions';

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ReviewStatus, {
  label: string; color: string; bg: string; border: string; dot: string;
}> = {
  draft:             { label: 'Draft',             color: 'text-slate-600',   bg: 'bg-slate-50',    border: 'border-slate-200',  dot: 'bg-slate-400' },
  in_review:         { label: 'In Review',         color: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200',  dot: 'bg-amber-400' },
  changes_requested: { label: 'Changes Requested', color: 'text-orange-700',  bg: 'bg-orange-50',   border: 'border-orange-200', dot: 'bg-orange-500' },
  approved:          { label: 'Approved',          color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200',dot: 'bg-emerald-500' },
  sent:              { label: 'Sent to Client',    color: 'text-sky-700',     bg: 'bg-sky-50',      border: 'border-sky-200',    dot: 'bg-sky-500' },
  accepted:          { label: 'Accepted',          color: 'text-violet-700',  bg: 'bg-violet-50',   border: 'border-violet-200', dot: 'bg-violet-500' },
  rejected:          { label: 'Rejected',          color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200',    dot: 'bg-red-500' },
};

const FLOW: ReviewStatus[] = ['draft', 'in_review', 'approved', 'sent', 'accepted'];

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function quoteRef(id: string) {
  return 'Q-' + id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
function timeStr(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function isProvisional(p: string | null | undefined) {
  const v = (p || '').toUpperCase();
  return v.startsWith('NEAREST_DIM') || v === 'CATEGORY_AVERAGE' || v === 'MANUAL_PRICING_REQUIRED' || v === 'ESTIMATED_DOOR_DRAWER';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { project: any; bom: any[]; manufacturerName: string; }

export function StaffReviewClient({ project, bom: initialBom, manufacturerName }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [bom, setBom] = useState(initialBom);
  const [status, setStatus] = useState<ReviewStatus>((project.review_status ?? 'draft') as ReviewStatus);
  const [history, setHistory] = useState<QuotationReviewEntry[]>(project.review_history ?? []);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showBom, setShowBom] = useState(false);

  // ── Computed ──────────────────────────────────────────────────────────────

  const billable = useMemo(() => bom.filter(i => i.is_billable !== false), [bom]);
  const unconfirmed = useMemo(() => billable.filter(i => isProvisional(i.precision_level) && !i.price_confirmed), [billable]);
  const grandTotal = useMemo(() => bom.reduce((s, i) => s + (i.line_total ?? 0), 0), [bom]);
  const rooms = useMemo(() => [...new Set(bom.map(i => i.room).filter(Boolean))], [bom]);

  const sc = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const flowStep = FLOW.indexOf(FLOW.includes(status) ? status : 'draft');

  // Blockers — things preventing approval
  const blockers = [
    bom.length === 0      && { msg: 'BOM not generated yet', action: 'Generate BOM', href: `/quotation-ai/bom/${project.id}` },
    unconfirmed.length > 0 && { msg: `${unconfirmed.length} items need price confirmation`, action: 'Fix in BOM Manager', href: `/quotation-ai/bom/${project.id}` },
    !project.manufacturer_id && { msg: 'Manufacturer not selected', action: 'Go to Review', href: `/quotation-ai/review/${project.id}` },
  ].filter(Boolean) as { msg: string; action: string; href: string }[];

  const canApprove = blockers.length === 0 && status === 'in_review';

  // ── Action ────────────────────────────────────────────────────────────────

  function advance(next: ReviewStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setReviewStatusAction(project.id, next, note);
      if (!res.success) { setError(res.error); return; }
      setHistory(h => [...h, { status: next, by: 'Staff', at: new Date().toISOString(), note: note.trim() }]);
      setStatus(next);
      setNote('');
      toast({ title: `✓ ${STATUS_CONFIG[next].label}` });
      router.refresh();
    });
  }

  async function confirmItem(id: string) {
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

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['Project', project.project_name],
      ['Ref', quoteRef(project.id)],
      ['Date', new Date().toLocaleDateString()],
      [],
      ['Room', 'SKU', 'Description', 'Match', 'Qty', 'Unit Price', 'Total', 'Confirmed'],
      ...bom.map(i => [i.room || '', i.sku, i.description || '', (i.precision_level || '').toUpperCase(),
        i.quantity, +(i.sell_price ?? i.list_price ?? 0).toFixed(2), +(i.line_total ?? 0).toFixed(2), i.price_confirmed ? 'Yes' : 'No']),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOM');
    XLSX.writeFile(wb, `${project.project_name.replace(/[^a-z0-9]/gi, '-')}-review.xlsx`);
  }

  function printProposal() {
    const ref = quoteRef(project.id);
    const rows = bom.filter(i => i.is_billable !== false).map(i =>
      `<tr><td>${i.room||'—'}</td><td><b>${i.sku}</b></td><td>${i.description||'—'}</td>
       <td style="text-align:right">${i.quantity}</td>
       <td style="text-align:right">${fmt(i.sell_price??i.list_price??0)}</td>
       <td style="text-align:right"><b>${fmt(i.line_total??0)}</b></td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${ref}</title>
    <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:sans-serif;font-size:11px;padding:32px;color:#0f172a;}
    .h{display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:20px;}
    .co{font-size:20px;font-weight:900;} .ref{font-size:13px;font-weight:800;text-align:right;}
    table{width:100%;border-collapse:collapse;} th{background:#f8fafc;text-align:left;padding:5px 6px;font-size:9px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;}
    td{padding:4px 6px;border-bottom:1px solid #f1f5f9;} .tot{margin-top:12px;text-align:right;font-size:14px;font-weight:900;}
    @media print{body{padding:20px;}}</style></head><body>
    <div class="h"><div class="co">KABS Inc.<br/><small style="font-weight:400;font-size:10px;color:#64748b">Professional Cabinet Quotation</small></div>
    <div class="ref">${ref}<br/><span style="font-weight:400;font-size:10px;color:#64748b">${new Date().toLocaleDateString()}</span></div></div>
    <p style="margin-bottom:12px;font-weight:700">${project.project_name}${manufacturerName ? ` · ${manufacturerName}` : ''}</p>
    <table><thead><tr><th>Room</th><th>SKU</th><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="tot">Grand Total: ${fmt(grandTotal)}</div>
    <p style="margin-top:24px;font-size:9px;color:#94a3b8">Valid 30 days. Generated by KABS Quotation AI.</p>
    </body></html>`;
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0';
    document.body.appendChild(f);
    f.contentDocument!.open(); f.contentDocument!.write(html); f.contentDocument!.close();
    setTimeout(() => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 2000); }, 400);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-100 px-5 h-14 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <Link href={`/quotation-ai/bom/${project.id}`}>
            <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors">
              <ArrowLeft className="w-4 h-4 text-slate-600" />
            </button>
          </Link>
          <div>
            <p className="text-sm font-bold text-slate-900 leading-tight">{project.project_name}</p>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Staff Review</p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${sc.border} ${sc.bg} ${sc.color}`}>
          <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
          {sc.label}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {/* ── 1. Quote reference card ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Quote Reference</p>
            <p className="text-xl font-black text-slate-900">{quoteRef(project.id)}</p>
            <p className="text-xs text-slate-500 mt-0.5">{manufacturerName || '—'} · {rooms.length} rooms · {bom.length} items</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Grand Total</p>
            <p className="text-2xl font-black text-sky-700">{fmt(grandTotal)}</p>
          </div>
        </div>

        {/* ── 2. Workflow progress ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Progress</p>
          <div className="flex items-center gap-0 overflow-x-auto">
            {FLOW.map((s, i) => {
              const wsc = STATUS_CONFIG[s];
              const done = flowStep > i;
              const active = flowStep === i || (status === 'changes_requested' && s === 'in_review');
              return (
                <div key={s} className="flex items-center shrink-0">
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-bold ${
                    done ? 'text-emerald-700' : active ? `${wsc.color} ${wsc.bg}` : 'text-slate-300'
                  }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${
                      done ? 'bg-emerald-500 text-white' : active ? `${wsc.dot} text-white` : 'bg-slate-200 text-slate-400'
                    }`}>{done ? '✓' : i + 1}</span>
                    {wsc.label}
                    {status === 'changes_requested' && s === 'in_review' && (
                      <span className="text-[9px] text-orange-600 font-black">(Changes)</span>
                    )}
                  </div>
                  {i < FLOW.length - 1 && <div className={`w-4 h-px mx-0.5 ${done ? 'bg-emerald-200' : 'bg-slate-200'}`} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 3. Blockers (most important) ── */}
        {blockers.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 bg-amber-100 border-b border-amber-200">
              <p className="text-xs font-black uppercase tracking-wider text-amber-800">
                ⚠️ {blockers.length} item{blockers.length > 1 ? 's' : ''} need{blockers.length === 1 ? 's' : ''} attention before approval
              </p>
            </div>
            <div className="p-4 space-y-2">
              {blockers.map((b, i) => (
                <div key={i} className="flex items-center justify-between gap-3 bg-white rounded-xl px-4 py-3 border border-amber-100">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-sm text-slate-800">{b.msg}</span>
                  </div>
                  <Link href={b.href}>
                    <button className="text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-xl hover:bg-sky-100 transition-colors whitespace-nowrap">
                      {b.action} →
                    </button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 4. Unconfirmed items — inline confirm ── */}
        {unconfirmed.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowBom(v => !v)}
              className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-bold text-slate-900">Unconfirmed Prices</span>
                <span className="text-xs font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{unconfirmed.length}</span>
              </div>
              {showBom ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {showBom && (
              <div className="border-t border-slate-100">
                <div className="px-5 py-2 bg-slate-50 flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Click "Confirm" per item, or fix in BOM Manager</p>
                  <Link href={`/quotation-ai/bom/${project.id}`}>
                    <button className="text-[10px] font-bold text-sky-700 underline">Open BOM Manager</button>
                  </Link>
                </div>
                <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                  {unconfirmed.map((item) => (
                    <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono font-bold text-sm text-slate-900">{item.sku}</p>
                        <p className="text-xs text-slate-500 truncate">{item.room} · {item.description || '—'}</p>
                        <p className="text-[10px] font-bold text-amber-600 mt-0.5">
                          {(item.precision_level || '').replace(/_/g, ' ')}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-black text-slate-900">{fmt(item.line_total ?? 0)}</p>
                        <button
                          onClick={() => confirmItem(item.id)}
                          disabled={confirmingId === item.id}
                          className="mt-1 text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-100 transition-colors"
                        >
                          {confirmingId === item.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : '✓ Confirm'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 5. All confirmed ✓ ── */}
        {bom.length > 0 && unconfirmed.length === 0 && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-3.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <p className="text-sm font-bold text-emerald-800">All prices confirmed — ready for approval</p>
          </div>
        )}

        {/* ── 6. Error ── */}
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-5 py-3.5 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* ── 7. Review note ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">
            Note (optional — saved with status change)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. All SKUs verified — ready to send to client."
            className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        {/* ── 8. Primary action button ── */}
        <div className="space-y-2">
          {status === 'draft' && (
            <Button onClick={() => advance('in_review')} disabled={isPending || bom.length === 0}
              className="w-full h-14 gradient-button text-base font-bold rounded-2xl">
              {isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <ChevronRight className="w-5 h-5 mr-2" />}
              Submit for Staff Review
            </Button>
          )}

          {status === 'in_review' && (
            <>
              <Button onClick={() => advance('approved')} disabled={isPending || !canApprove}
                className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold rounded-2xl">
                {isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
                {!canApprove && blockers.length > 0 ? `Fix ${blockers.length} issue${blockers.length > 1 ? 's' : ''} above first` : 'Approve Quote'}
              </Button>
              <button onClick={() => advance('changes_requested')} disabled={isPending}
                className="w-full h-11 text-sm font-bold text-orange-700 border border-orange-200 rounded-2xl hover:bg-orange-50 transition-colors flex items-center justify-center gap-2">
                <RefreshCcw className="w-4 h-4" /> Request Changes
              </button>
              <button onClick={() => advance('draft')} disabled={isPending}
                className="w-full h-9 text-xs text-slate-400 hover:text-slate-600 transition-colors">
                ← Back to Draft
              </button>
            </>
          )}

          {status === 'changes_requested' && (
            <>
              <Button onClick={() => advance('in_review')} disabled={isPending}
                className="w-full h-14 gradient-button text-base font-bold rounded-2xl">
                {isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
                Resubmit for Review
              </Button>
              <button onClick={() => advance('draft')} disabled={isPending}
                className="w-full h-9 text-xs text-slate-400 hover:text-slate-600 transition-colors">
                ← Back to Draft
              </button>
            </>
          )}

          {status === 'approved' && (
            <>
              <Button onClick={() => advance('sent')} disabled={isPending}
                className="w-full h-14 bg-sky-600 hover:bg-sky-700 text-white text-base font-bold rounded-2xl">
                {isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
                Mark as Sent to Client
              </Button>
              <button onClick={printProposal}
                className="w-full h-11 text-sm font-bold text-slate-700 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2">
                <Printer className="w-4 h-4" /> Print Customer Proposal
              </button>
            </>
          )}

          {status === 'sent' && (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => advance('accepted')} disabled={isPending}
                className="h-12 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-2xl text-sm">
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> Accepted
              </Button>
              <button onClick={() => advance('rejected')} disabled={isPending}
                className="h-12 text-sm font-bold text-red-700 border border-red-200 rounded-2xl hover:bg-red-50 flex items-center justify-center gap-1.5">
                <XCircle className="w-4 h-4" /> Rejected
              </button>
            </div>
          )}

          {(status === 'accepted' || status === 'rejected') && (
            <div className={`text-center py-4 rounded-2xl text-sm font-bold border ${sc.border} ${sc.bg} ${sc.color}`}>
              {status === 'accepted' ? '✓ Client accepted — quotation closed.' : '✕ Client rejected — quotation closed.'}
            </div>
          )}
        </div>

        {/* ── 9. Quick links ── */}
        <div className="grid grid-cols-2 gap-3">
          <Link href={`/quotation-ai/bom/${project.id}`}>
            <button className="w-full flex items-center justify-center gap-2 h-10 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> BOM Manager
            </button>
          </Link>
          <button onClick={exportExcel}
            className="w-full flex items-center justify-center gap-2 h-10 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
          </button>
        </div>

        {/* ── 10. Review history (collapsible) ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-bold text-slate-700">Review History</span>
              <span className="text-xs text-slate-400">({history.length} entries)</span>
            </div>
            {showHistory ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {showHistory && (
            <div className="border-t border-slate-100 divide-y divide-slate-50">
              {history.length === 0 ? (
                <p className="px-5 py-4 text-xs text-slate-400">No history yet.</p>
              ) : (
                [...history].reverse().map((entry, i) => {
                  const esc = STATUS_CONFIG[entry.status as ReviewStatus] ?? STATUS_CONFIG.draft;
                  return (
                    <div key={i} className="px-5 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${esc.dot}`} />
                          <span className={`text-xs font-bold ${esc.color}`}>{esc.label}</span>
                          <span className="text-xs text-slate-400">· {entry.by}</span>
                        </div>
                        <span className="text-[10px] text-slate-400">{timeStr(entry.at)}</span>
                      </div>
                      {entry.note && <p className="text-xs text-slate-600 ml-4">{entry.note}</p>}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
