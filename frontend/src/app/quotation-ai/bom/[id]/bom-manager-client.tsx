
"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
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
  Printer,
  ArrowLeft,
  Save,
  ArrowRight,
  RefreshCcw,
  Loader2,
  Box,
  ChevronDown,
  Trash2,
  Calculator,
  Eye,
  EyeOff,
  FileText,
  CheckCircle2,
  FileDown,
  Phone,
  MapPin,
  User,
  Truck,
  Building2,
  Mail,
  DollarSign,
  Percent,
  Tag,
  TrendingUp,
  Factory,
  Edit,
  Wrench,
  Package,
  AlertTriangle,
  Plus,
  X,
  Settings,
  Upload,
  FlaskConical,
  Columns2,
  TrendingDown,
  ArrowUpDown,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn, detectCategory } from '@/lib/utils';
import {
  updateBomItemAction,
  updateProjectAction,
  fetchInstallRulesAction,
  upsertInstallRuleAction,
  deleteInstallRuleAction,
  fetchInstallOverridesAction,
  upsertInstallOverrideAction,
  deleteInstallOverrideAction,
  type InstallRule,
  type InstallOverride,
} from '../../actions';
import { useToast } from '@/hooks/use-toast';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface BomItem {
  id: string;
  sku: string;
  // matched_sku stores the full catalog reference string:
  // exact match → catalog SKU code
  // nearest-dim → "Ref: SKU (nearest Xin wide) [COLLECTION]"
  // category avg → "Catalog Ref: SKU [COLLECTION] (avg. of N items)"
  matched_sku: string;
  qty: number;
  unit_price: number;
  line_total: number;
  room: string;
  precision_level: string;
  is_billable?: boolean;
  description?: string;
  cabinet_type?: string;
  match_explanation?: string;
  match_confidence?: number;
}

interface BomManagerClientProps {
  id: string;
  project: any;
  initialBom: BomItem[];
  manufacturerName: string;
}

type WorkflowStep = 'pricing' | 'preview' | 'config' | 'compare';
type ViewMode = 'client' | 'internal';

