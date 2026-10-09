'use client';

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { Loader2, Upload, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { updateOrgLogo, updateOrgSettings, type OrgSettings } from './actions';

export function SettingsForm({ settings }: { settings: OrgSettings }) {
  const { toast } = useToast();
  const [name, setName] = useState(settings.name);
  const [phone, setPhone] = useState(settings.phone || '');
  const [address, setAddress] = useState(settings.address || '');
  const [markup, setMarkup] = useState(String(settings.default_markup_percent ?? 0));
  const [tax, setTax] = useState(String(settings.tax_percent ?? 0));
  const [terms, setTerms] = useState(settings.proposal_terms || '');
  const [logoUrl, setLogoUrl] = useState(settings.logo_url);
  const [savingDetails, startDetails] = useTransition();
  const [uploadingLogo, startLogo] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    startDetails(async () => {
      const res = await updateOrgSettings({
        name,
        phone,
        address,
        default_markup_percent: Number(markup) || 0,
        tax_percent: Number(tax) || 0,
        proposal_terms: terms,
      });
      if (res.success) toast({ title: 'Saved', description: 'Company settings updated.' });
      else toast({ variant: 'destructive', title: 'Could not save', description: res.error });
    });
  }

  function onLogoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('logo', file);
    startLogo(async () => {
      const res = await updateOrgLogo(formData);
      if (res.success) {
        setLogoUrl(res.url || null);
        toast({ title: 'Logo updated' });
      } else {
        toast({ variant: 'destructive', title: 'Upload failed', description: res.error });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>Shown on your proposals and in the admin header.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
            {logoUrl ? (
              <Image src={logoUrl} alt="Company logo" width={80} height={80} className="object-contain w-full h-full" unoptimized />
            ) : (
              <Building2 className="w-8 h-8 text-slate-300" />
            )}
          </div>
          <div className="space-y-2">
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={uploadingLogo}>
              {uploadingLogo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload logo
            </Button>
            <p className="text-xs text-slate-400">PNG or JPG, up to 2MB.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <form onSubmit={saveDetails}>
          <CardHeader>
            <CardTitle>Company profile</CardTitle>
            <CardDescription>Used on your quotes and proposals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="name">Company name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="markup">Default markup (%)</Label>
                <Input id="markup" type="number" min={0} max={1000} step={0.1} value={markup} onChange={(e) => setMarkup(e.target.value)} />
                <p className="text-xs text-slate-400">Applied to new quotes by default; editable per quote.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tax">Sales tax (%)</Label>
                <Input id="tax" type="number" min={0} max={100} step={0.01} value={tax} onChange={(e) => setTax(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="terms">Proposal terms &amp; notes</Label>
              <Textarea id="terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={5} placeholder="Payment terms, warranty, lead times..." />
              <p className="text-xs text-slate-400">Printed at the bottom of PDF proposals.</p>
            </div>
            <Button type="submit" className="gradient-button" disabled={savingDetails}>
              {savingDetails && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
