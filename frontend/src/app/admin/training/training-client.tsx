"use client";

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, Trash2, FileText, Loader2, Brain,
  BookOpen, FileSpreadsheet, Ruler, CheckCircle2,
  AlertTriangle, Plus, ChevronDown, ChevronUp,
  Sparkles, Info, Database, FolderPlus,
} from 'lucide-react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

const DOC_TYPES = [
  { value: 'spec_book',         label: 'Spec Book',       icon: BookOpen,        color: 'text-blue-600 bg-blue-50' },
  { value: 'nkba_rules',        label: 'NKBA Rules',      icon: Ruler,           color: 'text-purple-600 bg-purple-50' },
  { value: 'pricing_sheet',     label: 'Pricing Sheet',   icon: FileSpreadsheet, color: 'text-emerald-600 bg-emerald-50' },
  { value: 'manufacturer_data', label: 'Manufacturer Data', icon: Brain,         color: 'text-amber-600 bg-amber-50' },
  { value: 'general',           label: 'General',         icon: FileText,        color: 'text-slate-600 bg-slate-100' },
];

interface TrainingDoc {
  id: string;
  name: string;
  description: string;
  doc_type: string;
  file_name: string;
  file_url: string;
  manufacturer_name: string;
  extracted_knowledge: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export function TrainingClient() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<TrainingDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [availableFiles, setAvailableFiles] = useState<any[]>([]);
  const [showImportList, setShowImportList] = useState(false);
  const [isImporting, setIsImporting] = useState<string | null>(null);

  const [form, setForm] = useState({
    doc_name: '',
    doc_type: 'spec_book',
    description: '',
    manufacturer_name: '',
    file: null as File | null,
    file_id: '', // For existing files
  });

  useEffect(() => { 
    fetchDocs(); 
    fetchAvailableFiles();
  }, []);

