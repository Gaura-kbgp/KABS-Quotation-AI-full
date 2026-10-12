'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Library, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { deleteNkbaRuleAction } from '@/features/nkba/actions';

export interface SetupManufacturer {
  id: string;
  name: string;
}

export interface SetupFile {
  id: string;
  manufacturer_id: string;
  file_type: string; // 'pricing' | 'spec'
  file_name: string;
  file_url: string;
}

export interface SetupNkbaRule {
  id: string;
  version: string;
  file_name: string;
  file_url: string;
}

/**
 * The manufacturer catalog (brands, spec/pricing files, SKU pricing) is
 * curated once by Super Admin and shared read-only with every company —
 * see PLATFORM_ORG_ID in lib/db.ts. A dealer doesn't add or upload
 * anything here; this step just confirms which brands are already
 * available to them, straight from that shared catalog. They pick which
 * one to use per quotation later, in the quotation review flow.
 */
export function ManufacturersStep({ initial }: { initial: SetupManufacturer[]; files?: SetupFile[] }) {
  if (initial.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No manufacturers are available yet — ask Super Admin to add one to the shared catalog.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
        {initial.map((m) => (
          <li key={m.id} className="flex items-center gap-2 px-4 py-3 bg-white">
            <Library className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="font-medium text-slate-900">{m.name}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-400">
        {initial.length} manufacturer{initial.length === 1 ? '' : 's'} ready to quote with. You'll pick one per project
        when you start a quotation.
      </p>
    </div>
  );
}

export function NkbaStep({ rules }: { rules: SetupNkbaRule[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    if (!version.trim()) return toast({ variant: 'destructive', title: 'Enter the NKBA version first (e.g. 2025)' });
    setBusy(true);
    let ok = 0;
    for (const f of picked) {
      try {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('version', version.trim());
        const res = await fetch('/api/upload-nkba', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || 'NKBA upload failed');
        ok++;
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'NKBA upload failed', description: `${f.name}: ${err.message}` });
      }
    }
    setBusy(false);
    if (ok > 0) {
      toast({ title: `${ok} NKBA file${ok === 1 ? '' : 's'} uploaded` });
      router.refresh();
    }
  }

  async function remove(r: SetupNkbaRule) {
    if (!window.confirm(`Delete NKBA file "${r.file_name}"?`)) return;
    setBusy(true);
    const res = await deleteNkbaRuleAction(r.id, r.file_url);
    setBusy(false);
    if (!res.success) return toast({ variant: 'destructive', title: 'Could not delete NKBA file', description: res.error });
    toast({ title: 'NKBA file deleted', description: r.file_name });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Optional. {rules.length > 0 ? `${rules.length} NKBA file${rules.length === 1 ? '' : 's'} uploaded.` : 'No NKBA file yet.'}</p>

      {rules.length > 0 && (
        <ul className="space-y-1">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 shrink-0 text-slate-400" />
                <span className="text-sm text-slate-700 truncate">{r.file_name}</span>
                <span className="text-xs text-slate-400 shrink-0">v{r.version}</span>
              </span>
              <Button type="button" size="icon" variant="ghost" onClick={() => remove(r)} disabled={busy} aria-label={`Delete ${r.file_name}`}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version, e.g. 2025" className="bg-white max-w-[180px]" />
        <input ref={input} type="file" accept=".pdf" multiple className="hidden" onChange={pick} />
        <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          Upload NKBA PDF
        </Button>
      </div>
    </div>
  );
}
