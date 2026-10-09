import { redirect } from 'next/navigation';

// Old workspace address: keep bookmarks working.
export default function LegacyAdminRedirect() {
  redirect('/app/dashboard');
}
