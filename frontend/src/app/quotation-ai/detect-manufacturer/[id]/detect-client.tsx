"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Cpu, Factory, Search, ChevronRight, Loader2,
  CheckCircle2, AlertTriangle, BookOpen, Zap,
  Info, ArrowLeft, Sparkles, Building2,
} from 'lucide-react';

interface Props {
  project: any;
  manufacturers: { id: string; name: string }[];
}

interface DetectionResult {
  detected_manufacturer: string;
  confidence: number;
  reasoning: string;
  key_indicators: string[];
  alternative_matches: { manufacturer: string; confidence: number; reason: string }[];
  coding_patterns_observed: Record<string, string | string[]>;
}

interface ResearchResult {
  coding_system: string;
  series_lines: string[];
  wall_cabinet_prefix: string;
  base_cabinet_prefix: string;
  example_skus: string[];
  notes: string;
  confidence: number;
  [key: string]: unknown;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

export function DetectManufacturerClient({ project, manufacturers }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<'detect' | 'select' | 'research' | 'done'>('detect');
  const [isDetecting, setIsDetecting] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [selectedManufacturerId, setSelectedManufacturerId] = useState('');
  const [selectedManufacturerName, setSelectedManufacturerName] = useState('');
  const [isOther, setIsOther] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Extract all cabinet codes from project
  const rooms: any[] = project.extracted_data?.rooms || [];
  const allCodes: { code: string; room: string }[] = [];
  const roomTypes: string[] = [];

  for (const room of rooms) {
    roomTypes.push(room.room_name);
    const cats = ['cabinets', 'perimeter', 'island', 'hardware', 'bump',
      'opt_crown', 'opt_light_rail', 'vent_chase_material'];
    for (const cat of cats) {
      for (const item of room[cat] || []) {
        allCodes.push({ code: item.code, room: room.room_name });
      }
    }
  }

  const uniqueCodes = [...new Map(allCodes.map(c => [c.code, c])).values()];

  const handleDetect = async () => {
    setIsDetecting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/detect-manufacturer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          codes: uniqueCodes.slice(0, 60),
          room_types: roomTypes,
          project_info: project.project_name || '',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setDetection(data);
        setStep('select');

        // Pre-select if detected manufacturer matches a saved one
        if (data.detected_manufacturer && data.detected_manufacturer !== 'Unknown') {
          const matched = manufacturers.find(m =>
            m.name.toLowerCase().includes(data.detected_manufacturer.toLowerCase()) ||
            data.detected_manufacturer.toLowerCase().includes(m.name.toLowerCase())
          );
          if (matched) {
            setSelectedManufacturerId(matched.id);
            setSelectedManufacturerName(matched.name);
          }
        }
      } else {
        throw new Error(data.error || 'Detection failed');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Detection Error', description: err.message });
    } finally {
      setIsDetecting(false);
    }
  };

