
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
}
