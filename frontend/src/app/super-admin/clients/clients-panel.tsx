'use client';

import { useState, useTransition } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Building2, Factory, Loader2, Plus, ShieldOff, ShieldCheck, Trash2, History, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { type AuditRow, type ClientManufacturer, type ClientRow, createClient, deleteClient, getClientManufacturers, setClientStatus } from './actions';

const ACTION_LABEL: Record<string, string> = {
  'client.create': 'Created client',
  'client.suspend': 'Suspended client',
  'client.reactivate': 'Reactivated client',
  'client.delete': 'Deleted client',
};

export function ClientsPanel({ initialClients, initialAudit }: { initialClients: ClientRow[]; initialAudit: AuditRow[] }) {
  const { toast } = useToast();
  const [clients, setClients] = useState(initialClients);
  const [audit, setAudit] = useState(initialAudit);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [creating, startCreate] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mfgsByClient, setMfgsByClient] = useState<Record<string, ClientManufacturer[]>>({});
  const [loadingMfgs, setLoadingMfgs] = useState<string | null>(null);

  async function toggleManufacturers(c: ClientRow) {
    if (expandedId === c.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(c.id);
    if (!mfgsByClient[c.id]) {
      setLoadingMfgs(c.id);
      try {
        const mfgs = await getClientManufacturers(c.id);
        setMfgsByClient((prev) => ({ ...prev, [c.id]: mfgs }));
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Could not load manufacturers', description: err.message });
      } finally {
        setLoadingMfgs(null);
      }
    }
  }

  function refresh() {
    import('./actions').then(async ({ listClients, listAuditLog }) => {
      setClients(await listClients());
      setAudit(await listAuditLog());
      setMfgsByClient({}); // stale after create/suspend/delete; reload lazily on next expand
    });
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    startCreate(async () => {
      const res = await createClient({ companyName: name, adminEmail: email });
      if (res.success) {
        toast({ title: 'Client created', description: res.message });
        setName('');
        setEmail('');
        setOpen(false);
        refresh();
      } else {
        toast({ variant: 'destructive', title: 'Could not create client', description: res.error });
      }
    });
  }

  async function toggleStatus(c: ClientRow) {
    setBusyId(c.id);
    const next = c.status === 'active' ? 'suspended' : 'active';
    const res = await setClientStatus(c.id, next);
    setBusyId(null);
    if (res.success) {
      toast({ title: next === 'active' ? 'Client reactivated' : 'Client suspended' });
      refresh();
    } else {
      toast({ variant: 'destructive', title: 'Could not update', description: res.error });
    }
  }

  async function remove(c: ClientRow) {
    setBusyId(c.id);
    const res = await deleteClient(c.id);
    setBusyId(null);
    if (res.success) {
      toast({ title: `${c.name} deleted` });
      refresh();
    } else {
      toast({ variant: 'destructive', title: 'Could not delete', description: res.error });
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-button">
              <Plus className="w-4 h-4 mr-2" /> Add client
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={onCreate}>
              <DialogHeader>
                <DialogTitle>Add a new client</DialogTitle>
                <DialogDescription>
                  Creates their company and a Dealer Admin account. They sign in with Google, or create an
                  account with this exact email — it links automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="cname">Company name</Label>
                  <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cemail">Dealer admin email</Label>
                  <Input id="cemail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" className="gradient-button" disabled={creating}>
                  {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create client
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {clients.length === 0 && (
          <Card className="border-slate-200 border-dashed">
            <CardContent className="py-12 text-center text-slate-400">
              <Building2 className="w-8 h-8 mx-auto mb-3" />
              No clients yet. Add your first one above.
            </CardContent>
          </Card>
        )}
        {clients.map((c) => (
          <Card key={c.id} className="border-slate-200">
            <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 truncate">{c.name}</h3>
                  <Badge variant={c.status === 'active' ? 'default' : 'destructive'} className={c.status === 'active' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : ''}>
                    {c.status}
                  </Badge>
                  {c.admin_status === 'invited' && <Badge variant="outline" className="text-amber-600 border-amber-200">invited — not signed in yet</Badge>}
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {c.admin_email || 'No admin email on file'} · joined {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                </p>
                <button
                  onClick={() => toggleManufacturers(c)}
                  className="text-xs text-slate-400 hover:text-sky-600 mt-1 flex items-center gap-1"
                >
                  {c.manufacturers} manufacturers · {c.spec_books} spec books · {c.pricing_sheets} pricing sheets · {c.pricing_rows.toLocaleString()} SKU rows · {c.projects} projects
                  {expandedId === c.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => toggleStatus(c)} disabled={busyId === c.id}>
                  {c.status === 'active' ? <ShieldOff className="w-4 h-4 mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  {c.status === 'active' ? 'Suspend' : 'Reactivate'}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" disabled={busyId === c.id}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes their account, manufacturers, pricing ({c.pricing_rows.toLocaleString()} rows),
                        projects ({c.projects}), and all other data. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => remove(c)}>Delete permanently</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>

            {expandedId === c.id && (
              <CardContent className="pt-0 pb-5 px-5 border-t border-slate-100">
                {loadingMfgs === c.id ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400 py-3">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading manufacturers…
                  </div>
                ) : (mfgsByClient[c.id] || []).length === 0 ? (
                  <p className="text-sm text-slate-400 py-3">This client hasn&apos;t added any manufacturers yet.</p>
                ) : (
                  <div className="pt-3 flex flex-wrap gap-2">
                    {(mfgsByClient[c.id] || []).map((m) => (
                      <Badge key={m.id} variant="outline" className="font-normal gap-1.5 py-1.5">
                        <Factory className="w-3 h-3 text-slate-400" />
                        {m.name}
                        <span className="text-slate-400">
                          · {m.spec_books} spec{m.spec_books === 1 ? '' : 's'} · {m.pricing_sheets} pricing
                        </span>
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><History className="w-4 h-4" /> Recent activity</CardTitle>
          <CardDescription>Super Admin actions on client accounts.</CardDescription>
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
