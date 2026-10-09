import { SuperAdminSidebar } from '@/components/admin/super-admin-sidebar';
import { AdminShell } from '@/components/admin/admin-shell';
import { requireSuperAdmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase-server';

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  const { data: org } = await createServerSupabase().from('organizations').select('logo_url').eq('id', user.orgId).maybeSingle();

  return (
    <AdminShell sidebar={<SuperAdminSidebar />} user={user} logoUrl={org?.logo_url}>
      {children}
    </AdminShell>
  );
}
