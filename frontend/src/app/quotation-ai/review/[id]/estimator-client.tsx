
"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableRow
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import {
  Plus,
  Trash2,
  ChevronRight,
  ArrowLeft,
  Box,
  Layers,
  Loader2,
  Layout,
  PlusCircle,
  Factory,
  Package,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateProjectAction } from '../../actions';
import { refineBomFlow } from '@/ai/flows/refine-bom-flow';
import { useRouter } from 'next/navigation';
import { cn, detectCategory, isPrimaryCabinet } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { MANUFACTURER_CONFIG } from '@/lib/manufacturer-config';
// INTEGRITY_SERIES removed — series are now derived dynamically from the DB mapping

interface Item {
  code: string;
  quantity: number;
  _assignedCategory?: string;
}

interface Room {
  room_name: string;
  collection?: string;
  door_style?: string;
  cabinets: Item[];
  perimeter: Item[];
  island: Item[];
  hardware: Item[];
  island_hardware: Item[];
  bump: Item[];
  island_bump: Item[];
  opt_crown?: Item[];
  opt_light_rail?: Item[];
  vent_chase_material?: Item[];
  [key: string]: any; // Allow for dynamic category access
}

interface EstimatorClientProps {
  project: any;
  manufacturers: any[];
}

type Step = 'review' | 'manufacturer' | 'specifications';

const CATEGORIES = [
  { key: 'cabinets', label: 'Primary Cabinets', icon: Box },
  { key: 'perimeter', label: 'Perimeter Specs', icon: Layers },
  { key: 'island', label: 'Island Specs', icon: Layout },
  { key: 'hardware', label: 'Hardware', icon: Package },
  { key: 'island_hardware', label: 'Island Hardware', icon: Package },
  { key: 'bump', label: 'Bump / Boxing', icon: Layers },
  { key: 'island_bump', label: 'Island Bump / Boxing', icon: Layers },
  { key: 'opt_crown', label: 'Optional Crown', icon: Layers },
  { key: 'opt_light_rail', label: 'Optional Light Rail', icon: Layers },
  { key: 'vent_chase_material', label: 'Vent Chase Material', icon: Layers },
];

