
import { createServerSupabase } from '@/lib/supabase-server';
import { NkbaRulesClient } from './nkba-rules-client';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from 'lucide-react';

export default async function NkbaRulesPage() {
  const supabase = createServerSupabase();
  
  let rules: any[] = [];
  let error: string | null = null;

  try {
    const { data, error: fetchError } = await supabase
      .from('nkba_files')
      .select('*')
      .order('created_at', { ascending: false });

    if (fetchError) throw new Error(fetchError.message);
    rules = data || [];
  } catch (err: any) {
    console.error('NKBA Fetch Error:', err.message);
    error = err.message;
  }

  if (error) return (
    <div className="p-8">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Connection Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">NKBA Rules Management</h1>
        <p className="text-slate-500 mt-1">Upload and manage National Kitchen & Bath Association standards.</p>
      </div>

      <NkbaRulesClient initialRules={rules} />
    </div>
  );
}
