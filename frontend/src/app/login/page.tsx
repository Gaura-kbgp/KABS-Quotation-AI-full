import { redirect } from 'next/navigation';
import { Calculator } from 'lucide-react';
import { getCurrentUser, homeFor } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { AuthForm } from './auth-form';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  not_configured: 'Sign-in is not configured on the server yet.',
  not_migrated: 'The database is not set up yet (run the multi-tenant SQL migration).',
  cancelled: 'Sign-in was cancelled.',
  invalid: 'Could not sign you in. Please try again.',
  unverified_google: 'Your Google email is not verified.',
  suspended: 'This company account is suspended. Please contact KABS.',
  disabled: 'This account has been disabled.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const { error, mode } = await searchParams;

  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    /* not configured yet: just show the page */
  }
  if (user) redirect(homeFor(user));

  return (
    <main className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-sky-500/10 via-transparent to-transparent -z-10"></div>
      <Card className="w-full max-w-md glass-card border-slate-200">
        <CardHeader className="space-y-1 text-center">
          <style>{`
            @keyframes pricing-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
            @keyframes pricing-shine { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }
            .pricing-logo-mark { animation: pricing-float 3s ease-in-out infinite; }
            .pricing-logo-text {
              background: linear-gradient(90deg, #0369a1, #38bdf8, #0284c7, #0369a1);
              background-size: 200% auto;
              -webkit-background-clip: text;
              background-clip: text;
              color: transparent;
              animation: pricing-shine 4s linear infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .pricing-logo-mark, .pricing-logo-text { animation: none; }
            }
          `}</style>
          <div className="mx-auto mb-3 flex items-center justify-center gap-3">
            <div className="pricing-logo-mark flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 shadow-lg shadow-sky-500/20">
              <Calculator className="h-6 w-6 text-white" />
            </div>
            <span className="pricing-logo-text text-2xl font-extrabold tracking-tight">Pricing AI</span>
          </div>
          <CardDescription className="text-slate-500">Sign in or create your account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Button asChild variant="outline" className="w-full h-12 text-base">
            <a href="/api/auth/google">
              <svg className="w-5 h-5 mr-3" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
                <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
              </svg>
              Continue with Google
            </a>
          </Button>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200" /> or use email <div className="h-px flex-1 bg-slate-200" />
          </div>

          <AuthForm initialError={error ? ERRORS[error] || ERRORS.invalid : undefined} initialMode={mode === 'signup' ? 'signup' : 'signin'} />
        </CardContent>
      </Card>
    </main>
  );
}
