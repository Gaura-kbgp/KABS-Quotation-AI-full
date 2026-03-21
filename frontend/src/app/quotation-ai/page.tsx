"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  UploadCloud,
  FileText,
  Loader2,
  ArrowLeft,
  Sparkles,
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function QuotationAiPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleUpload = async () => {
    if (!file) return;

    setIsProcessing(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectName', file.name.replace(/\.[^/.]+$/, ""));

    try {
      const res = await fetch('/api/upload-drawing', {
        method: 'POST',
        body: formData,
      });

      const contentType = res.headers.get("content-type");

      if (!contentType || !contentType.includes("application/json")) {
        throw new Error('Server timeout. This drawing set is too large for a single pass. Try uploading just the Cabinetry/Plan pages.');
      }

      const result = await res.json();

      if (res.ok && result.projectId) {
        toast({ title: 'Success', description: 'Takeoff complete.' });
        router.push(`/quotation-ai/review/${result.projectId}`);
      } else {
        throw new Error(result.error || 'AI analysis encountered an issue.');
      }
    } catch (err: any) {
      console.error('[Scan Process v86] Error:', err);
      toast({
        variant: 'destructive',
        title: 'Scan Interrupted',
        description: err.message
      });
      setIsProcessing(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6 flex flex-col items-center">
      <div className="w-full max-w-xl space-y-8 mt-4">
        <div className="flex justify-between items-center">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-sky-600">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          </Link>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 border border-sky-100">
            <Sparkles className="w-3 h-3 text-sky-600" />
            <span className="text-[10px] font-bold uppercase text-sky-600">Gemini 3.1 Flash Lite</span>
          </div>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Upload your drawing <span className="text-sky-600">PDF</span>
          </h1>
          <p className="text-sm text-slate-500">Hybrid AI Extraction Engine.</p>
        </div>

        <Card className="bg-white border-slate-200 shadow-lg">
          <CardContent className="p-6 space-y-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); setFile(e.dataTransfer.files[0]); }}
              className={cn(
                "border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all",
                isDragging ? "border-sky-500 bg-sky-50" : "border-slate-200 hover:border-sky-400",
                file ? "border-emerald-400 bg-emerald-50/20" : ""
              )}
            >
              <input id="up" type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <label htmlFor="up" className="cursor-pointer flex flex-col items-center w-full">
                {file ? (
                  <>
                    <FileText className="w-10 h-10 text-emerald-600 mb-2" />
                    <p className="text-sm font-bold text-emerald-700">{file.name}</p>
                    <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">Ready for Analysis</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-10 h-10 text-sky-500 mb-2" />
                    <p className="text-sm font-bold">Select Drawing PDF</p>
                    <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">Architectural Sets Supported</p>
                  </>
                )}
              </label>
            </div>

            <Button onClick={handleUpload} disabled={!file || isProcessing} className="w-full h-14 gradient-button">
              {isProcessing ? <Loader2 className="animate-spin mr-2" /> : <ChevronRight className="mr-2" />}
              {isProcessing ? 'Scanning Blueprint...' : 'Start Scan'}
            </Button>
          </CardContent>
        </Card>

        {isProcessing && (
          <div className="p-5 rounded-2xl bg-sky-50 border border-sky-100 flex items-start gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
            <div className="mt-1">
              <AlertCircle className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-sky-800 uppercase tracking-wider mb-1">Hybrid Mode Enabled</p>
              <p className="text-[11px] text-sky-700 leading-relaxed">Processing architectural anchors and cabinetry schedules.</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}