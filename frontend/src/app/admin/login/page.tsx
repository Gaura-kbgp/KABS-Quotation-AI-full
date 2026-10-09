import { redirect } from 'next/navigation';
import { getCurrentUser, homeFor } from '@/lib/auth';
import { AuthForm } from '@/app/login/auth-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

/** KABS Super Admin sign-in. Same account check as /login (email + password from the server .env). */
export default async function AdminLoginPage() {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    /* not configured yet: just show the page */
  }
  if (user) redirect(homeFor(user));

  return (
    <main className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
      <Card className="w-full max-w-md border-slate-200">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-lg mb-3">
            <span className="font-bold text-white text-2xl">K</span>
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900">KABS Super Admin</CardTitle>
          <CardDescription className="text-slate-500">Platform owner sign-in</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm initialMode="signin" allowSignup={false} />
        </CardContent>
      </Card>
    </main>
  );
}
