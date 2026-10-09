'use client';

import { useRef, useState, useTransition } from 'react';
import { Building2, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { updateOrgLogo } from './actions';

export function LogoUploader({ initialUrl }: { initialUrl: string | null }) {
  const { toast } = useToast();
  const [url, setUrl] = useState(initialUrl);
  const [busy, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    start(async () => {
      const res = await updateOrgLogo(fd);
      if (res.success) {
        setUrl(res.url || null);
        toast({ title: 'Logo updated' });
      } else {
        toast({ variant: 'destructive', title: 'Upload failed', description: res.error });
      }
    });
  }

  return (
    <div className="flex items-center gap-6">
      <div className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Company logo" className="object-contain w-full h-full" />
        ) : (
          <Building2 className="w-8 h-8 text-slate-300" />
        )}
      </div>
      <div className="space-y-2">
        <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={pick} />
        <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          {url ? 'Replace logo' : 'Upload logo'}
        </Button>
        <p className="text-xs text-slate-400">PNG or JPG, up to 2MB. Shown on your quotes.</p>
      </div>
    </div>
  );
}
