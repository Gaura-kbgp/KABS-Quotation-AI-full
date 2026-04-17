
"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Upload, 
  Trash2, 
  FileText, 
  History, 
  Loader2, 
  CheckCircle2,
  ExternalLink 
} from 'lucide-react';
import { deleteNkbaRuleAction } from '../actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export function NkbaRulesClient({ initialRules }: { initialRules: any[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [isUploading, setIsUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');

  // Use the most recent rule as the implied active one since we removed is_active
  const latestRule = rules.length > 0 ? rules[0] : null;

  const handleUpload = async () => {
    if (!file || !version) return;

    setIsUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('version', version);

    try {
      const response = await fetch('/api/upload-nkba', {
        method: 'POST',
        body: formData,
      });

      const res = await response.json();

      if (response.ok && res.success) {
        toast({ title: 'NKBA Rule Uploaded' });
        setFile(null);
        setVersion('');
        router.refresh();
      } else {
        toast({ variant: 'destructive', title: 'Upload Failed', description: res.error });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'API connection failed' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (rule: any) => {
    if (!confirm('Are you sure you want to delete this rule version?')) return;
    try {
      const res = await deleteNkbaRuleAction(rule.id, rule.file_url);
      if (res.success) {
        toast({ title: 'Rule deleted' });
        router.refresh();
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-8">
        <Card className="glass-card border-slate-200">
          <CardHeader>
             <CardTitle className="flex items-center gap-2 text-slate-900">
                <FileText className="w-5 h-5 text-sky-600" />
                Upload New Standard
             </CardTitle>
             <CardDescription>Streaming API upload enabled for large PDFs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Version Number</Label>
                  <Input 
                    placeholder="e.g. v32.1" 
                    value={version} 
                    onChange={e => setVersion(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>PDF File</Label>
                  <Input 
                    type="file" 
                    accept=".pdf" 
                    onChange={e => setFile(e.target.files?.[0] || null)}
                  />
                </div>
             </div>
             <Button 
               className="w-full gradient-button h-11" 
               disabled={isUploading || !file || !version}
               onClick={handleUpload}
             >
               {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
               {isUploading ? 'Streaming...' : 'Publish New Rule Set'}
             </Button>

             {latestRule && (
               <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                   <div>
                     <p className="text-sm font-bold text-emerald-900">Latest Version: {latestRule.version}</p>
                     <p className="text-xs text-emerald-600">{latestRule.file_name}</p>
                   </div>
                 </div>
                 <Button variant="ghost" size="icon" asChild>
                   <a href={latestRule.file_url} target="_blank"><ExternalLink className="w-4 h-4" /></a>
                 </Button>
               </div>
             )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-slate-400" />
              Version History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {rules.length === 0 ? (
                <div className="p-12 text-center text-slate-400">No rules uploaded yet.</div>
              ) : (
                rules.map((rule, idx) => (
                  <div key={rule.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        idx === 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                      )} />
                      <div>
                        <p className="text-sm font-semibold">Version {rule.version}</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                          {rule.file_name} • {new Date(rule.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" asChild><a href={rule.file_url} target="_blank"><ExternalLink className="w-4 h-4" /></a></Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-red-400 hover:text-red-600"
                        onClick={() => handleDelete(rule)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
