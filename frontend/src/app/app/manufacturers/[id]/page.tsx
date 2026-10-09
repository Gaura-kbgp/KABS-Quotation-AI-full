import { requireDealerAdmin } from '@/lib/auth';
import { getManufacturerDetail } from '@/features/manufacturers/data';
import { ManufacturerDetailClient } from '@/features/manufacturers/manufacturer-detail-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ManufacturerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDealerAdmin();
  const { id } = await params;
  const { manufacturer, files, specsSummary, error } = await getManufacturerDetail(id);

  if (error) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-6">
        <Link href="/app/manufacturers">
          <Button variant="ghost" className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Manufacturers
          </Button>
        </Link>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-bold">System Connection Error</AlertTitle>
          <AlertDescription className="mt-2 text-red-700 leading-relaxed">
            The server encountered an error while loading this manufacturer: {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!manufacturer) {
    return (
      <div className="p-20 text-center">
        <h2 className="text-2xl font-bold text-slate-900">Manufacturer not found</h2>
        <Link href="/app/manufacturers">
          <Button variant="outline" className="mt-6">Return to List</Button>
        </Link>
      </div>
    );
  }

  return (
    <ManufacturerDetailClient id={id} manufacturer={manufacturer} initialFiles={files} initialSpecsSummary={specsSummary} basePath="/app" />
  );
}