  const fetchAvailableFiles = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/available-manufacturer-files`);
      const data = await res.json();
      if (data.success) {
        setAvailableFiles(data.files || []);
      }
    } catch (err) {
      console.error('Failed to load available manufacturer files', err);
    }
  };

  const fetchDocs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/training-docs`);
      const data = await res.json();
      setDocs(data.documents || []);
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load training documents' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!form.file || !form.doc_name.trim()) {
      toast({ variant: 'destructive', title: 'Please provide a file and document name' });
      return;
    }

    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', form.file);
      fd.append('doc_name', form.doc_name.trim());
      fd.append('doc_type', form.doc_type);
      fd.append('description', form.description);
      fd.append('manufacturer_name', form.manufacturer_name);

      const res = await fetch(`${BACKEND_URL}/api/agent/process-training-doc`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();

      if (data.success) {
        toast({ title: 'Training document processed!', description: data.message });
        setForm({ doc_name: '', doc_type: 'spec_book', description: '', manufacturer_name: '', file: null, file_id: '' });
        setShowUploadForm(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchDocs();
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: err.message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleImport = async (file: any) => {
    setIsImporting(file.id);
    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/train-from-existing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: file.id,
          doc_name: file.file_name,
          doc_type: file.file_type === 'spec' ? 'spec_book' : 'pricing_sheet',
          manufacturer_name: file.manufacturer_name
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast({ title: 'AI Training Started', description: data.message });
        fetchDocs();
        fetchAvailableFiles();
      } else {
        throw new Error(data.error || 'Import failed');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: err.message });
    } finally {
      setIsImporting(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/training-docs/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Document removed from training data' });
        setDocs(prev => prev.filter(d => d.id !== id));
      } else throw new Error(data.error);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message });
    } finally {
      setDeletingId(null);
    }
  };

  const getDocTypeInfo = (type: string) => DOC_TYPES.find(t => t.value === type) || DOC_TYPES[4];

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const formatBytes = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <Brain className="w-6 h-6 text-sky-500" />
              AI Training Knowledge Base
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Upload spec books, NKBA rules, pricing sheets — the AI learns permanently and uses them for smarter cabinet matching.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="rounded-2xl h-12 px-5 font-bold border-sky-200 text-sky-600 bg-sky-50/50 hover:bg-sky-50"
              onClick={() => setShowImportList(!showImportList)}
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              Import from Manufacturer
            </Button>
            <Button
              className="gradient-button rounded-2xl h-12 px-5 font-bold"
              onClick={() => setShowUploadForm(!showUploadForm)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Training Data
            </Button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 flex gap-3">
          <Info className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
          <div className="text-sm text-sky-800">
            <p className="font-bold mb-1">How Training Works</p>
            <p>After uploading, the AI reads your document (spec book, NKBA rules, pricing sheet) and extracts
            cabinet codes, naming conventions, dimension formats, and series information.
            This knowledge is stored permanently and used automatically when detecting manufacturers,
            generating BOM descriptions, and matching cabinet codes.</p>
          </div>
        </div>

        {/* Import List */}
        {showImportList && (
          <Card className="rounded-3xl border-sky-200 shadow-lg bg-white overflow-hidden">
            <CardHeader className="border-b border-sky-100 p-5 bg-sky-50/30">
              <CardTitle className="text-base flex items-center gap-2 text-sky-800">
                <Database className="w-4 h-4" />
                Select Existing Manufacturer Files
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-h-[400px] overflow-y-auto">
              <div className="divide-y divide-slate-100">
                {availableFiles.length === 0 ? (
                  <div className="p-12 text-center text-slate-400">No manufacturer files found.</div>
                ) : (
                  availableFiles.map(file => (
                    <div key={file.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${file.file_type === 'spec' ? 'bg-blue-50 text-blue-500' : 'bg-emerald-50 text-emerald-500'}`}>
                          {file.file_type === 'spec' ? <BookOpen className="w-4 h-4" /> : <FileSpreadsheet className="w-4 h-4" />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{file.file_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{file.manufacturer_name}</span>
                            <span className="text-slate-200">•</span>
                            <span className="text-[10px] text-slate-400">{formatDate(file.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={file.is_already_trained ? "ghost" : "outline"}
                        className={`rounded-xl h-9 px-4 font-bold ${file.is_already_trained ? 'text-emerald-500' : 'border-sky-100 text-sky-600 hover:bg-sky-50'}`}
                        disabled={file.is_already_trained || isImporting === file.id}
                        onClick={() => handleImport(file)}
                      >
                        {file.is_already_trained ? (
                          <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Already Trained</>
                        ) : isImporting === file.id ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Training...</>
                        ) : (
                          <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> Train AI</>
                        )}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
            <div className="p-3 bg-slate-50 border-t border-slate-100 text-center">
               <Button variant="ghost" size="sm" onClick={() => setShowImportList(false)} className="text-slate-500 hover:text-slate-700">
                 Close List
               </Button>
            </div>
          </Card>
        )}
        {showUploadForm && (
          <Card className="rounded-3xl border-sky-200 shadow-lg bg-gradient-to-br from-sky-50 to-white">
            <CardHeader className="border-b border-sky-100 p-5">
              <CardTitle className="text-base flex items-center gap-2 text-sky-800">
                <Upload className="w-4 h-4" />
                Upload Training Document
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {/* Document Type */}
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2 block">
                  Document Type
                </label>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {DOC_TYPES.map(dt => {
                    const Icon = dt.icon;
                    return (
                      <button
                        key={dt.value}
                        onClick={() => setForm(p => ({ ...p, doc_type: dt.value }))}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all text-center ${
                          form.doc_type === dt.value
                            ? 'border-sky-500 bg-sky-50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <Icon className={`w-5 h-5 ${form.doc_type === dt.value ? 'text-sky-500' : 'text-slate-400'}`} />
                        <span className={`text-[10px] font-bold ${form.doc_type === dt.value ? 'text-sky-700' : 'text-slate-500'}`}>
                          {dt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* File Upload */}
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2 block">
                  File (PDF, Excel, CSV, TXT)
                </label>
                <div
                  className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center cursor-pointer hover:border-sky-400 hover:bg-sky-50/50 transition-all"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {form.file ? (
                    <div className="flex items-center justify-center gap-3 text-slate-700">
                      <FileText className="w-6 h-6 text-sky-500" />
                      <div className="text-left">
                        <p className="font-bold text-sm">{form.file.name}</p>
                        <p className="text-xs text-slate-400">{formatBytes(form.file.size)}</p>
                      </div>
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 ml-2" />
                    </div>
                  ) : (
                    <div className="text-slate-400">
                      <Upload className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-sm font-bold">Click to choose file</p>
                      <p className="text-xs mt-1">PDF, XLSX, XLS, CSV, TXT</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.xlsx,.xls,.xlsm,.csv,.txt"
                  onChange={e => setForm(p => ({ ...p, file: e.target.files?.[0] || null }))}
                />
              </div>

              {/* Name */}
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2 block">
                  Document Name *
                </label>
                <Input
                  placeholder="e.g., Integrity Cabinets Spec Book 2024"
                  value={form.doc_name}
                  onChange={e => setForm(p => ({ ...p, doc_name: e.target.value }))}
                  className="rounded-2xl border-slate-200 bg-white h-12"
                />
              </div>

              {/* Manufacturer Name */}
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2 block">
                  Manufacturer Name (optional)
                </label>
                <Input
                  placeholder="e.g., Integrity Cabinets, KraftMaid, Merillat..."
                  value={form.manufacturer_name}
                  onChange={e => setForm(p => ({ ...p, manufacturer_name: e.target.value }))}
                  className="rounded-2xl border-slate-200 bg-white h-12"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2 block">
                  What does this document contain?
                </label>
                <textarea
                  placeholder="Describe the content: e.g., 'Full spec book for Integrity Cabinets Elite series. Contains all SKU codes, dimension tables, and finish options for 2024 catalog.'"
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="rounded-2xl h-12 px-5"
                  onClick={() => setShowUploadForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 h-12 gradient-button rounded-2xl font-bold"
                  onClick={handleUpload}
                  disabled={isUploading || !form.file || !form.doc_name.trim()}
                >
                  {isUploading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />AI Processing...</>
                  ) : (
                    <><Sparkles className="w-4 h-4 mr-2" />Upload & Train AI</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Documents List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">
              Training Documents ({docs.length})
            </h2>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
            </div>
          ) : docs.length === 0 ? (
            <Card className="rounded-3xl border-dashed border-slate-300 shadow-none">
              <CardContent className="p-12 text-center">
                <Brain className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="font-bold text-slate-500">No training documents yet</p>
                <p className="text-sm text-slate-400 mt-1">
                  Upload spec books, NKBA rules, or pricing sheets to train the AI.
                </p>
              </CardContent>
            </Card>
          ) : (
            docs.map(doc => {
              const typeInfo = getDocTypeInfo(doc.doc_type);
              const TypeIcon = typeInfo.icon;
              const isExpanded = expandedDoc === doc.id;
              const knowledge = doc.extracted_knowledge || {};

              return (
                <Card key={doc.id} className="rounded-3xl border-slate-200 shadow-sm overflow-hidden">
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${typeInfo.color}`}>
                      <TypeIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-900 truncate">{doc.name}</p>
                        <Badge variant="outline" className={`text-[10px] font-bold uppercase tracking-widest px-2 ${typeInfo.color}`}>
                          {typeInfo.label}
                        </Badge>
                        {doc.manufacturer_name && (
                          <Badge variant="outline" className="text-[10px] text-sky-600 border-sky-200 bg-sky-50">
                            {doc.manufacturer_name}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <p className="text-xs text-slate-400">{doc.file_name}</p>
                        <span className="text-slate-200">•</span>
                        <p className="text-xs text-slate-400">{formatDate(doc.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs text-emerald-600 font-bold">Active</span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-4 space-y-4 animate-in fade-in">
                      {doc.description && (
                        <div>
                          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Description</p>
                          <p className="text-sm text-slate-600">{doc.description}</p>
                        </div>
                      )}

                      {/* Extracted Knowledge */}
                      {Object.keys(knowledge).length > 0 && (
                        <div>
                          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                            AI Extracted Knowledge
                          </p>
                          <div className="grid grid-cols-1 gap-2">
                            {!!knowledge.document_summary && (
                              <div className="bg-white rounded-2xl p-3 border border-slate-200 text-sm text-slate-600">
                                <p className="font-bold text-xs text-slate-500 mb-1">Summary</p>
                                <span>{String(knowledge.document_summary)}</span>
                              </div>
                            )}
                            {Array.isArray(knowledge.coding_rules) && (knowledge.coding_rules as string[]).length > 0 && (
                              <div className="bg-white rounded-2xl p-3 border border-slate-200">
                                <p className="font-bold text-xs text-slate-500 mb-2">Coding Rules</p>
                                <ul className="text-sm text-slate-600 space-y-1">
                                  {(knowledge.coding_rules as string[]).slice(0, 5).map((rule, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                      <span className="text-sky-400 mt-0.5">›</span>
                                      {rule}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {!!knowledge.key_codes && Object.keys(knowledge.key_codes as object).length > 0 && (
                              <div className="bg-white rounded-2xl p-3 border border-slate-200">
                                <p className="font-bold text-xs text-slate-500 mb-2">Key Codes</p>
                                <div className="flex flex-wrap gap-2">
                                  {Object.entries(knowledge.key_codes as Record<string,string>).slice(0, 12).map(([code, meaning]) => (
                                    <div key={code} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                                      <span className="font-mono font-bold text-sky-700">{code}</span>
                                      <span className="text-slate-500 ml-1">= {meaning}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300"
                          onClick={() => handleDelete(doc.id)}
                          disabled={deletingId === doc.id}
                        >
                          {deletingId === doc.id ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          Remove from Training
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
