import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, FileText, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PhaseAWorkbench } from '@/features/elevate/phase-a-workbench';
import { ElevateQuotePreview } from '@/features/elevate/elevate-quote-preview';
import { loadPricingProfile, loadManufacturers } from '@/features/elevate/actions';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  in_review: { label: 'Needs Review',  cls: 'text-amber-700 bg-amber-50 border-amber-200',   icon: AlertTriangle },
  approved:  { label: 'Approved',      cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  sent:      { label: 'Sent to Client',cls: 'text-sky-700 bg-sky-50 border-sky-200',          icon: CheckCircle2 },
};

export default async function ElevatePage() {
  try {
    await requireUser();
  } catch {
    redirect('/login');
  }

  const supabase = await scopedDb();
  const { data: pendingProjects } = await supabase
    .from('quotation_projects')
    .select('id, project_name, review_status, updated_at, manufacturer_id, bom_data, manufacturers(name)')
    .in('review_status', ['in_review', 'approved', 'sent'])
    .order('updated_at', { ascending: false })
    .limit(10);

  const [saved, manufacturers] = await Promise.all([
    loadPricingProfile(),
    loadManufacturers(),
  ]);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-sky-600">Elevate</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-900">Design and pricing</h1>
            <p className="mt-2 text-slate-500">
              Upload a 2020 design or product list, apply pricing rules, review, and generate a customer quote.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0 rounded-xl">
            <Link href="/">Back</Link>
          </Button>
        </div>

        {/* Pending Quotation Reviews from Staff */}
        {pendingProjects && pendingProjects.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-amber-200 bg-amber-100/60">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-bold text-amber-800">
                {pendingProjects.filter(p => p.review_status === 'in_review').length > 0
                  ? `${pendingProjects.filter(p => p.review_status === 'in_review').length} quotation${pendingProjects.filter(p => p.review_status === 'in_review').length > 1 ? 's' : ''} waiting for your review`
                  : 'Recent quotation activity'}
              </p>
            </div>
            <div className="divide-y divide-amber-100">
              {pendingProjects.map(p => {
                const s = STATUS_STYLE[p.review_status] ?? STATUS_STYLE['in_review'];
                const Icon = s.icon;
                const bom = (p as any).bom_data ?? {};
                const mfgName = (p as any).manufacturers?.name;
                const ago = (() => {
                  const diff = Date.now() - new Date(p.updated_at).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 60) return `${mins}m ago`;
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return `${hrs}h ago`;
                  return new Date(p.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                })();
                return (
                  <div key={p.id} className="px-5 py-4 space-y-3">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${s.cls.split(' ')[0]}`} />
                        <div>
                          <p className="text-sm font-bold text-slate-800">{p.project_name}</p>
                          <p className="text-[10px] text-slate-400">{ago}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>
                          {s.label}
                        </span>
                        <Button asChild size="sm" className="h-8 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs gap-1.5">
                          <Link href={`/quotation-ai/bom/${p.id}`}>
                            Review &amp; Edit <ArrowRight className="w-3 h-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                    {/* Info grid: manufacturer + pricing rules */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1.5 text-xs rounded-xl bg-white/70 border border-amber-100 px-4 py-2.5">
                      {mfgName && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Manufacturer</p>
                          <p className="font-semibold text-slate-700">{mfgName}</p>
                        </div>
                      )}
                      {bom.pricingFactor !== undefined && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Pricing Factor</p>
                          <p className="font-mono font-semibold text-slate-700">{bom.pricingFactor} <span className="text-slate-400 font-normal">({((1 - bom.pricingFactor) * 100).toFixed(0)}% off list)</span></p>
                        </div>
                      )}
                      {bom.targetMargin !== undefined && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Target Margin</p>
                          <p className="font-mono font-semibold text-slate-700">{bom.targetMargin}%</p>
                        </div>
                      )}
                      {(bom.discount ?? 0) > 0 && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Discount</p>
                          <p className="font-mono font-semibold text-red-600">{bom.discount}%</p>
                        </div>
                      )}
                      {(bom.taxRate ?? 0) > 0 && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Tax</p>
                          <p className="font-mono font-semibold text-slate-700">{bom.taxRate}%</p>
                        </div>
                      )}
                      {(bom.freight ?? 0) > 0 && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Freight</p>
                          <p className="font-mono font-semibold text-slate-700">${bom.freight}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick-launch: Full Quotation Flow */}
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-sky-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-800">Full Quotation Flow</p>
              <p className="text-xs text-slate-500">Upload a 2020 PDF → select Wellborn / Integrity → generate BOM → proposal → staff review → download</p>
            </div>
          </div>
          <Button asChild className="shrink-0 rounded-xl bg-sky-600 hover:bg-sky-700 text-white gap-2">
            <Link href="/quotation-ai">
              Start New Project <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>

        {/* How-to steps */}
        <div className="flex items-start gap-3 flex-wrap">
          {[
            { n: '1', title: 'Select manufacturer & door style', desc: 'Choose from the dropdown, then pick a door style.' },
            { n: '2', title: 'Upload or paste items', desc: 'Upload a 2020 PDF or type SKU codes and quantities.' },
            { n: '3', title: 'Auto-fill prices', desc: 'Click Auto-fill to pull list prices from the catalog.' },
            { n: '4', title: 'Set rules & save', desc: 'Adjust markup / GP target, charges, then Save.' },
            { n: '5', title: 'Use it on the project', desc: 'Carry these numbers into the quotation project — review and sending happen there.' },
          ].map(step => (
            <div key={step.n} className="flex items-start gap-2 min-w-[160px] flex-1">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">{step.n}</span>
              <div>
                <p className="text-xs font-semibold text-slate-700">{step.title}</p>
                <p className="text-xs text-slate-400">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg text-slate-900">Pricing workbench</CardTitle>
          </CardHeader>
          <CardContent>
            <PhaseAWorkbench initial={saved} manufacturers={manufacturers} />
          </CardContent>
        </Card>

        {/* Quote preview — approval itself happens on the quotation project, not here */}
        <Card className="border-slate-200">
          <CardHeader>
            <CardDescription className="text-xs font-bold uppercase tracking-widest text-slate-400">Reference</CardDescription>
            <CardTitle className="mt-1 text-lg text-slate-900">Quote preview</CardTitle>
          </CardHeader>
          <CardContent>
            <ElevateQuotePreview profile={saved} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
