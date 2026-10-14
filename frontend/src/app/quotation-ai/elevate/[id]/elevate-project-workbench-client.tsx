'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhaseAWorkbench } from '@/features/elevate/phase-a-workbench';
import { ElevateQuotePreview } from '@/features/elevate/elevate-quote-preview';
import { applyElevateToProject, type Manufacturer, type SavedProfile } from '@/features/elevate/actions';

interface Props {
  projectId: string;
  projectName: string;
  initial: SavedProfile | null;
  manufacturers: Manufacturer[];
}

/**
 * Per-project Elevate pricing workbench. Unlike the standalone /elevate scratchpad,
 * this worksheet belongs to one quotation_project — "Send to BOM" pushes its lines
 * into quotation_boms (same table generate-bom and Blueprint write into), so the
 * same confirmed-price gate and staff review in the BOM manager apply to it too.
 */
export function ElevateProjectWorkbenchClient({ projectId, projectName, initial, manufacturers }: Props) {
  const [isApplying, startApplying] = useTransition();
  const [applyResult, setApplyResult] = useState<{ ok: boolean; text: string } | null>(null);

  function applyToBom() {
    setApplyResult(null);
    startApplying(async () => {
      const res = await applyElevateToProject(projectId);
      setApplyResult(
        res.success
          ? { ok: true, text: `${res.count} item(s) sent to the BOM. Open the BOM manager to review pricing and approve.` }
          : { ok: false, text: res.error }
      );
    });
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-sky-600">Elevate pricing</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-900">{projectName}</h1>
            <p className="mt-2 text-slate-500">
              Build a pricing worksheet for this project, then send it to the BOM for review and approval.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0 rounded-xl gap-1.5">
            <Link href={`/quotation-ai/bom/${projectId}`}>
              <ArrowLeft className="w-4 h-4" /> Back to BOM
            </Link>
          </Button>
        </div>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg text-slate-900">Pricing workbench</CardTitle>
          </CardHeader>
          <CardContent>
            <PhaseAWorkbench initial={initial} manufacturers={manufacturers} projectId={projectId} />
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader>
            <CardTitle className="text-lg text-slate-900">Send to BOM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              This replaces any items previously sent from this worksheet with the current one.
              Staff review, approval, and the customer proposal all happen in the BOM manager —
              not here.
            </p>
            <Button onClick={applyToBom} disabled={isApplying} className="rounded-xl gradient-button gap-2">
              {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send worksheet to BOM
            </Button>
            {applyResult && (
              <p className={`text-sm ${applyResult.ok ? 'text-emerald-700' : 'text-red-600'}`}>{applyResult.text}</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg text-slate-900">Quote preview</CardTitle>
          </CardHeader>
          <CardContent>
            <ElevateQuotePreview profile={initial} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
