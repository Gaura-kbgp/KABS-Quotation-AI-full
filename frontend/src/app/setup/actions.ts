'use server';

import { redirect } from 'next/navigation';
import { requireSetupUser } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase-server';
import { getManufacturers } from '@/features/manufacturers/data';

/** Marks the signed-in user's company as set up. Only ever touches the caller's own company. */
export async function finishSetup() {
  const user = await requireSetupUser();
  const { manufacturers } = await getManufacturers();
  if (manufacturers.length === 0) throw new Error('Add at least one manufacturer before finishing setup.');
  const { error } = await createServerSupabase()
    .from('organizations')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', user.orgId);
  if (error) throw error;
  redirect('/app/profile');
}
