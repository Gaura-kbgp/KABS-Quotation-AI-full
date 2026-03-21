import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function DesignAiPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-background p-6">
      <Link href="/" className="absolute top-8 left-8 flex items-center text-sky-400 hover:text-sky-300 transition-colors">
        <ArrowLeft className="w-5 h-5 mr-2" />
        Back to Home
      </Link>
      
      <div className="glass-card p-12 rounded-2xl max-w-md w-full text-center">
        <h1 className="text-4xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-sky-600">Coming Soon</h1>
        <p className="text-slate-400">The KABS Design AI engine is currently in training.</p>
      </div>
    </main>
  );
}