  const handleResearchOther = async () => {
    if (!otherName.trim()) return;
    setIsResearching(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/research-manufacturer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manufacturer_name: otherName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setResearch(data.research);
        setStep('research');
      } else {
        throw new Error(data.error || 'Research failed');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Research Error', description: err.message });
    } finally {
      setIsResearching(false);
    }
  };

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      // Save detection to project metadata
      const updateRes = await fetch('/api/update-project-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          metadata: {
            detected_manufacturer: detection?.detected_manufacturer,
            detection_confidence: detection?.confidence,
            selected_manufacturer_id: selectedManufacturerId || null,
            selected_manufacturer_name: selectedManufacturerName || otherName,
            is_other_manufacturer: isOther,
            manufacturer_research: research || null,
          },
        }),
      });

      router.push(`/quotation-ai/review/${project.id}`);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const confidenceColor = (c: number) =>
    c >= 0.8 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
    c >= 0.5 ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-red-500 bg-red-50 border-red-200';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50/30 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-2xl">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <Cpu className="w-6 h-6 text-sky-500" />
              Manufacturer Intelligence
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              AI analyzes your drawing codes to identify the cabinet manufacturer
            </p>
          </div>
        </div>

        {/* Codes Preview */}
        <Card className="rounded-3xl border-slate-200 shadow-md">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-5">
            <CardTitle className="text-base flex items-center gap-2 text-slate-700">
              <BookOpen className="w-4 h-4 text-sky-500" />
              Extracted Cabinet Codes ({uniqueCodes.length} unique)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex flex-wrap gap-2">
              {uniqueCodes.slice(0, 40).map((c, i) => (
                <Badge key={i} variant="outline"
                  className="font-mono text-xs px-2.5 py-1 border-slate-200 bg-slate-50 text-slate-700">
                  {c.code}
                </Badge>
              ))}
              {uniqueCodes.length > 40 && (
                <Badge variant="outline" className="text-xs px-2.5 py-1 border-dashed text-slate-400">
                  +{uniqueCodes.length - 40} more
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Step: Detect */}
        {step === 'detect' && (
          <Card className="rounded-3xl border-sky-100 shadow-xl bg-gradient-to-br from-sky-50 to-white">
            <CardContent className="p-8 text-center space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-sky-500 flex items-center justify-center mx-auto shadow-lg shadow-sky-200">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900">AI Manufacturer Detection</h2>
                <p className="text-slate-500 mt-2 text-sm max-w-md mx-auto">
                  Our AI reads every cabinet code, understands the coding patterns, suffixes,
                  and dimension formats to identify which manufacturer these drawings belong to.
                </p>
              </div>
              <Button
                className="gradient-button h-14 px-10 rounded-2xl text-base font-bold shadow-lg shadow-sky-500/20"
                onClick={handleDetect}
                disabled={isDetecting}
              >
                {isDetecting ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Analyzing {uniqueCodes.length} codes...</>
                ) : (
                  <><Zap className="w-5 h-5 mr-2" />Detect Manufacturer</>
                )}
              </Button>
              <p className="text-xs text-slate-400">
                Uses NKBA standards + AI pattern recognition. Takes ~5 seconds.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Step: Select */}
        {step === 'select' && detection && (
          <div className="space-y-4">
            {/* Detection Result */}
            <Card className="rounded-3xl border-slate-200 shadow-md overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-5">
                <CardTitle className="text-base flex items-center gap-2 text-slate-700">
                  <Cpu className="w-4 h-4 text-sky-500" />
                  AI Detection Result
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Detected</p>
                    <p className="text-2xl font-black text-slate-900">{detection.detected_manufacturer}</p>
                  </div>
                  <Badge className={`text-sm font-bold px-3 py-1.5 border rounded-xl ${confidenceColor(detection.confidence)}`}>
                    {Math.round(detection.confidence * 100)}% confident
                  </Badge>
                </div>

                {detection.reasoning && (
                  <div className="bg-slate-50 rounded-2xl p-4 text-sm text-slate-600">
                    <p className="font-bold text-slate-700 mb-1 text-xs uppercase tracking-widest">Reasoning</p>
                    {detection.reasoning}
                  </div>
                )}

                {detection.key_indicators?.length > 0 && (
                  <div>
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Key Indicators</p>
                    <div className="flex flex-wrap gap-2">
                      {detection.key_indicators.map((ind, i) => (
                        <Badge key={i} className="bg-sky-50 text-sky-700 border-sky-200 font-mono text-xs">
                          {ind}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {detection.alternative_matches?.length > 0 && (
                  <div>
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Alternatives Considered</p>
                    <div className="space-y-1">
                      {detection.alternative_matches.map((alt, i) => (
                        <div key={i} className="flex items-center justify-between text-sm text-slate-500 px-3 py-1.5 bg-slate-50 rounded-xl">
                          <span>{alt.manufacturer}</span>
                          <span className="text-xs font-bold">{Math.round(alt.confidence * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Manufacturer Selection */}
            <Card className="rounded-3xl border-slate-200 shadow-md">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-5">
                <CardTitle className="text-base flex items-center gap-2 text-slate-700">
                  <Factory className="w-4 h-4 text-sky-500" />
                  Confirm Manufacturer for Pricing
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-3">
                <p className="text-sm text-slate-500">
                  Select your pricing manufacturer. The AI will match these drawing codes
                  to whichever manufacturer's catalog you choose.
                </p>

                {/* Saved Manufacturers */}
                <div className="space-y-2">
                  {manufacturers.map(m => {
                    const isDetectedMatch =
                      detection.detected_manufacturer &&
                      (m.name.toLowerCase().includes(detection.detected_manufacturer.toLowerCase()) ||
                       detection.detected_manufacturer.toLowerCase().includes(m.name.toLowerCase()));
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSelectedManufacturerId(m.id);
                          setSelectedManufacturerName(m.name);
                          setIsOther(false);
                        }}
                        className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left ${
                          selectedManufacturerId === m.id
                            ? 'border-sky-500 bg-sky-50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                            selectedManufacturerId === m.id ? 'bg-sky-500' : 'bg-slate-100'
                          }`}>
                            <Building2 className={`w-4 h-4 ${selectedManufacturerId === m.id ? 'text-white' : 'text-slate-500'}`} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">{m.name}</p>
                            {isDetectedMatch && (
                              <p className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> AI detected match
                              </p>
                            )}
                          </div>
                        </div>
                        {selectedManufacturerId === m.id && (
                          <CheckCircle2 className="w-5 h-5 text-sky-500" />
                        )}
                      </button>
                    );
                  })}

                  {/* Other Option */}
                  <button
                    onClick={() => {
                      setIsOther(true);
                      setSelectedManufacturerId('');
                      setSelectedManufacturerName('');
                    }}
                    className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left ${
                      isOther
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-dashed border-slate-300 bg-white hover:border-slate-400'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      isOther ? 'bg-amber-400' : 'bg-slate-100'
                    }`}>
                      <Search className={`w-4 h-4 ${isOther ? 'text-white' : 'text-slate-500'}`} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">Other Manufacturer</p>
                      <p className="text-xs text-slate-500">AI will research their coding system</p>
                    </div>
                    {isOther && <CheckCircle2 className="w-5 h-5 text-amber-500 ml-auto" />}
                  </button>
                </div>

                {/* Other name input + research */}
                {isOther && (
                  <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter manufacturer name (e.g., KraftMaid, Merillat...)"
                        value={otherName}
                        onChange={e => setOtherName(e.target.value)}
                        className="rounded-2xl border-slate-200 bg-slate-50 h-12"
                        onKeyDown={e => e.key === 'Enter' && handleResearchOther()}
                      />
                      <Button
                        onClick={handleResearchOther}
                        disabled={!otherName.trim() || isResearching}
                        className="rounded-2xl h-12 px-5 gradient-button"
                      >
                        {isResearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-amber-600 flex items-center gap-1.5 px-1">
                      <Info className="w-3 h-3" />
                      AI will research this manufacturer's cabinet coding system, series, and suffixes.
                    </p>
                  </div>
                )}

                <Button
                  className="w-full h-14 gradient-button rounded-2xl text-base font-bold mt-2"
                  disabled={(!selectedManufacturerId && !isOther) || (isOther && !otherName.trim() && !research) || isSaving}
                  onClick={handleContinue}
                >
                  {isSaving ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Saving...</>
                  ) : (
                    <>Continue to Pricing Setup<ChevronRight className="w-5 h-5 ml-2" /></>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step: Research Result */}
        {step === 'research' && research && (
          <Card className="rounded-3xl border-amber-200 shadow-md overflow-hidden">
            <CardHeader className="border-b border-amber-100 bg-amber-50/50 p-5">
              <CardTitle className="text-base flex items-center gap-2 text-amber-800">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Research Complete: {otherName}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {research.coding_system && (
                  <div className="bg-white rounded-2xl p-3 border border-amber-100">
                    <p className="text-xs font-black text-amber-500 uppercase tracking-widest mb-1">Coding System</p>
                    <p className="text-sm text-slate-700">{String(research.coding_system)}</p>
                  </div>
                )}
                {research.series_lines?.length > 0 && (
                  <div className="bg-white rounded-2xl p-3 border border-amber-100">
                    <p className="text-xs font-black text-amber-500 uppercase tracking-widest mb-1">Product Lines</p>
                    <p className="text-sm text-slate-700">{research.series_lines.slice(0, 4).join(', ')}</p>
                  </div>
                )}
                {research.wall_cabinet_prefix && (
                  <div className="bg-white rounded-2xl p-3 border border-amber-100">
                    <p className="text-xs font-black text-amber-500 uppercase tracking-widest mb-1">Wall Prefix</p>
                    <p className="text-sm font-mono text-slate-700">{String(research.wall_cabinet_prefix)}</p>
                  </div>
                )}
                {research.base_cabinet_prefix && (
                  <div className="bg-white rounded-2xl p-3 border border-amber-100">
                    <p className="text-xs font-black text-amber-500 uppercase tracking-widest mb-1">Base Prefix</p>
                    <p className="text-sm font-mono text-slate-700">{String(research.base_cabinet_prefix)}</p>
                  </div>
                )}
              </div>

              {research.example_skus?.length > 0 && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Example SKUs</p>
                  <div className="flex flex-wrap gap-2">
                    {research.example_skus.map((s, i) => (
                      <Badge key={i} variant="outline" className="font-mono text-xs border-amber-200 text-amber-700">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {research.notes && (
                <div className="bg-amber-50 rounded-2xl p-3 text-sm text-amber-800">
                  <p className="font-bold text-xs uppercase tracking-widest mb-1">Notes</p>
                  {String(research.notes)}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Badge className={`${confidenceColor(research.confidence)} px-3 py-1 rounded-xl border`}>
                  {Math.round(research.confidence * 100)}% confidence
                </Badge>
                <Button
                  className="gradient-button rounded-2xl h-12 px-6 font-bold"
                  onClick={handleContinue}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Continue to Pricing
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
