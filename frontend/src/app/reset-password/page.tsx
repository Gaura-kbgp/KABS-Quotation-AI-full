'use client';

import { Suspense, useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { resetPassword } from '@/app/auth/actions';

function ResetForm() {
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    start(async () => {
      const res = await resetPassword(token, password);
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-3">Password updated. You can now sign in.</p>
        <Button asChild className="w-full gradient-button h-11"><Link href="/login">Go to sign in</Link></Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            className="bg-white pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-slate-400">At least 8 characters, with letters and a number.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <div className="relative">
          <Input
            id="confirm"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="bg-white pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm rounded-lg bg-red-50 border border-red-100 text-red-700 p-3">{error}</p>}
      <Button type="submit" className="w-full gradient-button h-11" disabled={pending || !token}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Update password
      </Button>
      {!token && <p className="text-center text-sm text-red-600">This reset link is incomplete. Please request a new one.</p>}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
      <Card className="w-full max-w-md glass-card border-slate-200">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold text-slate-900">Set a new password</CardTitle>
          <CardDescription className="text-slate-500">Choose a strong password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense><ResetForm /></Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
