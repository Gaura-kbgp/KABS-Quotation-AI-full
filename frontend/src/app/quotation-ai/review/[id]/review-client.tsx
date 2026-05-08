
"use client";

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Box,
  Calculator,
  Factory,
  ChevronRight,
  Loader2,
  Layers,
  Layout,
  Package,
  Cpu,
  Sparkles,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { generateBOMAction } from '../../actions';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MANUFACTURER_CONFIG } from '@/lib/manufacturer-config';
import { detectCategory } from '@/lib/utils';
// INTEGRITY_SERIES removed — series derived dynamically from DB mapping

const CABINET_SECTION_ORDER = [
  'Wall Cabinets', 'Base Cabinets', 'Tall Cabinets', 'Vanity Cabinets',
  'Universal Fillers', 'Panels', 'Molding & Trim', 'Accessories',
];

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

interface ReviewClientProps {
  project: any;
  manufacturers: any[];
}

export function ReviewClient({ project, manufacturers }: ReviewClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedManId, setSelectedManId] = useState<string>('');
  const [config, setConfig] = useState<any>({
    collection: '',
    doorStyle: '',
    box_construction: '',
    finish: '',
    wood_species: '',
    drawer_box: ''
  });
  // Full mapping from API: { collectionName: [doorStyle, ...] }
  const [availableMapping, setAvailableMapping] = useState<Record<string, string[]>>({});
  const [availableCollections, setAvailableCollections] = useState<string[]>([]);
  const [availableStyles, setAvailableStyles] = useState<string[]>([]);
  // Integrity-specific: series list derived from DB + selected series
  const [availableSeries, setAvailableSeries] = useState<string[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetchingConfig, setIsFetchingConfig] = useState(false);
  const [generatingDescriptions, setGeneratingDescriptions] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  const rooms = project.extracted_data?.rooms || [];

  const fetchManufacturerConfig = async (manId: string) => {
    setSelectedManId(manId);
    setSelectedSeries('');
    setIsFetchingConfig(true);
    try {
      const res = await fetch(`/api/manufacturer-config?id=${manId}`);
      const data = await res.json();
      const mapping: Record<string, string[]> = data.mapping || {};

      // Wellborn / 1951 Cabinetry: replace the entire mapping with the static config.
      // Static config is the complete, correctly-ordered pricing-guide source of truth.
      // DB data can contain partial, re-ordered, or cross-collection noise — ignore it entirely.
      const manName = manufacturers.find(m => m.id === manId)?.name || '';
      const staticCfg = MANUFACTURER_CONFIG[manName];
      if (staticCfg) {
        staticCfg.collections.forEach(col => {
          mapping[col.name] = col.styles;
        });
      }

      setAvailableMapping(mapping);
      // Preserve spreadsheet column order for manufacturers with static config;
      // fall back to sorted keys for dynamic/DB-only manufacturers (e.g. Integrity).
      if (staticCfg) {
        const ordered = staticCfg.collections.map(c => c.name).filter(n => mapping[n] !== undefined);
        const extra = Object.keys(mapping).filter(k => !ordered.includes(k)).sort();
        setAvailableCollections([...ordered, ...extra]);
      } else {
        setAvailableCollections(Object.keys(mapping).sort());
      }
      setAvailableStyles([]);
      // Derive series from whatever is in the DB: "SERIES - COLLECTION" → take part before " - "
      const seriesSet = new Set<string>();
      Object.keys(mapping).forEach(col => {
        const dashIdx = col.indexOf(' - ');
        if (dashIdx > 0) seriesSet.add(col.substring(0, dashIdx));
      });
      setAvailableSeries(Array.from(seriesSet).sort());
      setConfig({
        collection: '',
        doorStyle: '',
        box_construction: '',
        finish: '',
        wood_species: '',
        drawer_box: ''
      });
    } catch {
      toast({ variant: 'destructive', title: 'Error fetching config' });
    } finally {
      setIsFetchingConfig(false);
    }
  };

  const handleCollectionChange = (value: string) => {
    setConfig((prev: any) => ({ ...prev, collection: value, doorStyle: '' }));
    setAvailableStyles(availableMapping[value] || []);
  };

  const isIntegrity = manufacturers.find(m => m.id === selectedManId)?.name === 'Integrity Cabinets';

  const handleSeriesChange = (seriesName: string) => {
    setSelectedSeries(seriesName);
    setConfig((prev: any) => ({ ...prev, collection: '', doorStyle: '' }));
    setAvailableStyles([]);
    // Filter collections: must start with "SERIES NAME - " (the DB format)
    const prefix = seriesName.toUpperCase() + ' - ';
    const filtered = Object.keys(availableMapping)
      .filter(c => c.toUpperCase().startsWith(prefix))
      .sort();
    setAvailableCollections(filtered);
  };

  const handleGenerateBOM = async () => {
    if (!selectedManId || !config.collection || !config.doorStyle) return;

    setIsGenerating(true);
    setGenerationStatus('Generating BOM...');
    try {
      const result = await generateBOMAction(project.id, selectedManId, config.collection, config.doorStyle, config);
      if (result.success) {
        toast({ title: 'BOM Generated Successfully' });

        // Trigger AI description generation in the background
        setGeneratingDescriptions(true);
        setGenerationStatus('AI enriching BOM descriptions...');
        try {
          const mfgName = manufacturers.find(m => m.id === selectedManId)?.name || '';
          // Fetch the BOM items we just created
          const bomRes = await fetch(`/api/get-bom-items?project_id=${project.id}`);
          const bomData = await bomRes.json();
          if (bomData.items?.length > 0) {
            await fetch(`${BACKEND_URL}/api/agent/generate-bom-descriptions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                project_id: project.id,
                manufacturer_name: mfgName,
                bom_items: bomData.items,
              }),
            });
          }
        } catch (descErr) {
          console.warn('Description generation failed (non-fatal):', descErr);
        } finally {
          setGeneratingDescriptions(false);
        }

        router.push(`/quotation-ai/bom/${project.id}`);
      } else {
        throw new Error(result.error || 'Failed to generate BOM');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'BOM Error', description: err.message });
      setIsGenerating(false);
      setGenerationStatus('');
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
                {/* CABINETS — grouped by type (Wall, Base, Tall, etc.) */}
                {(() => {
                  const grouped: Record<string, any[]> = {};
                  (room.cabinets || []).forEach((cab: any) => {
                    const cat = detectCategory(cab.code);
                    if (!grouped[cat]) grouped[cat] = [];
                    grouped[cat].push(cab);
                  });
                  return CABINET_SECTION_ORDER.map(sectionName => {
                    const items = grouped[sectionName];
                    if (!items || items.length === 0) return null;
                    return (
                      <div key={sectionName} className="bg-white">
                        <div className="px-6 py-2 bg-slate-50/50 border-b border-slate-100">
                          <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{sectionName}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2">
                          {items.map((cab: any, cIdx: number) => (
                            <div key={cIdx} className="px-6 py-3 flex items-center gap-4 border-b border-slate-50 hover:bg-slate-50 transition-colors">
                              <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center font-bold text-sky-600 border border-sky-100 text-sm flex-shrink-0">
                                {cab.quantity}
                              </div>
                              <p className="font-bold text-sm tracking-tight text-slate-900">{cab.code}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* ACCESSORIES & HARDWARE SECTIONS */}
                {[
                  { key: 'perimeter', label: 'Perimeter Specs', icon: Layers },
                  { key: 'island', label: 'Island Specs', icon: Layout },
                  { key: 'hardware', label: 'Hardware', icon: Package },
                  { key: 'island_hardware', label: 'Island Hardware', icon: Package },
                  { key: 'bump', label: 'Bump / Boxing', icon: Layers },
                  { key: 'island_bump', label: 'Island Bump / Boxing', icon: Layers },
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
        {/* Detect Manufacturer Card */}
        <Card className="bg-gradient-to-br from-sky-50 to-white border-sky-200 rounded-3xl shadow-md">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shrink-0">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-slate-900 text-sm">AI Manufacturer Detection</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Let AI analyze your drawing codes to identify which manufacturer they belong to.
                </p>
                <Link href={`/quotation-ai/detect-manufacturer/${project.id}`}>
                  <Button variant="outline" size="sm" className="mt-3 rounded-xl border-sky-300 text-sky-700 hover:bg-sky-100 text-xs font-bold h-8">
                    <Sparkles className="w-3 h-3 mr-1.5" />
                    Detect Manufacturer
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

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

                  {/* ── Integrity: Series dropdown (first step) ── */}
                  {isIntegrity && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">Series</label>
                      <Select
                        disabled={isFetchingConfig}
                        value={selectedSeries}
                        onValueChange={handleSeriesChange}
                      >
                        <SelectTrigger className="bg-slate-50 border-none h-14 text-slate-900 rounded-2xl shadow-inner">
                          <SelectValue placeholder={isFetchingConfig ? "Syncing..." : "Choose Series"} />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200 text-slate-900">
                          {availableSeries.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">
                       {manufacturers.find(m => m.id === selectedManId)?.name === "Aristocraft" ? "Door Style" : "Collection"}
                    </label>
                    <Select
                      disabled={isFetchingConfig || (isIntegrity && !selectedSeries)}
                      value={config.collection}
                      onValueChange={handleCollectionChange}
                    >
                      <SelectTrigger className="bg-slate-50 border-none h-14 text-slate-900 rounded-2xl shadow-inner">
                        <SelectValue placeholder={
                          isFetchingConfig ? "Syncing..."
                          : (isIntegrity && !selectedSeries) ? "Select a series first"
                          : manufacturers.find(m => m.id === selectedManId)?.name === "Aristocraft" ? "Choose Style"
                          : "Choose Collection"
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900">
                        {availableCollections.map(c => {
                          const separator = isIntegrity && selectedSeries
                            ? selectedSeries.toUpperCase() + ' - '
                            : '';
                          const label = (separator && c.toUpperCase().startsWith(separator))
                            ? c.slice(separator.length)
                            : c;
                          return <SelectItem key={c} value={c}>{label}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">
                       {manufacturers.find(m => m.id === selectedManId)?.name === "Aristocraft" ? "Price Point" : "Door Style"}
                    </label>
                    <Select
                      disabled={isFetchingConfig || !config.collection}
                      value={config.doorStyle}
                      onValueChange={(v) => setConfig((prev: any) => ({ ...prev, doorStyle: v }))}
                    >
                      <SelectTrigger className="bg-slate-50 border-none h-14 text-slate-900 rounded-2xl shadow-inner">
                        <SelectValue placeholder={manufacturers.find(m => m.id === selectedManId)?.name === "Aristocraft" ? "Choose Point" : "Choose Style"} />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900">
                        {availableStyles.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {isIntegrity && (
                    <div className="pt-4 space-y-4 border-t border-slate-100 mt-4 animate-in zoom-in-95">
                       <p className="text-[10px] font-black text-sky-600 uppercase tracking-widest flex items-center gap-2">
                          <Factory className="w-3 h-3" />
                          Global Integrity Specs
                       </p>
                       <div className="grid grid-cols-1 gap-4">
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Box Construction</label>
                             <Select onValueChange={(v) => setConfig((p: any) => ({ ...p, box_construction: v }))}>
                                <SelectTrigger className="bg-sky-50/50 border-none h-10 text-xs font-bold rounded-xl"><SelectValue placeholder="Select Box" /></SelectTrigger>
                                <SelectContent>
                                   <SelectItem value="Frameless Plywood" className="font-bold">Frameless Plywood</SelectItem>
                                   <SelectItem value="Standard Plywood" className="font-bold">Standard Plywood</SelectItem>
                                   <SelectItem value="Particle Board" className="font-bold">Particle Board</SelectItem>
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Finish</label>
                             <Select onValueChange={(v) => setConfig((p: any) => ({ ...p, finish: v }))}>
                                <SelectTrigger className="bg-sky-50/50 border-none h-10 text-xs font-bold rounded-xl"><SelectValue placeholder="Select Finish" /></SelectTrigger>
                                <SelectContent>
                                   <SelectItem value="Standard Stain" className="font-bold">Standard Stain</SelectItem>
                                   <SelectItem value="Paint" className="font-bold">Paint</SelectItem>
                                   <SelectItem value="Glazed" className="font-bold">Glazed</SelectItem>
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Wood Species</label>
                             <Select onValueChange={(v) => setConfig((p: any) => ({ ...p, wood_species: v }))}>
                                <SelectTrigger className="bg-sky-50/50 border-none h-10 text-xs font-bold rounded-xl"><SelectValue placeholder="Wood Type" /></SelectTrigger>
                                <SelectContent>
                                   <SelectItem value="Maple" className="font-bold">Maple</SelectItem>
                                   <SelectItem value="Oak" className="font-bold">Oak</SelectItem>
                                   <SelectItem value="Cherry" className="font-bold">Cherry</SelectItem>
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Drawer Box</label>
                             <Select onValueChange={(v) => setConfig((p: any) => ({ ...p, drawer_box: v }))}>
                                <SelectTrigger className="bg-sky-50/50 border-none h-10 text-xs font-bold rounded-xl"><SelectValue placeholder="Drawer Type" /></SelectTrigger>
                                <SelectContent>
                                   <SelectItem value="Dovetail Wood" className="font-bold">Dovetail Wood</SelectItem>
                                   <SelectItem value="Metal Box" className="font-bold">Metal Box</SelectItem>
                                </SelectContent>
                             </Select>
                          </div>
                       </div>
                    </div>
                  )}

                  {manufacturers.find(m => m.id === selectedManId)?.name === "Aristocraft" && (
                    <div className="pt-4 space-y-4 border-t border-slate-100 mt-4 animate-in zoom-in-95">
                       <p className="text-[10px] font-black text-sky-600 uppercase tracking-widest flex items-center gap-2">
                          <Package className="w-3 h-3" />
                          Aristocraft Options
                       </p>
                       <div className="space-y-1.5">
                          <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Door Finishing</label>
                          <Select onValueChange={(v) => setConfig((p: any) => ({ ...p, finish: v }))}>
                             <SelectTrigger className="bg-sky-50/50 border-none h-10 text-xs font-bold rounded-xl"><SelectValue placeholder="Select Finish" /></SelectTrigger>
                             <SelectContent>
                                <SelectItem value="Standard" className="font-bold">Standard</SelectItem>
                                <SelectItem value="Paint" className="font-bold">Paint</SelectItem>
                                <SelectItem value="Glazed" className="font-bold">Glazed</SelectItem>
                             </SelectContent>
                          </Select>
                       </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Button
              className="w-full h-16 gradient-button mt-4 shadow-2xl shadow-sky-500/20 rounded-2xl text-lg font-bold"
              disabled={!config.doorStyle || isGenerating}
              onClick={handleGenerateBOM}
            >
              {isGenerating ? (
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {generatingDescriptions ? 'AI Enriching...' : 'Building BOM...'}
                  </div>
                  {generationStatus && (
                    <span className="text-xs opacity-75">{generationStatus}</span>
                  )}
                </div>
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
