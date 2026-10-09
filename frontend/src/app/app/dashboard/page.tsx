import Link from 'next/link';
import { Factory, FileText, Receipt, Wrench, BookOpen, Quote, AlertCircle, RefreshCcw, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { requireDealerAdmin } from '@/lib/auth';
import { scopedDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminDashboardPage() {
  const user = await requireDealerAdmin();

  let stats = { manufacturers: 0, specBooks: 0, pricingSheets: 0, laborCharges: 0, nkbaRules: 0, projects: 0 };
  let error: string | null = null;

  try {
    const supabase = await scopedDb();
    const [mfg, specs, pricing, labor, nkba, projects] = await Promise.all([
      supabase.from('manufacturers').select('id', { count: 'exact', head: true }),
      supabase.from('manufacturer_files').select('id', { count: 'exact', head: true }).eq('file_type', 'spec'),
      supabase.from('manufacturer_files').select('id', { count: 'exact', head: true }).eq('file_type', 'pricing'),
      supabase.from('labor_charges').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('nkba_files').select('id', { count: 'exact', head: true }),
      supabase.from('quotation_projects').select('id', { count: 'exact', head: true }),
    ]);
    for (const r of [mfg, specs, pricing, labor, nkba, projects]) if (r.error) throw new Error(r.error.message);

    stats = {
      manufacturers: mfg.count || 0,
      specBooks: specs.count || 0,
      pricingSheets: pricing.count || 0,
      laborCharges: labor.count || 0,
      nkbaRules: nkba.count || 0,
      projects: projects.count || 0,
    };
  } catch (err: any) {
    console.error('Dealer dashboard stats error:', err.message);
    error = err.message;
  }

  if (error) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-bold">System Connection Error</AlertTitle>
          <AlertDescription className="mt-2 text-red-700 leading-relaxed">
            The server could not connect to the database. Error: {error}
          </AlertDescription>
        </Alert>
        <div className="flex justify-center">
          <Link href="/app/dashboard">
            <Button className="gradient-button px-8">
              <RefreshCcw className="w-4 h-4 mr-2" />
              Retry Connection
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const cards = [
    { name: 'Manufacturers', value: stats.manufacturers, icon: Factory, color: 'text-sky-600', bg: 'bg-sky-50', href: '/app/manufacturers' },
    { name: 'Spec Books', value: stats.specBooks, icon: FileText, color: 'text-indigo-600', bg: 'bg-indigo-50', href: '/app/manufacturers' },
    { name: 'Pricing Sheets', value: stats.pricingSheets, icon: Receipt, color: 'text-purple-600', bg: 'bg-purple-50', href: '/app/manufacturers' },
    { name: 'Labor & Charges', value: stats.laborCharges, icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-50', href: '/app/labor' },
    { name: 'NKBA Rules', value: stats.nkbaRules, icon: BookOpen, color: 'text-emerald-600', bg: 'bg-emerald-50', href: '/app/nkba' },
    { name: 'Quotes & Projects', value: stats.projects, icon: Quote, color: 'text-rose-600', bg: 'bg-rose-50', href: '/quotation-ai' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">{user.orgName}&apos;s account overview.</p>
        </div>
        <Link href="/app/settings">
          <Button variant="outline" size="sm">Company settings <ArrowRight className="w-4 h-4 ml-2" /></Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((stat) => (
          <Link key={stat.name} href={stat.href}>
            <Card className="glass-card border-slate-200 shadow-sm hover:border-sky-200 transition-colors h-full">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-slate-500">{stat.name}</CardTitle>
                <div className={`${stat.bg} p-2 rounded-lg`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{stat.value.toLocaleString()}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
