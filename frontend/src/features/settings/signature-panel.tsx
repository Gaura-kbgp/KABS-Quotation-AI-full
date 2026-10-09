'use client';

import { useRef, useState, useTransition } from 'react';
import { Loader2, Eraser, Upload, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { saveSignature } from './actions';

type Mode = 'draw' | 'upload';

export function SignaturePanel({ currentUrl, currentMethod }: { currentUrl: string | null; currentMethod: 'drawn' | 'uploaded' | null }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('draw');
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [busy, start] = useTransition();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvas.current!.getContext('2d')!;
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.current!.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  }

  function up() {
    drawing.current = false;
  }

  function clearPad() {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  function submit() {
    let file: File | null = null;
    let method: 'drawn' | 'uploaded' = 'uploaded';
    if (mode === 'draw') {
      if (!hasInk) { toast({ variant: 'destructive', title: 'Draw your signature first' }); return; }
      method = 'drawn';
    } else {
      if (!picked) { toast({ variant: 'destructive', title: 'Choose a signature image first' }); return; }
      file = picked;
    }

    start(async () => {
      if (mode === 'draw') {
        const blob: Blob | null = await new Promise((resolve) => canvas.current!.toBlob(resolve, 'image/png'));
        if (!blob) { toast({ variant: 'destructive', title: 'Could not read the drawing' }); return; }
        file = new File([blob], 'signature.png', { type: 'image/png' });
      }
      const fd = new FormData();
      fd.append('signature', file!);
      fd.append('method', method);
      const res = await saveSignature(fd);
      if (res.success) {
        setPreview(URL.createObjectURL(file!));
        toast({ title: 'Signature saved' });
      } else {
        toast({ variant: 'destructive', title: 'Could not save', description: res.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button type="button" variant={mode === 'draw' ? 'default' : 'outline'} size="sm" onClick={() => setMode('draw')}>
          <PenLine className="w-4 h-4 mr-2" /> Draw
        </Button>
        <Button type="button" variant={mode === 'upload' ? 'default' : 'outline'} size="sm" onClick={() => setMode('upload')}>
          <Upload className="w-4 h-4 mr-2" /> Upload image
        </Button>
      </div>

      {mode === 'draw' ? (
        <div className="space-y-2">
          <canvas
            ref={canvas}
            width={600}
            height={200}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
            className="w-full h-40 rounded-xl border border-slate-300 bg-white touch-none cursor-crosshair"
          />
          <Button type="button" variant="ghost" size="sm" onClick={clearPad}>
            <Eraser className="w-4 h-4 mr-2" /> Clear
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => setPicked(e.target.files?.[0] || null)}
          />
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
            {picked ? picked.name : 'Choose PNG or JPG'}
          </Button>
          <p className="text-xs text-slate-400">Use a transparent PNG for the cleanest result. Up to 1MB.</p>
        </div>
      )}

      <div className="flex items-center gap-4 pt-2">
        <Button type="button" className="gradient-button" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save signature
        </Button>
        {preview && (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Current signature" className="h-12 rounded border border-slate-200 bg-white p-1" />
            <span className="text-xs text-slate-400">Current{currentMethod ? ` (${currentMethod})` : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}
