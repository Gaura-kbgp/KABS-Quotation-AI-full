import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase-server';
import { UserMenu } from '@/components/user-menu';

export default async function Home() {
  const user = await getCurrentUser();
  let logoUrl: string | null = null;
  if (user) {
    const { data } = await createServerSupabase().from('organizations').select('logo_url').eq('id', user.orgId).maybeSingle();
    logoUrl = data?.logo_url ?? null;
  }

  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen p-6 text-center overflow-hidden bg-white">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] bg-sky-500/5 blur-[120px] rounded-full"></div>
        <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-blue-600/5 blur-[120px] rounded-full"></div>
      </div>

      {/* Signed in: go to your workspace. Signed out: sign in / get started */}
      <div className="absolute top-8 right-8 flex items-center gap-3">
        {user ? (
          <UserMenu
            orgName={user.orgName}
            logoUrl={logoUrl}
            profileHref={user.role === 'super_admin' ? '/super-admin/dashboard' : '/app/profile'}
          />
        ) : (
          <>
            <Link href="/login" className="text-sm font-medium text-slate-500 hover:text-sky-600 px-3">
              Sign in
            </Link>
            <Link href="/login?mode=signup">
              <Button className="rounded-full gradient-button">Get started</Button>
            </Link>
          </>
        )}
      </div>

      {/* Hero Section */}
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 border border-sky-100 text-sky-600 text-[10px] font-bold uppercase tracking-widest mx-auto">
            <Sparkles className="w-3 h-3" />
            Empowering Precision
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tighter text-slate-900 leading-[1.1]">
            KABS <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-sky-600">Pricing AI</span>
          </h1>
          <p className="text-lg text-slate-500 max-w-xl mx-auto leading-relaxed">
            The next generation of kitchen and bathroom estimation. AI-powered extraction meets professional-grade precision.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link href="/quotation-ai">
            <Button className="gradient-button h-16 px-12 text-lg rounded-2xl shadow-lg shadow-sky-500/20 group">
              Start Quotation
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
          <Link href="/elevate">
            <Button variant="outline" className="h-16 px-12 text-lg rounded-2xl border-slate-200 text-slate-600 hover:bg-slate-50">
              Elevate Design &amp; Pricing
            </Button>
          </Link>
        </div>
      </div>

      <footer className="absolute bottom-8 text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em]">
        &copy; {new Date().getFullYear()} KABS Inc. Precision Engineering.
      </footer>
    </main>
  );
}
