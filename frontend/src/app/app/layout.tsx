import { AdminSidebar } from '@/components/admin/sidebar';
import { AdminShell } from '@/components/admin/admin-shell';
import { requireDealerAdmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase-server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDealerAdmin();
  const { data: org } = await createServerSupabase().from('organizations').select('logo_url').eq('id', user.orgId).maybeSingle();

  return (
    <AdminShell sidebar={<AdminSidebar />} user={user} logoUrl={org?.logo_url}>
      {children}
    </AdminShell>
  );
}
