
"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Table as TableIcon,
  Trash2,
  ExternalLink,
  ArrowLeft,
  Loader2,
  Plus,
  FileUp,
  UploadCloud,
  CheckCircle2,
  Database,
  Hash,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  TrendingUp,
  Layers,
  Tag,
  BarChart3,
  FlaskConical,
} from 'lucide-react';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { deleteManufacturerFileAction } from '../../actions';
import { useRouter } from 'next/navigation';

interface CollectionStat {
  name: string;
  sku_count: number;
  rows: number;
  price_min: number;
  price_max: number;
}

interface ExtractionReport {
  collections: CollectionStat[];
  door_styles: string[];
  total_skus: number;
  total_rows: number;
}

interface SpecsSummary {
  collections: number;
  styles: number;
  skuCount: number;
  totalRows: number;
  collectionBreakdown?: Array<{ name: string; skuCount: number; rows: number }>;
}

interface ManufacturerDetailClientProps {
  id: string;
  manufacturer: any;
  initialFiles: any[];
  initialSpecsSummary: SpecsSummary;
}

const UPLOAD_STEPS = [
  { pct: 5,  msg: 'Uploading file to processing server…' },
  { pct: 20, msg: 'Parsing Excel structure & header rows…' },
  { pct: 45, msg: 'Extracting collections and SKU prices…' },
  { pct: 70, msg: 'Replacing old catalog data…' },
  { pct: 90, msg: 'Saving pricing records to database…' },
  { pct: 98, msg: 'Rebuilding pricing cache…' },
];

