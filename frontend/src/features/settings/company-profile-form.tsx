'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { updateCompanyProfile } from './actions';

export function CompanyProfileForm({ initial }: { initial: { name: string; phone: string | null; address: string | null } }) {
  const { toast } = useToast();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone || '');
  const [address, setAddress] = useState(initial.address || '');
  const [saving, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateCompanyProfile({ name, phone, address });
      if (res.success) toast({ title: 'Saved', description: 'Company profile updated.' });
      else toast({ variant: 'destructive', title: 'Could not save', description: res.error });
    });
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="cp-name">Company name</Label>
        <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp-phone">Phone</Label>
        <Input id="cp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp-address">Address</Label>
        <Textarea id="cp-address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
      </div>
      <Button type="submit" className="gradient-button" disabled={saving}>
        {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Save company profile
      </Button>
    </form>
  );
}
