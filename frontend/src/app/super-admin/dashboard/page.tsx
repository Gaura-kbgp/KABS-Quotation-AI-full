import Link from 'next/link';
import { Building2, Users, Factory, FileText, Receipt, Quote, History, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { requireSuperAdmin } from '@/lib/auth';
import { getPlatformStats } from '@/features/platform/stats';
import { listAuditLog } from '@/app/super-admin/clients/actions';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ACTION_LABEL: Record<string, string> = {
  'client.create': 'Created client',
  'client.suspend': 'Suspended client',
  'client.reactivate': 'Reactivated client',
  'client.delete': 'Deleted client',
};

export default async function SuperAdminDashboardPage() {
  await requireSuperAdmin();
  const [stats, audit] = await Promise.all([getPlatformStats(), listAuditLog(8)]);

  const cards = [
    { name: 'Clients', value: `${stats.activeClients}/${stats.totalClients}`, sub: 'active / total', icon: Building2, color: 'text-sky-600', bg: 'bg-sky-50', href: '/super-admin/clients' },
    { name: 'Dealer Users', value: stats.totalUsers, sub: 'across all clients', icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50', href: '/super-admin/usage' },
    { name: 'Manufacturers', value: stats.manufacturers, sub: 'across all clients', icon: Factory, color: 'text-purple-600', bg: 'bg-purple-50', href: '/super-admin/usage' },
    { name: 'Spec Books', value: stats.specBooks, sub: 'across all clients', icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50', href: '/super-admin/usage' },
    { name: 'Pricing Sheets', value: stats.pricingSheets, sub: 'across all clients', icon: Receipt, color: 'text-emerald-600', bg: 'bg-emerald-50', href: '/super-admin/usage' },
    { name: 'Quotes & Projects', value: stats.projects, sub: 'across all clients', icon: Quote, color: 'text-rose-600', bg: 'bg-rose-50', href: '/super-admin/usage' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Platform Overview</h1>
          <p className="text-slate-500 mt-1">KABS Pricing AI, across every client.</p>
        </div>
        <Link href="/super-admin/usage">
          <Button variant="outline" size="sm">Tool usage <ArrowRight className="w-4 h-4 ml-2" /></Button>
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
                <div className="text-2xl font-bold text-slate-900">{stat.value.toString()}</div>
                <p className="text-xs text-slate-400 mt-1">{stat.sub}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><History className="w-4 h-4" /> Recent activity</CardTitle>
          <CardDescription>Latest Super Admin actions on client accounts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {audit.length === 0 && <p className="text-sm text-slate-400">No activity yet.</p>}
          {audit.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0 last:pb-0">
              <span className="text-slate-700">
                <span className="font-medium">{ACTION_LABEL[a.action] || a.action}</span>
                {a.target_org_name && <> — {a.target_org_name}</>}
              </span>
              <span className="text-slate-400 text-xs shrink-0 ml-4">
                {a.actor_email} · {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
