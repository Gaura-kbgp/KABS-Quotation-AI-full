'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resendVerification, signIn, signUp } from '@/app/auth/actions';

export function AuthForm({ initialError, initialMode = 'signin', allowSignup = true }: { initialError?: string; initialMode?: 'signin' | 'signup'; allowSignup?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [notice, setNotice] = useState('');
  const [needsVerify, setNeedsVerify] = useState(false);
  const [pending, start] = useTransition();

  function switchMode(m: 'signin' | 'signup') {
    setMode(m);
    setError('');
    setNotice('');
    setNeedsVerify(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setNeedsVerify(false);
    start(async () => {
      if (mode === 'signup') {
        const res = await signUp({ company, email, password });
        if (res.ok) {
          setNotice(res.message || 'Account created.');
          setMode('signin');
          setPassword('');
        } else setError(res.error);
      } else {
        const res = await signIn({ email, password });
        if (res.ok) {
          router.replace(res.role === 'super_admin' ? '/super-admin/dashboard' : res.onboarded ? '/app/profile' : '/setup');
          router.refresh();
        } else {
          setError(res.error);
          setNeedsVerify(res.error.startsWith('Please verify'));
        }
      }
    });
  }

  function resend() {
    start(async () => {
      const res = await resendVerification(email);
      if (res.ok) {
        setError('');
        setNotice(res.message || 'Verification link sent.');
        setNeedsVerify(false);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {allowSignup && (
      <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={`rounded-lg py-2 transition ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      )}

      {mode === 'signup' && (
        <div className="space-y-2">
          <Label htmlFor="company">Company name</Label>
          <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Your company" className="bg-white" required />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="bg-white" required />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          {mode === 'signin' && allowSignup && (
            <Link href="/forgot-password" className="text-xs text-sky-600 hover:underline">
              Forgot password?
            </Link>
          )}
        </div>
        <Input
          id="password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          minLength={mode === 'signup' ? 8 : undefined}
          className="bg-white"
          required
        />
        {mode === 'signup' && <p className="text-xs text-slate-400">At least 8 characters, with letters and a number.</p>}
      </div>

      {error && (
        <p role="alert" className="text-sm rounded-lg bg-red-50 border border-red-100 text-red-700 p-3">
          {error}
          {needsVerify && (
            <button type="button" onClick={resend} className="ml-2 font-medium underline">
              Resend link
            </button>
          )}
        </p>
      )}
      {notice && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-3">{notice}</p>}

      <Button type="submit" className="w-full gradient-button h-11" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {mode === 'signup' ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  );
}
