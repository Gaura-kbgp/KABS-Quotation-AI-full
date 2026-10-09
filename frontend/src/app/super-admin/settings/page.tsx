import { requireSuperAdmin } from '@/lib/auth';
import { getOrgSettings } from '@/features/settings/actions';
import { SettingsForm } from '@/features/settings/settings-form';

export const dynamic = 'force-dynamic';

export default async function SuperAdminSettingsPage() {
  await requireSuperAdmin();
  const settings = await getOrgSettings();

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">KABS Settings</h1>
        <p className="text-slate-500 mt-1">The KABS account&apos;s own profile, logo, and proposal defaults.</p>
      </div>
      <SettingsForm settings={settings} />
    </div>
  );
}
