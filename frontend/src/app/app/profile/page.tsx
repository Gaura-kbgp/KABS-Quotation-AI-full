import { requireDealerAdmin } from '@/lib/auth';
import { getOrgSettings } from '@/features/settings/actions';
import { CompanyProfileForm } from '@/features/settings/company-profile-form';
import { LogoUploader } from '@/features/settings/logo-uploader';
import { TermsForm } from '@/features/settings/terms-form';
import { SignaturePanel } from '@/features/settings/signature-panel';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requireDealerAdmin();
  const org = await getOrgSettings();

  return (
    <div className="space-y-8 max-w-3xl animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">My Profile</h1>
        <p className="text-slate-500 mt-1">Signed in as {user.email}</p>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <h2 className="font-semibold text-slate-900">Company profile</h2>
        <CompanyProfileForm initial={{ name: org.name, phone: org.phone, address: org.address }} />
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <h2 className="font-semibold text-slate-900">Logo</h2>
        <LogoUploader initialUrl={org.logo_url} />
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <h2 className="font-semibold text-slate-900">Terms and conditions</h2>
        <TermsForm initial={org.proposal_terms} />
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div>
          <h2 className="font-semibold text-slate-900">Authorized signature</h2>
          <p className="text-sm text-slate-500 mt-1">Printed on quotes you release. Only you can change it.</p>
        </div>
        <SignaturePanel currentUrl={org.signature_url} currentMethod={org.signature_method} />
      </section>
    </div>
  );
}
