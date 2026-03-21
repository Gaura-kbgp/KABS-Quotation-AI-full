import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Factory, BookOpen, Database, Quote, RefreshCcw, AlertCircle } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase-server';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminDashboardPage() {
  const supabase = createServerSupabase();
  
  let stats = {
    manufacturers: 0,
    specifications: 0,
    files: 0,
    status: 'Live'
  };
  
  let error: string | null = null;

  try {
    const [mRes, sRes, fRes] = await Promise.all([
      supabase.from('manufacturers').select('*', { count: 'exact', head: true }),
      supabase.from('manufacturer_pricing').select('*', { count: 'exact', head: true }),
      supabase.from('manufacturer_files').select('*', { count: 'exact', head: true }),
    ]);

    if (mRes.error) throw new Error(mRes.error.message);
    if (sRes.error) throw new Error(sRes.error.message);
    if (fRes.error) throw new Error(fRes.error.message);

    stats.manufacturers = mRes.count || 0;
    stats.specifications = sRes.count || 0;
    stats.files = fRes.count || 0;
  } catch (err: any) {
    console.error('Server-side Stats Fetch Error:', err.message);
    error = err.message;
  }

  if (error) return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle className="font-bold">System Connection Error</AlertTitle>
        <AlertDescription className="mt-2 text-red-700 leading-relaxed">
          The server could not connect to the database. Error: {error}
        </AlertDescription>
      </Alert>
      <div className="flex justify-center">
        <Link href="/admin/dashboard">
          <Button className="gradient-button px-8">
            <RefreshCcw className="w-4 h-4 mr-2" />
            Retry Connection
          </Button>
        </Link>
      </div>
    </div>
  );

  const cards = [
    { name: 'Active Manufacturers', value: stats.manufacturers, icon: Factory, color: 'text-sky-600', bg: 'bg-sky-50' },
    { name: 'Pricing Records', value: (stats.specifications || 0).toLocaleString(), icon: Database, color: 'text-purple-600', bg: 'bg-purple-50' },
    { name: 'Technical Documents', value: stats.files, icon: BookOpen, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { name: 'System Status', value: stats.status, icon: Quote, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">Real-time overview of the quotation platform infrastructure.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((stat) => (
          <Card key={stat.name} className="glass-card border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-500">{stat.name}</CardTitle>
              <div className={`${stat.bg} p-2 rounded-lg`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
