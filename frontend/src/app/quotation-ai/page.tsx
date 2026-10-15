"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  UploadCloud,
  FileText,
  Loader2,
  ArrowLeft,
  Sparkles,
  ChevronRight,
  AlertCircle,
  FolderOpen,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  Eye,
  Plus,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getProjectsAction } from './actions';

type ReviewStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'sent' | 'accepted' | 'rejected';

type Project = {
  id: string;
  project_name: string | null;
  review_status: string | null;
  bom_data: any;
  created_at: string;
  manufacturer_id: string | null;
};

const STATUS_CONFIG: Record<ReviewStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft:              { label: 'Draft',             color: 'bg-slate-100 text-slate-600 border-slate-200',       icon: <Clock className="w-3 h-3" /> },
  in_review:          { label: 'In Review',         color: 'bg-amber-50 text-amber-700 border-amber-200',        icon: <Eye className="w-3 h-3" /> },
  changes_requested:  { label: 'Changes Requested', color: 'bg-orange-50 text-orange-700 border-orange-200',     icon: <AlertCircle className="w-3 h-3" /> },
  approved:           { label: 'Approved',          color: 'bg-emerald-50 text-emerald-700 border-emerald-200',  icon: <CheckCircle2 className="w-3 h-3" /> },
  sent:               { label: 'Sent',              color: 'bg-sky-50 text-sky-700 border-sky-200',              icon: <Send className="w-3 h-3" /> },
  accepted:           { label: 'Accepted',          color: 'bg-green-50 text-green-700 border-green-200',        icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:           { label: 'Rejected',          color: 'bg-red-50 text-red-700 border-red-200',              icon: <XCircle className="w-3 h-3" /> },
};

const STEP_LABEL: Record<string, string> = {
  pricing:    'Pricing',
  breakdown:  'Breakdown',
  preview:    'Staff Review',
  invoice:    'Invoice',
  config:     'Config',
  compare:    'Compare',
};

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? 'draft') as ReviewStatus;
  const cfg = STATUS_CONFIG[s] ?? STATUS_CONFIG.draft;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border', cfg.color)}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function QuotationAiPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    const res = await getProjectsAction();
    setProjects(res.projects as Project[]);
    setLoadingProjects(false);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

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

  const isDraft = (p: Project) => !p.review_status || p.review_status === 'draft';
  const drafts = projects.filter(isDraft);
  const others = projects.filter(p => !isDraft(p));

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6 flex flex-col items-center">
      <div className="w-full max-w-2xl space-y-8 mt-4">

        {/* Header */}
        <div className="flex justify-between items-center">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-sky-600">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          </Link>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 border border-sky-100">
            <Sparkles className="w-3 h-3 text-sky-600" />
            <span className="text-[10px] font-bold uppercase text-sky-600">Fast Pricing AI</span>
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Quotation <span className="text-sky-600">Projects</span>
          </h1>
          <p className="text-sm text-slate-500">Resume a draft or start a new quote.</p>
        </div>

        {/* New Quote button / toggle */}
        <div className="flex justify-end">
          <Button
            onClick={() => setShowUpload(v => !v)}
            className={cn('gap-2', showUpload ? 'variant-outline border border-slate-200 bg-white text-slate-700' : 'gradient-button')}
          >
            {showUpload ? <XCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showUpload ? 'Cancel' : 'New Quote'}
          </Button>
        </div>

        {/* Upload panel */}
        {showUpload && (
          <Card className="bg-white border-slate-200 shadow-lg animate-in fade-in slide-in-from-top-2 duration-300">
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
        )}

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

        {/* Draft projects */}
        {(loadingProjects || drafts.length > 0) && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" /> Drafts in Progress
              </h2>
              <button onClick={loadProjects} className="text-slate-400 hover:text-sky-600 transition-colors" title="Refresh">
                <RefreshCw className={cn('w-3.5 h-3.5', loadingProjects && 'animate-spin')} />
              </button>
            </div>
            {loadingProjects ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            ) : (
              drafts.map(p => (
                <ProjectCard key={p.id} project={p} onResume={() => router.push(`/quotation-ai/bom/${p.id}`)} />
              ))
            )}
          </section>
        )}

        {/* Completed / other projects */}
        {others.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <FolderOpen className="w-3.5 h-3.5" /> All Quotes
            </h2>
            {others.map(p => (
              <ProjectCard key={p.id} project={p} onResume={() => router.push(`/quotation-ai/bom/${p.id}`)} />
            ))}
          </section>
        )}

        {/* Empty state */}
        {!loadingProjects && projects.length === 0 && !showUpload && (
          <div className="text-center py-16 space-y-4">
            <FolderOpen className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="text-sm text-slate-400">No quotes yet. Start one with the button above.</p>
          </div>
        )}

      </div>
    </main>
  );
}

function ProjectCard({ project: p, onResume }: { project: Project; onResume: () => void }) {
  const lastStep = p.bom_data?.lastStep as string | undefined;
  const name = p.project_name || 'Untitled Project';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-4 hover:border-sky-200 hover:shadow-md transition-all">
      <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center flex-shrink-0">
        <FileText className="w-5 h-5 text-sky-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-900 truncate">{name}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <StatusBadge status={p.review_status} />
          {lastStep && (
            <span className="text-[10px] text-slate-400 font-medium">
              Last: {STEP_LABEL[lastStep] ?? lastStep}
            </span>
          )}
          <span className="text-[10px] text-slate-300">{formatDate(p.created_at)}</span>
        </div>
      </div>
      <Button size="sm" onClick={onResume} className="gradient-button flex-shrink-0 text-xs px-4 h-8">
        Resume
      </Button>
    </div>
  );
}
