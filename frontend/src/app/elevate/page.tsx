import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PhaseAWorkbench } from '@/features/elevate/phase-a-workbench';
import { loadPricingProfile } from '@/features/elevate/actions';

export const dynamic = 'force-dynamic';

type Status = 'ready' | 'next' | 'later';

const PHASES: { id: string; title: string; status: Status; statusText: string; items: string[] }[] = [
  {
    id: 'A',
    title: 'Pricing from a 2020 design PDF or product list',
    status: 'next',
    statusText: 'Starts first',
    items: [
      'Accept a 2020 design PDF or product list (no new layout)',
      'Extract items and quantities for staff review',
      'Apply builder templates, discounts, markups and gross-profit targets',
      'Produce an internal worksheet and a customer price summary',
    ],
  },
  {
    id: 'B',
    title: 'Catalog ingest and SKU matching',
    status: 'later',
    statusText: 'After A',
    items: [
      'Load the Integrity, Wellborn and Shiloh price lists and effective dates',
      'Show each SKU match as exact/verified or uncertain',
    ],
  },
  {
    id: 'C',
    title: 'Dimensioned plan and layout generation',
    status: 'later',
    statusText: 'Largest part',
    items: [
      'Read walls, openings, dimensions, appliance and plumbing locations from a plan',
      'Generate an initial layout from manufacturer sizes and design rules',
      'Flag missing or uncertain dimensions for staff input',
    ],
  },
  {
    id: 'D',
    title: 'Editing, estimate and customer summary',
    status: 'later',
    statusText: 'Last',
    items: [
      'Staff adjust sizes, positions, appliances, door style, finish and manufacturer',
      'Rebuild the SKU schedule and estimate after each change',
      'Show a plan view, an itemized cabinet and trim list, and a budget estimate',
      'Price hardware, installation, delivery, freight and 3PL as separate amounts',
    ],
  },
];

const STATUS_STYLE: Record<Status, string> = {
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  next: 'bg-sky-50 text-sky-700 border-sky-200',
  later: 'bg-slate-50 text-slate-500 border-slate-200',
};

export default async function ElevatePage() {
  try {
    await requireUser();
  } catch {
    redirect('/login');
  }
  const saved = await loadPricingProfile();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-sky-600">Elevate</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-900">Design and pricing</h1>
            <p className="mt-2 text-slate-500">
              Design and pricing workflow for Elevate. The pricing path (Phase A) is built first; plan reading and layout follow.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0 rounded-xl">
            <Link href="/">Back</Link>
          </Button>
        </div>

        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6 text-sm text-amber-800">
            Elevate has not yet supplied its catalog price lists, pricing rules or sample jobs. Until those arrive, nothing here
            calculates a price. This page shows the agreed phases and their status.
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardDescription className="text-xs font-bold uppercase tracking-widest text-slate-400">Phase A</CardDescription>
            <CardTitle className="mt-1 text-lg text-slate-900">Pricing workbench (rules are assumptions to confirm with Elevate)</CardTitle>
          </CardHeader>
          <CardContent>
            <PhaseAWorkbench initial={saved} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          {PHASES.map((p) => (
            <Card key={p.id} className="border-slate-200">
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardDescription className="text-xs font-bold uppercase tracking-widest text-slate-400">Phase {p.id}</CardDescription>
                  <CardTitle className="mt-1 text-lg text-slate-900">{p.title}</CardTitle>
                </div>
                <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLE[p.status]}`}>{p.statusText}</span>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {p.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
