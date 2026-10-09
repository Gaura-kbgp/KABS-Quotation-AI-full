'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { UserCircle, LogOut } from 'lucide-react';
import { logout } from '@/app/auth/actions';

/** Company logo (or initials) as one avatar; click opens the company name, profile link and sign out. */
export function UserMenu({ orgName, logoUrl, profileHref }: { orgName: string; logoUrl: string | null; profileHref: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = orgName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'K';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm hover:ring-2 hover:ring-sky-100"
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" />
        ) : (
          <span className="text-sm font-bold text-sky-600">{initials}</span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-400">Signed in as</p>
            <p className="truncate text-sm font-semibold text-slate-900">{orgName}</p>
          </div>
          <Link
            href={profileHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <UserCircle className="h-4 w-4 text-slate-400" /> My profile
          </Link>
          <form action={logout}>
            <button type="submit" role="menuitem" className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
              <LogOut className="h-4 w-4 text-slate-400" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
