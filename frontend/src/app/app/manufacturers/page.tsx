import { requireDealerAdmin } from '@/lib/auth';
import { getManufacturers } from '@/features/manufacturers/data';
import { ManufacturersList } from '@/features/manufacturers/manufacturers-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default async function ManufacturersPage() {
  await requireDealerAdmin();
  const { manufacturers, error } = await getManufacturers();

  if (error) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-bold">System Connection Error</AlertTitle>
          <AlertDescription className="mt-2 text-red-700 leading-relaxed">
            The server could not connect to the database to fetch manufacturers. {error}
          </AlertDescription>
        </Alert>
        <div className="mt-6 flex justify-center">
          <Link href="/app/manufacturers">
            <Button className="gradient-button px-8">
              <RefreshCcw className="w-4 h-4 mr-2" />
              Retry Connection
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <ManufacturersList initialManufacturers={manufacturers} basePath="/app" />
    </div>
  );
}