export function EstimatorClient({ project, manufacturers }: EstimatorClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const initialSyncRef = useRef(false);
  
  const [step, setStep] = useState<Step>('review');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedManId, setSelectedManId] = useState<string>(project.manufacturer_id || '');
  const [manMapping, setManMapping] = useState<Record<string, string[]>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFetchingConfig, setIsFetchingConfig] = useState(false);

  // Integrity-only: series + collection selection (global + per-room)
  const [globalSeries, setGlobalSeries] = useState<string>('');
  const [globalCollection, setGlobalCollection] = useState<string>('');
  const [globalDoorStyle, setGlobalDoorStyle] = useState<string>('');
  const [roomSeriesMap, setRoomSeriesMap] = useState<Record<number, string>>({});
  
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [agentResult, setAgentResult] = useState<{ corrected_rooms: any[], explanations: string[] } | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);

  const normalizeRooms = (rawRooms: any[]) => {
    return rawRooms.map((r: any) => {
      const normalized: any = { ...r, room_name: r.room_name || r.name || "Unknown Room" };
      const categories = ['cabinets', 'perimeter', 'island', 'hardware', 'island_hardware', 'bump', 'island_bump', 'opt_crown', 'opt_light_rail', 'vent_chase_material'];
      
      categories.forEach(cat => {
        normalized[cat] = (r[cat] || []).map((item: any) => {
          if (typeof item === 'string') return { code: item, quantity: 1 };
          return {
            ...item,
            code: item.code || item.sku || '',
            quantity: typeof item.quantity === 'number' ? item.quantity : 1
          };
        });
      });

      normalized.cabinets = normalized.cabinets.map((c: any) => ({
        ...c,
        _assignedCategory: c._assignedCategory || detectCategory(c.code)
      }));

      return normalized;
    });
  };

  useEffect(() => {
    if (project.extracted_data?.rooms) {
      // Only sync if we don't have rooms yet OR if the server data is definitively different/newer
      // For now, we sync once or on re-scan (handled by setRooms)
      if (rooms.length === 0 || initialSyncRef.current === false) {
        setRooms(normalizeRooms(project.extracted_data.rooms));
        initialSyncRef.current = true;
      }
    }
  }, [project, rooms.length]);

  const totals = useMemo(() => {
    let cabinets = 0;
    let accs = 0;
    rooms.forEach(r => {
      (r.cabinets || []).forEach(item => {
        const cat = item._assignedCategory || detectCategory(item.code);
        const isFiller = cat === 'Universal Fillers' || item.code.startsWith('UF');
        const isPanel = cat === 'Panels' || item.code.includes('EP') || item.code.includes('PNL');
        
        if (isPrimaryCabinet(item.code) && !isFiller && !isPanel) {
          cabinets += (Number(item.quantity) || 0);
        } else {
          accs += (Number(item.quantity) || 0);
        }
      });
      CATEGORIES.slice(1).forEach(cat => {
        accs += (r[cat.key] || []).reduce((sum: number, i: any) => sum + (Number(i?.quantity) || 0), 0);
      });
    });
    return { cabinets, accessories: accs };
  }, [rooms]);

  // Preserve the key insertion order from fetchManConfig (spreadsheet column order for
  // Wellborn/1951 Cabinetry; sorted DB order for Integrity and other manufacturers).
  // DO NOT sort here — sorting overrides the predefined pricing-guide column order.
  const allCollections = useMemo(() => Object.keys(manMapping), [manMapping]);

  const isIntegrity = useMemo(
    () => manufacturers.find(m => m.id === selectedManId)?.name === 'Integrity Cabinets',
    [manufacturers, selectedManId]
  );

  /**
   * Dynamically extract series names from whatever the DB actually has.
   * Any collection containing " - " is treated as "SERIES NAME - COLLECTION DETAIL".
   * This handles any naming convention the DB uses without hardcoding.
   */
  const integritySeriesFromDB = useMemo(() => {
    if (!isIntegrity) return [];
    const seriesSet = new Set<string>();
    Object.keys(manMapping).forEach(col => {
      const dashIdx = col.indexOf(' - ');
      if (dashIdx > 0) {
        seriesSet.add(col.substring(0, dashIdx));
      }
    });
    return Array.from(seriesSet).sort();
  }, [manMapping, isIntegrity]);

  /** Filter collections to those belonging to the selected series. */
  const getFilteredCollections = (seriesName: string) => {
    if (!isIntegrity || !seriesName) return allCollections;
    const prefix = seriesName.toUpperCase() + ' - ';
    return allCollections.filter(c => c.toUpperCase().startsWith(prefix));
  };

  /** Strip the series prefix for clean display.
   *  "CLASSIC SERIES - 24 DEEP LIST PRICE" → "24 DEEP LIST PRICE" */
  const getCollectionLabel = (collectionValue: string, seriesName: string) => {
    if (!seriesName) return collectionValue;
    const separator = seriesName.toUpperCase() + ' - ';
    if (collectionValue.toUpperCase().startsWith(separator)) {
      return collectionValue.slice(separator.length);
    }
    return collectionValue;
  };

  // Collections shown in the "Apply to All" card (filtered by globalSeries if Integrity)
  const collections = useMemo(
    () => getFilteredCollections(globalSeries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allCollections, globalSeries, isIntegrity]
  );

  const handleUpdateQty = (rIdx: number, catKey: string, iIdx: number, val: number) => {
    setRooms(prev => {
      const nr = [...prev];
      const items = [...nr[rIdx][catKey]];
      items[iIdx] = { ...items[iIdx], quantity: val };
      nr[rIdx] = { ...nr[rIdx], [catKey]: items };
      return nr;
    });
  };

  const handleUpdateCode = (rIdx: number, catKey: string, iIdx: number, val: string) => {
    setRooms(prev => {
      const nr = [...prev];
      const items = [...nr[rIdx][catKey]];
      items[iIdx] = { ...items[iIdx], code: val.toUpperCase() };
      nr[rIdx] = { ...nr[rIdx], [catKey]: items };
      return nr;
    });
  };

  const handleDelete = (rIdx: number, catKey: string, iIdx: number) => {
    setRooms(prev => {
      const nr = [...prev];
      const items = [...nr[rIdx][catKey]];
      items.splice(iIdx, 1);
      nr[rIdx] = { ...nr[rIdx], [catKey]: items };
      return nr;
    });
  };

  const handleAddItem = (rIdx: number, catKey: string, defaultCode = '', specificCat = '') => {
    setRooms(prev => {
      const nr = [...prev];
      const items = [...(nr[rIdx][catKey] || [])];
      const newItem: any = { code: defaultCode, quantity: 1 };
      if (catKey === 'cabinets') {
        newItem._assignedCategory = specificCat || detectCategory(defaultCode);
      }
      items.push(newItem);
      nr[rIdx] = { ...nr[rIdx], [catKey]: items };
      return nr;
    });
  };

  const handleAddRoom = () => {
    setRooms(prev => [...prev, {
      room_name: `NEW ROOM ${prev.length + 1}`,
      cabinets: [],
      perimeter: [],
      island: [],
      hardware: [],
      island_hardware: [],
      bump: [],
      island_bump: [],
      opt_crown: [],
      opt_light_rail: [],
      vent_chase_material: [],
    }]);
    toast({ title: 'Room Added' });
  };

  const handleRemoveRoom = (idx: number) => {
    if (!confirm('Are you sure you want to remove this room?')) return;
    setRooms(prev => prev.filter((_, i) => i !== idx));
  };

  const handleBack = () => {
    if (step === 'manufacturer') setStep('review');
    else if (step === 'specifications') setStep('manufacturer');
    else router.push('/quotation-ai');
  };

  const handleGenerateQuote = async () => {
    if (rooms.some(r => !r.collection || !r.door_style)) {
      toast({ variant: 'destructive', title: 'Missing Specs', description: 'Apply manufacturer specs to all rooms.' });
      return;
    }
    setIsProcessing(true);
    try {
      await updateProjectAction(project.id, { 
        extracted_data: { rooms }, 
        manufacturer_id: selectedManId 
      });
      
      const res = await fetch('/api/generate-bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, manufacturerId: selectedManId })
      });
      
      const result = await res.json();
      if (result.success) {
        router.push(`/quotation-ai/bom/${project.id}`);
      } else throw new Error(result.error);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const fetchManConfig = async (id: string) => {
    setIsFetchingConfig(true);
    try {
      const res = await fetch(`/api/manufacturer-config?id=${id}`);
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Unknown error loading brands');
      }
      const mapping: Record<string, string[]> = data.mapping || {};

      // For manufacturers with a static config (1951, Wellborn), use the static list as the
      // authoritative collection names shown in the dropdown — this prevents raw DB artifacts
      // like "SCB/S" or "(DURAFROM TEXTURED)" variants from appearing as separate entries.
      // DB door styles are still used when available for each canonical collection.
      const manName = manufacturers.find(m => m.id === id)?.name || '';
      const staticCfg = MANUFACTURER_CONFIG[manName];
      if (staticCfg) {
        // Wellborn / 1951 Cabinetry: use ONLY the static config.
        // The static config is the complete, correctly-ordered pricing-guide source of truth.
        // DB data can contain partial, re-ordered, or cross-collection noise — ignore it entirely.
        const filteredMapping: Record<string, string[]> = {};
        staticCfg.collections.forEach(col => {
          filteredMapping[col.name] = col.styles;
        });
        setManMapping(filteredMapping);
      } else {
        setManMapping(mapping);
      }
    } catch (err: any) {
      console.error('[Client] Load config error:', err);
      toast({ 
        variant: 'destructive', 
        title: 'Error loading brands', 
        description: err.message || 'The connection to the pricing backend failed.' 
      });
    } finally {
      setIsFetchingConfig(false);
    }
  };

  const handleRunSmartAgent = async () => {
    setIsRunningAgent(true);
    try {
      const result = await refineBomFlow({ rooms });
      setAgentResult(result);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Smart Agent Error', description: err.message || 'Failed to refine BOM.' });
    } finally {
      setIsRunningAgent(false);
    }
  };

  const handleRescan = async () => {
    if (!confirm('Re-scan will search the PDF for any missing rooms and add them to your list. Existing rooms with the same names will be preserved. Continue?')) return;
    setIsRescanning(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/agent/rescan-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id }),
      });
      const data = await res.json();
      if (data.success) {
        const newRooms = normalizeRooms(data.rooms || []);
        
        // --- Merge Logic: Proper Patch ---
        const mergedRooms = [...rooms];
        let addedCount = 0;
        
        newRooms.forEach(nr => {
          const exists = mergedRooms.some(r => r.room_name.toUpperCase() === nr.room_name.toUpperCase());
          if (!exists) {
            mergedRooms.push(nr);
            addedCount++;
          }
        });

        setRooms(mergedRooms);

        // Persist the merge back to the DB immediately so it's not lost on refresh
        await updateProjectAction(project.id, {
          extracted_data: { 
            rooms: mergedRooms,
            smart_agent_explanations: [
              ...(project.extracted_data?.smart_agent_explanations || []),
              `Re-scanned PDF. Found ${newRooms.length} rooms. Added ${addedCount} new rooms to existing set.`
            ]
          }
        });

        toast({ 
          title: 'Re-scan Complete', 
          description: addedCount > 0 
            ? `Added ${addedCount} new rooms. Total rooms: ${mergedRooms.length}.` 
            : `No new rooms found. Your current ${mergedRooms.length} rooms are already up to date.`
        });
        
        router.refresh();
      } else {
        throw new Error(data.error || 'Re-scan failed');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Re-scan Error', description: err.message });
    } finally {
      setIsRescanning(false);
    }
  };


  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-6 h-16 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full h-8 w-8" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900">{project.project_name}</h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
              Review Workstation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {step === 'review' && (
            <Button onClick={handleAddRoom} variant="outline" size="sm" className="rounded-xl border-sky-100 text-sky-600 font-bold">
              <PlusCircle className="w-4 h-4 mr-2" />
              Add Room
            </Button>
          )}
        </div>
      </header>

      <div className="p-6 flex-1">
        {step === 'review' && (
          <div className="max-w-5xl mx-auto space-y-8 pb-32 animate-in fade-in duration-500">
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100 sticky top-20 z-40">
               <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-sky-500" />
                  <p className="text-sm font-bold text-slate-600">Review all extracted items and apply manufacturer specifications below.</p>
               </div>
               <div className="flex items-center gap-3">
                 <Button onClick={handleRescan} variant="outline" disabled={isRescanning} title="Re-extract all rooms from original PDF" className="h-12 px-4 border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm font-bold">
                    {isRescanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Re-scan PDF
                 </Button>
                 <Button onClick={handleRunSmartAgent} variant="outline" disabled={isRunningAgent} className="h-12 px-6 border-purple-200 text-purple-700 hover:bg-purple-50 hover:text-purple-800 bg-purple-50/50 shadow-sm font-bold">
                    {isRunningAgent ? <Loader2 className="w-5 h-5 mr-2 animate-spin text-purple-600" /> : <Sparkles className="w-5 h-5 mr-2 text-purple-600" />}
                    Quotation Smart Agent
                 </Button>
                 <Button onClick={() => setStep('manufacturer')} className="h-12 px-10 gradient-button text-base">
                    Select Manufacturer
                    <ChevronRight className="ml-2 w-5 h-5" />
                 </Button>
               </div>
            </div>

            <div className="space-y-12">
              {rooms.map((room, rIdx) => (
                <div key={rIdx} className="space-y-6">
                   <div className="flex items-center justify-between group">
                      <div className="flex items-center gap-3 w-full">
                         <Layout className="w-5 h-5 text-sky-400" />
                         <Input 
                           value={room.room_name} 
                           onChange={(e) => {
                             const nr = [...rooms];
                             nr[rIdx].room_name = e.target.value.toUpperCase();
                             setRooms(nr);
                           }}
                           className="text-xl font-bold text-slate-900 border-none bg-transparent h-auto p-0 focus-visible:ring-0"
                         />
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleRemoveRoom(rIdx)} className="text-slate-300 hover:text-red-500">
                         <Trash2 className="w-5 h-5" />
                      </Button>
                   </div>
                   
                   <div className="grid grid-cols-1 gap-6">
                       {/* GROUPED CABINETS SECTION — Smart: only shows categories that have items */}
                       {(() => {
                         const groupedCabs: Record<string, { originalIndex: number; item: Item }[]> = {};
                         (room.cabinets || []).forEach((item: any, originalIndex) => {
                           const cat = item._assignedCategory || detectCategory(item.code);
                           if (!groupedCabs[cat]) groupedCabs[cat] = [];
                           groupedCabs[cat].push({ originalIndex, item });
                         });

                         const cabOrder = [
                           'Wall Cabinets', 'Base Cabinets', 'Tall Cabinets',
                           'Vanity Cabinets', 'Universal Fillers', 'Panels',
                           'Molding & Trim', 'Hardwares', 'Accessories'
                         ];
                         const extraCats = Object.keys(groupedCabs).filter(c => !cabOrder.includes(c));
                         const finalOrder = [...cabOrder, ...extraCats];

                         const cards = finalOrder.map(catName => {
                           const entries = groupedCabs[catName] || [];
                           if (entries.length === 0) return null;

                           return (
                             <Card key={catName} className="rounded-2xl border-slate-100 shadow-sm overflow-hidden bg-white">
                               <div className="px-6 py-3 bg-slate-50 flex items-center justify-between">
                                  <span className="text-xs font-black uppercase tracking-widest text-slate-600 flex items-center gap-2">
                                    <Box className={cn(
                                      "w-4 h-4",
                                      catName.includes('Wall') ? "text-amber-500" : 
                                      catName.includes('Base') ? "text-sky-500" : 
                                      catName.includes('Vanity') ? "text-purple-500" : 
                                      catName.includes('Tall') ? "text-emerald-500" : "text-slate-400"
                                    )} />
                                    {catName} ({entries.length})
                                  </span>
                                  <Button variant="ghost" size="sm" onClick={() => {
                                    const prefix = catName.includes('Wall') ? 'W' : 
                                                  catName.includes('Base') ? 'B' : 
                                                  catName.includes('Tall') ? 'T' : 
                                                  catName.includes('Vanity') ? 'V' : 
                                                  catName.includes('Filler') ? 'UF' : 
                                                  catName.includes('Molding') ? 'M' : '';
                                    handleAddItem(rIdx, 'cabinets', prefix, catName);
                                  }} className="h-7 text-[10px] uppercase font-bold text-sky-600 bg-sky-50">
                                    <Plus className="w-3 h-3 mr-1" /> Add
                                  </Button>
                               </div>
                               <Table>
                                 <TableBody>
                                   {entries.map(({ originalIndex, item }, iIdx) => (
                                     <TableRow key={iIdx} className="h-14 hover:bg-slate-50 border-slate-50">
                                       <TableCell className="w-24 pl-6">
                                         <Input 
                                           type="number" 
                                           value={item.quantity} 
                                           onChange={(e) => handleUpdateQty(rIdx, 'cabinets', originalIndex, parseInt(e.target.value) || 0)}
                                           className="w-16 h-9 text-center font-bold bg-slate-50 border-none"
                                         />
                                       </TableCell>
                                       <TableCell>
                                         <Input 
                                           value={item.code}
                                           onChange={(e) => handleUpdateCode(rIdx, 'cabinets', originalIndex, e.target.value)}
                                           className="border-none bg-transparent font-bold text-slate-900 text-base"
                                           placeholder="SKU"
                                         />
                                       </TableCell>
                                       <TableCell className="text-right pr-6">
                                         <Button variant="ghost" size="icon" onClick={() => handleDelete(rIdx, 'cabinets', originalIndex)} className="text-slate-300 hover:text-red-500">
                                           <Trash2 className="w-4 h-4" />
                                         </Button>
                                       </TableCell>
                                     </TableRow>
                                   ))}
                                 </TableBody>
                               </Table>
                             </Card>
                           );
                         });

                         return (
                           <>
                             {cards}
                             {/* Add Cabinet button — always visible for manual additions */}
                             <Button
                               variant="outline"
                               onClick={() => handleAddItem(rIdx, 'cabinets', '')}
                               className="w-full h-12 rounded-2xl border-dashed border-2 border-slate-200 text-slate-400 hover:border-sky-400 hover:text-sky-600 transition-all"
                             >
                               <Plus className="w-4 h-4 mr-2" /> Add Cabinet
                             </Button>
                           </>
                         );
                       })()}

                      <Accordion type="multiple" className="w-full space-y-4">
                        {CATEGORIES.slice(1).map((cat) => {
                          const items = room[cat.key] || [];
                          if (items.length === 0 && step === 'review') return null; // Hide empty optional sections in review mode

                          return (
                            <AccordionItem key={cat.key} value={cat.key} className="border-none">
                              <Card className="rounded-2xl border-slate-100 shadow-sm overflow-hidden bg-slate-50/10">
                                <AccordionTrigger className="px-6 py-4 hover:no-underline">
                                  <div className="flex items-center gap-2">
                                    <cat.icon className="w-4 h-4 text-slate-400" />
                                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                                      {cat.label} ({items.length})
                                    </span>
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent className="pb-0">
                                  <div className="px-6 py-2 bg-slate-50/50 flex items-center justify-end">
                                    <Button variant="ghost" size="sm" onClick={() => handleAddItem(rIdx, cat.key)} className="h-6 text-[9px] uppercase font-bold text-slate-400">
                                      <Plus className="w-3 h-3 mr-1" /> Add {cat.label}
                                    </Button>
                                  </div>
                                  <Table>
                                    <TableBody>
                                    {items.map((item: Item, iIdx: number) => (
                                        <TableRow key={iIdx} className="h-12 border-slate-100/50 bg-white">
                                          <TableCell className="w-28 pl-6">
                                            <Input 
                                              type="number" 
                                              value={item.quantity} 
                                              onChange={(e) => handleUpdateQty(rIdx, cat.key, iIdx, parseInt(e.target.value) || 0)}
                                              className="w-16 h-9 text-center font-bold text-sm bg-slate-50 border-none"
                                            />
                                          </TableCell>
                                          <TableCell>
                                            <Input 
                                              value={item.code}
                                              onChange={(e) => handleUpdateCode(rIdx, cat.key, iIdx, e.target.value)}
                                              className="border-none bg-transparent text-slate-600 text-sm font-medium"
                                              placeholder="Code"
                                            />
                                          </TableCell>
                                          <TableCell className="text-right pr-6">
                                            <Button variant="ghost" size="icon" onClick={() => handleDelete(rIdx, cat.key, iIdx)} className="text-slate-200 hover:text-red-500">
                                              <Trash2 className="w-4 h-4" />
                                            </Button>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </AccordionContent>
                              </Card>
                            </AccordionItem>
                          );
                        })}
                       </Accordion>

                       {/* ROOM TOTALS SUMMARY */}
                       <div className="flex justify-end pt-2">
                          <div className="bg-white px-8 py-5 rounded-3xl border border-slate-100 shadow-sm flex gap-12 items-center">
                             <div className="flex flex-col">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Cabinets</span>
                                <div className="flex items-center gap-3">
                                   <span className="text-2xl font-black text-slate-900">
                                      {(room.cabinets || []).reduce((sum, item) => {
                                        return sum + (Number(item.quantity) || 0);
                                      }, 0)}
                                   </span>
                                   <Box className="w-5 h-5 text-sky-500" />
                                </div>
                             </div>
                             <div className="h-10 w-px bg-slate-100" />
                             <div className="flex flex-col">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Room Accessories</span>
                                <div className="flex items-center gap-3">
                                   <span className="text-2xl font-black text-slate-500">
                                      {CATEGORIES.slice(1).reduce((sum, cat) => sum + (room[cat.key] || []).reduce((s: number, i: any) => s + (Number(i?.quantity) || 0), 0), 0)}
                                   </span>
                                   <Package className="w-5 h-5 text-slate-400" />
                                </div>
                             </div>
                          </div>
                       </div>
                    </div>
                 </div>
              ))}
            </div>
          </div>
        )}

        {step === 'manufacturer' && (
          <div className="max-w-xl mx-auto py-8 space-y-6 animate-in fade-in duration-500">
            <h2 className="text-xl font-black text-center text-slate-900">Select Manufacturer</h2>
            <div className="grid grid-cols-1 gap-3">
              {manufacturers.map(m => (
                <button 
                  key={m.id}
                  onClick={() => { setSelectedManId(m.id); fetchManConfig(m.id); setStep('specifications'); }}
                  className="p-4 rounded-xl border border-slate-100 bg-white hover:border-sky-500 transition-all flex items-center gap-4 text-slate-700 shadow-sm"
                >
                  <Factory className="w-5 h-5 text-sky-600" />
                  <span className="font-bold">{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'specifications' && (
          <div className="max-w-4xl mx-auto py-8 space-y-6 animate-in fade-in duration-500">
            <h2 className="text-xl font-black text-center text-slate-900">Configure Brands</h2>

            {/* LOADING STATE */}
            {isFetchingConfig && (
              <Card className="p-8 rounded-2xl bg-white border-slate-100 shadow-md">
                <div className="flex flex-col items-center justify-center gap-4">
                  <div className="relative">
                    <Loader2 className="w-10 h-10 text-sky-500 animate-spin" />
                    <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-sky-100" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-slate-900 text-sm">Loading Collections & Door Styles</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-1">Syncing with pricing database...</p>
                  </div>
                </div>
              </Card>
            )}
            
            {/* APPLY TO ALL ROOMS — Master Selector */}
            {!isFetchingConfig && (
            <>
            <Card className="p-6 rounded-2xl bg-gradient-to-r from-sky-50 to-indigo-50 border-sky-200 shadow-md">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-sm">Apply to All Rooms</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Select once, apply everywhere</p>
                  </div>
                </div>
                <div className="flex gap-3 flex-wrap">
                  {/* Integrity only: Series first */}
                  {isIntegrity && (
                    <div className="space-y-1">
                      <p className="text-[9px] font-black uppercase text-indigo-600 tracking-widest pl-1">Series</p>
                      <Select
                        value={globalSeries}
                        onValueChange={(v) => {
                          setGlobalSeries(v);
                          setGlobalCollection('');
                          setGlobalDoorStyle('');
                          // Sync per-room series map so each room row reflects the selection
                          setRoomSeriesMap(() => {
                            const next: Record<number, string> = {};
                            rooms.forEach((_, i) => { next[i] = v; });
                            return next;
                          });
                          setRooms(prev => prev.map(r => ({ ...r, collection: '', door_style: '' })));
                        }}
                      >
                        <SelectTrigger className="w-44 h-11 text-sm bg-white border-indigo-200 rounded-xl">
                          <SelectValue placeholder="Select Series" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-100">
                          {integritySeriesFromDB.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase text-sky-600 tracking-widest pl-1">Collection</p>
                    <Select
                      key={globalSeries}
                      value={globalCollection}
                      disabled={isIntegrity && !globalSeries}
                      onValueChange={(v) => {
                        setGlobalCollection(v);
                        setGlobalDoorStyle('');
                        setRooms(prev => prev.map(r => ({ ...r, collection: v, door_style: '' })));
                      }}
                    >
                      <SelectTrigger className="w-44 h-11 text-sm bg-white border-sky-200 rounded-xl">
                        <SelectValue placeholder={isIntegrity && !globalSeries ? 'Pick series first' : 'Select'} />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-100 max-h-80">
                        {collections.map(c => (
                          <SelectItem key={c} value={c}>
                            {getCollectionLabel(c, globalSeries)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase text-sky-600 tracking-widest pl-1">Door Style</p>
                    <Select
                      key={globalCollection}
                      value={globalDoorStyle}
                      disabled={!globalCollection}
                      onValueChange={(v) => {
                        setGlobalDoorStyle(v);
                        setRooms(prev => prev.map(r => ({ ...r, door_style: v })));
                      }}
                    >
                      <SelectTrigger className="w-44 h-11 text-sm bg-white border-sky-200 rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent className="bg-white border-slate-100">
                        {globalCollection && manMapping[globalCollection]?.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </Card>

            {/* INDIVIDUAL ROOM OVERRIDES */}
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-[9px] font-black uppercase text-slate-400 tracking-[0.2em]">Or configure per room</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="grid grid-cols-1 gap-4">
              {rooms.map((room, rIdx) => (
                <Card key={rIdx} className="p-6 rounded-2xl flex items-center justify-between gap-4 bg-white border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Layout className="w-5 h-5 text-sky-500" />
                    <span className="font-bold text-slate-900">{room.room_name}</span>
                    {room.collection && room.door_style && (
                      <span className="text-[9px] font-bold uppercase text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full tracking-wider">✓ Set</span>
                    )}
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    {/* Integrity only: Series first per room */}
                    {isIntegrity && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-black uppercase text-indigo-500 tracking-widest pl-1">Series</p>
                        <Select
                          value={roomSeriesMap[rIdx] || ''}
                          onValueChange={(v) => {
                            setRoomSeriesMap(prev => ({ ...prev, [rIdx]: v }));
                            // Reset collection + door_style for this room
                            const nr = [...rooms];
                            nr[rIdx].collection = '';
                            nr[rIdx].door_style = '';
                            setRooms(nr);
                          }}
                        >
                          <SelectTrigger className="w-40 h-11 text-sm bg-indigo-50 border-none rounded-xl">
                            <SelectValue placeholder="Series" />
                          </SelectTrigger>
                          <SelectContent className="bg-white border-slate-100">
                            {integritySeriesFromDB.map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-1">
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest pl-1">Collection</p>
                      <Select
                        key={roomSeriesMap[rIdx] ?? 'no-series'}
                        value={room.collection}
                        disabled={isIntegrity && !roomSeriesMap[rIdx]}
                        onValueChange={(v) => {
                          const nr = [...rooms];
                          nr[rIdx].collection = v;
                          nr[rIdx].door_style = '';
                          setRooms(nr);
                        }}
                      >
                        <SelectTrigger className="w-44 h-11 text-sm bg-slate-50 border-none rounded-xl">
                          <SelectValue placeholder={isIntegrity && !roomSeriesMap[rIdx] ? 'Pick series' : 'Select'} />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-100 max-h-80">
                          {getFilteredCollections(roomSeriesMap[rIdx] || '').map(c => (
                            <SelectItem key={c} value={c}>
                              {getCollectionLabel(c, roomSeriesMap[rIdx] || '')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest pl-1">Door Style</p>
                      <Select value={room.door_style} onValueChange={(v) => {
                        const nr = [...rooms];
                        nr[rIdx].door_style = v;
                        setRooms(nr);
                      }} disabled={!room.collection}>
                        <SelectTrigger className="w-44 h-11 text-sm bg-slate-50 border-none rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent className="bg-white border-slate-100">
                          {room.collection && manMapping[room.collection]?.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            <Button onClick={handleGenerateQuote} className="w-full h-14 gradient-button mt-4 shadow-xl shadow-sky-500/10" disabled={isProcessing}>
              {isProcessing ? <Loader2 className="animate-spin" /> : 'Finalize Pricing'}
            </Button>
            </>
            )}
          </div>
        )}
      </div>

      {/* Quotation Smart Agent Review Dialog */}
      <Dialog open={!!agentResult} onOpenChange={(open) => { if (!open) setAgentResult(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-700">
              <Sparkles className="w-5 h-5" />
              Smart Agent Review Complete
            </DialogTitle>
            <DialogDescription>
              The AI has reviewed your Bill of Materials based on NKBA structural rules. Here are the suggested changes:
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {agentResult?.explanations && agentResult.explanations.length > 0 ? (
              agentResult.explanations.map((exp, idx) => (
                <div key={idx} className="p-3 bg-purple-50 text-purple-900 border border-purple-100 rounded-lg text-sm flex gap-3">
                  <Sparkles className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
                  <span>{exp}</span>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-emerald-600 bg-emerald-50 rounded-xl border border-emerald-100 flex flex-col items-center gap-2">
                <Sparkles className="w-8 h-8" />
                <p className="font-bold">Perfect! No corrections needed.</p>
                <p className="text-xs">Your extracted items perfectly match standard NKBA taxonomies.</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setAgentResult(null)}>Cancel</Button>
            {agentResult?.explanations && agentResult.explanations.length > 0 && (
              <Button onClick={() => {
                if (agentResult) {
                  const enrichedRooms = agentResult.corrected_rooms.map((r: any) => ({
                    ...r,
                    cabinets: (r.cabinets || []).map((c: any) => ({
                      ...c,
                      _assignedCategory: c._assignedCategory || detectCategory(c.code)
                    }))
                  }));
                  setRooms(enrichedRooms);
                }
                setAgentResult(null);
                toast({ title: 'Corrections Applied', description: 'The suggested changes have been merged.' });
              }} className="bg-purple-600 hover:bg-purple-700 text-white">
                Approve & Apply Corrections
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
