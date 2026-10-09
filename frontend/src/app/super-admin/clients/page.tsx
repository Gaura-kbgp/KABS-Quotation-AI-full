import { requireSuperAdmin } from '@/lib/auth';
import { listAuditLog, listClients } from './actions';
import { ClientsPanel } from './clients-panel';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  await requireSuperAdmin();
  const [clients, audit] = await Promise.all([listClients(), listAuditLog()]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Clients</h1>
        <p className="text-slate-500 mt-1">Dealer companies on KABS Quotation AI.</p>
      </div>
      <ClientsPanel initialClients={clients} initialAudit={audit} />
    </div>
  );
}
