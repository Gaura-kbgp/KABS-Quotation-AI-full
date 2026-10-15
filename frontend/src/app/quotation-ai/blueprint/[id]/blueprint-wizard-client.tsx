'use client';

import { useState, useMemo, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, Plus, Trash2, Ruler, Blocks, Wand2, Save, Download, DoorOpen,
  Refrigerator, ChefHat, Droplet, WashingMachine, LayoutGrid, FileText, Sparkles, Circle,
  Loader2, CheckCircle2,
} from 'lucide-react';
import { useRef } from 'react';
import Link from 'next/link';
import { LayoutCanvas } from './layout-canvas';
import { saveBlueprintAction } from '@/app/quotation-ai/actions';

type Opening = { type: 'window' | 'door'; start_in: number; width_in: number; sill_height_in?: number };
type Appliance = { type: 'sink' | 'dishwasher' | 'range' | 'cooktop' | 'oven' | 'fridge' | 'microwave' | 'hood'; center_in: number; width_in: number };
type Wall = {
  id: string;
  length_in: number;
  openings: Opening[];
  appliances: Appliance[];
  kind?: 'wall' | 'island' | 'peninsula';
  attached_end?: 'left' | 'right';
};
type BomItem = { code: string; qty: number; wall: string; position_in: number; category: string; notes?: string };

const APPLIANCE_ICONS: Record<string, any> = {
  sink: Droplet, dishwasher: WashingMachine, range: ChefHat, cooktop: ChefHat,
  oven: ChefHat, fridge: Refrigerator, microwave: ChefHat, hood: ChefHat,
};

const APPLIANCE_DEFAULTS: Record<string, number> = {
  sink: 33, dishwasher: 24, range: 30, cooktop: 30, oven: 30, fridge: 36, microwave: 24, hood: 30,
};

function newWall(idx: number, kind: 'wall' | 'island' | 'peninsula' = 'wall'): Wall {
  const prefix = kind === 'island' ? 'I' : kind === 'peninsula' ? 'P' : String.fromCharCode(65 + idx);
  return { id: prefix, length_in: kind === 'island' ? 72 : 120, openings: [], appliances: [], kind, attached_end: 'left' };
}

