import { createServerSupabase } from '@/lib/supabase-server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { BomManagerClient } from './bom-manager-client';

export default async function BomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabase();

  let project = null;
  let manufacturerName = 'Standard Production';
  let bom: any[] = [];
  let error: string | null = null;

  try {
    const [pRes, bRes] = await Promise.all([
      supabase.from('quotation_projects').select('*').eq('id', id).single(),
      supabase.from('quotation_boms').select('*').eq('project_id', id)
    ]);

    if (pRes.error) throw new Error(pRes.error.message);
    project = pRes.data;
    bom = bRes.data || [];

    if (project?.manufacturer_id) {
      const { data: mData } = await supabase
        .from('manufacturers')
        .select('name')
        .eq('id', project.manufacturer_id)
        .single();
      if (mData) manufacturerName = mData.name;
    }
  } catch (err: any) {
    error = err.message;
  }

  if (error || !project) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-8 text-center">
        <Card className="max-w-md p-12 rounded-[3rem]">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Quotation Error</h2>
          <p className="text-slate-500 mb-6">{error}</p>
          <Button asChild className="gradient-button rounded-xl"><Link href="/quotation-ai">Back to Home</Link></Button>
        </Card>
      </main>
    );
  }

  return (
    <BomManagerClient 
      id={id}
      project={project}
      initialBom={bom}
      manufacturerName={manufacturerName}
    />
  );
}
