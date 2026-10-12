'use client';

import { UserCircle, LayoutDashboard, Factory, BookOpen, Wrench, Settings } from 'lucide-react';
import { NavSidebar, type NavItem } from './nav-sidebar';

const ITEMS: NavItem[] = [
  { name: 'My Profile', icon: UserCircle, href: '/app/profile' },
  { name: 'Dashboard', icon: LayoutDashboard, href: '/app/dashboard' },
  { name: 'Manufacturers', icon: Factory, href: '/app/manufacturers' },
  { name: 'Labor & Charges', icon: Wrench, href: '/app/labor' },
  { name: 'NKBA Rules', icon: BookOpen, href: '/app/nkba' },
  { name: 'Settings', icon: Settings, href: '/app/settings' },
];

export function AdminSidebar() {
  return <NavSidebar title="KABS" subtitle="Pricing AI" items={ITEMS} />;
}
