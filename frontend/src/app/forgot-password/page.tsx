'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requestPasswordReset } from '@/app/auth/actions';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    start(async () => {
      const res = await requestPasswordReset(email);
      if (res.ok) setNotice(res.message || 'Check your email.');
      else setError(res.error);
    });
  }

  return (
    <main className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
      <Card className="w-full max-w-md glass-card border-slate-200">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold text-slate-900">Forgot password?</CardTitle>
          <CardDescription className="text-slate-500">Enter your email and we will send you a reset link.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="bg-white" required />
            </div>
            {error && <p role="alert" className="text-sm rounded-lg bg-red-50 border border-red-100 text-red-700 p-3">{error}</p>}
            {notice && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-3">{notice}</p>}
            <Button type="submit" className="w-full gradient-button h-11" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
            <p className="text-center text-sm text-slate-500">
              <Link href="/login" className="text-sky-600 hover:underline">Back to sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
