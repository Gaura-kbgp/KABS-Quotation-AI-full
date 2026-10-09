'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, LogOut, type LucideIcon } from 'lucide-react';
import { logout } from '@/app/auth/actions';

export interface NavItem {
  name: string;
  icon: LucideIcon;
  href: string;
}

/** Shared sidebar shell for both /admin (dealer) and /super-admin (KABS). */
export function NavSidebar({ title, subtitle, items }: { title: string; subtitle: string; items: NavItem[] }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <aside className="w-72 admin-sidebar flex flex-col h-full shrink-0" suppressHydrationWarning>
      <div className="p-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <span className="font-bold text-white text-xl">K</span>
          </div>
          <div>
            <h1 className="font-bold text-slate-900 leading-tight">{title}</h1>
            <p className="text-[10px] text-sky-600 uppercase tracking-[0.2em] font-bold">{subtitle}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {items.map((item) => {
          // Robust check for active state to prevent hydration mismatch
          const isActive = mounted && pathname ? pathname.startsWith(item.href) : false;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'group flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200',
                isActive ? 'bg-sky-50 text-sky-600 border border-sky-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              <div className="flex items-center gap-3">
                <item.icon className={cn('w-5 h-5', isActive ? 'text-sky-600' : 'text-slate-400 group-hover:text-slate-600')} />
                <span className="font-medium">{item.name}</span>
              </div>
              {isActive && <ChevronRight className="w-4 h-4 text-sky-500" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-6 border-t border-slate-200">
        <form action={logout}>
          <button type="submit" className="flex w-full items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-200 font-medium">
            <LogOut className="w-5 h-5 text-slate-400 group-hover:text-red-600" />
            <span>Logout</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
