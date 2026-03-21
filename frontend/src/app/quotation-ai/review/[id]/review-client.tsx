
"use client";

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Box, 
  AlertTriangle, 
  Calculator, 
  Settings, 
  Factory,
  ChevronRight,
  Loader2,
  Layers,
  Layout,
  Package,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { generateBOMAction } from '../../actions';
import { useRouter } from 'next/navigation';

interface ReviewClientProps {
  project: any;
  manufacturers: any[];
}

export function ReviewClient({ project, manufacturers }: ReviewClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedManId, setSelectedManId] = useState<string>('');
  const [config, setConfig] = useState({ collection: '', doorStyle: '' });
  const [availableCollections, setAvailableCollections] = useState<string[]>([]);
  const [availableStyles, setAvailableStyles] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetchingConfig, setIsFetchingConfig] = useState(false);

  const rooms = project.extracted_data?.rooms || [];

  const fetchManufacturerConfig = async (manId: string) => {
    setSelectedManId(manId);
    setIsFetchingConfig(true);
    try {
      const res = await fetch(`/api/manufacturer-config?id=${manId}`);
      const data = await res.json();
      setAvailableCollections(data.collections || []);
      setAvailableStyles(data.styles || []);
      setConfig({ collection: '', doorStyle: '' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error fetching config' });
    } finally {
      setIsFetchingConfig(false);
    }
  };

  const handleGenerateBOM = async () => {
    if (!selectedManId || !config.collection || !config.doorStyle) return;
    
    setIsGenerating(true);
    try {
      const result = await generateBOMAction(project.id, selectedManId, config.collection, config.doorStyle);
      if (result.success) {
        toast({ title: 'BOM Generated Successfully' });
        router.push(`/quotation-ai/bom/${project.id}`);
      } else {
        throw new Error(result.error || 'Failed to generate BOM');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'BOM Error', description: err.message });
      setIsGenerating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20">
      <div className="lg:col-span-2 space-y-8">
        {rooms.map((room: any, idx: number) => (
          <Card key={idx} className="bg-white border-slate-200 shadow-md overflow-hidden rounded-3xl">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
              <div className="flex justify-between items-center">
                <CardTitle className="text-xl flex items-center gap-2 text-slate-900">
                  <Box className="w-5 h-5 text-sky-500" />
                  {room.room_name}
                </CardTitle>
                <Badge variant="outline" className="border-sky-200 text-sky-600 uppercase tracking-widest text-[10px] font-bold px-3 py-1">
                  Ready for Review
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100">
                {/* PRIMARY CABINETS SECTION */}
                <div className="bg-white">
                  <div className="px-6 py-3 bg-slate-50/50 border-b border-slate-100">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Primary Cabinets</span>
                  </div>
                  {room.cabinets?.map((cab: any, cIdx: number) => (
                    <div key={cIdx} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center font-bold text-sky-600 border border-sky-100">
                          {cab.quantity}
                        </div>
                        <div>
                          <p className="font-bold text-lg tracking-tight text-slate-900">{cab.code}</p>
                          <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest leading-none mt-1">Cabinet Unit</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ACCESSORIES & HARDWARE SECTIONS */}
                {[
                  { key: 'perimeter', label: 'Perimeter Specs', icon: Layers },
                  { key: 'island', label: 'Island Specs', icon: Layout },
                  { key: 'hardware', label: 'Hardware', icon: Package },
                  { key: 'bump', label: 'Bump / Boxing', icon: Layers },
                ].map((section) => {
                  const items = room[section.key] || [];
                  if (items.length === 0) return null;

                  return (
                    <div key={section.key} className="bg-white">
                      <div className="px-6 py-3 bg-slate-50/50 border-y border-slate-100">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                           <section.icon className="w-3 h-3" />
                           {section.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2">
                        {items.map((item: any, iIdx: number) => (
                          <div key={iIdx} className="px-6 py-3 flex items-center gap-4 border-b border-slate-50">
                            <span className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                              {item.quantity}
                            </span>
                            <span className="font-bold text-slate-700 text-sm">{item.code}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-6">
        <Card className="bg-white border-slate-200 sticky top-8 shadow-xl rounded-3xl overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
            <CardTitle className="text-lg flex items-center gap-2 text-slate-900">
              <Calculator className="w-5 h-5 text-sky-500" />
              Configure Pricing
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">Manufacturer</label>
                <Select onValueChange={fetchManufacturerConfig}>
                  <SelectTrigger className="bg-slate-50 border-none h-14 text-slate-900 rounded-2xl shadow-inner">
                    <SelectValue placeholder="Choose Brand" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200 text-slate-900">
                    {manufacturers.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedManId && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">Collection</label>
                    <Select 
                      disabled={isFetchingConfig} 
                      onValueChange={(v) => setConfig(prev => ({ ...prev, collection: v }))}
                    >
                      <SelectTrigger className="bg-slate-50 border-none h-14 text-slate-900 rounded-2xl shadow-inner">
                        <SelectValue placeholder={isFetchingConfig ? "Syncing..." : "Choose Collection"} />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900">
                        {availableCollections.map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">Door Style</label>
                    <Select 
                      disabled={isFetchingConfig || !config.collection} 
                      onValueChange={(v) => setConfig(prev => ({ ...prev, doorStyle: v }))}
                    >
                      <SelectTrigger className="bg-slate-50 border-none h-14 text-slate-900 rounded-2xl shadow-inner">
                        <SelectValue placeholder="Choose Style" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900">
                        {availableStyles.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            <Button 
              className="w-full h-16 gradient-button mt-4 shadow-2xl shadow-sky-500/20 rounded-2xl text-lg font-bold"
              disabled={!config.doorStyle || isGenerating}
              onClick={handleGenerateBOM}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                  Generating BOM...
                </>
              ) : (
                <>
                  Build Final Quote
                  <ChevronRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>

            <div className="pt-6 border-t border-slate-100 flex items-center justify-between px-2">
               <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pricing Engine Live</span>
               </div>
               <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">AI Validated</span>
               </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
