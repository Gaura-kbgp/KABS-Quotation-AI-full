'use client';

import { Suspense, useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { verifyEmailToken } from '@/app/auth/actions';

// The link only shows a button; verifying happens on click, so email scanners
// that "pre-open" links can't use up the one-time token.
function Verify() {
  const token = useSearchParams().get('token') || '';
  const [result, setResult] = useState<'ok' | 'bad' | null>(null);
  const [pending, start] = useTransition();

  if (result === 'ok') {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-3">Your email is verified.</p>
        <Button asChild className="w-full gradient-button h-11"><Link href="/login">Continue to sign in</Link></Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {result === 'bad' && (
        <p role="alert" className="text-sm rounded-lg bg-red-50 border border-red-100 text-red-700 p-3">
          This link is invalid or has expired. Sign in and choose &quot;Resend link&quot; to get a new one.
        </p>
      )}
      <Button className="w-full gradient-button h-11" disabled={pending || !token} onClick={() => start(async () => setResult((await verifyEmailToken(token)) ? 'ok' : 'bad'))}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Verify my email
      </Button>
      <p className="text-center text-sm text-slate-500"><Link href="/login" className="text-sky-600 hover:underline">Back to sign in</Link></p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
      <Card className="w-full max-w-md glass-card border-slate-200">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold text-slate-900">Verify your email</CardTitle>
          <CardDescription className="text-slate-500">One click to activate your KABS account.</CardDescription>
        </CardHeader>
        <CardContent><Suspense><Verify /></Suspense></CardContent>
      </Card>
    </main>
  );
}
