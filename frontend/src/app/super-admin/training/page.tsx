import { requireSuperAdmin } from '@/lib/auth';
import { TrainingClient } from './training-client';

export default async function TrainingPage() {
  await requireSuperAdmin();
  return <TrainingClient />;
}
