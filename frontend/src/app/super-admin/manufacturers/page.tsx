import { requireSuperAdmin } from '@/lib/auth';
import { getManufacturers } from '@/features/manufacturers/data';
import { ManufacturersList } from '@/features/manufacturers/manufacturers-list';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SuperAdminManufacturersPage() {
  await requireSuperAdmin();
  const { manufacturers } = await getManufacturers();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <ManufacturersList
        initialManufacturers={manufacturers}
        basePath="/super-admin"
        title="Manufacturer Catalog Library"
        subtitle="Manage global manufacturer catalogs — spec books, pricing sheets, and AI-extracted config for all clients."
      />
    </div>
  );
}
