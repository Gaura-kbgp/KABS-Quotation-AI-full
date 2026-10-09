"use client";

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Wrench,
  UploadCloud,
  Loader2,
  FileSpreadsheet,
  Sparkles,
  Info,
} from 'lucide-react';

// --- Types ---
interface LaborClientProps {
  initialRates: any[];
  initialError: string | null;
}

export function LaborClient({ initialError }: LaborClientProps) {
  const { toast } = useToast();

  // --- Install Rules Upload ---
  const installFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingInstall, setIsUploadingInstall] = useState(false);
  const [uploadInstallMsg, setUploadInstallMsg] = useState('');
  const [installWarnings, setInstallWarnings] = useState<string[]>([]);

  async function handleUploadInstall(file: File) {
    if (!file) return;
    setIsUploadingInstall(true);
    setUploadInstallMsg('Syncing Rules…');
    setInstallWarnings([]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload-install-rules', { method: 'POST', body: fd });
      const data = await res.json();

      if (!data.success) {
        toast({ title: 'Point Rules failed', description: data.error || 'Unknown error', variant: 'destructive' });
        setInstallWarnings(data.warnings || []);
        return;
      }

      setInstallWarnings(data.warnings || []);
      toast({
        title: 'Installation Point Rules Updated',
        description: `Successfully processed ${data.count} SKU-based rules.`,
      });
    } catch (err: any) {
      toast({ title: 'Upload error', description: err.message, variant: 'destructive' });
    } finally {
      setIsUploadingInstall(false);
      setUploadInstallMsg('');
      if (installFileRef.current) installFileRef.current.value = '';
    }
  }

  function onInstallFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUploadInstall(file);
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
          <Sparkles className="w-8 h-8 text-indigo-600" />
          Installation Point Rules
        </h1>
        <p className="text-slate-500 mt-2 max-w-2xl">
          Configure weighted labor factors (Points) for different items. These factors are used to calculate proportionate installation costs for cabinets, panels, and accessories.
        </p>
      </div>

      {initialError && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">{initialError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">

        {/* Left: Upload card */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="glass-card border-indigo-100 shadow-xl shadow-indigo-500/5">
            <CardHeader className="border-b border-slate-100 pb-4 bg-indigo-50/30">
              <CardTitle className="text-base flex items-center gap-2 text-indigo-700">
                <UploadCloud className="w-5 h-5" />
                Upload Point Factors
              </CardTitle>
              <CardDescription>Excel Template — defines SKU-based points</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div
                onClick={() => !isUploadingInstall && installFileRef.current?.click()}
                className={cn(
                  "relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all",
                  "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50",
                  isUploadingInstall ? "pointer-events-none opacity-70" : ""
                )}
              >
                <input ref={installFileRef} type="file" className="hidden" accept=".csv,.xlsx,.xlsm,.xls" onChange={onInstallFileChange} />
                {isUploadingInstall ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                    <p className="text-sm text-indigo-600 font-bold uppercase tracking-widest">{uploadInstallMsg || 'Syncing…'}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <FileSpreadsheet className="w-10 h-10 text-slate-300" />
                    <div>
                      <p className="text-sm font-bold text-slate-700">Upload Point Rules</p>
                      <p className="text-xs text-slate-400 mt-1">Excel (.xlsx, .xlsm) or CSV</p>
                    </div>
                  </div>
                )}
              </div>
              
              {installWarnings.length > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-4 space-y-2 max-h-48 overflow-y-auto">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Import Logs / Warnings</p>
                  {installWarnings.map((w, i) => (<p key={i} className="text-xs text-amber-700 font-medium">→ {w}</p>))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-black uppercase tracking-widest text-slate-400">Required Template Format</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {[
                { col: 'Manufacturer',   req: true,  note: 'e.g. Wellborn, 1951' },
                { col: 'Item Code',       req: true,  note: 'SKU suffix (W3030, UF3, EP)' },
                { col: 'Install Factor', req: true,  note: '1.0, 0.5, or 0.1' },
                { col: 'Include in 3PL', req: false, note: 'TRUE for cabinets only' },
              ].map(({ col, req, note }) => (
                <div key={col} className="flex items-start gap-3">
                  <span className={cn("text-[10px] font-black px-2 py-0.5 rounded shrink-0 mt-0.5", req ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500")}>
                    {req ? 'REQ' : 'OPT'}
                  </span>
                  <div>
                    <p className="text-xs font-bold text-slate-700">{col}</p>
                    <p className="text-[10px] text-slate-400 font-medium">{note}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right: Informational Content */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="glass-card border-none shadow-none bg-transparent">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-xl font-black text-slate-800">System Understanding</CardTitle>
              <CardDescription className="text-slate-500">How the installation point system calculates labor costs.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 space-y-6">
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { title: '1.0 Point', desc: 'Full Cabinet', sub: 'Standard effort', color: 'indigo' },
                  { title: '0.5 Points', desc: 'End Panels', sub: 'Reduced effort', color: 'blue' },
                  { title: '0.1 Points', desc: 'Fillers/Trim', sub: 'Minimal effort', color: 'sky' },
                ].map((item) => (
                  <div key={item.title} className={cn("p-5 rounded-2xl border-2", `border-${item.color}-100 bg-${item.color}-50/30`)}>
                    <p className={cn("text-2xl font-black", `text-${item.color}-700`)}>{item.title}</p>
                    <p className="text-sm font-bold text-slate-700 mt-1">{item.desc}</p>
                    <p className="text-[10px] uppercase font-black text-slate-400 mt-0.5">{item.sub}</p>
                  </div>
                ))}
              </div>

              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Calculation Example
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-100">
                    <div>
                      <p className="text-sm font-bold text-slate-700">10x Wall Cabinets</p>
                      <p className="text-[10px] text-slate-400">10 qty × 1.0 points</p>
                    </div>
                    <span className="text-lg font-black text-indigo-600">10.0 pts</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-100">
                    <div>
                      <p className="text-sm font-bold text-slate-700">4x End Panels</p>
                      <p className="text-[10px] text-slate-400">4 qty × 0.5 points</p>
                    </div>
                    <span className="text-lg font-black text-indigo-600">2.0 pts</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-100">
                    <div>
                      <p className="text-sm font-bold text-slate-700">5x Universal Fillers</p>
                      <p className="text-[10px] text-slate-400">5 qty × 0.1 points</p>
                    </div>
                    <span className="text-lg font-black text-indigo-600">0.5 pts</span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                    <p className="text-sm font-black uppercase text-slate-500">Total Project Points</p>
                    <p className="text-2xl font-black text-slate-900">12.5 Points</p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-indigo-600 rounded-2xl text-white">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Final Pricing Formula</p>
                <p className="text-lg font-bold mt-1">Total Points × $/Unit Rate = Installation Sell Price</p>
              </div>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
