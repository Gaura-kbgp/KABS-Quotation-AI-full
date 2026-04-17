
import { createServerSupabase } from '@/lib/supabase-server';
import { EstimatorClient } from './estimator-client';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function ReviewProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabase();

  try {
    const [pRes, mRes] = await Promise.all([
      supabase.from('quotation_projects').select('*').eq('id', id).single(),
      supabase.from('manufacturers').select('id, name').eq('status', 'Active').order('name')
    ]);

    if (pRes.error || !pRes.data) {
      console.error('Project Fetch Error:', pRes.error);
      redirect('/quotation-ai');
    }

    const project = pRes.data;
    const manufacturers = mRes.data || [];

    return (
      <main className="min-h-screen bg-white text-slate-900">
         <EstimatorClient project={project} manufacturers={manufacturers} />
      </main>
    );

  } catch (err: any) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
        <Alert variant="destructive" className="max-w-xl bg-red-50 border-red-200 text-red-600">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle className="font-bold">Project Loading Error</AlertTitle>
          <AlertDescription className="mt-2">{err.message}</AlertDescription>
          <Link href="/quotation-ai" className="block mt-4">
             <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50">Return to Upload</Button>
          </Link>
        </Alert>
      </div>
    );
  }
}
