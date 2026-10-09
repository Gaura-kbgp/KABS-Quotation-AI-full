'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, ChevronUp, FileText, Loader2, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  addManufacturer,
  deleteManufacturer,
  deleteManufacturerFileAction,
  updateManufacturer,
} from '@/features/manufacturers/actions';
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

export function ManufacturersStep({ initial, files }: { initial: SetupManufacturer[]; files: SetupFile[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [adding, startAdd] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (clean.length < 2) return toast({ variant: 'destructive', title: 'Enter a manufacturer name' });
    startAdd(async () => {
      const res = await addManufacturer(clean);
      if (res.success) {
        setName('');
        toast({ title: 'Manufacturer added', description: clean });
        router.refresh();
      } else {
        toast({ variant: 'destructive', title: 'Could not add', description: res.error });
      }
    });
  }

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Manufacturer name, e.g. Wellborn" className="bg-white" />
        <Button type="submit" className="gradient-button shrink-0" disabled={adding}>
          {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Add
        </Button>
      </form>

      {initial.length === 0 && <p className="text-sm text-slate-400">No manufacturers yet. Add the first one above.</p>}

      <div className="space-y-3">
        {initial.map((m) => (
          <ManufacturerRow
            key={m.id}
            m={m}
            files={files.filter((f) => f.manufacturer_id === m.id)}
            onChanged={() => router.refresh()}
          />
        ))}
      </div>
    </div>
  );
}

function ManufacturerRow({ m, files, onChanged }: { m: SetupManufacturer; files: SetupFile[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.name);
  const [busy, startBusy] = useTransition();

  function save() {
    const clean = draft.trim();
    if (clean.length < 2) return toast({ variant: 'destructive', title: 'Enter a manufacturer name' });
    startBusy(async () => {
      const res = await updateManufacturer(m.id, { name: clean });
      if (res.success) {
        setEditing(false);
        toast({ title: 'Name updated', description: clean });
        onChanged();
      } else {
        toast({ variant: 'destructive', title: 'Could not rename', description: res.error });
      }
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${m.name}" with all its pricing sheets and spec books? This cannot be undone.`)) return;
    startBusy(async () => {
      const res = await deleteManufacturer(m.id);
      if (res.success) {
        toast({ title: 'Manufacturer deleted', description: m.name });
        onChanged();
      } else {
        toast({ variant: 'destructive', title: 'Could not delete', description: res.error });
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 px-4 py-3">
        {editing ? (
          <>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="bg-white h-9" autoFocus />
            <Button type="button" size="icon" variant="outline" onClick={save} disabled={busy} aria-label="Save name">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </Button>
            <Button type="button" size="icon" variant="ghost" onClick={() => { setEditing(false); setDraft(m.name); }} aria-label="Cancel">
              <X className="w-4 h-4" />
            </Button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setOpen(!open)} className="flex-1 flex items-center justify-between text-left">
              <span className="font-medium text-slate-900">{m.name}</span>
              {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            <Button type="button" size="icon" variant="ghost" onClick={() => setEditing(true)} aria-label="Rename manufacturer">
              <Pencil className="w-4 h-4 text-slate-500" />
            </Button>
            <Button type="button" size="icon" variant="ghost" onClick={remove} disabled={busy} aria-label="Delete manufacturer">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-500" />}
            </Button>
          </>
        )}
      </div>

      {open && !editing && (
        <div className="px-4 pb-4 space-y-5 border-t border-slate-100 pt-3">
          <FileSection
            label="Pricing sheets"
            hint=".xlsx, .xlsm, .csv or .pdf"
            accept=".xlsx,.xlsm,.csv,.pdf"
            files={files.filter((f) => f.file_type === 'pricing')}
            manufacturerId={m.id}
            upload={(file) => uploadPricing(m.id, file)}
            onChanged={onChanged}
          />
          <FileSection
            label="Spec books"
            hint=".pdf"
            accept=".pdf"
            files={files.filter((f) => f.file_type === 'spec')}
            manufacturerId={m.id}
            upload={(file) => uploadSpec(m.id, file)}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  );
}

/** Lists every uploaded file by name, lets you delete any of them, and uploads one or more at a time. */
function FileSection({
  label,
  hint,
  accept,
  files,
  manufacturerId,
  upload,
  onChanged,
}: {
  label: string;
  hint: string;
  accept: string;
  files: SetupFile[];
  manufacturerId: string;
  upload: (file: File) => Promise<void>;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    setBusy(true);
    let ok = 0;
    for (const f of picked) {
      try {
        await upload(f);
        ok++;
      } catch (err: any) {
        toast({ variant: 'destructive', title: `${label} upload failed`, description: `${f.name}: ${err.message}` });
      }
    }
    setBusy(false);
    if (ok > 0) {
      toast({ title: `${ok} file${ok === 1 ? '' : 's'} uploaded` });
      onChanged();
    }
  }

  async function remove(f: SetupFile) {
    if (!window.confirm(`Delete "${f.file_name}"?`)) return;
    setBusy(true);
    try {
      const res = await deleteManufacturerFileAction(f.id, f.file_url, manufacturerId);
      if (!res.success) throw new Error(res.error);
      toast({ title: 'File deleted', description: f.file_name });
      onChanged();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not delete file', description: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">{label}</div>
          <div className="text-xs text-slate-400">{hint} · you can select several files</div>
        </div>
        <input ref={input} type="file" accept={accept} multiple className="hidden" onChange={pick} />
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          Upload
        </Button>
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-slate-400">No files yet.</p>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 shrink-0 text-slate-400" />
                <span className="text-sm text-slate-700 truncate">{f.file_name}</span>
              </span>
              <Button type="button" size="icon" variant="ghost" onClick={() => remove(f)} disabled={busy} aria-label={`Delete ${f.file_name}`}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function uploadPricing(manufacturerId: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/backend/api/upload-pricing?manufacturer_id=${manufacturerId}`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || data.detail || 'Pricing upload failed');
}

async function uploadSpec(manufacturerId: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('manufacturerId', manufacturerId);
  const res = await fetch('/api/upload-spec', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'Spec book upload failed');
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
