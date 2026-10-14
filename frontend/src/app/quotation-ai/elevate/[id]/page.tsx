import { requireUser } from '@/lib/auth';
import { scopedDb } from '@/lib/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { loadPricingProfile, loadManufacturers } from '@/features/elevate/actions';
import { ElevateProjectWorkbenchClient } from './elevate-project-workbench-client';

export const dynamic = 'force-dynamic';

export default async function ElevateProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const supabase = await scopedDb();

  let project: any = null;
  let error: string | null = null;
  try {
    const { data, error: pErr } = await supabase
      .from('quotation_projects')
      .select('id, project_name')
      .eq('id', id)
      .single();
    if (pErr) throw new Error(pErr.message);
    project = data;
  } catch (err: any) {
    error = err.message;
  }

  if (error || !project) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-8 text-center">
        <Card className="max-w-md p-12 rounded-[3rem]">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Project not found</h2>
          <p className="text-slate-500 mb-6">{error}</p>
          <Button asChild className="gradient-button rounded-xl">
            <Link href="/quotation-ai">Back to Home</Link>
          </Button>
        </Card>
      </main>
    );
  }

  const [saved, manufacturers] = await Promise.all([
    loadPricingProfile(id),
    loadManufacturers(),
  ]);

  return <ElevateProjectWorkbenchClient projectId={id} projectName={project.project_name} initial={saved} manufacturers={manufacturers} />;
}
