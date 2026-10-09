import { requireDealerAdmin } from '@/lib/auth';
import { getNkbaRules } from '@/features/nkba/data';
import { NkbaRulesClient } from '@/features/nkba/nkba-rules-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export default async function NkbaRulesPage() {
  await requireDealerAdmin();
  const { rules, error } = await getNkbaRules();

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

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
