import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight } from 'lucide-react';

export default function Home() {
  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen p-6 text-center overflow-hidden bg-white">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] bg-sky-500/5 blur-[120px] rounded-full"></div>
        <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-blue-600/5 blur-[120px] rounded-full"></div>
      </div>

      {/* Admin Login Button */}
      <div className="absolute top-8 right-8">
        <Link href="/admin/login">
          <Button variant="ghost" className="rounded-full text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition-all duration-300">
            Admin Access
          </Button>
        </Link>
      </div>

      <div className="absolute top-8 left-8 flex items-center gap-2">
         <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center text-white font-bold text-xl">K</div>
         <span className="font-bold text-xl tracking-tight">KABS</span>
      </div>

      {/* Hero Section */}
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 border border-sky-100 text-sky-600 text-[10px] font-bold uppercase tracking-widest mx-auto">
            <Sparkles className="w-3 h-3" />
            Empowering Precision
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tighter text-slate-900 leading-[1.1]">
            KABS <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-sky-600">Quotation AI</span>
          </h1>
          <p className="text-lg text-slate-500 max-w-xl mx-auto leading-relaxed">
            The next generation of kitchen and bathroom estimation. AI-powered extraction meets professional-grade precision.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link href="/quotation-ai">
            <Button className="gradient-button h-16 px-12 text-lg rounded-2xl shadow-lg shadow-sky-500/20 group">
              Start Quotation
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
          <Link href="/design-ai">
            <Button variant="outline" className="h-16 px-12 text-lg rounded-2xl border-slate-200 text-slate-600 hover:bg-slate-50">
              Design AI
            </Button>
          </Link>
        </div>
      </div>

      <footer className="absolute bottom-8 text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em]">
        &copy; {new Date().getFullYear()} KABS Inc. Precision Engineering.
      </footer>
    </main>
  );
}