export function BomManagerClient({ id, project, initialBom, manufacturerName }: BomManagerClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  
  const [bom, setBom] = useState<BomItem[]>(() => 
    initialBom.map(item => ({
      ...item,
      is_billable: item.is_billable ?? true
    }))
  );

  const [mfgConfig, setMfgConfig] = useState<Record<string, string[]>>({});
  const [roomConfigs, setRoomConfigs] = useState<any>(() => {
    const configs: any = {};
    project.extracted_data?.rooms?.forEach((r: any) => {
      configs[r.room_name] = {
        collection: r.collection || 'UNIVERSAL',
        door_style: r.door_style || 'UNIVERSAL',
        box_construction: r.box_construction || 'Plywood',
        finish: r.finish || 'Standard Stain',
        wood_species: r.wood_species || 'Maple',
        drawer_box: r.drawer_box || 'Dovetail Wood'
      };
    });
    return configs;
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(`/api/manufacturer-config?id=${project.manufacturer_id}`);
        const data = await res.json();
        if (data.success) setMfgConfig(data.mapping);
      } catch (err) {
        console.error('Failed to fetch manufacturer config:', err);
      }
    };
    fetchConfig();
  }, [project.manufacturer_id]);


  const handleRoomConfigUpdate = async (roomName: string, updates: any) => {
    const newConfigs = { ...roomConfigs, [roomName]: { ...roomConfigs[roomName], ...updates } };
    setRoomConfigs(newConfigs);

    // Sync back to project.extracted_data.rooms and update project
    const updatedRooms = project.extracted_data.rooms.map((r: any) => 
      r.room_name === roomName ? { ...r, ...updates } : r
    );

    try {
      await updateProjectAction(id, {
        extracted_data: { ...project.extracted_data, rooms: updatedRooms }
      });
      toast({ title: `Room ${roomName} Updated. Re-pricing...` });
      handleReprice();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: err.message });
    }
  };

  const roomsList = useMemo(() => {
    const uniqueRooms = Array.from(new Set(bom.map(i => i.room)));
    const extractionOrder = project.extracted_data?.rooms?.map((r: any) => r.room_name) || [];
    
    return uniqueRooms.sort((a, b) => {
      const idxA = extractionOrder.indexOf(a);
      const idxB = extractionOrder.indexOf(b);
      if (idxA === -1 && idxB === -1) return a.localeCompare(b);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }, [bom, project.extracted_data]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>(project.bom_data?.selectedRooms || roomsList);
  const [step, setStep] = useState<WorkflowStep>('pricing');
  const [viewMode, setViewMode] = useState<ViewMode>('client');

  const [pricingFactor, setPricingFactor] = useState(project.bom_data?.pricingFactor ?? 1);
  const [targetMargin, setTargetMargin] = useState(project.bom_data?.targetMargin ?? 35);
  const [globalDiscount, setGlobalDiscount] = useState(project.bom_data?.discount ?? 0);
  const [taxRate, setTaxRate] = useState(project.bom_data?.taxRate ?? 8.25);
  const [freight, setFreight] = useState(project.bom_data?.freight ?? 0);
  const [fuelSurcharge, setFuelSurcharge] = useState(project.bom_data?.fuelSurcharge ?? 0);
  const [miscCharges, setMiscCharges] = useState(project.bom_data?.miscCharges ?? 0);
  const [installationCharges, setInstallationCharges] = useState(project.bom_data?.installationCharges ?? 0);
  const [laborCharges, setLaborCharges] = useState(project.bom_data?.laborCharges ?? 0);
  const [customItemCharges, setCustomItemCharges] = useState<Record<string, {installation?: number, labor?: number}>>(project.bom_data?.customItemCharges || {});
  const [installRate, setInstallRate] = useState<number>(project.bom_data?.installRate ?? 0);
  const [installCostRate, setInstallCostRate] = useState<number>(project.bom_data?.installCostRate ?? 0);
  const [includeInstall, setIncludeInstall] = useState<boolean>(project.bom_data?.includeInstall ?? false);
  const [includeDelivery, setIncludeDelivery] = useState<boolean>(project.bom_data?.includeDelivery ?? false);
  const [deliverySellRate, setDeliverySellRate] = useState<number>(project.bom_data?.deliverySellRate ?? 0);
  const [deliveryCostRate, setDeliveryCostRate] = useState<number>(project.bom_data?.deliveryCostRate ?? 0);

  // True for manufacturers whose install rules should drive per-line + total install charges
  const isInstallManufacturer = /1951|wellborn/i.test(manufacturerName);

  const [quoteDate, setQuoteDate] = useState(
    project.bom_data?.quoteDate || new Date().toISOString().split('T')[0]
  );
  const [expirationDate, setExpirationDate] = useState(() => {
    if (project.bom_data?.expirationDate) return project.bom_data.expirationDate;
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toISOString().split('T')[0];
  });

  const [roomDiscounts, setRoomDiscounts] = useState<Record<string, number>>(project.bom_data?.roomDiscounts || {});

  const [customer, setCustomer] = useState({
    name: project.bom_data?.customerName || '',
    address: project.bom_data?.customerAddress || '',
    phone: project.bom_data?.customerPhone || '',
    delivery: project.bom_data?.customerDelivery || '',
  });

  // Fetch install rules + client overrides (runs after customer is declared)
  useEffect(() => {
    const fetchInstallData = async () => {
      try {
        const [rulesResult, overridesResult] = await Promise.all([
          fetchInstallRulesAction(project.manufacturer_id),
          fetchInstallOverridesAction(project.manufacturer_id, customer.name || undefined),
        ]);
        if (rulesResult.success) setInstallRules(rulesResult.rules);
        if (overridesResult.success) setInstallOverrides(overridesResult.overrides);
      } catch (err) {
        console.error('Failed to fetch install rules:', err);
      }
    };
    fetchInstallData();
  }, [project.manufacturer_id, customer.name]);

  const [dealer, setDealer] = useState({
    name: project.bom_data?.dealerName || "Elite Building Solutions",
    address: project.bom_data?.dealerAddress || "123 Manufacturing Way, Industry City, IN 46201",
    phone: project.bom_data?.dealerPhone || "(800) 555-KABS",
    email: project.bom_data?.dealerEmail || `orders@${manufacturerName.toLowerCase().replace(/\s+/g, '')}.com`
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isPricing, setIsPricing] = useState(false);
  const [activePrintRoom, setActivePrintRoom] = useState<string | null>(null);

  // ── Install Rules ──────────────────────────────────────────────────────────
  const [installRules, setInstallRules] = useState<InstallRule[]>([]);
  const [installOverrides, setInstallOverrides] = useState<InstallOverride[]>([]);
  const [newRule, setNewRule] = useState<{
    item_code: string; item_type: string; install_factor: number; include_in_3pl: boolean;
  }>({ item_code: '', item_type: 'cabinet', install_factor: 1.0, include_in_3pl: true });
  const [isSavingRule, setIsSavingRule] = useState(false);
  // Test-rule state
  const [testRuleInput, setTestRuleInput] = useState<{ item_code: string; quantity: string }>({ item_code: '', quantity: '1' });
  const [testRuleResult, setTestRuleResult] = useState<any>(null);
  const [isTestingRule, setIsTestingRule] = useState(false);
  // Excel upload for bulk rules
  const [isUploadingRules, setIsUploadingRules] = useState(false);
  // Quick-fill state for missing items
  const [quickFillValues, setQuickFillValues] = useState<Record<string, { factor: string; include_3pl: boolean }>>({});
  const [isSavingQuickFill, setIsSavingQuickFill] = useState(false);
  const manageRulesRef = useRef<HTMLDivElement>(null);

  // ── Cross-Line Comparison ──────────────────────────────────────────────────
  interface CompareRow {
    room: string; sku_original: string; qty: number;
    sku_a: string | null; price_a: number; precision_a: string | null; ext_a: number;
    sku_b: string | null; price_b: number; precision_b: string | null; ext_b: number;
    delta: number;
  }
  interface CompareResult {
    rows: CompareRow[];
    totals: { list_a: number; list_b: number; delta: number; delta_pct: number };
  }
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [manufacturers, setManufacturers] = useState<Array<{ id: string; name: string }>>([]);
  const [compareConfig, setCompareConfig] = useState({
    mfgAId:        project.manufacturer_id as string,
    mfgACollection: (project.extracted_data?.rooms?.[0]?.collection || 'UNIVERSAL') as string,
    mfgADoorStyle:  (project.extracted_data?.rooms?.[0]?.door_style  || 'UNIVERSAL') as string,
    mfgBId:         '' as string,
    mfgBCollection: '' as string,
    mfgBDoorStyle:  '' as string,
  });
  const [mfgBConfig, setMfgBConfig] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const fetchMfgs = async () => {
      try {
        const { supabaseClient } = await import('@/lib/supabase-client');
        const { data } = await supabaseClient.from('manufacturers').select('id,name').eq('status', 'Active').order('name');
        if (data) setManufacturers(data);
      } catch { /* non-critical */ }
    };
    fetchMfgs();
  }, []);

  useEffect(() => {
    if (!compareConfig.mfgBId) return;
    const fetchConfig = async () => {
      try {
        const res  = await fetch(`/api/manufacturer-config?id=${compareConfig.mfgBId}`);
        const data = await res.json();
        if (data.success) setMfgBConfig(data.mapping);
      } catch { /* non-critical */ }
    };
    fetchConfig();
  }, [compareConfig.mfgBId]);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

  const getEffectiveUnitPrice = (item: BomItem) => {
      return (Number(item.unit_price) || 0);
  };

  // Returns colour-coded badge config for each pricing tier
  const getPrecisionBadge = (precision: string) => {
    const p = (precision || '').toUpperCase();
    if (p.startsWith('EXACT') || p === 'COMPRESSED' || p.startsWith('FUZZY') || p.startsWith('DIMENSION'))
      return { label: 'Exact Match', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (p.startsWith('NEAREST_DIM'))
      return { label: 'Nearest Size', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    if (p === 'CATEGORY_AVERAGE')
      return { label: 'Est. Average', cls: 'bg-orange-50 text-orange-700 border-orange-200' };
    if (p === 'MANUAL_PRICING_REQUIRED')
      return { label: 'Review Needed', cls: 'bg-red-50 text-red-700 border-red-200' };
    return { label: precision, cls: 'bg-slate-100 text-slate-500 border-slate-200' };
  };

  // Generates a human-readable match summary from pricing engine data (used as fallback when AI hasn't run)
  const getMatchSummary = (item: BomItem): string => {
    const p = (item.precision_level || '').toUpperCase();
    const raw = item.matched_sku || '';

    // Parse catalog SKU and collection from matched_sku string formats:
    // "W3042BD", "Ref: W3042BD [CLASSIC SERIES]", "Catalog Ref: W3042BD [CLASSIC] (avg. of 3)"
    const refMatch = raw.match(/^(?:Ref:|Catalog Ref:)?\s*([A-Z0-9][A-Z0-9\-\.]*?)(?:\s*\[|\s*\(|$)/i);
    const catalogSku = refMatch ? refMatch[1].trim() : raw.replace(/\[.*\]|\(.*\)/g, '').trim();
    const colMatch = raw.match(/\[([^\]]+)\]/);
    const catalogCol = colMatch ? ` [${colMatch[1]}]` : '';
    const price = item.unit_price > 0 ? ` — List $${item.unit_price.toLocaleString()}` : '';

    if (p.startsWith('EXACT')) {
      if (catalogSku && catalogSku !== item.sku)
        return `Drawing code "${item.sku}" → Exact catalog match: ${catalogSku}${catalogCol}${price}`;
      return `Drawing code "${item.sku}" matched exactly in the pricing catalog${catalogCol}${price}`;
    }
    if (p === 'SUFFIX_BRIDGE' || p === 'COMPRESSED' || p.startsWith('FUZZY')) {
      const hint = item.sku.endsWith('BUTT') ? ' (BUTT = door hinge style, mapped to catalog BD suffix)' : '';
      return `Drawing suffix translated to catalog format${hint}. Catalog ref: ${catalogSku}${catalogCol}${price}`;
    }
    if (p.startsWith('NEAREST_DIM')) {
      return `No exact size for "${item.sku}" in catalog — priced at nearest available size: ${catalogSku}${catalogCol}${price}. Verify dimensions.`;
    }
    if (p === 'DIMENSION') {
      return `Dimension-based match: "${item.sku}" mapped to ${catalogSku}${catalogCol} by cabinet dimensions${price}`;
    }
    if (p === 'CATEGORY_AVERAGE') {
      const avgMatch = raw.match(/avg\.\s*of\s*(\d+)/i);
      const n = avgMatch ? ` (avg. of ${avgMatch[1]} items)` : '';
      return `No close match found for "${item.sku}" — price estimated from category average${n}${catalogCol}. Review manually.`;
    }
    if (p === 'MANUAL_PRICING_REQUIRED') {
      return `"${item.sku}" could not be automatically priced. Please set price manually.`;
    }
    if (catalogSku) return `Catalog ref: ${catalogSku}${catalogCol}${price}`;
    return `No catalog reference available — price set manually`;
  };

  const financials = useMemo(() => {
    const effectiveRooms = activePrintRoom ? [activePrintRoom] : selectedRooms;
    const activeItems = bom.filter(item => item.is_billable && effectiveRooms.includes(item.room));
    
    let listSubtotal = 0;
    activeItems.forEach(item => {
      const roomDiscount = roomDiscounts[item.room] || 0;
      const basePrice = (getEffectiveUnitPrice(item) * Number(item.qty) || 0);
      const discountedPrice = basePrice * (1 - roomDiscount / 100);
      listSubtotal += discountedPrice;
    });

    const dealerCost = listSubtotal * Number(pricingFactor);
    const marginDecimal = Number(targetMargin) / 100;
    const marginSell = marginDecimal < 1 ? dealerCost / (1 - marginDecimal) : dealerCost;
    
    const additionalExpenses = activePrintRoom ? 0 : (Number(freight) + Number(fuelSurcharge) + Number(miscCharges));
    
    const netBeforeDiscount = marginSell + additionalExpenses;
    const discountAmt = netBeforeDiscount * (Number(globalDiscount) / 100);
    const netTotal = netBeforeDiscount - discountAmt;
    const taxes = netTotal * (Number(taxRate) / 100);

    // Install & Delivery value units (only for 1951 / Wellborn)
    let totalInstallUnitsInline = 0;
    let total3PLUnitsInline = 0;
    if (isInstallManufacturer) {
      activeItems.forEach(item => {
        const skuKey = (item.sku || '').toUpperCase().trim();
        const override = installOverrides.find(o => o.item_code.toUpperCase().trim() === skuKey);
        const defRule  = installRules.find(r => r.item_code.toUpperCase().trim() === skuKey);
        const rule = override ?? defRule ?? null;
        let factor = 0;
        let tplInclude = false;
        if (rule) {
          factor = Number(rule.install_factor);
          tplInclude = rule.include_in_3pl;
        } else {
          const category = detectCategory(item.sku);
          const isCabinetOrFiller = category.includes('Cabinets') || category === 'Universal Fillers';
          factor = isCabinetOrFiller ? 1 : 0;
          tplInclude = isCabinetOrFiller;
        }
        totalInstallUnitsInline += Number(item.qty) * factor;
        if (tplInclude) total3PLUnitsInline += Number(item.qty);
      });
    }

    // Installation: sell = units × sellRate, internal cost = units × costRate
    const totalInstallSell = (isInstallManufacturer && includeInstall)
      ? totalInstallUnitsInline * Number(installRate)
      : 0;
    const totalInstallInternalCost = (isInstallManufacturer && includeInstall)
      ? totalInstallUnitsInline * Number(installCostRate)
      : 0;
    const installProfit = totalInstallSell - totalInstallInternalCost;

    // Delivery (3PL): sell = 3PL units × sellRate, internal cost = 3PL units × costRate
    const totalDeliverySell = (isInstallManufacturer && includeDelivery)
      ? total3PLUnitsInline * Number(deliverySellRate)
      : 0;
    const totalDeliveryCost = (isInstallManufacturer && includeDelivery)
      ? total3PLUnitsInline * Number(deliveryCostRate)
      : 0;
    const deliveryProfit = totalDeliverySell - totalDeliveryCost;

    // Keep totalInstallCost alias for backwards compat with existing UI references
    const totalInstallCost = totalInstallSell;

    const grandTotal = netTotal + taxes + totalInstallSell + totalDeliverySell;

    // Financial Metrics for Manufacturer Oversight
    const estimatedMfgCost = dealerCost;
    const estimatedProfit = netTotal - dealerCost;

    // Calculate scaling factor for individual items/rooms (Pre-Tax, excluding install)
    const scalingFactor = listSubtotal > 0 ? netTotal / listSubtotal : 0;

    return {
      listSubtotal,
      dealerCost,
      marginSell,
      additionalExpenses,
      discountAmt,
      netTotal,
      taxes,
      totalInstallCost,
      totalInstallSell,
      totalInstallInternalCost,
      installProfit,
      totalInstallUnitsInline,
      totalDeliverySell,
      totalDeliveryCost,
      deliveryProfit,
      total3PLUnitsInline,
      grandTotal,
      scalingFactor,
      estimatedMfgCost,
      estimatedProfit
    };
  }, [bom, selectedRooms, activePrintRoom, pricingFactor, targetMargin, globalDiscount, taxRate, freight, fuelSurcharge, miscCharges, installationCharges, laborCharges, roomDiscounts, customItemCharges, installRate, installCostRate, includeInstall, includeDelivery, deliverySellRate, deliveryCostRate, installRules, installOverrides, isInstallManufacturer]);

  // ── Install / 3PL Calculations ─────────────────────────────────────────────
  // Lookup priority: client overrides → manufacturer defaults → missing
  const installCalculations = useMemo(() => {
    const activeItems = bom.filter(
      item => item.is_billable && selectedRooms.includes(item.room)
    );

    let totalInstallUnits = 0;
    let total3PLUnits = 0;
    let missingRulesCount = 0;

    const itemCalcs: Record<string, {
      installUnits: number;
      tplUnits: number;
      factor: number;
      ruleSource: 'override' | 'default' | 'missing';
    }> = {};

    activeItems.forEach(item => {
      const skuKey = (item.sku || '').toUpperCase().trim();
      const override = installOverrides.find(o => o.item_code.toUpperCase().trim() === skuKey);
      const defRule  = installRules.find(r => r.item_code.toUpperCase().trim() === skuKey);
      const rule = override ?? defRule ?? null;

      if (rule) {
        const factor       = Number(rule.install_factor);
        const installUnits = Number(item.qty) * factor;
        const tplUnits     = rule.include_in_3pl ? Number(item.qty) : 0;
        totalInstallUnits += installUnits;
        total3PLUnits     += tplUnits;
        itemCalcs[item.id] = {
          installUnits,
          tplUnits,
          factor,
          ruleSource: override ? 'override' : 'default',
        };
      } else {
        missingRulesCount++;
        const category = detectCategory(item.sku);
        const isCabinetOrFiller = category.includes('Cabinets') || category === 'Universal Fillers';
        const factor = isCabinetOrFiller ? 1 : 0;
        const installUnits = Number(item.qty) * factor;
        const tplUnits = isCabinetOrFiller ? Number(item.qty) : 0;
        
        totalInstallUnits += installUnits;
        total3PLUnits += tplUnits;
        
        itemCalcs[item.id] = { installUnits, tplUnits, factor, ruleSource: 'missing' };
      }
    });

    return { totalInstallUnits, total3PLUnits, missingRulesCount, itemCalcs };
  }, [bom, selectedRooms, installRules, installOverrides]);

  // List of billable BOM items that have no install rule configured
  const missingRuleItems = useMemo(() => {
    const activeItems = bom.filter(item => item.is_billable && selectedRooms.includes(item.room));
    const seen = new Set<string>();
    return activeItems.filter(item => {
      const skuKey = (item.sku || '').toUpperCase().trim();
      if (seen.has(skuKey)) return false;
      seen.add(skuKey);
      const override = installOverrides.find(o => o.item_code.toUpperCase().trim() === skuKey);
      const defRule = installRules.find(r => r.item_code.toUpperCase().trim() === skuKey);
      return !override && !defRule;
    });
  }, [bom, selectedRooms, installRules, installOverrides]);

  const toggleAllRooms = (checked: boolean) => {
    setSelectedRooms(checked ? roomsList : []);
  };

  const toggleRoom = (roomName: string, checked: boolean) => {
    if (checked) {
      setSelectedRooms(prev => [...prev, roomName]);
    } else {
      setSelectedRooms(prev => prev.filter(r => r !== roomName));
    }
  };

  const handleUpdateItem = (idx: number, updates: Partial<BomItem>) => {
    const newBom = [...bom];
    const item = { ...newBom[idx], ...updates };
    if ('unit_price' in updates || 'qty' in updates) {
      item.line_total = (Number(item.unit_price) || 0) * (Number(item.qty) || 0);
    }
    newBom[idx] = item;
    setBom(newBom);
  };

  const handleReprice = async () => {
    setIsPricing(true);
    try {
      const res = await fetch('/api/generate-bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, manufacturerId: project.manufacturer_id })
      });
      const result = await res.json();
      if (result.success) {
        toast({ title: 'Prices Refreshed from Catalog' });
        router.refresh();
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Pricing Error', description: err.message });
    } finally {
      setIsPricing(false);
    }
  };

  const handleCatalogDiagnose = async () => {
    try {
      const res = await fetch(`/api/catalog-check?manufacturer_id=${project.manufacturer_id}`);
      const data = await res.json();
      if (!data.success) {
        toast({ variant: 'destructive', title: 'Catalog Check Failed', description: data.error });
        return;
      }
      if (data.total_rows === 0) {
        const hint = data.manufacturers_with_pricing?.length
          ? `IDs with data: ${data.manufacturers_with_pricing.slice(0, 3).join(', ')}…`
          : 'No pricing data found in any manufacturer.';
        toast({
          variant: 'destructive',
          title: `No Catalog Data for this Manufacturer ID`,
          description: `${data.warning} ${hint}`,
        });
      } else {
        const cols = (data.collections || []).slice(0, 5).join(', ');
        toast({
          title: `Catalog OK — ${data.total_rows.toLocaleString()} rows`,
          description: `Collections: ${cols || 'N/A'} | Cache: ${data.cache_status}`,
        });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Diagnose Error', description: err.message });
    }
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      await Promise.all(bom.map(item =>
        updateBomItemAction(item.id, {
          sku: item.sku,
          matched_sku: item.matched_sku || null,
          qty: item.qty,
          unit_price: item.unit_price,
          line_total: item.unit_price * item.qty,
          is_billable: item.is_billable,
          description: item.description || null,
          cabinet_type: item.cabinet_type || null,
          match_explanation: item.match_explanation || null,
        })
      ));
      await updateProjectAction(id, {
        bom_data: {
          pricingFactor,
          targetMargin,
          discount: globalDiscount,
          taxRate,
          freight,
          fuelSurcharge,
          miscCharges,
          installationCharges,
          laborCharges,
          installRate,
          installCostRate,
          includeInstall,
          includeDelivery,
          deliverySellRate,
          deliveryCostRate,
          customItemCharges,
          roomDiscounts,
          customerName: customer.name,
          customerAddress: customer.address,
          customerPhone: customer.phone,
          customerDelivery: customer.delivery,
          dealerName: dealer.name,
          dealerAddress: dealer.address,
          dealerPhone: dealer.phone,
          dealerEmail: dealer.email,
          quoteDate,
          expirationDate,
          listSubtotal: financials.listSubtotal,
          grandTotal: financials.grandTotal,
          selectedRooms
        }
      });
      toast({ title: 'Pricing & BOM Saved' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Save Failed', description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Install Rule Handlers ──────────────────────────────────────────────────
  const handleSaveRule = async () => {
    if (!newRule.item_code.trim()) return;
    setIsSavingRule(true);
    try {
      const result = await upsertInstallRuleAction({
        manufacturer_id: project.manufacturer_id,
        item_code:       newRule.item_code.toUpperCase().trim(),
        item_type:       newRule.item_type,
        install_factor:  newRule.install_factor,
        include_in_3pl:  newRule.include_in_3pl,
        count_basis:     'quantity',
      });
      if (result.success) {
        const fresh = await fetchInstallRulesAction(project.manufacturer_id);
        if (fresh.success) setInstallRules(fresh.rules);
        setNewRule({ item_code: '', item_type: 'cabinet', install_factor: 1.0, include_in_3pl: true });
        toast({ title: 'Rule saved' });
      } else {
        toast({ variant: 'destructive', title: 'Save failed', description: result.error });
      }
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    await deleteInstallRuleAction(ruleId);
    setInstallRules(prev => prev.filter(r => r.id !== ruleId));
    toast({ title: 'Rule deleted' });
  };

  const handleTestRule = async () => {
    if (!testRuleInput.item_code.trim()) return;
    setIsTestingRule(true);
    setTestRuleResult(null);
    try {
      const res = await fetch('/api/test-install-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manufacturer_id: project.manufacturer_id,
          client_name:     customer.name || '',
          item_code:       testRuleInput.item_code.trim().toUpperCase(),
          quantity:        parseFloat(testRuleInput.quantity) || 1,
        }),
      });
      const data = await res.json();
      setTestRuleResult(data);
    } catch (err: any) {
      setTestRuleResult({ success: false, error: err.message });
    } finally {
      setIsTestingRule(false);
    }
  };

  const handleUploadRulesExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingRules(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `/api/install-rules-upload?manufacturer_id=${project.manufacturer_id}`,
        { method: 'POST', body: fd }
      );
      const data = await res.json();
      if (data.success) {
        const fresh = await fetchInstallRulesAction(project.manufacturer_id);
        if (fresh.success) setInstallRules(fresh.rules);
        toast({ title: `Uploaded: ${data.rows_upserted} rules (${data.rows_skipped} skipped)` });
      } else {
        toast({ variant: 'destructive', title: 'Upload failed', description: data.error });
      }
    } finally {
      setIsUploadingRules(false);
      e.target.value = '';
    }
  };

  const handleQuickFillAll = async () => {
    const entries = Object.entries(quickFillValues).filter(([, v]) => v.factor.trim() !== '');
    if (entries.length === 0) return;
    setIsSavingQuickFill(true);
    try {
      await Promise.all(entries.map(([sku, val]) =>
        upsertInstallRuleAction({
          manufacturer_id: project.manufacturer_id,
          item_code: sku.toUpperCase().trim(),
          item_type: 'cabinet',
          install_factor: parseFloat(val.factor) || 1,
          include_in_3pl: val.include_3pl,
          count_basis: 'quantity',
        })
      ));
      const fresh = await fetchInstallRulesAction(project.manufacturer_id);
      if (fresh.success) setInstallRules(fresh.rules);
      setQuickFillValues({});
      toast({ title: `${entries.length} install rule${entries.length > 1 ? 's' : ''} saved` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: err.message });
    } finally {
      setIsSavingQuickFill(false);
    }
  };

  const handleRunComparison = async () => {
    if (!compareConfig.mfgBId) {
      toast({ variant: 'destructive', title: 'Select a second manufacturer first' });
      return;
    }
    setIsComparing(true);
    setCompareResult(null);
    try {
      const res = await fetch('/api/compare-bom', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: id,
          manufacturer_a: {
            id:         compareConfig.mfgAId,
            collection: compareConfig.mfgACollection,
            door_style: compareConfig.mfgADoorStyle,
          },
          manufacturer_b: {
            id:         compareConfig.mfgBId,
            collection: compareConfig.mfgBCollection,
            door_style: compareConfig.mfgBDoorStyle,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCompareResult(data);
      } else {
        toast({ variant: 'destructive', title: 'Comparison failed', description: data.error });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Comparison error', description: err.message });
    } finally {
      setIsComparing(false);
    }
  };

  const triggerPrint = (roomName?: string) => {
    if (roomName) {
      setActivePrintRoom(roomName);
      setTimeout(() => {
        window.print();
        setActivePrintRoom(null);
      }, 150);
    } else {
      setActivePrintRoom(null);
      window.print();
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 pb-32 print:bg-white print:pb-0">
      {isPricing && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
           <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm w-full mx-4 border border-slate-100">
              <div className="w-16 h-16 bg-sky-50 rounded-2xl flex items-center justify-center mb-6 relative">
                 <div className="absolute inset-0 border-4 border-sky-100 rounded-2xl animate-ping opacity-20" />
                 <RefreshCcw className="w-8 h-8 text-sky-600 animate-spin" />
              </div>
              <h2 className="text-xl font-black text-slate-900 mb-2">Price Refresh</h2>
              <p className="text-sm font-bold text-slate-500 text-center">Syncing new catalog prices for your selected collection and door styles...</p>
           </div>
        </div>
      )}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 px-8 h-20 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => {
            if (step === 'preview') setStep('pricing');
            else if (step === 'pricing' && manufacturerName === "Integrity Cabinets") setStep('config');
            else router.back();
          }}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              {step === 'pricing' ? 'Bill of Materials' : step === 'config' ? 'Manufacturer Configuration' : step === 'compare' ? 'Compare Cabinet Lines' : 'Proposal Preview'}
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              Project: {project.project_name} • {manufacturerName} {step === 'config' && '— Integrity Cabinets Multi-Select'}{step === 'compare' && '— Side-by-Side Pricing'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {step === 'pricing' && (
            <>
              <Button variant="outline" className="rounded-xl h-11 px-4 border-slate-200" onClick={handleReprice} disabled={isPricing}>
                {isPricing ? <Loader2 className="animate-spin w-4 h-4" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
                Match Catalog Prices
              </Button>
              <Button variant="outline" className="rounded-xl h-11 px-4 border-amber-200 text-amber-700 hover:bg-amber-50" onClick={handleCatalogDiagnose} title="Check if pricing catalog is loaded for this manufacturer">
                <FlaskConical className="w-4 h-4 mr-2" />
                Diagnose Catalog
              </Button>
              <Button variant="outline" className="rounded-xl h-11 px-4 border-violet-200 text-violet-700 hover:bg-violet-50" onClick={() => setStep('compare')}>
                <Columns2 className="w-4 h-4 mr-2" />
                Compare Lines
              </Button>
            </>
          )}
          <Button className="rounded-xl h-11 px-6 gradient-button" onClick={() => {
              if (step === 'config') setStep('pricing');
              else if (step === 'compare') setStep('pricing');
              else if (step === 'pricing') setStep('preview');
              else setStep('pricing');
          }}>
             {step === 'config' ? 'Proceed to BOM' : step === 'compare' ? 'Back to BOM' : step === 'pricing' ? 'Next: Preview Proposal' : 'Back to BOM List'}
             <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-8 mt-8 grid grid-cols-1 lg:grid-cols-4 gap-8 print:block print:px-0">
        <div className="lg:col-span-3 space-y-8 print:col-span-1">
          {step === 'config' && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
               <Card className="rounded-3xl border-sky-100 shadow-xl shadow-sky-900/5 bg-white overflow-hidden">
                  <CardHeader className="bg-sky-50/50 border-b border-sky-100 p-8">
                     <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-sky-600 flex items-center justify-center shadow-lg shadow-sky-200">
                           <Factory className="text-white w-6 h-6" />
                        </div>
                        <div>
                           <CardTitle className="text-2xl font-black text-slate-900">Integrity Configuration</CardTitle>
                           <CardDescription className="text-sky-600 font-bold">Select the global product specifications for this project.</CardDescription>
                        </div>
                     </div>
                  </CardHeader>
                  <CardContent className="p-8 space-y-12">
                     {roomsList.map(roomName => {
                        const currentConfig = roomConfigs[roomName] || {};
                        return (
                          <div key={roomName} className="space-y-6 p-6 rounded-2xl bg-slate-50 border border-slate-100">
                             <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                                <h3 className="text-lg font-black uppercase text-slate-700">{roomName}</h3>
                                <CheckCircle2 className="text-emerald-500 w-5 h-5" />
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                <div className="space-y-2">
                                   <Label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Door Style</Label>
                                   <Select value={currentConfig.door_style} onValueChange={(val) => handleRoomConfigUpdate(roomName, { door_style: val })}>
                                     <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 font-bold text-slate-700 shadow-sm"><SelectValue /></SelectTrigger>
                                     <SelectContent className="max-h-80">
                                       {(mfgConfig[currentConfig.collection] || []).map(s => <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>)}
                                     </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                   <Label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Box Construction</Label>
                                   <Select value={currentConfig.box_construction} onValueChange={(v) => handleRoomConfigUpdate(roomName, { box_construction: v })}>
                                     <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 font-bold text-slate-700 shadow-sm"><SelectValue /></SelectTrigger>
                                     <SelectContent>
                                       <SelectItem value="Frameless Plywood" className="font-bold">Frameless Plywood</SelectItem>
                                       <SelectItem value="Standard Plywood" className="font-bold">Standard Plywood</SelectItem>
                                       <SelectItem value="Particle Board" className="font-bold">Particle Board</SelectItem>
                                     </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                   <Label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Finish</Label>
                                   <Select value={currentConfig.finish} onValueChange={(v) => handleRoomConfigUpdate(roomName, { finish: v })}>
                                     <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 font-bold text-slate-700 shadow-sm"><SelectValue /></SelectTrigger>
                                     <SelectContent>
                                       <SelectItem value="Standard Stain" className="font-bold">Standard Stain</SelectItem>
                                       <SelectItem value="Paint" className="font-bold">Paint</SelectItem>
                                       <SelectItem value="Glazed" className="font-bold">Glazed</SelectItem>
                                     </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                   <Label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Wood Species</Label>
                                   <Select value={currentConfig.wood_species} onValueChange={(v) => handleRoomConfigUpdate(roomName, { wood_species: v })}>
                                     <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 font-bold text-slate-700 shadow-sm"><SelectValue /></SelectTrigger>
                                     <SelectContent>
                                       <SelectItem value="Maple" className="font-bold">Maple</SelectItem>
                                       <SelectItem value="Oak" className="font-bold">Oak</SelectItem>
                                       <SelectItem value="Cherry" className="font-bold">Cherry</SelectItem>
                                     </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                   <Label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Drawer Box</Label>
                                   <Select value={currentConfig.drawer_box} onValueChange={(v) => handleRoomConfigUpdate(roomName, { drawer_box: v })}>
                                     <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 font-bold text-slate-700 shadow-sm"><SelectValue /></SelectTrigger>
                                     <SelectContent>
                                       <SelectItem value="Dovetail Wood" className="font-bold">Dovetail Wood</SelectItem>
                                       <SelectItem value="Metal Box" className="font-bold">Metal Box</SelectItem>
                                     </SelectContent>
                                   </Select>
                                </div>
                             </div>
                          </div>
                        )
                     })}
                     <div className="flex justify-end pt-6">
                        <Button className="gradient-button h-12 px-10 rounded-2xl" onClick={() => setStep('pricing')}>
                           Proceed to BOM Verification
                           <ArrowRight className="w-5 h-5 ml-2" />
                        </Button>
                     </div>
                  </CardContent>
               </Card>
            </div>
          )}

          {step === 'pricing' && (
            <div className="space-y-12 animate-in fade-in duration-500">
              <Card className="rounded-2xl border-slate-200 shadow-sm bg-white overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <Checkbox 
                      id="select-all" 
                      checked={selectedRooms.length === roomsList.length} 
                      onCheckedChange={v => toggleAllRooms(!!v)}
                    />
                    <Label htmlFor="select-all" className="text-xs font-bold uppercase tracking-widest text-slate-500">Select ALL Rooms for Billing</Label>
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {selectedRooms.length} of {roomsList.length} Rooms Selected
                  </div>
                </div>
              </Card>

              {roomsList.map(roomName => {
                const roomItems = bom.filter(i => i.room === roomName);
                      const isSelected = selectedRooms.includes(roomName);
                const categories = ['Wall Cabinets', 'Base Cabinets', 'Tall Cabinets', 'Vanity Cabinets', 'Universal Fillers', 'Molding & Trim', 'Hardwares'];
                
                // Calculate cabinet count (excluding fillers)
                const cabCount = roomItems.filter(i => {
                  const cat = detectCategory(i.sku);
                  return cat.includes('Cabinets');
                }).reduce((sum, item) => sum + item.qty, 0);

                const currentConfig = roomConfigs[roomName] || {};
                const availableCollections = Object.keys(mfgConfig || {});
                const availableStyles = mfgConfig[currentConfig.collection] || [];

                return (
                  <section key={roomName} className={cn("space-y-4 transition-opacity duration-300", !isSelected && "opacity-40 grayscale-[0.5]")}>
                    <div className="flex flex-col gap-4 border-b-2 border-slate-900 pb-4 mb-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                           <div className="flex items-center gap-3">
                              <Checkbox checked={isSelected} onCheckedChange={v => toggleRoom(roomName, !!v)} />
                              <Box className="w-5 h-5 text-sky-600" />
                              <h2 className="text-xl font-black uppercase tracking-tight">{roomName}</h2>
                              {manufacturerName === "Integrity Cabinets" && (
                                 <Button 
                                   variant="ghost" 
                                   size="sm" 
                                   className="h-8 rounded-lg text-sky-600 bg-sky-50 hover:bg-sky-100 hover:text-sky-700 font-bold ml-4"
                                   onClick={() => setStep('config')}
                                 >
                                   <Edit className="w-3.5 h-3.5 mr-2" />
                                   Full Configuration
                                 </Button>
                               )}
                           </div>

                           <div className="flex items-center gap-4 print:hidden">
                              <div className="flex flex-col gap-1 min-w-[180px]">
                                <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Collection</Label>
                                <Select 
                                  value={currentConfig.collection} 
                                  onValueChange={(val) => handleRoomConfigUpdate(roomName, { collection: val, door_style: mfgConfig[val]?.[0] || '' })}
                                >
                                  <SelectTrigger className="h-10 rounded-xl border-slate-200 text-sm font-bold shadow-sm bg-white">
                                    <SelectValue placeholder="Collection" />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-80">
                                    {availableCollections.map(c => <SelectItem key={c} value={c} className="text-sm font-bold">{c}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="flex flex-col gap-1 min-w-[180px]">
                                 <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Door Style</Label>
                                 <Select 
                                   value={currentConfig.door_style} 
                                   onValueChange={(val) => handleRoomConfigUpdate(roomName, { door_style: val })}
                                 >
                                   <SelectTrigger className="h-10 rounded-xl border-slate-200 text-sm font-bold shadow-sm bg-white">
                                     <SelectValue placeholder="Door Style" />
                                   </SelectTrigger>
                                   <SelectContent className="max-h-80">
                                     {availableStyles.map(s => <SelectItem key={s} value={s} className="text-sm font-bold">{s}</SelectItem>)}
                                   </SelectContent>
                                 </Select>
                               </div>
                           </div>
                        </div>

                        {manufacturerName === "Integrity Cabinets" && (
                           <div className="flex flex-wrap items-center gap-6 p-5 bg-sky-50/40 rounded-2xl border border-sky-100/60 mt-2 animate-in fade-in slide-in-from-top-2 duration-500">
                             <div className="flex items-center gap-2 border-r border-sky-100 pr-6">
                                <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shadow-lg shadow-sky-200">
                                   <Factory className="w-4 h-4" />
                                </div>
                                <span className="text-xs font-black uppercase text-sky-800 tracking-tight">Integrity Specs</span>
                             </div>

                             <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 flex-1">
                               <div className="space-y-1.5">
                                 <Label className="text-[10px] font-black uppercase text-sky-600/70 ml-1 tracking-wider">Box Construction</Label>
                                 <Select value={currentConfig.box_construction} onValueChange={(v) => handleRoomConfigUpdate(roomName, { box_construction: v })}>
                                   <SelectTrigger className="h-10 bg-white border-sky-200 rounded-xl text-sm font-bold shadow-sm ring-offset-white focus:ring-sky-500"><SelectValue /></SelectTrigger>
                                   <SelectContent>
                                     <SelectItem value="Frameless Plywood" className="font-bold">Frameless Plywood</SelectItem>
                                     <SelectItem value="Standard Plywood" className="font-bold">Standard Plywood</SelectItem>
                                     <SelectItem value="Particle Board" className="font-bold">Particle Board</SelectItem>
                                   </SelectContent>
                                 </Select>
                               </div>
                               <div className="space-y-1.5">
                                 <Label className="text-[10px] font-black uppercase text-sky-600/70 ml-1 tracking-wider">Finish</Label>
                                 <Select value={currentConfig.finish} onValueChange={(v) => handleRoomConfigUpdate(roomName, { finish: v })}>
                                   <SelectTrigger className="h-10 bg-white border-sky-200 rounded-xl text-sm font-bold shadow-sm ring-offset-white focus:ring-sky-500"><SelectValue /></SelectTrigger>
                                   <SelectContent>
                                     <SelectItem value="Standard Stain" className="font-bold">Standard Stain</SelectItem>
                                     <SelectItem value="Paint" className="font-bold">Paint</SelectItem>
                                     <SelectItem value="Glazed" className="font-bold">Glazed</SelectItem>
                                   </SelectContent>
                                 </Select>
                               </div>
                               <div className="space-y-1.5">
                                 <Label className="text-[10px] font-black uppercase text-sky-600/70 ml-1 tracking-wider">Wood Species</Label>
                                 <Select value={currentConfig.wood_species} onValueChange={(v) => handleRoomConfigUpdate(roomName, { wood_species: v })}>
                                   <SelectTrigger className="h-10 bg-white border-sky-200 rounded-xl text-sm font-bold shadow-sm ring-offset-white focus:ring-sky-500"><SelectValue /></SelectTrigger>
                                   <SelectContent>
                                     <SelectItem value="Maple" className="font-bold">Maple</SelectItem>
                                     <SelectItem value="Oak" className="font-bold">Oak</SelectItem>
                                     <SelectItem value="Cherry" className="font-bold">Cherry</SelectItem>
                                   </SelectContent>
                                 </Select>
                               </div>
                               <div className="space-y-1.5">
                                 <Label className="text-[10px] font-black uppercase text-sky-600/70 ml-1 tracking-wider">Drawer Box</Label>
                                 <Select value={currentConfig.drawer_box} onValueChange={(v) => handleRoomConfigUpdate(roomName, { drawer_box: v })}>
                                   <SelectTrigger className="h-10 bg-white border-sky-200 rounded-xl text-sm font-bold shadow-sm ring-offset-white focus:ring-sky-500"><SelectValue /></SelectTrigger>
                                   <SelectContent>
                                     <SelectItem value="Dovetail Wood" className="font-bold">Dovetail Wood</SelectItem>
                                     <SelectItem value="Metal Box" className="font-bold">Metal Box</SelectItem>
                                   </SelectContent>
                                 </Select>
                               </div>
                             </div>
                           </div>
                        )}
                       
                       <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 text-[10px] font-bold uppercase text-slate-400">
                             <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full">
                                <Box className="w-3 h-3" />
                                <span>{cabCount} Total Cabinets</span>
                             </div>
                             <div className="hidden md:block">
                                Selected: <span className="text-sky-600">{currentConfig.collection}</span> / <span className="text-sky-600">{currentConfig.door_style}</span>
                             </div>
                          </div>

                          {roomsList.length > 1 && isSelected && (
                            <div className="flex items-center gap-4 bg-slate-100/50 px-4 py-1.5 rounded-full border border-slate-200">
                               <Tag className="w-3.5 h-3.5 text-sky-600" />
                               <Label className="text-[10px] font-black uppercase text-slate-500">Room Discount (%)</Label>
                               <Input 
                                 type="number" 
                                 value={roomDiscounts[roomName] || 0} 
                                 onChange={(e) => setRoomDiscounts(prev => ({ ...prev, [roomName]: parseFloat(e.target.value) || 0 }))}
                                 className="w-16 h-7 text-center font-bold bg-white border-none text-xs"
                               />
                            </div>
                          )}
                       </div>
                    </div>

                    {categories.map(cat => {
                      const items = roomItems.filter(i => detectCategory(i.sku) === cat);
                      if (items.length === 0) return null;

                      return (
                        <div key={cat} className="space-y-2 mb-8">
                           <div className="px-4 py-2 bg-slate-100/50 rounded-lg flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{cat}</span>
                           </div>
                           <Table>
                             <TableHeader>
                               <TableRow className="border-b border-slate-100 bg-transparent hover:bg-transparent">
                                 <TableHead className="w-10"></TableHead>
                                 <TableHead className="text-[10px] uppercase font-bold text-slate-400">CAB Code</TableHead>
                                 <TableHead className="text-[10px] uppercase font-bold text-slate-400">Description / Match Reason</TableHead>
                                 <TableHead className="text-center text-[10px] uppercase font-bold text-slate-400">QTY</TableHead>
                                 <TableHead className="text-right text-[10px] uppercase font-bold text-slate-400">UNIT PRICE (LIST)</TableHead>
                                 <TableHead className="text-right text-[10px] uppercase font-bold text-slate-400">TOTAL</TableHead>
                                 {isInstallManufacturer && installRate > 0 && (
                                   <TableHead className="text-right text-[10px] uppercase font-bold text-orange-500">INSTALL</TableHead>
                                 )}
                               </TableRow>
                             </TableHeader>
                             <TableBody>
                                {items.map(item => {
                                  const idx = bom.findIndex(b => b.id === item.id);
                                  const badge = getPrecisionBadge(item.precision_level);
                                  const rawRef = item.matched_sku || '';
                                  const isEstimated = item.precision_level === 'CATEGORY_AVERAGE' || item.precision_level === 'MANUAL_PRICING_REQUIRED';
                                  const isNearest = (item.precision_level || '').toUpperCase().startsWith('NEAREST_DIM');
                                  const refMatch = rawRef.match(/^(?:Ref:|Catalog Ref:)\s*([A-Z0-9][A-Z0-9\-\.\s]*?)(?:\s*\[|\s*\(|$)/i);
                                  const catalogSku = refMatch ? refMatch[1].trim() : rawRef.split('[')[0].trim();
                                  const colMatch = rawRef.match(/\[([^\]]+)\]/);
                                  const catalogCol = colMatch ? colMatch[1] : '';
                                  const matchReason = item.match_explanation || getMatchSummary(item);
                                  return (
                                    <TableRow key={item.id} className={cn("align-top hover:bg-white", !item.is_billable && "opacity-40")}>
                                      <TableCell className="pt-4 w-8">
                                        <Checkbox checked={item.is_billable} onCheckedChange={v => handleUpdateItem(idx, { is_billable: !!v })} />
                                      </TableCell>
                                      {/* CAB CODE column — both drawing code and catalog ref are editable */}
                                      <TableCell className="pt-3 min-w-[140px]">
                                        {/* Drawing SKU — editable */}
                                        <input
                                          className="w-full font-bold text-slate-900 text-sm font-mono bg-transparent border-none outline-none focus:bg-white focus:px-1.5 focus:rounded-md focus:border focus:border-sky-200 transition-all"
                                          value={item.sku}
                                          onChange={e => handleUpdateItem(idx, { sku: e.target.value.toUpperCase() })}
                                          title="Drawing cabinet code — click to edit"
                                        />
                                        <div className="mt-1 space-y-1">
                                          <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>
                                            {isEstimated ? '⚠ ' : isNearest ? '≈ ' : '✓ '}{badge.label}
                                          </span>
                                          {/* Catalog ref — editable */}
                                          <div className="flex items-center gap-1 flex-wrap">
                                            <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap">Catalog:</span>
                                            <input
                                              className={`text-[10px] font-black font-mono px-1.5 py-0.5 rounded border bg-transparent outline-none focus:ring-1 transition-all w-[90px] ${
                                                isEstimated ? 'border-orange-200 text-orange-700 focus:ring-orange-300' :
                                                isNearest   ? 'border-amber-200 text-amber-700 focus:ring-amber-300' :
                                                              'border-emerald-200 text-emerald-700 focus:ring-emerald-300'
                                              }`}
                                              value={catalogSku}
                                              onChange={e => handleUpdateItem(idx, { matched_sku: e.target.value.toUpperCase() })}
                                              title="Catalog reference code — click to edit"
                                            />
                                            {catalogCol && <span className="text-[8px] text-slate-400 font-mono">[{catalogCol}]</span>}
                                          </div>
                                        </div>
                                      </TableCell>
                                      <TableCell className="pt-3 min-w-[280px] max-w-[420px]">
                                        <div className="flex flex-col gap-1">
                                          {/* Editable description line */}
                                          <div className="flex items-start gap-1.5 group/desc">
                                            <Edit className="w-2.5 h-2.5 mt-0.5 text-slate-300 flex-shrink-0 group-focus-within/desc:text-sky-400 transition-colors" />
                                            <textarea
                                              className="flex-1 text-[11px] font-medium text-slate-700 bg-transparent border-none outline-none focus:bg-white focus:px-2 focus:py-1 focus:rounded-md focus:border focus:border-sky-200 transition-all placeholder:text-slate-300 placeholder:italic leading-snug resize-none overflow-y-auto max-h-24 scrollbar-thin scrollbar-thumb-slate-200"
                                              rows={2}
                                              value={item.description || ''}
                                              placeholder="Click to add description…"
                                              onChange={e => handleUpdateItem(idx, { description: e.target.value })}
                                              title="Click to edit"
                                            />
                                          </div>
                                          {/* Match reason — always shown, explains pricing method */}
                                          <div className="max-h-20 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-100">
                                            <p className={`text-[10px] leading-snug pl-4 ${isEstimated ? 'text-orange-600 font-semibold' : isNearest ? 'text-amber-600' : 'text-slate-400 italic'}`}>
                                              {matchReason}
                                            </p>
                                          </div>
                                        </div>
                                      </TableCell>
                                      <TableCell className="pt-4 text-center">
                                        <Input type="number" value={item.qty} onChange={e => handleUpdateItem(idx, { qty: parseInt(e.target.value) || 0 })} className="w-16 mx-auto text-center h-9 font-bold bg-slate-50 border-none" />
                                      </TableCell>
                                      <TableCell className="pt-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                           <span className="text-slate-400 font-mono text-xs">$</span>
                                           <Input type="number" value={item.unit_price} onChange={e => handleUpdateItem(idx, { unit_price: parseFloat(e.target.value) || 0 })} className="w-24 text-right h-9 font-bold bg-slate-50 border-none font-mono" />
                                        </div>
                                      </TableCell>
                                      <TableCell className="pt-4 text-right font-black font-mono text-slate-900 text-sm">
                                        ${(item.unit_price * item.qty).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                      </TableCell>
                                      {isInstallManufacturer && installRate > 0 && (() => {
                                        const calc = installCalculations.itemCalcs[item.id];
                                        const installCost = calc ? calc.installUnits * installRate : 0;
                                        return (
                                          <TableCell className="pt-4 text-right font-mono text-xs text-orange-600 font-bold">
                                            {installCost > 0 ? `$${installCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                                          </TableCell>
                                        );
                                      })()}
                                    </TableRow>
                                  );
                                })}
                             </TableBody>
                           </Table>
                        </div>
                      )
                    })}

                    {roomItems.filter(i => !categories.includes(detectCategory(i.sku))).length > 0 && (
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="acc" className="border-none">
                          <AccordionTrigger className="px-4 py-2 bg-slate-50 rounded-xl hover:no-underline">
                             <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Accessories And Others</span>
                          </AccordionTrigger>
                          <AccordionContent className="pt-4">
                            <Table>
                              <TableHeader>
                                <TableRow className="border-b border-slate-100">
                                  <TableHead className="w-10" />
                                  <TableHead className="text-[10px] uppercase font-bold text-slate-400">CAB Code / Description</TableHead>
                                  <TableHead className="text-center text-[10px] uppercase font-bold text-slate-400">QTY</TableHead>
                                  <TableHead className="text-right text-[10px] uppercase font-bold text-slate-400">UNIT PRICE</TableHead>
                                  <TableHead className="text-right text-[10px] uppercase font-bold text-slate-400">TOTAL</TableHead>
                                </TableRow>
                              </TableHeader>
                               <TableBody>
                                  {roomItems.filter(i => !categories.includes(detectCategory(i.sku))).map(item => {
                                    const idx = bom.findIndex(b => b.id === item.id);
                                    return (
                                      <TableRow key={item.id} className="border-b border-slate-100 align-top hover:bg-white">
                                        <TableCell className="w-10 pt-3"><Checkbox checked={item.is_billable} onCheckedChange={v => handleUpdateItem(idx, { is_billable: !!v })} /></TableCell>
                                        <TableCell className="pt-2">
                                          <input
                                            className="font-bold text-xs font-mono text-slate-900 bg-transparent border-none outline-none focus:bg-white focus:px-1.5 focus:rounded-md focus:border focus:border-sky-200 transition-all w-full"
                                            value={item.sku}
                                            onChange={e => handleUpdateItem(idx, { sku: e.target.value.toUpperCase() })}
                                          />
                                          {item.description && (
                                            <textarea
                                              className="mt-0.5 text-[10px] text-slate-500 bg-transparent border-none outline-none focus:bg-white focus:px-1 focus:rounded focus:border focus:border-sky-200 transition-all w-full italic resize-none overflow-y-auto max-h-20 scrollbar-thin scrollbar-thumb-slate-200"
                                              rows={2}
                                              value={item.description}
                                              onChange={e => handleUpdateItem(idx, { description: e.target.value })}
                                              placeholder="Description…"
                                            />
                                          )}
                                        </TableCell>
                                        <TableCell className="pt-2 text-center">
                                          <Input type="number" value={item.qty} onChange={e => handleUpdateItem(idx, { qty: parseInt(e.target.value) || 0 })} className="w-14 mx-auto text-center h-8 text-xs font-bold bg-slate-50 border-none" />
                                        </TableCell>
                                        <TableCell className="pt-2 text-right">
                                          <div className="flex items-center justify-end gap-1">
                                            <span className="text-slate-400 font-mono text-xs">$</span>
                                            <Input type="number" value={item.unit_price} onChange={e => handleUpdateItem(idx, { unit_price: parseFloat(e.target.value) || 0 })} className="w-20 text-right h-8 text-xs font-bold bg-slate-50 border-none font-mono" />
                                          </div>
                                        </TableCell>
                                        <TableCell className="pt-3 text-right font-mono text-xs font-bold text-slate-900">
                                          ${(getEffectiveUnitPrice(item) * item.qty).toFixed(2)}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                               </TableBody>
                            </Table>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    )}

                    <div className="mt-4 p-6 bg-slate-900 rounded-2xl flex items-center justify-between text-white shadow-lg overflow-hidden relative group">
                        <div className="absolute right-0 top-0 h-full w-32 bg-sky-500/20 skew-x-[-20deg] translate-x-16 group-hover:translate-x-12 transition-transform" />
                        <div className="flex gap-8 relative z-10 flex-wrap">
                            <div className="space-y-1">
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Cabinetry Style</p>
                                <p className="text-sm font-bold">{currentConfig.collection} / {currentConfig.door_style}</p>
                            </div>
                            <div className="space-y-1 border-l border-slate-700 pl-8">
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Unit Count</p>
                                <p className="text-sm font-bold flex items-center gap-2">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                  {cabCount} Total Units
                                </p>
                            </div>
                            {/* Per-room Install / 3PL summary removed */}
                        </div>
                        <div className="text-right relative z-10">
                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
                                {isSelected ? "Room Total (Sale)" : "Room Total (List)"}
                            </p>
                            <p className="text-2xl font-black font-mono">
                                {isSelected ? (
                                    "$" + (
                                        roomItems.filter(i => i.is_billable).reduce((sum, item) => sum + (getEffectiveUnitPrice(item) * item.qty), 0)
                                        * (1 - (roomDiscounts[roomName] || 0) / 100)
                                        * (financials.scalingFactor || 1)
                                    ).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                                ) : (
                                    "$" + roomItems.filter(i => i.is_billable).reduce((sum, item) => sum + (getEffectiveUnitPrice(item) * item.qty), 0).toLocaleString('en-US', { minimumFractionDigits: 0 })
                                )}
                            </p>
                            {isSelected && (
                                <p className="text-[8px] font-black uppercase text-sky-400 mt-1 opacity-80">Calculated Final Price</p>
                            )}
                        </div>
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          {step === 'compare' && (
            <div className="space-y-6 animate-in fade-in duration-500">
              {/* Config panel */}
              <Card className="rounded-2xl border-violet-100 shadow-sm bg-white overflow-hidden">
                <CardHeader className="bg-violet-50/60 border-b border-violet-100 p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shadow-md shadow-violet-200">
                      <Columns2 className="text-white w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-black text-slate-900">Cross-Line Pricing Comparison</CardTitle>
                      <CardDescription className="text-violet-600 font-bold text-xs">Select two cabinet lines to compare list prices side-by-side.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Manufacturer A */}
                    <div className="space-y-4 p-5 rounded-2xl bg-sky-50/60 border border-sky-100">
                      <p className="text-[10px] font-black uppercase tracking-widest text-sky-600">Line A (Current Project)</p>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-black uppercase text-slate-400">Manufacturer</Label>
                        <Select value={compareConfig.mfgAId} onValueChange={v => setCompareConfig(c => ({ ...c, mfgAId: v, mfgACollection: '', mfgADoorStyle: '' }))}>
                          <SelectTrigger className="h-10 rounded-xl bg-white border-sky-200 font-bold text-sm shadow-sm"><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {manufacturers.map(m => <SelectItem key={m.id} value={m.id} className="font-bold">{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-black uppercase text-slate-400">Collection / Tier</Label>
                        <Select value={compareConfig.mfgACollection} onValueChange={v => setCompareConfig(c => ({ ...c, mfgACollection: v, mfgADoorStyle: mfgConfig[v]?.[0] || '' }))}>
                          <SelectTrigger className="h-10 rounded-xl bg-white border-sky-200 font-bold text-sm shadow-sm"><SelectValue placeholder="Select collection" /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {Object.keys(mfgConfig).map(col => <SelectItem key={col} value={col} className="font-bold text-xs">{col}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-black uppercase text-slate-400">Door Style</Label>
                        <Select value={compareConfig.mfgADoorStyle} onValueChange={v => setCompareConfig(c => ({ ...c, mfgADoorStyle: v }))}>
                          <SelectTrigger className="h-10 rounded-xl bg-white border-sky-200 font-bold text-sm shadow-sm"><SelectValue placeholder="Select style" /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {(mfgConfig[compareConfig.mfgACollection] || []).map(s => <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Manufacturer B */}
                    <div className="space-y-4 p-5 rounded-2xl bg-violet-50/60 border border-violet-100">
                      <p className="text-[10px] font-black uppercase tracking-widest text-violet-600">Line B (Compare Against)</p>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-black uppercase text-slate-400">Manufacturer</Label>
                        <Select value={compareConfig.mfgBId} onValueChange={v => setCompareConfig(c => ({ ...c, mfgBId: v, mfgBCollection: '', mfgBDoorStyle: '' }))}>
                          <SelectTrigger className="h-10 rounded-xl bg-white border-violet-200 font-bold text-sm shadow-sm"><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {manufacturers.map(m => <SelectItem key={m.id} value={m.id} className="font-bold">{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-black uppercase text-slate-400">Collection / Tier</Label>
                        <Select value={compareConfig.mfgBCollection} onValueChange={v => setCompareConfig(c => ({ ...c, mfgBCollection: v, mfgBDoorStyle: mfgBConfig[v]?.[0] || '' }))}>
                          <SelectTrigger className="h-10 rounded-xl bg-white border-violet-200 font-bold text-sm shadow-sm"><SelectValue placeholder="Select collection" /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {Object.keys(mfgBConfig).map(col => <SelectItem key={col} value={col} className="font-bold text-xs">{col}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-black uppercase text-slate-400">Door Style</Label>
                        <Select value={compareConfig.mfgBDoorStyle} onValueChange={v => setCompareConfig(c => ({ ...c, mfgBDoorStyle: v }))}>
                          <SelectTrigger className="h-10 rounded-xl bg-white border-violet-200 font-bold text-sm shadow-sm"><SelectValue placeholder="Select style" /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {(mfgBConfig[compareConfig.mfgBCollection] || []).map(s => <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end mt-6">
                    <Button className="h-11 px-8 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-black" onClick={handleRunComparison} disabled={isComparing || !compareConfig.mfgBId}>
                      {isComparing ? <><Loader2 className="animate-spin w-4 h-4 mr-2" />Running Comparison…</> : <><ArrowUpDown className="w-4 h-4 mr-2" />Run Comparison</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Results */}
              {compareResult && (() => {
                const labelA = manufacturers.find(m => m.id === compareConfig.mfgAId)?.name || 'Line A';
                const labelB = manufacturers.find(m => m.id === compareConfig.mfgBId)?.name || 'Line B';
                const rooms  = Array.from(new Set(compareResult.rows.map(r => r.room)));
                const { list_a, list_b, delta, delta_pct } = compareResult.totals;

                return (
                  <div className="space-y-6">
                    {/* Summary totals */}
                    <div className="grid grid-cols-3 gap-4">
                      <Card className="rounded-2xl border-sky-100 bg-sky-50/50 p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-sky-600 mb-1">{labelA} Total</p>
                        <p className="text-2xl font-black font-mono text-slate-900">${list_a.toLocaleString()}</p>
                        <p className="text-[10px] text-sky-500 font-bold mt-1">{compareConfig.mfgACollection}</p>
                      </Card>
                      <Card className="rounded-2xl border-violet-100 bg-violet-50/50 p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-600 mb-1">{labelB} Total</p>
                        <p className="text-2xl font-black font-mono text-slate-900">${list_b.toLocaleString()}</p>
                        <p className="text-[10px] text-violet-500 font-bold mt-1">{compareConfig.mfgBCollection}</p>
                      </Card>
                      <Card className={cn("rounded-2xl p-5", delta > 0 ? "border-red-100 bg-red-50/50" : "border-emerald-100 bg-emerald-50/50")}>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Difference (B vs A)</p>
                        <p className={cn("text-2xl font-black font-mono", delta > 0 ? "text-red-600" : "text-emerald-600")}>
                          {delta > 0 ? '+' : ''}{delta.toLocaleString()}
                        </p>
                        <p className={cn("text-[10px] font-bold mt-1", delta > 0 ? "text-red-500" : "text-emerald-500")}>
                          {delta > 0 ? <TrendingUp className="inline w-3 h-3 mr-1" /> : <TrendingDown className="inline w-3 h-3 mr-1" />}
                          {delta > 0 ? '+' : ''}{delta_pct}% vs Line A
                        </p>
                      </Card>
                    </div>

                    {/* Per-room tables */}
                    {rooms.map(room => {
                      const roomRows = compareResult.rows.filter(r => r.room === room);
                      const roomTotalA = roomRows.reduce((s, r) => s + r.ext_a, 0);
                      const roomTotalB = roomRows.reduce((s, r) => s + r.ext_b, 0);

                      return (
                        <Card key={room} className="rounded-2xl border-slate-200 shadow-sm bg-white overflow-hidden">
                          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div className="flex items-center gap-2">
                              <Box className="w-4 h-4 text-sky-600" />
                              <span className="font-black uppercase text-sm text-slate-800">{room}</span>
                            </div>
                            <div className="flex items-center gap-6 text-xs font-bold">
                              <span className="text-sky-600">{labelA}: ${roomTotalA.toLocaleString()}</span>
                              <span className="text-violet-600">{labelB}: ${roomTotalB.toLocaleString()}</span>
                              <span className={cn("font-black", (roomTotalB - roomTotalA) > 0 ? "text-red-500" : "text-emerald-600")}>
                                Δ {(roomTotalB - roomTotalA) > 0 ? '+' : ''}${(roomTotalB - roomTotalA).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow className="border-b border-slate-100 bg-transparent hover:bg-transparent">
                                <TableHead className="text-[10px] uppercase font-bold text-slate-400 w-32">SKU (Design)</TableHead>
                                <TableHead className="text-center text-[10px] uppercase font-bold text-slate-400 w-12">QTY</TableHead>
                                <TableHead className="text-[10px] uppercase font-bold text-sky-500">{labelA} Match</TableHead>
                                <TableHead className="text-right text-[10px] uppercase font-bold text-sky-500 w-28">Unit / Ext</TableHead>
                                <TableHead className="text-[10px] uppercase font-bold text-violet-500">{labelB} Match</TableHead>
                                <TableHead className="text-right text-[10px] uppercase font-bold text-violet-500 w-28">Unit / Ext</TableHead>
                                <TableHead className="text-right text-[10px] uppercase font-bold text-slate-400 w-24">Δ Ext</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {roomRows.map((row, ri) => {
                                const deltaPos = row.delta > 0;
                                const badgeA = getPrecisionBadge(row.precision_a || '');
                                const badgeB = getPrecisionBadge(row.precision_b || '');
                                return (
                                  <TableRow key={ri} className="h-14 hover:bg-slate-50/50 border-b border-slate-50">
                                    <TableCell className="font-black text-sm text-slate-900 font-mono">{row.sku_original}</TableCell>
                                    <TableCell className="text-center font-bold text-sm text-slate-600">{row.qty}</TableCell>
                                    <TableCell>
                                      <div className="font-bold text-xs text-slate-700 leading-tight truncate max-w-[180px]" title={row.sku_a || ''}>{row.sku_a || '—'}</div>
                                      <span className={`inline-flex items-center text-[8px] font-black uppercase tracking-wider px-1 py-0.5 rounded border mt-0.5 ${badgeA.cls}`}>{badgeA.label}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="font-black font-mono text-sky-700 text-sm">${row.price_a.toLocaleString()}</div>
                                      <div className="text-[10px] text-slate-400 font-mono">${row.ext_a.toLocaleString()}</div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="font-bold text-xs text-slate-700 leading-tight truncate max-w-[180px]" title={row.sku_b || ''}>{row.sku_b || '—'}</div>
                                      <span className={`inline-flex items-center text-[8px] font-black uppercase tracking-wider px-1 py-0.5 rounded border mt-0.5 ${badgeB.cls}`}>{badgeB.label}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="font-black font-mono text-violet-700 text-sm">${row.price_b.toLocaleString()}</div>
                                      <div className="text-[10px] text-slate-400 font-mono">${row.ext_b.toLocaleString()}</div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <span className={cn("font-black font-mono text-sm", deltaPos ? "text-red-500" : row.delta < 0 ? "text-emerald-600" : "text-slate-400")}>
                                        {row.delta === 0 ? '—' : `${deltaPos ? '+' : ''}$${row.delta.toLocaleString()}`}
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </Card>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {step === 'preview' && (
            <div className="animate-in fade-in duration-500 space-y-12">
               <Card className="rounded-3xl border-slate-200 shadow-sm bg-white overflow-hidden print:hidden">
                  <CardHeader className="bg-slate-50 border-b border-slate-100">
                    <CardTitle className="text-lg flex items-center gap-2">
                       <FileText className="w-5 h-5 text-sky-600" />
                       Invoice & Proposal Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-8 space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                      <div className="space-y-6">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-4">Customer Information</p>
                        <div className="grid grid-cols-1 gap-4">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500 uppercase">Customer Name</Label>
                            <div className="relative">
                              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                              <Input value={customer.name} onChange={e => setCustomer({...customer, name: e.target.value})} className="h-11 pl-10 bg-slate-50 border-slate-200 rounded-xl" placeholder="Full Name" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500 uppercase">Phone Number</Label>
                            <div className="relative">
                              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                              <Input value={customer.phone} onChange={e => setCustomer({...customer, phone: e.target.value})} className="h-11 pl-10 bg-slate-50 border-slate-200 rounded-xl" placeholder="(000) 000-0000" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500 uppercase">Billing Address</Label>
                            <div className="relative">
                              <MapPin className="absolute left-3 top-4 w-4 h-4 text-slate-400" />
                              <Input value={customer.address} onChange={e => setCustomer({...customer, address: e.target.value})} className="h-11 pl-10 bg-slate-50 border-slate-200 rounded-xl" placeholder="123 Street, City, State" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500 uppercase">Delivery Location</Label>
                            <div className="relative">
                              <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                              <Input value={customer.delivery} onChange={e => setCustomer({...customer, delivery: e.target.value})} className="h-11 pl-10 bg-slate-50 border-slate-200 rounded-xl" placeholder="Job Site Address" />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <p className="text-[10px] font-black uppercase text-sky-600 tracking-[0.2em] mb-4">Manufacturer / Dealer Details</p>
                        <div className="grid grid-cols-1 gap-4">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500 uppercase">Company Name</Label>
                            <div className="relative">
                              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                              <Input value={dealer.name} onChange={e => setDealer({...dealer, name: e.target.value})} className="h-11 pl-10 bg-slate-50 border-slate-200 rounded-xl font-bold" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500 uppercase">Office Phone</Label>
                            <div className="relative">
                              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                              <Input value={dealer.phone} onChange={e => setDealer({...dealer, phone: e.target.value})} className="h-11 pl-10 bg-slate-50 border-slate-200 rounded-xl" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500 uppercase">Company Address</Label>
                            <div className="relative">
                              <MapPin className="absolute left-3 top-4 w-4 h-4 text-slate-400" />
                              <Input value={dealer.address} onChange={e => setDealer({...dealer, address: e.target.value})} className="h-11 pl-10 bg-slate-50 border-slate-200 rounded-xl" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500 uppercase">Orders Email</Label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                              <Input value={dealer.email} onChange={e => setDealer({...dealer, email: e.target.value})} className="h-11 pl-10 bg-slate-50 border-slate-200 rounded-xl" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-8 pt-8 border-t border-slate-100">
                      <div className="space-y-4">
                        <Label className="text-xs font-bold text-slate-500 uppercase">Quote Date</Label>
                        <div className="relative">
                          <Input type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)} className="h-11 bg-slate-50 border-slate-200 rounded-xl" />
                        </div>
                      </div>
                      <div className="space-y-4">
                        <Label className="text-xs font-bold text-slate-500 uppercase">Expiration Date</Label>
                        <div className="relative">
                          <Input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} className="h-11 bg-slate-50 border-slate-200 rounded-xl" />
                        </div>
                      </div>
                    </div>
                  </CardContent>
               </Card>

               <div className="print:hidden flex flex-col md:flex-row justify-center items-center gap-6 bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                  <div className="flex gap-4 shrink-0">
                    <Button 
                      variant={viewMode === 'client' ? 'default' : 'outline'} 
                      onClick={() => setViewMode('client')}
                      className="rounded-xl h-11 px-6"
                    >
                      <Eye className="w-4 h-4 mr-2" /> Client Invoice View
                    </Button>
                    <Button 
                      variant={viewMode === 'internal' ? 'default' : 'outline'} 
                      onClick={() => setViewMode('internal')}
                      className="rounded-xl h-11 px-6"
                    >
                      <EyeOff className="w-4 h-4 mr-2" /> Internal Margin View
                    </Button>
                  </div>
                  
                  <div className="border-l border-slate-200 pl-6 flex flex-wrap gap-2 items-center justify-center">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest whitespace-nowrap">Download Room PDF:</p>
                    {selectedRooms.map(room => (
                                      <Button key={room} variant="outline" size="sm" className="text-[9px] h-8 rounded-lg px-3" onClick={() => triggerPrint(room)}>
                                        {room}
                                      </Button>
                                    ))}
                                  </div>
                               </div>
                               <div className="bg-white border-2 border-slate-100 print:border-none print-page-wrapper font-sans text-slate-800">
                  {viewMode === 'client' ? (
                     <div className="bg-white h-full w-full relative">
                       {/* Client Invoice Custom Redesign */}
                       <div className="flex justify-between items-start mb-4 p-8 pb-0">
                         <div className="flex flex-col items-center border-[3px] border-[#002060] p-1.5 bg-white w-48 shadow-sm">
                            <div className="flex items-center gap-1 justify-center pb-2">
                               <div className="w-[100px] h-[34px] relative overflow-hidden bg-white mt-1">
                                  <div className="absolute bottom-0 w-full h-0 border-l-[50px] border-l-transparent border-r-[50px] border-r-transparent border-b-[24px] border-b-[#002060]" />
                               </div>
                            </div>
                            <div className="text-white bg-[#2E7D32] px-3 font-black text-3xl w-full text-center leading-none tracking-tight pt-1 pb-1">ELITE</div>
                            <div className="bg-[#002060] text-white text-[9px] font-bold uppercase tracking-widest mt-0.5 w-full text-center py-0.5">Building Solutions</div>
                            <div className="mt-1.5 text-[8px] font-black text-slate-500 uppercase tracking-tight flex justify-center gap-1 border-t border-slate-200 pt-1 w-full">
                               <span>Honesty</span> | <span>Integrity</span> | <span>Respect</span>
                            </div>
                         </div>
                         <h1 className="text-3xl font-medium text-[#002060] tracking-wider uppercase mt-4 mr-4">CABINETRY BID</h1>
                       </div>

                       <div className="bg-[#c2f0c2] flex flex-col items-center py-1 mb-6 border-y border-white outline outline-4 outline-[#c2f0c2]/30 mt-2">
                         <div className="text-[11px] font-bold text-[#002060]">Quote Date: <span className="ml-1 font-black">{new Date(quoteDate + 'T12:00:00').toLocaleDateString('en-US')}</span></div>
                         <div className="text-[11px] font-bold text-[#002060]">Expiration Date: <span className="ml-1 font-black">{new Date(expirationDate + 'T12:00:00').toLocaleDateString('en-US')}</span></div>
                       </div>

                       <div className="px-8 pb-8">
                         <div className="border border-[#002060] mb-6">
                           <div className="grid grid-cols-2">
                             <div className="bg-slate-200 p-2 border-r border-[#002060] border-b border-white relative"><div className="absolute top-1 left-1 w-1.5 h-1.5 bg-green-500"></div></div>
                             <div className="bg-slate-200 p-2 border-b border-[#002060] text-center text-xs font-bold text-[#002060] uppercase tracking-widest">CABINETS</div>
                           </div>
                           <div className="grid grid-cols-2 bg-white border-b border-[#002060] divide-x divide-[#002060]">
                             <div className="p-4 flex flex-col items-center justify-center text-center space-y-1 relative">
                               <div className="absolute top-1 left-1 w-1.5 h-1.5 bg-green-500"></div>
                               <p className="text-xs font-bold text-[#002060] uppercase mt-1">AOK</p>
                               <p className="text-xs font-bold text-[#002060] uppercase">{dealer.name}</p>
                               <p className="text-xs font-bold text-[#002060] uppercase">EXPRESS SERIES - LEVEL 2 SPEC</p>
                               <p className="text-xs font-bold text-[#002060] uppercase">{project.project_name}</p>
                             </div>
                             <div className="p-4 flex flex-col items-center justify-center text-center space-y-1 relative">
                               <div className="absolute top-1 left-1 w-1.5 h-1.5 bg-green-500"></div>
                               <p className="text-xs font-bold text-[#002060] uppercase mt-1">{selectedRooms.length > 0 ? roomConfigs[selectedRooms[0]]?.collection : 'TILLY WHITE'}</p>
                               <p className="text-xs font-bold text-[#002060] uppercase my-1">OR</p>
                               <p className="text-xs font-bold text-[#002060] uppercase">{selectedRooms.length > 0 ? roomConfigs[selectedRooms[0]]?.door_style : 'SINCLAIR BURLAP'}</p>
                               <p className="text-xs font-bold text-[#002060] uppercase">PARTIAL OVERLAY</p>
                             </div>
                           </div>
                           <div className="bg-slate-200 py-1 border-b border-[#002060] text-center text-xs font-bold text-[#002060] tracking-widest uppercase">
                             STANDARD ROOMS
                           </div>
                           <div className="bg-white">
                             {(activePrintRoom ? [activePrintRoom] : selectedRooms).map(roomName => {
                               const roomItems = bom.filter(i => i.room === roomName && i.is_billable && i.unit_price > 0);
                               if (roomItems.length === 0) return null;
                               const roomTotal = roomItems.reduce((s, i) => s + (i.unit_price * i.qty), 0) * (1 - (roomDiscounts[roomName] || 0) / 100) * (financials.scalingFactor || 1);
                               return (
                                 <div key={roomName} className="flex justify-between items-center px-8 py-2 border-b border-slate-100 bg-[#E8EDF2]/40 relative">
                                   <div className="absolute top-2 left-1.5 w-1 h-1 bg-green-500"></div>
                                   <div className="flex items-center text-xs font-bold text-[#002060] uppercase">
                                     <span className="ml-2">STD {roomName}</span>
                                   </div>
                                   <div className="text-xs font-semibold text-[#002060]">${roomTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                                 </div>
                               );
                             })}
                             <div className="flex justify-between items-center px-8 py-2 border-b-2 border-white bg-[#E8EDF2]/40 relative">
                               <div className="absolute top-2 left-1.5 w-1 h-1 bg-green-500"></div>
                               <div className="flex items-center text-xs font-bold text-[#002060] uppercase">
                                 <span className="ml-2">QUARTER ROUND AT FLOOR-WHOLE HOUSE INCLUDED</span>
                               </div>
                               <div className="text-xs font-semibold text-[#002060]">$0</div>
                             </div>
                           </div>
                           {isInstallManufacturer && includeInstall && financials.totalInstallSell > 0 && (
                             <div className="flex items-center px-16 py-2 bg-orange-50/60 border-t border-orange-100 relative">
                               <div className="flex-grow text-center text-xs font-bold text-orange-700 uppercase">INSTALLATION CHARGES</div>
                               <div className="text-xs font-bold text-orange-700">${financials.totalInstallSell.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                             </div>
                           )}
                           {isInstallManufacturer && includeDelivery && financials.totalDeliverySell > 0 && (
                             <div className="flex items-center px-16 py-2 bg-blue-50/60 border-t border-blue-100 relative">
                               <div className="flex-grow text-center text-xs font-bold text-blue-700 uppercase">DELIVERY / 3PL</div>
                               <div className="text-xs font-bold text-blue-700">${financials.totalDeliverySell.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                             </div>
                           )}
                           <div className="h-3 bg-[#000040] w-full"></div>
                           <div className="flex items-center px-16 py-2 bg-slate-50 relative">
                             <div className="flex-grow text-center text-xs font-bold text-[#002060] uppercase">TOTAL</div>
                             <div className="text-xs font-bold text-[#002060]">${financials.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                           </div>
                         </div>

                         <div className="bg-slate-200 p-1 mb-4">
                           <div className="text-xs font-bold text-[#002060] pl-2 uppercase tracking-wide">PROPOSAL DETAILS AND DISCLAIMERS</div>
                         </div>
                         
                         <div className="space-y-3 text-[10px] font-bold text-[#002060] uppercase ml-2 mb-12 flex flex-col">
                           <span>STANDARD CONSTRUCTION INCLUDED - SEE CONSTRUCTION SPEC SHEET</span>
                           <span>6-WAY ADJUSTABLE HINGES, STANDARD DRAWER</span>
                           <span className="text-red-700">36" UPPERS/ RAISED VANITIES/ SCRIBE AT WALLS AND QUARTER ROUND AT FLOOR/ NO HARDWARE/NO VENT BOX</span>
                           <span>TWO RETURN TRIPS INCLUDED IN PRICING. ADDITIONAL RETURN TRIPS IS NEEDED IT WILL BE BILLED ACCORDINGLY.</span>
                         </div>

                         <div className="grid grid-cols-1 gap-4 mt-8 px-2 mb-4">
                           <div className="flex items-end justify-between gap-4 max-w-full">
                             <div className="flex items-end gap-2 pr-12 w-3/5">
                               <span className="text-[11px] font-bold text-[#002060] shrink-0 object-bottom pb-1">{dealer.name}</span>
                               <div className="flex-grow border-b border-[#002060]/50 h-5" />
                             </div>
                             <div className="flex items-end gap-2 w-2/5 pr-12">
                               <span className="text-[11px] font-bold text-[#002060] shrink-0 object-bottom pb-1">Date</span>
                               <div className="flex-grow border-b border-[#002060]/50 h-5" />
                             </div>
                           </div>
                           <div className="flex items-end justify-between gap-4 max-w-full">
                             <div className="flex items-end gap-2 pr-12 w-3/5">
                               <span className="text-[11px] font-bold text-[#002060] shrink-0 object-bottom pb-1">Client</span>
                               <div className="flex-grow border-b border-[#002060]/50 h-5" />
                             </div>
                             <div className="flex items-end gap-2 w-2/5 pr-12">
                               <span className="text-[11px] font-bold text-[#002060] shrink-0 object-bottom pb-1">Date</span>
                               <div className="flex-grow border-b border-[#002060]/50 h-5" />
                             </div>
                           </div>
                         </div>
                       </div>
                     </div>
                  ) : (
                     <div className="bg-white shadow-2xl rounded-sm p-12 print:p-0 print:shadow-none print:rounded-none border-0 print-page-wrapper font-sans text-slate-800">
                      <div className="flex justify-between items-end mb-8">
                        <div className="space-y-1">
                          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">{dealer.name}</h2>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest italic">Interal Billing & Margin Analysis</p>
                        </div>
                        <h1 className="text-4xl font-black text-[#002060] tracking-tighter uppercase italic">
                           Internal Quotation
                        </h1>
                      </div>

                      <div className="bg-[#D1E6D3] px-6 py-2 mb-2 flex justify-center gap-12 border-y border-[#A5D6A7]">
                        <div className="text-[11px] font-bold text-slate-700">Date: <span className="font-black ml-1 text-slate-900">{new Date(quoteDate + 'T12:00:00').toLocaleDateString('en-US')}</span></div>
                        <div className="text-[11px] font-bold text-slate-700">Quote Ref: <span className="font-black ml-1 text-slate-900">{id.substring(0, 8).toUpperCase()}</span></div>
                      </div>

                      <div className="grid grid-cols-2 border border-[#002060] mb-8 bg-white min-h-[140px]">
                        <div className="p-6 border-r border-[#002060] flex flex-col items-center justify-center text-center space-y-1">
                           <p className="text-sm font-black text-[#002060] uppercase">{customer.name || 'VALUED CUSTOMER'}</p>
                           <p className="text-sm font-black text-[#002060] uppercase">{project.project_name}</p>
                           <p className="text-sm font-black text-[#002060] uppercase">{customer.address || "JOB SITE ADDRESS"}</p>
                        </div>
                        <div className="p-6 flex flex-col items-center justify-center text-center space-y-1">
                           <div className="bg-slate-50 w-full py-1 mb-2">
                              <p className="text-[10px] font-black text-[#002060] uppercase tracking-widest text-center">Cabinet Style</p>
                           </div>
                           <p className="text-sm font-black text-[#002060] uppercase">{selectedRooms.length > 0 ? roomConfigs[selectedRooms[0]]?.collection : 'STANDARD'}</p>
                           <p className="text-sm font-black text-[#002060] uppercase">{selectedRooms.length > 0 ? roomConfigs[selectedRooms[0]]?.door_style : 'CABINETS'}</p>
                        </div>
                      </div>

                      <div className="space-y-10 min-h-[400px]">
                        <div className="space-y-8">
                          {(activePrintRoom ? [activePrintRoom] : selectedRooms).map(roomName => {
                            const roomItems = bom.filter(i => i.room === roomName && i.is_billable && i.unit_price > 0);
                            if (roomItems.length === 0) return null;
                            return (
                              <div key={roomName} className="avoid-break mb-8 overflow-hidden border border-slate-200 rounded-lg">
                                <div className="bg-[#B0C4DE] border-b border-[#002060] py-2 px-4 flex justify-between items-center">
                                   <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#002060] italic">{roomName}</h3>
                                   <span className="text-[10px] font-black text-[#002060] bg-white/50 px-2 py-0.5 rounded-full uppercase">Room Subtotal (Sell)</span>
                                </div>
                                <Table>
                                   <TableHeader className="bg-slate-50 border-b border-slate-200">
                                     <TableRow className="h-10 hover:bg-transparent">
                                       <TableHead className="text-[10px] font-black uppercase p-2 text-slate-900 border-r border-slate-100 italic">CAB Code</TableHead>
                                       <TableHead className="text-center text-[10px] font-black uppercase p-2 w-16 text-slate-900 border-r border-slate-100 italic">QTY</TableHead>
                                       <TableHead className="text-right text-[10px] font-black uppercase p-2 text-slate-900 border-r border-slate-100 italic">Sell Price</TableHead>
                                       <TableHead className="text-right text-[10px] font-black uppercase p-2 text-slate-900 italic">Amount</TableHead>
                                     </TableRow>
                                   </TableHeader>
                                   <TableBody>
                                       {(() => {
                                          const groups: Record<string, any[]> = {};
                                          roomItems.forEach(item => {
                                             const cat = detectCategory(item.sku);
                                             if (!groups[cat]) groups[cat] = [];
                                             groups[cat].push(item);
                                          });
                                          
                                          const order = ['Wall Cabinets', 'Base Cabinets', 'Tall Cabinets', 'Vanity Cabinets', 'Universal Fillers', 'Molding & Trim', 'Hardwares', 'Accessories'];
                                          return order.map(cat => {
                                             const items = groups[cat] || [];
                                             if (items.length === 0) return null;
                                             return (
                                               <React.Fragment key={cat}>
                                                  <TableRow className="bg-slate-100/30 h-8 border-b border-slate-100">
                                                     <TableCell colSpan={4} className="text-[9px] font-black uppercase tracking-[0.15em] text-[#002060] bg-slate-50/80 pl-4 italic">{cat}</TableCell>
                                                  </TableRow>
                                                  {items.map(item => (
                                                    <TableRow key={item.id} className="border-b border-slate-100 h-10 hover:bg-transparent even:bg-slate-50/50">
                                                       <TableCell className="font-bold text-[10px] p-2 text-slate-700 border-r border-slate-50">{item.sku}</TableCell>
                                                       <TableCell className="text-center text-[10px] font-black w-16 p-2 text-slate-900 border-r border-slate-50">{item.qty}</TableCell>
                                                       <TableCell className="text-right font-mono text-[10px] font-bold p-2 text-slate-600 border-r border-slate-50">
                                                          ${(item.unit_price * (financials.scalingFactor || 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                       </TableCell>
                                                       <TableCell className="text-right font-mono text-[10px] font-black p-2 text-[#002060]">
                                                          ${(item.unit_price * item.qty * (financials.scalingFactor || 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                       </TableCell>
                                                    </TableRow>
                                                  ))}
                                               </React.Fragment>
                                             );
                                          });
                                       })()}
                                      <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                                         <TableCell colSpan={3} className="text-[10px] font-black text-right uppercase italic pr-4">Room {roomName} Total:</TableCell>
                                         <TableCell className="text-right font-mono text-[11px] font-black text-[#002060]">
                                            ${(roomItems.reduce((s, i) => s + (i.unit_price * i.qty), 0) * (1 - (roomDiscounts[roomName] || 0) / 100) * (financials.scalingFactor || 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                         </TableCell>
                                      </TableRow>
                                   </TableBody>
                                </Table>
                              </div>
                            );
                          })}

                          <div className="avoid-break mb-8 overflow-hidden border border-slate-200 rounded-lg">
                              <div className="bg-[#B0C4DE] border-b border-[#002060] py-2 px-4 flex justify-between items-center">
                                 <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#002060] italic">Miscellaneous & Included Items</h3>
                              </div>
                              <div className="flex justify-between items-center px-12 py-3 bg-white border-b border-slate-100">
                                  <span className="text-[10px] font-black text-[#002060] uppercase italic">Quarter Round at Floor - Whole House Included</span>
                                  <span className="text-[10px] font-black font-mono text-[#002060]">$0.00</span>
                              </div>
                              <div className="flex justify-between items-center px-12 py-3 bg-slate-50/50">
                                  <span className="text-[10px] font-black text-[#002060] uppercase italic">Standard 36" Upper Cabinets / Raised Vanities</span>
                                  <span className="text-[10px] font-black font-mono text-[#002060]">Included</span>
                              </div>
                            </div>
                        </div>
                      </div>

                      <div className="mt-8 mb-12 flex justify-end">
                        <div className="w-80 border border-[#002060] overflow-hidden rounded-lg">
                           <div className="bg-[#B0C4DE] py-2 px-4 border-b border-[#002060]">
                              <p className="text-xs font-black text-[#002060] uppercase tracking-widest text-center italic">Final Summary</p>
                           </div>
                           
                           <div className="bg-slate-50 flex justify-between items-center px-6 py-2 border-b border-slate-200">
                              <span className="text-[10px] font-black text-[#002060] uppercase italic">Proposed Subtotal</span>
                              <span className="text-[11px] font-black font-mono text-[#002060]">${financials.netTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                           </div>

                           {isInstallManufacturer && includeInstall && financials.totalInstallSell > 0 && (
                             <div className="bg-orange-50/60 flex justify-between items-center px-6 py-2 border-b border-orange-100">
                               <span className="text-[10px] font-black text-orange-700 uppercase italic">
                                 Installation ({installCalculations.totalInstallUnits.toFixed(1)} units × ${installRate})
                               </span>
                               <span className="text-[11px] font-black font-mono text-orange-700">
                                 +${financials.totalInstallSell.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                               </span>
                             </div>
                           )}
                           {isInstallManufacturer && includeDelivery && financials.totalDeliverySell > 0 && (
                             <div className="bg-blue-50/60 flex justify-between items-center px-6 py-2 border-b border-blue-100">
                               <span className="text-[10px] font-black text-blue-700 uppercase italic">
                                 Delivery / 3PL ({installCalculations.total3PLUnits} items × ${deliverySellRate})
                               </span>
                               <span className="text-[11px] font-black font-mono text-blue-700">
                                 +${financials.totalDeliverySell.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                               </span>
                             </div>
                           )}

                           <div className="bg-white flex justify-between items-center px-6 py-2 border-b border-slate-200">
                              <span className="text-[10px] font-black text-red-700 uppercase italic">Estimated Sales Tax ({taxRate}%)</span>
                              <span className="text-[11px] font-black font-mono text-red-700">${financials.taxes.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                           </div>

                           <div className="bg-[#B0C4DE] flex justify-between items-center px-6 py-3">
                              <span className="text-xs font-black text-[#002060] uppercase italic tracking-widest underline decoration-2">Total Amount Due</span>
                              <span className="text-sm font-black font-mono text-[#002060] underline underline-offset-4 decoration-2">
                                 ${financials.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                           </div>
                        </div>
                      </div>
                      
                      <div className="mt-20 pt-10 border-t-2 border-slate-900 flex flex-col items-end text-right avoid-break pr-20">
                        <div className="w-full max-w-sm space-y-4">
                          <div className="bg-slate-50 p-6 rounded-lg mb-4 space-y-2 border border-slate-200 text-left">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Internal Cost Breakdown</p>
                            <div className="flex justify-between text-[11px] font-bold uppercase text-slate-500">
                               <span>Gross List</span>
                               <span className="font-mono">${financials.listSubtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-[11px] font-bold uppercase text-sky-600">
                               <span>Dealer Cost ({pricingFactor})</span>
                               <span className="font-mono">${financials.dealerCost.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-[11px] font-bold uppercase text-emerald-600">
                               <span>Margin ({targetMargin}%)</span>
                               <span className="font-mono">+${(financials.marginSell - financials.dealerCost).toFixed(2)}</span>
                            </div>
                            {financials.additionalExpenses > 0 && (
                              <div className="flex justify-between text-[11px] font-bold uppercase text-amber-600">
                                <span>Add'l Charges</span>
                                <span className="font-mono">+${financials.additionalExpenses.toFixed(2)}</span>
                              </div>
                            )}
                            {financials.discountAmt > 0 && (
                               <div className="flex justify-between text-[11px] font-bold uppercase text-red-600">
                                 <span>Discount ({globalDiscount}%)</span>
                                 <span className="font-mono">-${financials.discountAmt.toFixed(2)}</span>
                               </div>
                            )}
                             <div className="flex justify-between text-[11px] font-bold uppercase text-sky-600 border-t border-slate-200 pt-2 mt-2">
                               <span>Total Amount</span>
                               <span className="font-mono">${financials.grandTotal.toFixed(2)}</span>
                            </div>
                          </div>
                          
                          <div className="flex justify-between text-xs font-bold uppercase text-slate-500 px-2">
                             <span>Subtotal</span>
                             <span className="font-mono">${(financials.netTotal).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs font-bold uppercase text-slate-500 px-2">
                             <span>Tax ({taxRate}%)</span>
                             <span className="font-mono">${financials.taxes.toFixed(2)}</span>
                          </div>
                          <div className="border-t border-slate-200 my-2" />
                          
                          <div className="flex justify-between items-center bg-slate-50 p-4 rounded-lg border border-slate-200">
                             <span className="text-sm font-black uppercase text-slate-900 tracking-widest">Total Amount</span>
                             <span className="font-mono text-xl font-black text-sky-600 whitespace-nowrap ml-4">
                                ${financials.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                             </span>
                          </div>
    
                          <div className="pt-8 space-y-1">
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Valid until: {new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString()}</p>
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Terms: Net 30</p>
                          </div>
                        </div>
                      </div>
                     </div>
                  )}
                               </div>

                  <div className="mt-32 pt-10 border-t border-slate-100 flex justify-center gap-6 print:hidden">
                    <Button size="lg" className="gradient-button h-16 px-12 text-lg rounded-2xl shadow-xl shadow-sky-500/30" onClick={() => triggerPrint()}>
                      <Printer className="w-5 h-5 mr-3" /> Print Proposal (A4)
                    </Button>
                    <Button size="lg" variant="outline" className="h-16 px-12 text-lg rounded-2xl border-slate-200" onClick={() => triggerPrint()}>
                      <FileDown className="w-5 h-5 mr-3" /> Save Single PDF
                    </Button>
                  </div>
                </div>
           )}
        </div>

        <aside className="print:hidden lg:sticky lg:top-24 h-fit">
          <div className="max-h-[calc(100vh-160px)] overflow-y-auto pr-2 space-y-6 scrollbar-thin scrollbar-thumb-slate-200">
            <Card className="rounded-[2rem] border-slate-200 shadow-2xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100 flex flex-row items-center gap-2">
                <Calculator className="w-5 h-5 text-sky-600" />
                <CardTitle className="text-lg">Total Amount</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="p-5 bg-sky-50 rounded-2xl border border-sky-100 space-y-4">
                   <p className="text-[10px] font-black uppercase text-sky-600 tracking-[0.2em] mb-2">Cost & Margin Settings</p>
                   
                   <div className="space-y-1">
                      <Label className="text-[11px] font-bold text-slate-500 uppercase flex items-center justify-between">
                        Pricing Factor (Cost)
                        <DollarSign className="w-3 h-3 text-sky-400" />
                      </Label>
                      <Input type="number" step="0.01" value={pricingFactor} onChange={e => setPricingFactor(parseFloat(e.target.value) || 0)} className="h-10 bg-white border-sky-200 font-bold rounded-lg text-sm" />
                      <p className="text-[9px] text-slate-400 font-medium">Ex: 0.45 = 55% Off List</p>
                   </div>

                   <div className="space-y-1">
                      <Label className="text-[11px] font-bold text-slate-500 uppercase flex items-center justify-between">
                        Target Margin (%)
                        <Percent className="w-3 h-3 text-sky-400" />
                      </Label>
                      <Input type="number" value={targetMargin} onChange={e => setTargetMargin(parseFloat(e.target.value) || 0)} className="h-10 bg-white border-sky-200 font-bold rounded-lg text-sm" />
                   </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label className="text-[11px] font-bold text-slate-400 uppercase">Add'l Discount (%)</Label>
                    <Input type="number" value={globalDiscount} onChange={e => setGlobalDiscount(parseFloat(e.target.value) || 0)} className="h-10 bg-slate-50 border-slate-100 rounded-lg text-sm" />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-bold text-slate-400 uppercase">Sales Tax Rate (%)</Label>
                    <Input type="number" step="0.01" value={taxRate} onChange={e => setTaxRate(parseFloat(e.target.value) || 0)} className="h-10 bg-slate-50 border-slate-100 rounded-lg text-sm" />
                  </div>

                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Additional Charges ($)</p>
                    
                    <div className="space-y-1">
                      <Label className="text-[11px] font-bold text-slate-400 uppercase">Freight / Shipping ($)</Label>
                      <Input type="number" value={freight} onChange={e => setFreight(parseFloat(e.target.value) || 0)} className="h-10 bg-slate-50 border-slate-100 rounded-lg text-sm" />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px] font-bold text-slate-400 uppercase">Fuel Surcharge ($)</Label>
                      <Input type="number" value={fuelSurcharge} onChange={e => setFuelSurcharge(parseFloat(e.target.value) || 0)} className="h-10 bg-slate-50 border-slate-100 rounded-lg text-sm" />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px] font-bold text-slate-400 uppercase">Misc Charges ($)</Label>
                      <Input type="number" value={miscCharges} onChange={e => setMiscCharges(parseFloat(e.target.value) || 0)} className="h-10 bg-slate-50 border-slate-100 rounded-lg text-sm" />
                    </div>

                  </div>
                </div>

                {isInstallManufacturer && (
                  <div className="pt-4 border-t border-orange-100 space-y-3">
                    {/* ── Installation ── */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Wrench className="w-3.5 h-3.5 text-orange-500" />
                        <p className="text-[10px] font-black uppercase text-orange-600 tracking-widest">Installation Charges</p>
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={includeInstall}
                          onChange={e => setIncludeInstall(e.target.checked)}
                          className="w-3.5 h-3.5 accent-orange-500"
                        />
                        <span className="text-[9px] font-black uppercase text-orange-600">Include</span>
                      </label>
                    </div>
                    {includeInstall && (
                      <div className="p-3 bg-orange-50/60 rounded-xl border border-orange-100 space-y-3">
                        <p className="text-[9px] text-slate-400 font-semibold">
                          Total value: {installCalculations.totalInstallUnits.toFixed(1)} units
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-emerald-700 uppercase">Sell Rate ($/unit)</Label>
                            <Input
                              type="number" step="0.01" value={installRate}
                              onChange={e => setInstallRate(parseFloat(e.target.value) || 0)}
                              className="h-9 bg-white border-emerald-200 rounded-lg text-sm font-bold"
                              placeholder="0.00"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-sky-700 uppercase">Cost Rate ($/unit)</Label>
                            <Input
                              type="number" step="0.01" value={installCostRate}
                              onChange={e => setInstallCostRate(parseFloat(e.target.value) || 0)}
                              className="h-9 bg-white border-sky-200 rounded-lg text-sm font-bold"
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                        <div className="pt-2 border-t border-orange-100 space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold text-emerald-700 uppercase">
                            <span>Client Charge</span>
                            <span className="font-mono">${financials.totalInstallSell.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-bold text-sky-700 uppercase">
                            <span>Internal Cost</span>
                            <span className="font-mono">${financials.totalInstallInternalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-black text-purple-700 uppercase border-t border-orange-100 pt-1">
                            <span>Install Profit</span>
                            <span className="font-mono">+${financials.installProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Delivery (3PL) ── */}
                    <div className="flex items-center justify-between mt-3 mb-1">
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16l4-4m0 0l4 4m-4-4v9M9 3h6a2 2 0 012 2v7M3 16h18" /></svg>
                        <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest">Delivery (3PL) Charges</p>
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={includeDelivery}
                          onChange={e => setIncludeDelivery(e.target.checked)}
                          className="w-3.5 h-3.5 accent-blue-500"
                        />
                        <span className="text-[9px] font-black uppercase text-blue-600">Include</span>
                      </label>
                    </div>
                    {includeDelivery && (
                      <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 space-y-3">
                        <p className="text-[9px] text-slate-400 font-semibold">
                          3PL units: {installCalculations.total3PLUnits.toFixed(0)} items
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-emerald-700 uppercase">Sell Rate ($/unit)</Label>
                            <Input
                              type="number" step="0.01" value={deliverySellRate}
                              onChange={e => setDeliverySellRate(parseFloat(e.target.value) || 0)}
                              className="h-9 bg-white border-emerald-200 rounded-lg text-sm font-bold"
                              placeholder="0.00"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-sky-700 uppercase">Cost Rate ($/unit)</Label>
                            <Input
                              type="number" step="0.01" value={deliveryCostRate}
                              onChange={e => setDeliveryCostRate(parseFloat(e.target.value) || 0)}
                              className="h-9 bg-white border-sky-200 rounded-lg text-sm font-bold"
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                        <div className="pt-2 border-t border-blue-100 space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold text-emerald-700 uppercase">
                            <span>Client Charge</span>
                            <span className="font-mono">${financials.totalDeliverySell.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-bold text-sky-700 uppercase">
                            <span>Internal Cost</span>
                            <span className="font-mono">${financials.totalDeliveryCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-black text-purple-700 uppercase border-t border-blue-100 pt-1">
                            <span>Delivery Profit</span>
                            <span className="font-mono">+${financials.deliveryProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-6 border-t border-slate-100 space-y-4">
                   <div className="space-y-2">
                       <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-2">Room Sale Summary</p>
                       {selectedRooms.map(room => {
                           const rSub = bom.filter(i => i.room === room && i.is_billable).reduce((sum, item) => sum + (item.unit_price * item.qty), 0);
                           const rFinal = rSub * (1 - (roomDiscounts[room] || 0) / 100) * (financials.scalingFactor || 0);
                           return (
                               <div key={room} className="flex justify-between items-center text-[10px] font-bold text-slate-500">
                                   <span className="truncate max-w-[140px]">{room}</span>
                                   <span className="font-mono text-slate-900">${rFinal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                               </div>
                           );
                       })}
                   </div>

                   <div className="pt-4 border-t border-slate-50 flex justify-between text-xs">
                      <span className="text-slate-400 font-bold uppercase tracking-widest">Net Value</span>
                      <span className="font-mono text-slate-900 font-bold">${financials.netTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                   </div>
                   <div className="flex justify-between items-center text-xs">
                      <span className="text-sky-600 font-bold uppercase tracking-widest">Dealer Cost</span>
                      <span className="font-mono text-sky-900 font-bold">${financials.dealerCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                   </div>
                   <div className="pt-4 border-t border-slate-50">
                      <p className="text-[10px] font-black uppercase text-sky-600 tracking-[0.3em] mb-1">Total Amount</p>
                      <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">
                         ${financials.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                   </div>
                </div>

                <Button variant="outline" className="w-full h-11 rounded-xl" onClick={handleSaveAll} disabled={isSaving}>
                  {isSaving ? <Loader2 className="animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Financials
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-[2rem] border-slate-200 shadow-xl overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-100">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">Internal Cost Breakdown</p>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="flex justify-between text-xs font-bold text-slate-500 uppercase">
                  <span>Gross List</span>
                  <span className="font-mono">${financials.listSubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold text-sky-600 uppercase">
                  <span className="flex items-center gap-1"><Factory className="w-3 h-3" /> Est. Mfg Cost</span>
                  <span className="font-mono">${financials.estimatedMfgCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold text-emerald-600 uppercase">
                  <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Cabinet Profit</span>
                  <span className="font-mono">+${financials.estimatedProfit.toFixed(2)}</span>
                </div>
                {isInstallManufacturer && includeInstall && financials.totalInstallSell > 0 && (
                  <div className="border-t border-slate-50 pt-2 space-y-1">
                    <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest">Installation</p>
                    <div className="flex justify-between text-[10px] font-bold text-orange-600 uppercase">
                      <span>Sell ({installCalculations.totalInstallUnits.toFixed(1)} × ${installRate})</span>
                      <span className="font-mono">+${financials.totalInstallSell.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-sky-600 uppercase">
                      <span>Cost ({installCalculations.totalInstallUnits.toFixed(1)} × ${installCostRate})</span>
                      <span className="font-mono">-${financials.totalInstallInternalCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-black text-purple-700 uppercase">
                      <span>Install Profit</span>
                      <span className="font-mono">+${financials.installProfit.toFixed(2)}</span>
                    </div>
                  </div>
                )}
                {isInstallManufacturer && includeDelivery && financials.totalDeliverySell > 0 && (
                  <div className="border-t border-slate-50 pt-2 space-y-1">
                    <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Delivery (3PL)</p>
                    <div className="flex justify-between text-[10px] font-bold text-blue-600 uppercase">
                      <span>Sell ({installCalculations.total3PLUnits} units × ${deliverySellRate})</span>
                      <span className="font-mono">+${financials.totalDeliverySell.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-sky-600 uppercase">
                      <span>Cost ({installCalculations.total3PLUnits} units × ${deliveryCostRate})</span>
                      <span className="font-mono">-${financials.totalDeliveryCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-black text-purple-700 uppercase">
                      <span>Delivery Profit</span>
                      <span className="font-mono">+${financials.deliveryProfit.toFixed(2)}</span>
                    </div>
                  </div>
                )}
                <div className="border-t border-slate-50 pt-3 space-y-2">
                  <div className="flex justify-between text-xs font-bold text-slate-400 uppercase">
                    <span>Add'l Charges</span>
                    <span className="font-mono">+${financials.additionalExpenses.toFixed(2)}</span>
                  </div>
                  {financials.discountAmt > 0 && (
                    <div className="flex justify-between text-xs font-bold text-red-600 uppercase">
                      <span>Discount ({globalDiscount}%)</span>
                      <span className="font-mono">-${financials.discountAmt.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs font-bold text-slate-300 uppercase">
                    <span>Sales Tax</span>
                    <span className="font-mono">+${financials.taxes.toFixed(2)}</span>
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-3 flex justify-between text-sm font-black text-slate-900 uppercase">
                  <span>Final Total</span>
                  <span className="font-mono">${financials.grandTotal.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>



            <div className="p-6 bg-slate-900 rounded-[2rem] text-white shadow-2xl space-y-4">
               <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">Live Status</p>
               </div>
               <div>
                  <p className="text-xl font-black leading-tight">{selectedRooms.length} Rooms Selected</p>
                  <p className="text-xs text-slate-400 font-medium">Ready for {dealer.name} Export</p>
               </div>
               <Button className="w-full bg-white text-slate-900 hover:bg-slate-100 font-bold" onClick={() => setStep('preview')}>
                 Go to Preview
                 <ArrowRight className="w-4 h-4 ml-2" />
               </Button>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
