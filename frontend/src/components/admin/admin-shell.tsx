import { User, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import type { CurrentUser } from '@/lib/auth';

/** Shared chrome (sidebar + top bar) for both /admin and /super-admin. */
export function AdminShell({
  sidebar,
  user,
  logoUrl,
  children,
}: {
  sidebar: React.ReactNode;
  user: CurrentUser;
  logoUrl?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden" suppressHydrationWarning>
      {sidebar}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-slate-500 hover:text-sky-600">
                <Home className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>

            <Separator orientation="vertical" className="h-6" />

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-500">System Status:</span>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-600">Live</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-100 border border-slate-200">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="w-4 h-4 rounded object-contain" />
              ) : (
                <User className="w-4 h-4 text-sky-600" />
              )}
              <span className="text-sm font-medium text-slate-700">{user.orgName}</span>
              <span className="text-xs text-slate-400">{user.email}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
