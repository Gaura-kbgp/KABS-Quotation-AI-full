'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { updateTerms } from './actions';

export function TermsForm({ initial }: { initial: string | null }) {
  const { toast } = useToast();
  const [terms, setTerms] = useState(initial || '');
  const [saving, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateTerms(terms);
      if (res.success) toast({ title: 'Saved', description: 'Terms & conditions updated.' });
      else toast({ variant: 'destructive', title: 'Could not save', description: res.error });
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Textarea
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        rows={6}
        placeholder="Payment terms, warranty, lead times, cancellation policy..."
      />
      <p className="text-xs text-slate-400">Printed at the bottom of every quote you send.</p>
      <Button type="submit" className="gradient-button" disabled={saving}>
        {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Save terms
      </Button>
    </form>
  );
}