export function ManufacturerDetailClient({ id, manufacturer, initialFiles, initialSpecsSummary }: ManufacturerDetailClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [files, setFiles] = useState(initialFiles);
  const [specsSummary, setSpecsSummary] = useState<SpecsSummary>(initialSpecsSummary);
  const [extractionReport, setExtractionReport] = useState<ExtractionReport | null>(null);
  const [showCollections, setShowCollections] = useState(false);

  const [isAddingFile, setIsAddingFile] = useState<{ open: boolean; type: 'spec' | 'pricing' | null }>({ open: false, type: null });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusMsg, setUploadStatusMsg] = useState('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const stepRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!isAddingFile.open) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (stepRef.current) { clearInterval(stepRef.current); stepRef.current = null; }
    }
  }, [isAddingFile.open]);

  // Animate through progress steps during a long-running upload
  const startProgressAnimation = (steps: typeof UPLOAD_STEPS) => {
    let idx = 0;
    setUploadProgress(steps[0].pct);
    setUploadStatusMsg(steps[0].msg);
    stepRef.current = setInterval(() => {
      idx = Math.min(idx + 1, steps.length - 1);
      setUploadProgress(steps[idx].pct);
      setUploadStatusMsg(steps[idx].msg);
      if (idx === steps.length - 1) {
        clearInterval(stepRef.current!);
        stepRef.current = null;
      }
    }, 2200);
  };

  const handleFileUpload = async () => {
    if (!uploadFile || !isAddingFile.type) return;
    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatusMsg('');

    const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const isSpecPdf = isAddingFile.type === 'spec' && uploadFile.name.toLowerCase().endsWith('.pdf');

    // ── Spec PDF → async job with polling ────────────────────────────────────
    if (isSpecPdf) {
      const formData = new FormData();
      formData.append('file', uploadFile);
      try {
        setUploadProgress(2);
        setUploadStatusMsg('Uploading specification book…');
        const res = await fetch(`${BACKEND}/api/upload-spec-book?manufacturer_id=${id}`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');

        const jobId: string = data.job_id;
        setUploadProgress(5);
        setUploadStatusMsg('Processing in background…');

        pollRef.current = setInterval(async () => {
          try {
            const sRes = await fetch(`${BACKEND}/api/spec-job/${jobId}`);
            const status = await sRes.json();
            if (status.success) {
              setUploadProgress(status.progress ?? 0);
              setUploadStatusMsg(status.message ?? '');
              if (status.status === 'done') {
                clearInterval(pollRef.current!); pollRef.current = null;
                toast({ title: 'Spec Book Processed', description: `Extracted ${status.count} records from ${data.fileName}` });
                setIsAddingFile({ open: false, type: null });
                setUploadFile(null);
                setIsUploading(false);
                router.refresh();
              } else if (status.status === 'error') {
                clearInterval(pollRef.current!); pollRef.current = null;
                throw new Error(status.error || 'Processing failed');
              }
            }
          } catch (e: any) {
            clearInterval(pollRef.current!); pollRef.current = null;
            toast({ variant: 'destructive', title: 'Processing Error', description: e.message });
            setIsUploading(false);
          }
        }, 2000);
      } catch (e: any) {
        toast({ variant: 'destructive', title: 'Upload Failed', description: e.message });
        setIsUploading(false);
      }
      return;
    }

    // ── Pricing file → Python backend directly (proper collection extraction) ─
    if (isAddingFile.type === 'pricing') {
      startProgressAnimation(UPLOAD_STEPS);
      const formData = new FormData();
      formData.append('file', uploadFile);
      try {
        const res = await fetch(`${BACKEND}/api/upload-pricing?manufacturer_id=${id}`, { method: 'POST', body: formData });
        const data = await res.json();

        if (stepRef.current) { clearInterval(stepRef.current); stepRef.current = null; }

        if (!res.ok || !data.success) throw new Error(data.error || 'Extraction failed');

        setUploadProgress(100);
        setUploadStatusMsg(`Done — ${data.count} records extracted`);

        if (data.report) setExtractionReport(data.report);

        toast({
          title: 'Pricing Catalog Updated',
          description: `${data.count} records across ${data.report?.collections?.length ?? 0} collections extracted from ${data.fileName}`,
        });

        setIsAddingFile({ open: false, type: null });
        setUploadFile(null);
        router.refresh();
      } catch (e: any) {
        if (stepRef.current) { clearInterval(stepRef.current); stepRef.current = null; }
        toast({ variant: 'destructive', title: 'Upload Failed', description: e.message });
      } finally {
        setIsUploading(false);
      }
      return;
    }

    // ── Other non-PDF spec uploads via Next.js route ───────────────────────
    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('manufacturerId', id);
    try {
      setUploadStatusMsg('Uploading…');
      const res = await fetch('/api/upload-spec', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok || result.error) {
        toast({ variant: 'destructive', title: 'Upload Failed', description: result.error });
      } else {
        toast({ title: 'File Uploaded', description: result.fileName });
        setIsAddingFile({ open: false, type: null });
        setUploadFile(null);
        router.refresh();
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Network Error', description: e.message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleCatalogDiagnose = async () => {
    try {
      const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
      const res = await fetch(`${BACKEND}/api/catalog-check?manufacturer_id=${id}`);
      const data = await res.json();
      
      if (!data.success) {
        toast({ 
          variant: 'destructive', 
          title: 'Catalog Check Failed', 
          description: data.error || 'The pricing backend could not be reached.' 
        });
        return;
      }

      if (data.total_rows === 0) {
        toast({
          variant: 'destructive',
          title: `No Data Found: ${manufacturer.name}`,
          description: (
            <div className="space-y-2 mt-2">
              <p className="text-xs font-medium text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-100">
                {data.warning || "No pricing catalog has been uploaded for this manufacturer ID yet."}
              </p>
              <p className="text-[10px] text-slate-400">Checked ID: {id}</p>
            </div>
          ),
        });
      } else {
        const cols = (data.collections || []).slice(0, 10).join(', ');
        const sample = data.sample_skus?.[0]?.sku || 'None';
        
        toast({
          title: `Catalog Health Check: ${manufacturer.name}`,
          description: (
            <div className="space-y-2 mt-2">
              <div className="flex justify-between text-xs border-b border-slate-100 pb-1">
                <span className="text-slate-500 font-medium">Total Records:</span>
                <span className="font-black text-sky-600">{data.total_rows.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs border-b border-slate-100 pb-1">
                <span className="text-slate-500 font-medium">Cache Status:</span>
                <span className="font-bold text-emerald-600 uppercase tracking-tighter">{data.cache_status}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Collections ({data.collections?.length || 0})</span>
                <p className="text-[10px] text-slate-600 leading-tight">
                  {cols}{data.collections?.length > 10 ? ' ...' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px] pt-1">
                <span className="text-slate-400">Sample SKU:</span>
                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{sample}</span>
              </div>
            </div>
          ),
        });
      }
    } catch (err: any) {
      toast({ 
        variant: 'destructive', 
        title: 'Diagnose Error', 
        description: 'Failed to connect to the pricing intelligence service.' 
      });
    }
  };

  const handleDeleteFile = async (file: any) => {
    if (!confirm('Delete this file and all associated pricing records?')) return;
    try {
      const result = await deleteManufacturerFileAction(file.id, file.file_url, id);
      if (result.success) {
        toast({ title: 'File deleted' });
        setExtractionReport(null);
        router.refresh();
      } else {
        toast({ variant: 'destructive', title: 'Delete Failed', description: result.error });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const summaryCollections = extractionReport?.collections ?? specsSummary.collectionBreakdown?.map(c => ({
    name: c.name, sku_count: c.skuCount, rows: c.rows, price_min: 0, price_max: 0,
  })) ?? [];

  const displayCollections = specsSummary.collections || extractionReport?.collections?.length || 0;
  const displayStyles      = specsSummary.styles || extractionReport?.door_styles?.length || 0;
  const displaySkus        = specsSummary.skuCount || extractionReport?.total_skus || 0;
  const displayRows        = specsSummary.totalRows || extractionReport?.total_rows || 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/manufacturers">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="w-6 h-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{manufacturer.name}</h1>
          <p className="text-slate-500">Manage technical specifications and pricing documents.</p>
        </div>
        <div className="ml-auto">
          <Button 
            variant="outline" 
            onClick={handleCatalogDiagnose} 
            className="rounded-xl h-11 border-amber-200 text-amber-700 hover:bg-amber-50 shadow-sm font-bold"
          >
            <FlaskConical className="w-4 h-4 mr-2" />
            Diagnose Catalog
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">

          {/* Spec Books */}
          <Card className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
              <div>
                <CardTitle className="text-xl flex items-center gap-2">
                  <FileText className="w-5 h-5 text-sky-600" />
                  Specification Books
                </CardTitle>
                <CardDescription>Multiple PDF catalogs support.</CardDescription>
              </div>
              <Button onClick={() => setIsAddingFile({ open: true, type: 'spec' })} variant="outline" size="sm" className="rounded-xl">
                <Plus className="w-4 h-4 mr-2" />Add PDF
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100">
                {files.filter(f => f.file_type === 'spec').length === 0 ? (
                  <div className="p-12 text-center text-slate-400">No specification books uploaded.</div>
                ) : files.filter(f => f.file_type === 'spec').map(file => (
                  <div key={file.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-sky-500" />
                      <div>
                        <p className="text-sm font-semibold">{file.file_name}</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest" suppressHydrationWarning>
                          {mounted ? new Date(file.created_at).toLocaleDateString() : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {file.file_url && file.file_url !== '#' && (
                        <Button variant="ghost" size="icon" asChild>
                          <a href={file.file_url} target="_blank"><ExternalLink className="w-4 h-4" /></a>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteFile(file)} className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Pricing Files */}
          <Card className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
              <div>
                <CardTitle className="text-xl flex items-center gap-2">
                  <TableIcon className="w-5 h-5 text-emerald-600" />
                  Pricing Files (XLSX, XLSM, CSV)
                </CardTitle>
                <CardDescription>
                  Automatically extracts collections, door styles, and per-SKU prices.
                </CardDescription>
              </div>
              <Button onClick={() => setIsAddingFile({ open: true, type: 'pricing' })} variant="outline" size="sm" className="rounded-xl border-emerald-100 text-emerald-600">
                <Plus className="w-4 h-4 mr-2" />Add File
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100">
                {files.filter(f => f.file_type === 'pricing').length === 0 ? (
                  <div className="p-12 text-center text-slate-400">No pricing files uploaded.</div>
                ) : files.filter(f => f.file_type === 'pricing').map(file => (
                  <div key={file.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <TableIcon className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-semibold">{file.file_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-slate-400 uppercase tracking-widest" suppressHydrationWarning>
                            {mounted ? new Date(file.created_at).toLocaleDateString() : ''}
                          </span>
                          <Badge className="px-1.5 py-0 text-[9px] bg-emerald-50 text-emerald-700 border-emerald-100 rounded-full font-bold">
                            Catalog Active
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {file.file_url && file.file_url !== '#' && (
                        <Button variant="ghost" size="icon" asChild>
                          <a href={file.file_url} target="_blank"><ExternalLink className="w-4 h-4" /></a>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteFile(file)} className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Extraction Report — shown after a successful upload in the same session */}
          {extractionReport && extractionReport.collections.length > 0 && (
            <Card className="glass-card border-emerald-200">
              <CardHeader className="border-b border-emerald-100 pb-4">
                <CardTitle className="text-lg flex items-center gap-2 text-emerald-800">
                  <BarChart3 className="w-5 h-5 text-emerald-600" />
                  Last Extraction Report
                </CardTitle>
                <CardDescription>
                  {extractionReport.total_rows.toLocaleString()} records · {extractionReport.total_skus.toLocaleString()} unique SKUs · {extractionReport.collections.length} collections
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
                    <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">Collections</p>
                    <p className="text-2xl font-black text-emerald-800">{extractionReport.collections.length}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-sky-50 border border-sky-100 text-center">
                    <p className="text-[10px] text-sky-600 font-bold uppercase tracking-widest">Door Styles</p>
                    <p className="text-2xl font-black text-sky-800">{extractionReport.door_styles.length}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-purple-50 border border-purple-100 text-center">
                    <p className="text-[10px] text-purple-600 font-bold uppercase tracking-widest">Unique SKUs</p>
                    <p className="text-2xl font-black text-purple-800">{extractionReport.total_skus.toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-center">
                    <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">Total Records</p>
                    <p className="text-2xl font-black text-amber-800">{extractionReport.total_rows.toLocaleString()}</p>
                  </div>
                </div>

                {/* Collection breakdown table */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Collection Breakdown</p>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {extractionReport.collections.map((col, i) => (
                      <div key={i} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50/50">
                        <div className="flex items-center gap-2 min-w-0">
                          <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="text-sm font-semibold text-slate-800 truncate">{col.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-3">
                          <span className="text-xs text-slate-500">{col.sku_count} SKUs</span>
                          {col.price_max > 0 && (
                            <span className="text-xs text-emerald-600 font-semibold">
                              ${col.price_min.toLocaleString()}–${col.price_max.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Door styles */}
                {extractionReport.door_styles.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Door Styles Detected</p>
                    <div className="flex flex-wrap gap-1.5">
                      {extractionReport.door_styles.map(s => (
                        <Badge key={s} variant="outline" className="text-xs bg-white text-slate-600 border-slate-200">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Extraction Summary sidebar ─────────────────────────────────────── */}
        <div className="space-y-6">
          <Card className="glass-card sticky top-24">
            <CardHeader className="border-b border-slate-100 pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-sky-600" />
                Extraction Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              {/* 4 KPI tiles */}
              <div className="grid grid-cols-2 gap-3">
                <div className={cn(
                  "p-3 rounded-xl border flex flex-col gap-0.5",
                  displayCollections > 0 ? "bg-sky-50 border-sky-100" : "bg-slate-50 border-slate-100"
                )}>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Collections</p>
                  <p className={cn("text-2xl font-black", displayCollections > 0 ? "text-sky-700" : "text-slate-300")}>
                    {displayCollections}
                  </p>
                </div>
                <div className={cn(
                  "p-3 rounded-xl border flex flex-col gap-0.5",
                  displayStyles > 0 ? "bg-emerald-50 border-emerald-100" : "bg-slate-50 border-slate-100"
                )}>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Door Styles</p>
                  <p className={cn("text-2xl font-black", displayStyles > 0 ? "text-emerald-700" : "text-slate-300")}>
                    {displayStyles}
                  </p>
                </div>
                <div className={cn(
                  "p-3 rounded-xl border flex flex-col gap-0.5",
                  displaySkus > 0 ? "bg-purple-50 border-purple-100" : "bg-slate-50 border-slate-100"
                )}>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Active SKUs</p>
                  <p className={cn("text-2xl font-black", displaySkus > 0 ? "text-purple-700" : "text-slate-300")}>
                    {displaySkus > 0 ? displaySkus.toLocaleString() : 0}
                  </p>
                </div>
                <div className={cn(
                  "p-3 rounded-xl border flex flex-col gap-0.5",
                  displayRows > 0 ? "bg-amber-50 border-amber-100" : "bg-slate-50 border-slate-100"
                )}>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Records</p>
                  <p className={cn("text-2xl font-black", displayRows > 0 ? "text-amber-700" : "text-slate-300")}>
                    {displayRows > 0 ? displayRows.toLocaleString() : 0}
                  </p>
                </div>
              </div>

              {/* Collection breakdown (collapsible) */}
              {summaryCollections.length > 0 && (
                <div className="rounded-xl border border-slate-100 overflow-hidden">
                  <button
                    onClick={() => setShowCollections(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Collections ({summaryCollections.length})
                    </span>
                    {showCollections ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                  </button>
                  {showCollections && (
                    <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
                      {summaryCollections.map((col, i) => (
                        <div key={i} className="px-3 py-2 flex items-center justify-between">
                          <span className="text-xs text-slate-700 truncate mr-2 font-medium">{col.name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{col.sku_count} SKUs</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {displayRows === 0 && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    No pricing data loaded. Upload an Excel pricing file to populate the catalog.
                  </p>
                </div>
              )}

              {displayRows > 0 && (
                <div className="p-3 rounded-xl bg-sky-50 border border-sky-100">
                  <p className="text-[10px] text-sky-600 uppercase font-black tracking-widest mb-1">Normalized Capacity</p>
                  <p className="text-sm text-sky-700 font-semibold">{displayRows.toLocaleString()} pricing records stored.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Upload dialog ───────────────────────────────────────────────────── */}
      <Dialog open={isAddingFile.open} onOpenChange={(open) => !open && setIsAddingFile({ open: false, type: null })}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isAddingFile.type === 'pricing' ? (
                <><TableIcon className="w-5 h-5 text-emerald-600" /> Upload Pricing File</>
              ) : (
                <><FileText className="w-5 h-5 text-sky-600" /> Upload Specification Book</>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) setUploadFile(f); }}
              className={cn(
                "border-2 border-dashed rounded-2xl p-8 transition-all flex flex-col items-center text-center cursor-pointer",
                isDragging ? "border-sky-500 bg-sky-50" : "border-slate-200 hover:border-sky-400 hover:bg-slate-50/50",
                uploadFile ? "border-emerald-400 bg-emerald-50/20" : ""
              )}
            >
              <input
                id="file-input"
                type="file"
                accept={isAddingFile.type === 'pricing' ? '.xlsx,.xlsm,.csv,.pdf' : '.pdf'}
                className="hidden"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
              />
              <label htmlFor="file-input" className="cursor-pointer w-full flex flex-col items-center gap-2">
                {uploadFile ? (
                  <>
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                    <p className="text-sm font-bold text-emerald-700">{uploadFile.name}</p>
                    <p className="text-xs text-slate-400">({(uploadFile.size / (1024 * 1024)).toFixed(1)} MB) — ready to upload</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-10 h-10 text-slate-300" />
                    <p className="text-sm font-medium text-slate-600">
                      Drag & drop or <span className="text-sky-600">browse</span>
                    </p>
                    {isAddingFile.type === 'pricing' ? (
                      <p className="text-xs text-slate-400">XLSX / XLSM / CSV — multi-sheet, multi-tier catalogs supported</p>
                    ) : (
                      <p className="text-xs text-slate-400">PDF specification catalog</p>
                    )}
                  </>
                )}
              </label>
            </div>

            {/* How it works hint for pricing */}
            {isAddingFile.type === 'pricing' && !isUploading && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">What gets extracted</p>
                <ul className="space-y-1.5">
                  {[
                    { icon: Layers, color: 'text-sky-500', text: 'Every price tier column becomes a named Collection (e.g. PRIME MAPLE, ELITE CHERRY)' },
                    { icon: Tag,    color: 'text-emerald-500', text: 'Door styles detected from column headers (FACE FRAME, FRAMELESS, etc.)' },
                    { icon: Hash,   color: 'text-purple-500', text: 'Each SKU stored with its collection-specific price — no more UNIVERSAL fallback' },
                    { icon: TrendingUp, color: 'text-amber-500', text: 'Old catalog data is replaced so pricing is always fresh and accurate' },
                  ].map(({ icon: Icon, color, text }, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Icon className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", color)} />
                      <span className="text-xs text-slate-600">{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Progress bar */}
            {isUploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span className="font-medium">{uploadStatusMsg || 'Processing…'}</span>
                  <span className="font-bold text-sky-600">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-500 transition-all duration-700"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <Button
              onClick={handleFileUpload}
              className="w-full h-11 gradient-button"
              disabled={isUploading || !uploadFile}
            >
              {isUploading
                ? <><Loader2 className="animate-spin w-4 h-4 mr-2" />{uploadStatusMsg || 'Processing…'}</>
                : <><FileUp className="w-4 h-4 mr-2" />Upload & Extract</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
