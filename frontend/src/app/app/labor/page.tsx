import { requireDealerAdmin } from '@/lib/auth';
import { getLaborRates } from '@/features/labor/data';
import { LaborClient } from '@/features/labor/labor-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function LaborPage() {
  await requireDealerAdmin();
  const { rates, error } = await getLaborRates();
  return <LaborClient initialRates={rates} initialError={error} />;
}
