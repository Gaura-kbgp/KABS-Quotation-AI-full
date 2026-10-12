'use client';

/**
 * Module 5 — Customer-facing Quote view.
 * Clean print-friendly layout — one page per project summary.
 */

import { useMemo } from 'react';
import { Printer, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface BomRow {
  room_name: string;
  sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  tier?: string;
}

interface CustomerQuoteClientProps {
  project: {
    id: string;
    project_name?: string;
    created_at: string;
    review_status?: string;
  };
  bom: BomRow[];
  orgName: string;
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function CustomerQuoteClient({ project, bom, orgName }: CustomerQuoteClientProps) {
  const router = useRouter();

  const byRoom = useMemo(() => {
    const map: Record<string, BomRow[]> = {};
    for (const row of bom) {
      if (!map[row.room_name]) map[row.room_name] = [];
      map[row.room_name].push(row);
    }
    return map;
  }, [bom]);

  const grandTotal = useMemo(
    () => bom.reduce((s, r) => s + (r.unit_price || 0) * (r.quantity || 0), 0),
    [bom]
  );

  const totalCabinets = useMemo(
    () => bom.reduce((s, r) => s + (r.quantity || 0), 0),
    [bom]
  );

  const dateStr = new Date(project.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const isApproved = project.review_status === 'approved' || project.review_status === 'sent';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Toolbar — hidden on print */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-3">
          {isApproved && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
              ✓ Approved
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print / Save PDF
          </Button>
        </div>
      </div>

      {/* Quote document */}
      <div className="max-w-3xl mx-auto px-6 py-10 print:py-6 print:px-0">
        {/* Letterhead */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">{orgName}</h1>
            <p className="text-sm text-slate-500 mt-0.5">Cabinet Quotation</p>
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>{dateStr}</p>
            <p className="font-mono text-xs mt-1">#{project.id.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>

        {/* Project name */}
        <div className="mb-6 pb-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">
            {project.project_name || 'Untitled Project'}
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">{totalCabinets} total items across {Object.keys(byRoom).length} room(s)</p>
        </div>

        {/* Room sections */}
        {Object.keys(byRoom).length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
            <p className="text-sm text-amber-700 font-medium">No BOM items found for this project.</p>
            <p className="text-xs text-amber-600 mt-1">Generate the BOM first from the Review page.</p>
          </div>
        ) : (
          Object.entries(byRoom).map(([roomName, items]) => {
            const roomTotal = items.reduce((s, r) => s + (r.unit_price || 0) * (r.quantity || 0), 0);
            return (
              <div key={roomName} className="mb-8">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{roomName}</h3>
                  <span className="text-sm font-semibold text-slate-600">{money(roomTotal)}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-400 uppercase tracking-wide">
                      <th className="text-left py-1.5 pr-3 font-medium">Item</th>
                      <th className="text-left py-1.5 pr-3 font-medium">Description</th>
                      <th className="text-right py-1.5 pr-3 font-medium">Qty</th>
                      <th className="text-right py-1.5 font-medium">Unit Price</th>
                      <th className="text-right py-1.5 pl-3 font-medium">Extended</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">{row.sku}</td>
                        <td className="py-1.5 pr-3 text-slate-600">{row.description || '—'}</td>
                        <td className="py-1.5 pr-3 text-right text-slate-700">{row.quantity}</td>
                        <td className="py-1.5 text-right text-slate-700">{money(row.unit_price || 0)}</td>
                        <td className="py-1.5 pl-3 text-right font-medium text-slate-800">
                          {money((row.unit_price || 0) * (row.quantity || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}

        {/* Grand total */}
        {bom.length > 0 && (
          <div className="border-t-2 border-slate-800 pt-4 flex justify-end">
            <div className="text-right">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Grand Total</p>
              <p className="text-2xl font-black text-slate-900">{money(grandTotal)}</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-400 text-center">
          <p>This quotation was prepared by {orgName}. Prices are subject to change. Valid for 30 days.</p>
        </div>
      </div>
    </div>
  );
}
