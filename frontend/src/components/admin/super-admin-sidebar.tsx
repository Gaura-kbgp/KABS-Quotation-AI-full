'use client';

import { LayoutDashboard, Building2, BookOpen, Activity, Settings, Factory } from 'lucide-react';
import { NavSidebar, type NavItem } from './nav-sidebar';

const ITEMS: NavItem[] = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/super-admin/dashboard' },
  { name: 'Clients', icon: Building2, href: '/super-admin/clients' },
  { name: 'Manufacturers', icon: Factory, href: '/super-admin/manufacturers' },
  { name: 'Usage', icon: Activity, href: '/super-admin/usage' },
  { name: 'NKBA Rules', icon: BookOpen, href: '/super-admin/nkba' },
  { name: 'Settings', icon: Settings, href: '/super-admin/settings' },
];

export function SuperAdminSidebar() {
  return <NavSidebar title="KABS" subtitle="Super Admin" items={ITEMS} />;
}
