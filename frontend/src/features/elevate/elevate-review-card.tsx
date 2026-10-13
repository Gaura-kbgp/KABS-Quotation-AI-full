'use client';

import { useState, useTransition, useRef } from 'react';
import {
  CheckCircle2, Clock, Send, AlertTriangle, ChevronRight, ChevronLeft,
  FileText, Loader2, Printer, MessageSquare, RotateCcw, History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  setElevateApprovalAction,
  type ElevateApprovalStatus,
  type ReviewHistoryEntry,
  type SavedProfile,
} from './actions';
import { buildWorksheet, customerSummary, type WorksheetItem } from './pricing';
import { effectiveRules, money, type Method } from './pricing-rules-form';
import { DEFAULT_RULES } from './pricing-rules-form';

interface ElevateReviewCardProps {
  profile: SavedProfile | null;
}

const STATUS_CONFIG: Record<ElevateApprovalStatus, {
  label: string; color: string; bg: string; border: string; dot: string; icon: typeof Clock;
}> = {
  draft:     { label: 'Draft',          color: 'text-slate-600',   bg: 'bg-slate-50',   border: 'border-slate-200', dot: 'bg-slate-300',    icon: Clock },
  in_review: { label: 'In Review',      color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200', dot: 'bg-amber-400',    icon: AlertTriangle },
  approved:  { label: 'Approved',       color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2 },
  sent:      { label: 'Sent to Client', color: 'text-sky-700',     bg: 'bg-sky-50',     border: 'border-sky-200',    dot: 'bg-sky-500',     icon: Send },
};

const FLOW: ElevateApprovalStatus[] = ['draft', 'in_review', 'approved', 'sent'];

const NEXT_LABEL: Partial<Record<ElevateApprovalStatus, string>> = {
  draft:     'Start Review',
  in_review: 'Approve',
  approved:  'Mark as Sent',
};

const REVERT_LABEL: Partial<Record<ElevateApprovalStatus, string>> = {
  in_review: 'Back to Draft',
  approved:  'Back to Review',
  sent:      'Back to Approved',
};

function findExceptions(items: WorksheetItem[]): { code: string; reason: string }[] {
  return items.flatMap(item => {
    const code = item.code.trim();
    const issues: { code: string; reason: string }[] = [];
    if (!code) return issues;
    if (code.includes('?'))    issues.push({ code, reason: 'Contains uncertain character (?)' });
    else if (item.listPrice <= 0) issues.push({ code, reason: 'No list price — auto-fill or enter manually' });
    else if (item.qty <= 0)       issues.push({ code, reason: 'Quantity is zero' });
    return issues;
  });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shortName(email: string) {
  return email.split('@')[0];
}

export function ElevateReviewCard({ profile }: ElevateReviewCardProps) {
  const [status, setStatus]           = useState<ElevateApprovalStatus>(profile?.approvalStatus ?? 'draft');
  const [note, setNote]               = useState('');
  const [history, setHistory]         = useState<ReviewHistoryEntry[]>(profile?.reviewHistory ?? []);
  const [isPending, startTransition]  = useTransition();
  const [error, setError]             = useState<string | null>(null);
  const [showExceptions, setShowExceptions] = useState(false);
  const [showQuote, setShowQuote]     = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const quoteRef = useRef<HTMLDivElement>(null);

  const cfg         = STATUS_CONFIG[status];
  const Icon        = cfg.icon;
  const currentStep = FLOW.indexOf(status);
  const nextStatus  = FLOW[currentStep + 1] as ElevateApprovalStatus | undefined;
  const prevStatus  = FLOW[currentStep - 1] as ElevateApprovalStatus | undefined;

  const items: WorksheetItem[] = (profile?.items ?? []).map(i => ({
    code: i.code,
    description: i.description,
    qty: i.qty,
    listPrice: i.listPrice,
    category: 'cabinet' as const,
  }));

  const exceptions = findExceptions(items);

  let ws: ReturnType<typeof buildWorksheet> | null = null;
  try {
    if (items.length > 0) {
      ws = buildWorksheet(items, effectiveRules(profile?.rules ?? DEFAULT_RULES, profile?.method ?? 'markup'));
    }
  } catch { /* ignore */ }

  function move(toStatus: ElevateApprovalStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setElevateApprovalAction(toStatus, note);
      if (res.success) {
        setStatus(toStatus);
        const newEntry: ReviewHistoryEntry = {
          status: toStatus,
          by: profile?.approvedBy ?? 'You',
          at: new Date().toISOString(),
          note: note.trim(),
        };
        setHistory(h => [...h, newEntry]);
        setNote('');
      } else {
        setError((res as any).error ?? 'Could not update status.');
      }
    });
  }

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

  return (
    <div className={`rounded-2xl border p-5 space-y-4 ${cfg.bg} ${cfg.border}`}>

      {/* ── Header row ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className={`w-4 h-4 ${cfg.color}`} />
          <span className={`text-sm font-semibold ${cfg.color}`}>
            Staff Review: {cfg.label}
          </span>

          {exceptions.length > 0 && (
            <button
              onClick={() => setShowExceptions(v => !v)}
              className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full hover:bg-amber-200 transition-colors"
            >
              <AlertTriangle className="w-3 h-3" />
              {exceptions.length} exception{exceptions.length !== 1 ? 's' : ''}
            </button>
          )}

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
          {ws && (
            <Button type="button" variant="outline" size="sm"
              onClick={() => setShowQuote(v => !v)}
              className="text-xs gap-1 border-slate-200 text-slate-600 hover:bg-slate-100">
              <FileText className="w-3.5 h-3.5" />
              {showQuote ? 'Hide Quote' : 'Preview Quote'}
            </Button>
          )}

          {/* Revert */}
          {prevStatus && (
            <Button type="button" variant="outline" size="sm"
              disabled={isPending || !profile?.items?.length}
              onClick={() => move(prevStatus)}
              className="text-xs gap-1 border-slate-300 text-slate-600 hover:bg-slate-100">
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              {REVERT_LABEL[status]}
            </Button>
          )}

          {/* Advance */}
          {nextStatus && (
            <Button type="button" variant="outline" size="sm"
              disabled={isPending || !profile?.items?.length}
              onClick={() => move(nextStatus)}
              className={`text-xs gap-1 ${
                nextStatus === 'approved' ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' :
                nextStatus === 'sent'     ? 'border-sky-300 text-sky-700 hover:bg-sky-50' :
                                           'border-amber-300 text-amber-700 hover:bg-amber-50'
              }`}
              title={!profile?.items?.length ? 'Add items and save first' : undefined}>
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
              {NEXT_LABEL[status]}
            </Button>
          )}

          {status === 'sent' && (
            <span className="text-xs font-semibold text-sky-700 bg-sky-100 px-3 py-1 rounded-full">✓ Quote Sent</span>
          )}
        </div>
      </div>

      {/* ── Progress dots ── */}
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

      {/* ── Suggestion / note field ── */}
      {status !== 'sent' && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <MessageSquare className="w-3.5 h-3.5" />
            Add a note or suggestion (optional — saved with status change)
          </div>
          <textarea
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Crown moulding qty seems off — please double-check before approving"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 placeholder:text-slate-300 resize-none focus:outline-none focus:ring-1 focus:ring-sky-300"
          />
          <p className="text-[10px] text-slate-300">Note is recorded in history when you click Revert or Advance above.</p>
        </div>
      )}

      {/* ── Exceptions ── */}
      {showExceptions && exceptions.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white p-3 space-y-1.5">
          <p className="text-xs font-semibold text-amber-700 mb-1">Items needing attention before approval:</p>
          {exceptions.map((ex, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-800">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span><code className="font-mono bg-amber-50 px-1 rounded">{ex.code}</code> — {ex.reason}</span>
            </div>
          ))}
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
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                  STATUS_CONFIG[h.status].bg
                } ${STATUS_CONFIG[h.status].border} ${STATUS_CONFIG[h.status].color}`}>
                  {STATUS_CONFIG[h.status].label}
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

      {/* ── Customer Quote preview ── */}
      {showQuote && ws && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-semibold text-slate-600">Customer Quote Preview</span>
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

      {error && <p className="text-xs text-red-600">{error}</p>}

      {!profile?.items?.length && (
        <p className="text-xs text-slate-400">Add items and save the profile above before reviewing.</p>
      )}
    </div>
  );
}
