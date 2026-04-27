'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Review Page Error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
      <div className="max-w-xl w-full space-y-6">
        <Alert variant="destructive" className="bg-red-50 border-red-200 text-red-600 rounded-3xl p-6 shadow-lg">
          <div className="flex items-start gap-4">
            <AlertCircle className="h-6 w-6 mt-1 shrink-0" />
            <div className="space-y-2">
              <AlertTitle className="text-lg font-black tracking-tight">Something went wrong!</AlertTitle>
              <AlertDescription className="text-sm font-medium leading-relaxed opacity-90">
                An error occurred while loading the review workstation. This could be due to a missing configuration or a network issue.
              </AlertDescription>
              {error.digest && (
                <p className="text-[10px] font-mono bg-red-100/50 px-2 py-1 rounded inline-block mt-2">
                  Error ID: {error.digest}
                </p>
              )}
            </div>
          </div>
        </Alert>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => reset()}
            className="flex-1 h-12 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl shadow-md"
          >
            <RefreshCcw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
          <Link href="/quotation-ai" className="flex-1">
            <Button
              variant="outline"
              className="w-full h-12 border-slate-200 text-slate-600 font-bold rounded-2xl hover:bg-white"
            >
              Return to Dashboard
            </Button>
          </Link>
        </div>
        
        <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          KABS Quotation AI • Production Environment
        </p>
      </div>
    </div>
  );
}
