
import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { getSelectedManufacturers } from '@/features/manufacturers/data';
import { EstimatorClient } from './estimator-client';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function ReviewProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const supabase = await scopedDb();

  const [pRes, { manufacturers }] = await Promise.all([
    supabase.from('quotation_projects').select('*').eq('id', id).single(),
    getSelectedManufacturers(),
  ]);

  if (pRes.error || !pRes.data) {
    console.error('Project Fetch Error:', pRes.error);
    redirect('/quotation-ai');
  }

  const project = pRes.data;

  return (
    <main className="min-h-screen bg-white text-slate-900">
       <EstimatorClient project={project} manufacturers={manufacturers} />
    </main>
  );
}
