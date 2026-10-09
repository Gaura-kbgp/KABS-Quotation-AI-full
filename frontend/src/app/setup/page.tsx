import { requireSetupUser } from '@/lib/auth';
import { getOrgSettings } from '@/features/settings/actions';
import { CompanyProfileForm } from '@/features/settings/company-profile-form';
import { LogoUploader } from '@/features/settings/logo-uploader';
import { TermsForm } from '@/features/settings/terms-form';
import { SignaturePanel } from '@/features/settings/signature-panel';
import { ManufacturersStep, NkbaStep } from '@/features/setup/manufacturers-step';
import { getManufacturers, listManufacturerFiles } from '@/features/manufacturers/data';
import { getNkbaRules } from '@/features/nkba/data';
import { finishSetup } from './actions';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  await requireSetupUser();
  const org = await getOrgSettings();
  const { manufacturers } = await getManufacturers();
  const { files } = await listManufacturerFiles();
  const { rules: nkba } = await getNkbaRules();

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-sky-600">Setup</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Set up your company</h1>
          <p className="text-slate-500 mt-2">Takes about two minutes. You can change these later from your profile.</p>
        </div>

        <section className="space-y-4">
          <h2 className="font-semibold text-slate-900">1. Company profile</h2>
          <CompanyProfileForm initial={{ name: org.name, phone: org.phone, address: org.address }} />
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold text-slate-900">2. Logo</h2>
          <LogoUploader initialUrl={org.logo_url} />
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold text-slate-900">3. Terms and signature</h2>
          <TermsForm initial={org.proposal_terms} />
          <SignaturePanel currentUrl={org.signature_url} currentMethod={org.signature_method} />
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold text-slate-900">4. Manufacturers and files</h2>
          <p className="text-sm text-slate-500">Add each manufacturer you quote with, then upload its pricing sheet and spec book.</p>
          <ManufacturersStep
            initial={manufacturers.map((m: any) => ({ id: m.id, name: m.name }))}
            files={files.map((f: any) => ({ id: f.id, manufacturer_id: f.manufacturer_id, file_type: f.file_type, file_name: f.file_name, file_url: f.file_url }))}
          />
          <div className="border-t border-slate-100 pt-4">
            <h3 className="font-medium text-slate-900 mb-2">NKBA rules</h3>
            <NkbaStep rules={nkba.map((r: any) => ({ id: r.id, version: r.version, file_name: r.file_name, file_url: r.file_url }))} />
          </div>
        </section>

        <section className="space-y-4 border-t border-slate-100 pt-6">
          <h2 className="font-semibold text-slate-900">5. Finish</h2>
          <p className="text-sm text-slate-500">{manufacturers.length === 0 ? 'Add at least one manufacturer to finish.' : `${manufacturers.length} manufacturer${manufacturers.length === 1 ? '' : 's'} added.`}</p>
          <form action={finishSetup}>
            <button type="submit" className="w-full h-11 rounded-xl gradient-button text-white font-semibold">
              Finish setup and continue
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
