'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase-server';
import { LOGOS_BUCKET } from '@/lib/storage';

export interface OrgSettings {
  name: string;
  logo_url: string | null;
  phone: string | null;
  address: string | null;
  default_markup_percent: number;
  tax_percent: number;
  proposal_terms: string | null;
  signature_method: 'drawn' | 'uploaded' | null;
  signature_url: string | null; // short-lived signed link, null if none
}

const SIGNATURE_BUCKET = 'company-signatures';

/** Always the signed-in user's own company: org_id never comes from the client. */
export async function getOrgSettings(): Promise<OrgSettings> {
  const user = await requireUser();
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('organizations')
    .select('name, logo_url, phone, address, default_markup_percent, tax_percent, proposal_terms, signature_path, signature_method')
    .eq('id', user.orgId)
    .single();
  if (error) throw error;

  let signature_url: string | null = null;
  if (data.signature_path) {
    const { data: signed } = await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrl(data.signature_path, 3600);
    signature_url = signed?.signedUrl ?? null;
  }
  const { signature_path, ...rest } = data as any;
  return { ...rest, signature_url } as OrgSettings;
}

/** Terms & conditions shown on quotes. */
export async function updateTerms(terms: string) {
  try {
    const user = await requireUser();
    const clean = terms.trim().slice(0, 4000) || null;
    const { error } = await createServerSupabase()
      .from('organizations')
      .update({ proposal_terms: clean, updated_at: new Date().toISOString() })
      .eq('id', user.orgId);
    if (error) throw error;
    for (const p of ['/app/profile', '/app/settings', '/setup']) revalidatePath(p);
    return { success: true };
  } catch (err: any) {
    console.error('[updateTerms]', err);
    return { success: false, error: err.message || 'Could not save terms.' };
  }
}

/**
 * Saves the authorized signature. Accepts a PNG/JPG file, or a PNG drawn on the pad.
 * Stored in a private bucket under the company's own folder.
 */
export async function saveSignature(formData: FormData) {
  try {
    const user = await requireUser();
    const file = formData.get('signature') as File | null;
    const method = (formData.get('method') as string) === 'drawn' ? 'drawn' : 'uploaded';
    if (!file || file.size === 0) return { success: false, error: 'Please draw or choose a signature.' };
    if (file.size > 1024 * 1024) return { success: false, error: 'Signature image must be under 1MB.' };
    if (!['image/png', 'image/jpeg'].includes(file.type)) return { success: false, error: 'Signature must be a PNG or JPG image.' };

    const supabase = createServerSupabase();
    const ext = file.type === 'image/jpeg' ? 'jpg' : 'png';
    const path = `${user.orgId}/signature/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(SIGNATURE_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: true,
    });
    if (upErr) throw upErr;

    const { error } = await supabase
      .from('organizations')
      .update({ signature_path: path, signature_method: method, updated_at: new Date().toISOString() })
      .eq('id', user.orgId);
    if (error) throw error;

    for (const p of ['/app/profile', '/setup']) revalidatePath(p);
    return { success: true };
  } catch (err: any) {
    console.error('[saveSignature]', err);
    return { success: false, error: err.message || 'Could not save signature.' };
  }
}

export async function updateOrgSettings(input: {
  name: string;
  phone: string;
  address: string;
  default_markup_percent: number;
  tax_percent: number;
  proposal_terms: string;
}) {
  try {
    const user = await requireUser();
    const name = input.name.trim();
    if (name.length < 2 || name.length > 120) return { success: false, error: 'Please enter a valid company name.' };

    const markup = Number(input.default_markup_percent);
    const tax = Number(input.tax_percent);
    if (!Number.isFinite(markup) || markup < 0 || markup > 1000) return { success: false, error: 'Markup must be between 0 and 1000%.' };
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) return { success: false, error: 'Tax must be between 0 and 100%.' };

    const { error } = await createServerSupabase()
      .from('organizations')
      .update({
        name,
        phone: input.phone.trim().slice(0, 40) || null,
        address: input.address.trim().slice(0, 300) || null,
        default_markup_percent: markup,
        tax_percent: tax,
        proposal_terms: input.proposal_terms.trim().slice(0, 4000) || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.orgId); // scoped to the caller's own company, always

    if (error) throw error;
    revalidatePath('/app/settings');
    revalidatePath('/super-admin/settings');
    revalidatePath('/app');
    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: any) {
    console.error('[updateOrgSettings]', err);
    return { success: false, error: err.message || 'Could not save settings.' };
  }
}

export async function updateOrgLogo(formData: FormData) {
  try {
    const user = await requireUser();
    const file = formData.get('logo') as File | null;
    if (!file || file.size === 0) return { success: false, error: 'Please choose an image.' };
    if (file.size > 2 * 1024 * 1024) return { success: false, error: 'Logo must be under 2MB.' };
    if (!file.type.startsWith('image/')) return { success: false, error: 'Please upload an image file.' };

    const supabase = createServerSupabase();
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${user.orgId}/logo/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage.from(LOGOS_BUCKET).upload(path, buffer, {
      contentType: file.type,
      upsert: true,
    });
    if (upErr) throw upErr;

    const { data } = supabase.storage.from(LOGOS_BUCKET).getPublicUrl(path);
    const { error } = await supabase
      .from('organizations')
      .update({ logo_url: data.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', user.orgId);
    if (error) throw error;

    revalidatePath('/app/settings');
    revalidatePath('/super-admin/settings');
    revalidatePath('/app');
    revalidatePath('/super-admin');
    return { success: true, url: data.publicUrl };
  } catch (err: any) {
    console.error('[updateOrgLogo]', err);
    return { success: false, error: err.message || 'Could not upload logo.' };
  }
}

/** Company profile only (name, phone, address). Markup, tax and terms are untouched. */
export async function updateCompanyProfile(input: { name: string; phone: string; address: string }) {
  try {
    const user = await requireUser();
    const name = input.name.trim();
    if (name.length < 2 || name.length > 120) return { success: false, error: 'Please enter a company name (2-120 characters).' };

    const { error } = await createServerSupabase()
      .from('organizations')
      .update({
        name,
        phone: input.phone.trim().slice(0, 40) || null,
        address: input.address.trim().slice(0, 300) || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.orgId);
    if (error) throw error;

    for (const p of ['/app/profile', '/app/settings', '/setup', '/super-admin/settings']) revalidatePath(p);
    return { success: true };
  } catch (err: any) {
    console.error('[updateCompanyProfile]', err);
    return { success: false, error: err.message || 'Could not save company profile.' };
  }
}