export function BlueprintWizardClient({ id, project }: { id: string; project: any }) {
  const { toast } = useToast();
  const pdfFileRef = useRef<HTMLInputElement | null>(null);
  const [isSaving, startSave] = useTransition();
  const [lastSaved, setLastSaved] = useState<Date | null>(
    project.extracted_data?.blueprint ? new Date() : null
  );

  // Init from saved blueprint spec if available
  const saved = project.extracted_data?.blueprint;
  const [walls, setWalls] = useState<Wall[]>(saved?.walls?.length ? saved.walls : [newWall(0)]);
  const [ceilingIn, setCeilingIn] = useState<number>(saved?.ceiling_height_in ?? 96);
  const [wallCabHeight, setWallCabHeight] = useState<number>(saved?.options?.wall_cabinet_height_in ?? 36);
  const [hasCrown, setHasCrown] = useState<boolean>(saved?.options?.has_crown ?? true);
  const [hasLightRail, setHasLightRail] = useState<boolean>(saved?.options?.has_light_rail ?? false);
  const [generated, setGenerated] = useState<{ items: BomItem[]; summary: any; warnings: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [parsingPdf, setParsingPdf] = useState(false);
  const [refining, setRefining] = useState(false);
  const [aiReview, setAiReview] = useState<any>(null);
  const [roomName, setRoomName] = useState<string>('KITCHEN');
  const [replaceExisting, setReplaceExisting] = useState(false);

  const currentSpec = () => ({
    walls,
    ceiling_height_in: ceilingIn,
    options: { wall_cabinet_height_in: wallCabHeight, has_crown: hasCrown, has_light_rail: hasLightRail },
  });

  const saveSpec = () => {
    startSave(async () => {
      const res = await saveBlueprintAction(id, currentSpec());
      if (res.success) {
        setLastSaved(new Date());
        toast({ title: '✓ Blueprint saved' });
      } else {
        toast({ variant: 'destructive', title: 'Save failed', description: res.error });
      }
    });
  };

  const addWall = (kind: 'wall' | 'island' | 'peninsula' = 'wall') =>
    setWalls(w => [...w, newWall(w.length, kind)]);
  const removeWall = (idx: number) => setWalls(w => w.filter((_, i) => i !== idx));
  const updateWall = (idx: number, patch: Partial<Wall>) =>
    setWalls(w => w.map((wl, i) => (i === idx ? { ...wl, ...patch } : wl)));

  const addAppliance = (idx: number) =>
    setWalls(w => w.map((wl, i) =>
      i === idx ? { ...wl, appliances: [...wl.appliances, { type: 'sink', center_in: wl.length_in / 2, width_in: APPLIANCE_DEFAULTS.sink }] } : wl
    ));
  const updateAppliance = (wIdx: number, aIdx: number, patch: Partial<Appliance>) =>
    setWalls(w => w.map((wl, i) =>
      i === wIdx ? {
        ...wl,
        appliances: wl.appliances.map((a, j) => j === aIdx
          ? { ...a, ...patch, width_in: patch.type ? APPLIANCE_DEFAULTS[patch.type] : (patch.width_in ?? a.width_in) }
          : a),
      } : wl
    ));
  const removeAppliance = (wIdx: number, aIdx: number) =>
    setWalls(w => w.map((wl, i) =>
      i === wIdx ? { ...wl, appliances: wl.appliances.filter((_, j) => j !== aIdx) } : wl
    ));

  const addOpening = (idx: number) =>
    setWalls(w => w.map((wl, i) =>
      i === idx ? { ...wl, openings: [...wl.openings, { type: 'window', start_in: 36, width_in: 36, sill_height_in: 36 }] } : wl
    ));
  const updateOpening = (wIdx: number, oIdx: number, patch: Partial<Opening>) =>
    setWalls(w => w.map((wl, i) =>
      i === wIdx ? { ...wl, openings: wl.openings.map((o, j) => j === oIdx ? { ...o, ...patch } : o) } : wl
    ));
  const removeOpening = (wIdx: number, oIdx: number) =>
    setWalls(w => w.map((wl, i) =>
      i === wIdx ? { ...wl, openings: wl.openings.filter((_, j) => j !== oIdx) } : wl
    ));

  const totalLinearFeet = useMemo(
    () => walls.reduce((s, w) => s + w.length_in, 0) / 12,
    [walls]
  );

  const generate = async () => {
    setLoading(true);
    setGenerated(null);
    try {
      const res = await fetch('/api/backend/api/blueprint/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ceiling_height_in: ceilingIn,
          walls,
          options: {
            wall_cabinet_height_in: wallCabHeight,
            has_crown: hasCrown,
            has_light_rail: hasLightRail,
          },
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Layout failed');
      setGenerated({ items: data.items, summary: data.summary, warnings: data.warnings });
      toast({ title: 'Layout generated', description: `${data.summary.total_items} items across ${data.summary.walls_processed} walls.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Generation failed', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!generated) return;
    setApplying(true);
    try {
      const res = await fetch('/api/backend/api/blueprint/apply-to-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: id,
          room_name: roomName,
          spec: {
            ceiling_height_in: ceilingIn,
            walls,
            options: { wall_cabinet_height_in: wallCabHeight, has_crown: hasCrown, has_light_rail: hasLightRail },
          },
          replace_existing: replaceExisting,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Apply failed');
      // Auto-save spec to DB when applying so it's preserved
      await saveBlueprintAction(id, currentSpec());
      setLastSaved(new Date());
      toast({ title: 'Applied to project', description: `${data.added} items added to ${data.room}. Now generate the BOM to see pricing.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Apply failed', description: err.message });
    } finally {
      setApplying(false);
    }
  };

  const importPdf = async (file: File) => {
    setParsingPdf(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/backend/api/blueprint/parse-pdf', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'PDF parse failed');
      if (!data.walls || data.walls.length === 0) {
        toast({ variant: 'destructive', title: 'No walls found',
          description: data.warnings?.[0] || 'Try a cleaner page or enter walls manually.' });
      } else {
        setWalls(data.walls.map((w: any, i: number) => ({
          id: w.id || String.fromCharCode(65 + i),
          length_in: w.length_in,
          openings: w.openings || [],
          appliances: (w.appliances || []).map((a: any) => ({
            ...a,
            width_in: a.width_in || (APPLIANCE_DEFAULTS[a.type] || 24),
          })),
          kind: 'wall',
          attached_end: 'left',
        })));
        const src = data.source === 'ai' ? 'AI' : 'heuristic';
        toast({ title: 'PDF imported',
          description: `${data.walls.length} walls found (${src} parser), ${data.dimensions_found} dimensions parsed. Review and tweak before generating.` });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'PDF import failed', description: err.message });
    } finally {
      setParsingPdf(false);
    }
  };

  const aiRefine = async () => {
    if (!generated) return;
    setRefining(true);
    setAiReview(null);
    try {
      const res = await fetch('/api/backend/api/blueprint/ai-refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: { ceiling_height_in: ceilingIn, walls, options: { wall_cabinet_height_in: wallCabHeight, has_crown: hasCrown, has_light_rail: hasLightRail } },
          items: generated.items,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'AI refine failed');
      setAiReview(data.review);
      toast({ title: 'AI review complete',
        description: `${data.review.verdict || 'review'} — ${(data.review.suggestions || []).length} suggestions.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'AI review failed', description: err.message });
    } finally {
      setRefining(false);
    }
  };

  const downloadSpec = () => {
    const blob = new Blob([JSON.stringify({ ceiling_height_in: ceilingIn, walls, options: { wall_cabinet_height_in: wallCabHeight, has_crown: hasCrown, has_light_rail: hasLightRail } }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blueprint-${project.project_name || id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-slate-50 p-3 sm:p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center gap-3 mb-4 sm:mb-6">
          <Button asChild variant="ghost" size="icon" className="rounded-xl shrink-0">
            <Link href={`/quotation-ai/bom/${id}`}><ArrowLeft className="w-5 h-5" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-3xl font-black text-slate-800">Blueprint Mode</h1>
            <p className="text-xs sm:text-sm text-slate-500 font-bold uppercase tracking-wider truncate">
              {project.project_name} • Layout Generator
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={pdfFileRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) importPdf(f);
                e.target.value = '';
              }}
            />
            {lastSaved && (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Saved </span>{lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <Button variant="outline" onClick={saveSpec} disabled={isSaving} className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 h-9 px-3">
              {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Save
            </Button>
            <Button variant="outline" onClick={() => pdfFileRef.current?.click()}
                    disabled={parsingPdf} className="rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 h-9 px-3">
              <FileText className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">{parsingPdf ? 'Reading…' : 'Import 2020 PDF'}</span>
              <span className="sm:hidden">Import</span>
            </Button>
            <Button variant="outline" onClick={downloadSpec} className="rounded-xl h-9 px-3">
              <Download className="w-4 h-4 mr-1" /><span className="hidden sm:inline">Export JSON</span>
            </Button>
            <Button onClick={generate} disabled={loading} className="gradient-button rounded-xl h-9 px-3">
              <Wand2 className="w-4 h-4 mr-1" />
              {loading ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: wall inputs */}
          <div className="lg:col-span-2 space-y-4">
            {/* Global options */}
            <Card className="p-5 rounded-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Ruler className="w-5 h-5 text-sky-600" />
                <h2 className="font-black text-slate-700">Room Options</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-[10px] font-black uppercase text-slate-400">Ceiling (in)</Label>
                  <Input type="number" value={ceilingIn} onChange={e => setCeilingIn(Number(e.target.value) || 96)} className="rounded-xl font-bold" />
                </div>
                <div>
                  <Label className="text-[10px] font-black uppercase text-slate-400">Wall Cab Height</Label>
                  <Input type="number" value={wallCabHeight} onChange={e => setWallCabHeight(Number(e.target.value) || 36)} className="rounded-xl font-bold" />
                </div>
                <label className="flex items-center gap-2 self-end pb-2">
                  <Checkbox checked={hasCrown} onCheckedChange={v => setHasCrown(!!v)} />
                  <span className="text-sm font-bold">Crown</span>
                </label>
                <label className="flex items-center gap-2 self-end pb-2">
                  <Checkbox checked={hasLightRail} onCheckedChange={v => setHasLightRail(!!v)} />
                  <span className="text-sm font-bold">Light Rail</span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Total wall run: <span className="font-black text-slate-700">{totalLinearFeet.toFixed(1)} ft</span>
                {' '}· {walls.length} wall{walls.length !== 1 ? 's' : ''}
              </p>
            </Card>

            {walls.map((wall, wIdx) => (
              <Card key={wIdx} className="p-5 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-xl font-black flex items-center justify-center text-lg ${
                    wall.kind === 'island' ? 'bg-indigo-100 text-indigo-700' :
                    wall.kind === 'peninsula' ? 'bg-violet-100 text-violet-700' :
                    'bg-sky-100 text-sky-700'
                  }`}>
                    {wall.id}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-black text-slate-700 flex items-center gap-2">
                      {wall.kind === 'island' ? 'Island' : wall.kind === 'peninsula' ? 'Peninsula' : 'Wall'} {wall.id}
                      {wall.kind && wall.kind !== 'wall' && (
                        <span className="text-[9px] font-black uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          both sides
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-500">{(wall.length_in / 12).toFixed(1)} ft</p>
                  </div>
                  {wall.kind === 'peninsula' && (
                    <div className="w-32">
                      <Label className="text-[10px] font-black uppercase text-slate-400">Attached End</Label>
                      <Select value={wall.attached_end || 'left'} onValueChange={v => updateWall(wIdx, { attached_end: v as any })}>
                        <SelectTrigger className="h-9 rounded-xl font-bold"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left" className="font-bold">Left</SelectItem>
                          <SelectItem value="right" className="font-bold">Right</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="w-32">
                    <Label className="text-[10px] font-black uppercase text-slate-400">Length (in)</Label>
                    <Input
                      type="number"
                      value={wall.length_in}
                      onChange={e => updateWall(wIdx, { length_in: Number(e.target.value) || 0 })}
                      className="rounded-xl font-bold"
                    />
                  </div>
                  {walls.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeWall(wIdx)} className="text-red-500 rounded-xl">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                {/* Appliances */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400">Appliances & Sink</Label>
                    <Button variant="ghost" size="sm" onClick={() => addAppliance(wIdx)} className="h-7 rounded-lg text-xs">
                      <Plus className="w-3 h-3 mr-1" />Add
                    </Button>
                  </div>
                  {wall.appliances.length === 0 && (
                    <p className="text-xs text-slate-400 italic">No appliances — this wall will be all cabinets.</p>
                  )}
                  <div className="space-y-2">
                    {wall.appliances.map((a, aIdx) => {
                      const Icon = APPLIANCE_ICONS[a.type] || Blocks;
                      return (
                        <div key={aIdx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                          <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                          <Select value={a.type} onValueChange={v => updateAppliance(wIdx, aIdx, { type: v as any })}>
                            <SelectTrigger className="h-9 rounded-lg bg-white font-bold flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.keys(APPLIANCE_DEFAULTS).map(k => (
                                <SelectItem key={k} value={k} className="font-bold capitalize">{k}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1">
                            <Label className="text-[10px] text-slate-400">Center</Label>
                            <Input type="number" value={a.center_in} onChange={e => updateAppliance(wIdx, aIdx, { center_in: Number(e.target.value) || 0 })} className="h-9 rounded-lg w-20 font-bold" />
                          </div>
                          <div className="flex items-center gap-1">
                            <Label className="text-[10px] text-slate-400">W</Label>
                            <Input type="number" value={a.width_in} onChange={e => updateAppliance(wIdx, aIdx, { width_in: Number(e.target.value) || 0 })} className="h-9 rounded-lg w-16 font-bold" />
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeAppliance(wIdx, aIdx)} className="text-red-500 h-8 w-8 rounded-lg">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Openings */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400">Openings (windows / doors)</Label>
                    <Button variant="ghost" size="sm" onClick={() => addOpening(wIdx)} className="h-7 rounded-lg text-xs">
                      <Plus className="w-3 h-3 mr-1" />Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {wall.openings.map((op, oIdx) => (
                      <div key={oIdx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                        <DoorOpen className="w-4 h-4 text-slate-500 shrink-0" />
                        <Select value={op.type} onValueChange={v => updateOpening(wIdx, oIdx, { type: v as any })}>
                          <SelectTrigger className="h-9 rounded-lg bg-white font-bold flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="window" className="font-bold">Window</SelectItem>
                            <SelectItem value="door" className="font-bold">Door</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1">
                          <Label className="text-[10px] text-slate-400">Start</Label>
                          <Input type="number" value={op.start_in} onChange={e => updateOpening(wIdx, oIdx, { start_in: Number(e.target.value) || 0 })} className="h-9 rounded-lg w-20 font-bold" />
                        </div>
                        <div className="flex items-center gap-1">
                          <Label className="text-[10px] text-slate-400">W</Label>
                          <Input type="number" value={op.width_in} onChange={e => updateOpening(wIdx, oIdx, { width_in: Number(e.target.value) || 0 })} className="h-9 rounded-lg w-16 font-bold" />
                        </div>
                        {op.type === 'window' && (
                          <div className="flex items-center gap-1">
                            <Label className="text-[10px] text-slate-400">Sill</Label>
                            <Input type="number" value={op.sill_height_in || 36} onChange={e => updateOpening(wIdx, oIdx, { sill_height_in: Number(e.target.value) || 36 })} className="h-9 rounded-lg w-16 font-bold" />
                          </div>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => removeOpening(wIdx, oIdx)} className="text-red-500 h-8 w-8 rounded-lg">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Visual preview of this wall */}
                <WallPreview wall={wall} items={generated?.items.filter(it => it.wall === wall.id) || []} />
              </Card>
            ))}

            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => addWall('wall')} className="rounded-xl font-bold">
                <Plus className="w-4 h-4 mr-2" />Wall
              </Button>
              <Button variant="outline" onClick={() => addWall('island')} className="rounded-xl font-bold border-indigo-200 text-indigo-700">
                <Blocks className="w-4 h-4 mr-2" />Island
              </Button>
              <Button variant="outline" onClick={() => addWall('peninsula')} className="rounded-xl font-bold border-violet-200 text-violet-700">
                <LayoutGrid className="w-4 h-4 mr-2" />Peninsula
              </Button>
            </div>
          </div>

          {/* Right: generated layout */}
          <div className="lg:col-span-1">
            <Card className="p-5 rounded-2xl sticky top-6">
              <div className="flex items-center gap-2 mb-4">
                <LayoutGrid className="w-5 h-5 text-sky-600" />
                <h2 className="font-black text-slate-700">Generated Layout</h2>
              </div>

              {!generated && (
                <div className="text-center py-12">
                  <Blocks className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 font-bold">Click "Generate Layout" to see proposed cabinets.</p>
                </div>
              )}

              {generated && (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <StatBox label="Base" value={generated.summary.base_cabinets} />
                    <StatBox label="Wall" value={generated.summary.wall_cabinets} />
                    <StatBox label="Sink Base" value={generated.summary.sink_bases} />
                    <StatBox label="Fillers" value={generated.summary.fillers} />
                  </div>

                  {generated.warnings.length > 0 && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <p className="text-xs font-black uppercase text-amber-700 mb-1">Warnings</p>
                      {generated.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-800">• {w}</p>
                      ))}
                    </div>
                  )}

                  <div className="space-y-1 max-h-96 overflow-y-auto border rounded-xl p-3 bg-slate-50 mb-4">
                    {generated.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="font-mono font-bold text-slate-700">{it.code}</span>
                        <span className="text-slate-400">{it.wall} @ {it.position_in}"</span>
                        <span className="text-slate-500">×{it.qty}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 pt-3 border-t">
                    <Button onClick={aiRefine} disabled={refining} variant="outline" className="w-full rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50">
                      <Sparkles className="w-4 h-4 mr-2" />
                      {refining ? 'Reviewing…' : 'AI Review Layout'}
                    </Button>

                    {aiReview && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3 h-3 text-amber-600" />
                          <span className="text-[10px] font-black uppercase text-amber-700">
                            AI Verdict: {aiReview.verdict || 'review'}
                          </span>
                        </div>
                        {aiReview.notes && aiReview.notes.length > 0 && (
                          <ul className="text-xs text-amber-900 list-disc pl-4 space-y-0.5">
                            {aiReview.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
                          </ul>
                        )}
                        {aiReview.suggestions && aiReview.suggestions.length > 0 && (
                          <div className="pt-2 border-t border-amber-200">
                            <p className="text-[10px] font-black uppercase text-amber-700 mb-1">Suggestions ({aiReview.suggestions.length})</p>
                            {aiReview.suggestions.map((s: any, i: number) => (
                              <div key={i} className="text-xs text-amber-900">
                                <span className="font-black">{s.action}</span>{' '}
                                {s.wall && <span className="font-mono">[{s.wall}]</span>}{' '}
                                {s.target_code && <span className="font-mono">{s.target_code}</span>}
                                {s.with_code && <span className="font-mono"> → {s.with_code}</span>}
                                {s.reason && <span className="italic text-amber-700"> — {s.reason}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {aiReview.raw && (
                          <pre className="text-[10px] text-amber-800 whitespace-pre-wrap">{aiReview.raw}</pre>
                        )}
                      </div>
                    )}

                    <div>
                      <Label className="text-[10px] font-black uppercase text-slate-400">Apply to Room</Label>
                      <Input value={roomName} onChange={e => setRoomName(e.target.value.toUpperCase())} className="rounded-xl font-bold" />
                    </div>
                    <label className="flex items-center gap-2">
                      <Checkbox checked={replaceExisting} onCheckedChange={v => setReplaceExisting(!!v)} />
                      <span className="text-xs font-bold">Replace existing items in that room</span>
                    </label>
                    <Button onClick={apply} disabled={applying} className="w-full gradient-button rounded-xl">
                      <Save className="w-4 h-4 mr-2" />
                      {applying ? 'Applying…' : 'Apply to Project'}
                    </Button>
                    <Button asChild variant="outline" className="w-full rounded-xl">
                      <Link href={`/quotation-ai/bom/${id}`}>Go to BOM / Pricing →</Link>
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>

        {/* Module 2 — Visual 2D Layout Canvas */}
        {generated && generated.items.length > 0 && (
          <div className="mt-6">
            <LayoutCanvas
              walls={walls}
              items={generated.items}
              warnings={generated.warnings}
            />
          </div>
        )}
      </div>
    </main>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-xl bg-sky-50 border border-sky-100 text-center">
      <p className="text-2xl font-black text-sky-700">{value}</p>
      <p className="text-[10px] font-black uppercase text-sky-500 tracking-wider">{label}</p>
    </div>
  );
}

function WallPreview({ wall, items }: { wall: Wall; items: BomItem[] }) {
  if (!wall.length_in) return null;
  const PX_PER_IN = 2.5;
  const widthPx = Math.min(900, wall.length_in * PX_PER_IN);
  const scale = widthPx / wall.length_in;

  return (
    <div className="mt-4 border-t pt-3">
      <Label className="text-[10px] font-black uppercase text-slate-400">Preview</Label>
      <div className="relative mt-2 bg-slate-100 rounded-lg overflow-x-auto">
        <div className="relative h-32" style={{ width: widthPx + 'px' }}>
          {/* Base cabinet band (bottom 50%) */}
          <div className="absolute left-0 right-0 bottom-0 h-16 bg-amber-50 border border-amber-200">
            {items.filter(it => it.category === 'cabinets' && (it.code.startsWith('B') || it.code.startsWith('SB') || it.code.startsWith('UF') || it.code === 'TK96')).map((it, i) => {
              if (it.code === 'TK96') return null;
              const w = parseInt(it.code.replace(/[^0-9]/g, '')) || 12;
              return (
                <div key={i} className="absolute bottom-0 top-0 border-r border-amber-400 bg-amber-100 flex items-center justify-center text-[9px] font-black text-amber-900"
                     style={{ left: it.position_in * scale + 'px', width: w * scale + 'px' }}>
                  {it.code}
                </div>
              );
            })}
            {items.filter(it => it.category === 'appliance_spacer').map((it, i) => {
              const noteMatch = it.notes?.match(/\((\d+)"-(\d+)"\)/);
              const start = noteMatch ? parseInt(noteMatch[1]) : it.position_in;
              const end = noteMatch ? parseInt(noteMatch[2]) : start + 30;
              const isHood = it.code.includes('HOOD');
              return !isHood ? (
                <div key={i} className="absolute bottom-0 top-0 bg-slate-200 border border-slate-400 flex items-center justify-center text-[9px] font-black text-slate-600"
                     style={{ left: start * scale + 'px', width: (end - start) * scale + 'px' }}>
                  {it.code.replace('_SPACE', '')}
                </div>
              ) : null;
            })}
          </div>
          {/* Wall cabinet band (top 50%) */}
          <div className="absolute left-0 right-0 top-0 h-14 bg-sky-50 border border-sky-200">
            {items.filter(it => it.category === 'cabinets' && it.code.startsWith('W') && !it.code.startsWith('WB')).map((it, i) => {
              const m = it.code.match(/^W(\d+)/);
              const w = m ? parseInt(m[1]) : 24;
              return (
                <div key={i} className="absolute top-0 bottom-0 border-r border-sky-400 bg-sky-100 flex items-center justify-center text-[9px] font-black text-sky-900"
                     style={{ left: it.position_in * scale + 'px', width: w * scale + 'px' }}>
                  {it.code}
                </div>
              );
            })}
            {items.filter(it => it.code === 'HOOD_SPACE').map((it, i) => {
              const noteMatch = it.notes?.match(/\((\d+)"-(\d+)"\)/);
              const start = noteMatch ? parseInt(noteMatch[1]) : it.position_in;
              const end = noteMatch ? parseInt(noteMatch[2]) : start + 30;
              return (
                <div key={i} className="absolute top-0 bottom-0 bg-rose-100 border border-rose-300 flex items-center justify-center text-[9px] font-black text-rose-700"
                     style={{ left: start * scale + 'px', width: (end - start) * scale + 'px' }}>
                  HOOD
                </div>
              );
            })}
          </div>
          {/* Openings overlay */}
          {wall.openings.map((op, i) => (
            <div key={i} className={`absolute top-0 bottom-0 border-2 ${op.type === 'window' ? 'border-blue-400 bg-blue-50/50' : 'border-amber-500 bg-amber-50/50'} pointer-events-none`}
                 style={{ left: op.start_in * scale + 'px', width: op.width_in * scale + 'px' }}>
              <span className="absolute top-1 left-1 text-[8px] font-black text-slate-600 uppercase bg-white px-1 rounded">{op.type}</span>
            </div>
          ))}
        </div>
        {/* Ruler */}
        <div className="relative h-5 text-[9px] text-slate-500 border-t border-slate-300" style={{ width: widthPx + 'px' }}>
          {Array.from({ length: Math.ceil(wall.length_in / 12) + 1 }).map((_, i) => (
            <div key={i} className="absolute top-0 border-l border-slate-300 pl-0.5" style={{ left: i * 12 * scale + 'px' }}>
              {i}′
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
