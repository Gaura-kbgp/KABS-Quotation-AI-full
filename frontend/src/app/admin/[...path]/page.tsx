import { redirect } from 'next/navigation';

// Any old /admin/... bookmark goes to the workspace.
export default function LegacyAdminPathRedirect() {
  redirect('/app/dashboard');
}
