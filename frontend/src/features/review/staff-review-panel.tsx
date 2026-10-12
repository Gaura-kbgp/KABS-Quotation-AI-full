'use client';

/**
 * Module 5 — Staff Review & Approval Panel
 * Shows approval status workflow, SKU exception flags, and customer quote link.
 */

import { useState, useTransition } from 'react';
import { CheckCircle2, Clock, Send, AlertTriangle, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setReviewStatusAction, type ReviewStatus } from '@/app/quotation-ai/actions';

interface StaffReviewPanelProps {
  projectId: string;
  projectName?: string;
  reviewStatus: ReviewStatus;
  rooms: any[];
}

interface SkuException {
  room: string;
  code: string;
  reason: string;
}

const STATUS_CONFIG: Record<ReviewStatus, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  draft:     { label: 'Draft',      color: 'text-slate-500', bg: 'bg-slate-50  border-slate-200', icon: Clock },
  in_review: { label: 'In Review',  color: 'text-amber-700', bg: 'bg-amber-50  border-amber-200', icon: AlertTriangle },
  approved:  { label: 'Approved',   color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  sent:      { label: 'Sent to Client', color: 'text-sky-700', bg: 'bg-sky-50   border-sky-200',     icon: Send },
};

const FLOW: ReviewStatus[] = ['draft', 'in_review', 'approved', 'sent'];

const NEXT_LABEL: Record<ReviewStatus, string> = {
  draft:     'Start Review',
  in_review: 'Approve',
  approved:  'Mark as Sent',
  sent:      '',
};

/** Flag items that look like uncertain extractions or require manual attention. */
function findSkuExceptions(rooms: any[]): SkuException[] {
  const exceptions: SkuException[] = [];
  for (const room of rooms ?? []) {
    const allItems = [
      ...(room.cabinets ?? []),
      ...(room.perimeter ?? []),
      ...(room.island ?? []),
    ];
    for (const item of allItems) {
      const code: string = (item.code || '').trim();
      if (!code) continue;
      if (code.includes('?')) {
        exceptions.push({ room: room.room_name, code, reason: 'Contains uncertain character (?)' });
      } else if (code.length <= 2 && !/^\d+$/.test(code)) {
        exceptions.push({ room: room.room_name, code, reason: 'Code too short — may be incomplete' });
      } else if (/^[A-Z]{1,2}$/.test(code)) {
        exceptions.push({ room: room.room_name, code, reason: 'Looks like a partial code' });
      } else if (code.startsWith('MANUAL') || code.startsWith('TBD') || code === 'UNKNOWN') {
        exceptions.push({ room: room.room_name, code, reason: 'Manually flagged — requires attention' });
      }
    }
  }
  return exceptions;
}

export function StaffReviewPanel({ projectId, projectName, reviewStatus, rooms }: StaffReviewPanelProps) {
  const [status, setStatus] = useState<ReviewStatus>(reviewStatus || 'draft');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showExceptions, setShowExceptions] = useState(false);

  const exceptions = findSkuExceptions(rooms);
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  const nextStatus = FLOW[FLOW.indexOf(status) + 1];

  function advance() {
    if (!nextStatus) return;
    setError(null);
    startTransition(async () => {
      const res = await setReviewStatusAction(projectId, nextStatus);
      if (res.success) {
        setStatus(nextStatus);
      } else {
        setError(res.error ?? 'Could not update status.');
      }
    });
  }

  const currentStep = FLOW.indexOf(status);

  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${cfg.bg}`}>
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${cfg.color}`} />
          <span className={`text-sm font-semibold ${cfg.color}`}>
            Staff Review: {cfg.label}
          </span>
          {exceptions.length > 0 && (
            <button
              onClick={() => setShowExceptions(v => !v)}
              className="flex items-center gap-1 text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full hover:bg-amber-200 transition-colors"
            >
              <AlertTriangle className="w-3 h-3" />
              {exceptions.length} exception{exceptions.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Customer quote link */}
          <a
            href={`/quotation-ai/quote/${projectId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-slate-600 border border-slate-200 bg-white px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Customer Quote
          </a>

          {nextStatus && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={advance}
              className={`text-xs gap-1 ${
                nextStatus === 'approved' ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' :
                nextStatus === 'sent'     ? 'border-sky-300 text-sky-700 hover:bg-sky-50' :
                'border-amber-300 text-amber-700 hover:bg-amber-50'
              }`}
            >
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
              {NEXT_LABEL[status]}
            </Button>
          )}
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5">
        {FLOW.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                i < currentStep  ? 'bg-emerald-500' :
                i === currentStep ? (cfg.color.includes('emerald') ? 'bg-emerald-500' : cfg.color.includes('sky') ? 'bg-sky-500' : cfg.color.includes('amber') ? 'bg-amber-500' : 'bg-slate-400') :
                'bg-slate-200'
              }`}
            />
            <span className={`text-[10px] ${i <= currentStep ? 'text-slate-600 font-medium' : 'text-slate-300'}`}>
              {STATUS_CONFIG[s].label}
            </span>
            {i < FLOW.length - 1 && <div className="w-4 h-px bg-slate-200 mx-0.5" />}
          </div>
        ))}
      </div>

      {/* SKU exceptions (expandable) */}
      {showExceptions && exceptions.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
          <p className="text-xs font-semibold text-amber-700 mb-2">
            SKU Exceptions — review these items before approving:
          </p>
          {exceptions.map((ex, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-800">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                <strong>{ex.room}</strong>: <code className="font-mono bg-amber-100 px-1 rounded">{ex.code}</code>
                {' '}— {ex.reason}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
