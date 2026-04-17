import { LoginForm } from './login-form';

export default function AdminLoginPage() {
  return (
    <main className="flex items-center justify-center min-h-screen p-6 bg-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-sky-500/10 via-transparent to-transparent -z-10"></div>
      <LoginForm />
    </main>
  );
}
