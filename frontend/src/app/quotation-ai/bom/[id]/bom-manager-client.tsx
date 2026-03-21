
"use client";

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
  Factory
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn, detectCategory } from '@/lib/utils';
import { updateBomItemAction, updateProjectAction } from '../../actions';
import { useToast } from '@/hooks/use-toast';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface BomItem {
  id: string;
  sku: string;
  matched_sku: string;
  qty: number;
  unit_price: number;
  line_total: number;
  room: string;
  precision_level: string;
  is_billable?: boolean;
}

interface BomManagerClientProps {
  id: string;
  project: any;
  initialBom: BomItem[];
  manufacturerName: string;
}

type WorkflowStep = 'pricing' | 'preview';
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

  const [roomDiscounts, setRoomDiscounts] = useState<Record<string, number>>(project.bom_data?.roomDiscounts || {});

  const [customer, setCustomer] = useState({
    name: project.bom_data?.customerName || '',
    address: project.bom_data?.customerAddress || '',
    phone: project.bom_data?.customerPhone || '',
    delivery: project.bom_data?.customerDelivery || '',
  });

  const [dealer, setDealer] = useState({
    name: project.bom_data?.dealerName || manufacturerName,
    address: project.bom_data?.dealerAddress || "123 Manufacturing Way, Industry City, IN 46201",
    phone: project.bom_data?.dealerPhone || "(800) 555-KABS",
    email: project.bom_data?.dealerEmail || `orders@${manufacturerName.toLowerCase().replace(/\s+/g, '')}.com`
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isPricing, setIsPricing] = useState(false);
  const [activePrintRoom, setActivePrintRoom] = useState<string | null>(null);

  const financials = useMemo(() => {
    const effectiveRooms = activePrintRoom ? [activePrintRoom] : selectedRooms;
    const activeItems = bom.filter(item => item.is_billable && effectiveRooms.includes(item.room));
    
    let listSubtotal = 0;
    activeItems.forEach(item => {
      const roomDiscount = roomDiscounts[item.room] || 0;
      const basePrice = (Number(item.unit_price) * Number(item.qty) || 0);
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
    const grandTotal = netTotal + taxes;

    // Financial Metrics for Manufacturer Oversight
    const estimatedMfgCost = dealerCost;
    const estimatedProfit = netTotal - dealerCost;

    return { 
      listSubtotal, 
      dealerCost, 
      marginSell, 
      additionalExpenses,
      discountAmt, 
      netTotal, 
      taxes, 
      grandTotal,
      estimatedMfgCost,
      estimatedProfit
    };
  }, [bom, selectedRooms, activePrintRoom, pricingFactor, targetMargin, globalDiscount, taxRate, freight, fuelSurcharge, miscCharges, roomDiscounts]);

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

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      await Promise.all(bom.map(item => 
        updateBomItemAction(item.id, { 
          sku: item.sku,
          qty: item.qty,
          unit_price: item.unit_price, 
          line_total: item.unit_price * item.qty,
          is_billable: item.is_billable
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
          roomDiscounts,
          customerName: customer.name,
          customerAddress: customer.address,
          customerPhone: customer.phone,
          customerDelivery: customer.delivery,
          dealerName: dealer.name,
          dealerAddress: dealer.address,
          dealerPhone: dealer.phone,
          dealerEmail: dealer.email,
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
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 px-8 h-20 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => {
            if (step === 'preview') setStep('pricing');
            else router.back();
          }}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              {step === 'pricing' ? 'Bill of Materials' : 'Proposal Preview'}
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              Project: {project.project_name} • {manufacturerName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {step === 'pricing' && (
            <Button variant="outline" className="rounded-xl h-11 px-4 border-slate-200" onClick={handleReprice} disabled={isPricing}>
               {isPricing ? <Loader2 className="animate-spin w-4 h-4" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
               Match Catalog Prices
            </Button>
          )}
          <Button className="rounded-xl h-11 px-6 gradient-button" onClick={() => setStep(step === 'pricing' ? 'preview' : 'pricing')}>
             {step === 'pricing' ? 'Next: Preview Proposal' : 'Back to BOM List'}
             <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-8 mt-8 grid grid-cols-1 lg:grid-cols-4 gap-8 print:block print:px-0">
        <div className="lg:col-span-3 space-y-8 print:col-span-1">
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
                const categories = ['Wall Cabinets', 'Base Cabinets', 'Tall Cabinets', 'Vanity Cabinets', 'Universal Fillers'];

                return (
                  <section key={roomName} className={cn("space-y-4 transition-opacity duration-300", !isSelected && "opacity-40 grayscale-[0.5]")}>
                    <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2 mb-4">
                       <div className="flex items-center gap-3">
                          <Checkbox checked={isSelected} onCheckedChange={v => toggleRoom(roomName, !!v)} />
                          <Box className="w-5 h-5 text-sky-600" />
                          <h2 className="text-xl font-black uppercase tracking-tight">{roomName}</h2>
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
                                 <TableHead className="text-center text-[10px] uppercase font-bold text-slate-400">QTY</TableHead>
                                 <TableHead className="text-right text-[10px] uppercase font-bold text-slate-400">UNIT PRICE (LIST)</TableHead>
                                 <TableHead className="text-right text-[10px] uppercase font-bold text-slate-400">TOTAL</TableHead>
                               </TableRow>
                             </TableHeader>
                             <TableBody>
                                {items.map(item => {
                                  const idx = bom.findIndex(b => b.id === item.id);
                                  return (
                                    <TableRow key={item.id} className={cn("h-16 group hover:bg-white", !item.is_billable && "opacity-40")}>
                                      <TableCell>
                                        <Checkbox checked={item.is_billable} onCheckedChange={v => handleUpdateItem(idx, { is_billable: !!v })} />
                                      </TableCell>
                                      <TableCell>
                                        <div className="font-bold text-slate-900 text-sm">{item.sku}</div>
                                        <div className="text-[9px] text-slate-400 font-mono">{item.matched_sku}</div>
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Input type="number" value={item.qty} onChange={e => handleUpdateItem(idx, { qty: parseInt(e.target.value) || 0 })} className="w-16 mx-auto text-center h-9 font-bold bg-slate-50 border-none" />
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                           <span className="text-slate-400 font-mono text-xs">$</span>
                                           <Input type="number" value={item.unit_price} onChange={e => handleUpdateItem(idx, { unit_price: parseFloat(e.target.value) || 0 })} className="w-24 text-right h-9 font-bold bg-slate-50 border-none font-mono" />
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right font-black font-mono text-slate-900 text-sm">
                                        ${(item.unit_price * item.qty).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </TableCell>
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
                               <TableBody>
                                  {roomItems.filter(i => !categories.includes(detectCategory(i.sku))).map(item => {
                                    const idx = bom.findIndex(b => b.id === item.id);
                                    return (
                                      <TableRow key={item.id} className="h-10 border-b border-slate-100">
                                        <TableCell className="w-10"><Checkbox checked={item.is_billable} onCheckedChange={v => handleUpdateItem(idx, { is_billable: !!v })} /></TableCell>
                                        <TableCell className="text-xs font-bold">{item.sku}</TableCell>
                                        <TableCell className="text-right font-mono text-xs">${(item.unit_price * item.qty).toFixed(2)}</TableCell>
                                      </TableRow>
                                    );
                                  })}
                               </TableBody>
                            </Table>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    )}
                  </section>
                )
              })}
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

               <div className="bg-white shadow-2xl rounded-sm p-16 print:p-0 print:shadow-none print:rounded-none border border-slate-100 print-page-wrapper">
                  <div className="flex justify-between items-start mb-16 border-b-2 border-slate-900 pb-10">
                    <div className="space-y-4 max-w-[48%] flex flex-col items-start">
                      <div>
                        <h2 className="text-3xl font-black tracking-tight text-slate-900 uppercase leading-none">{dealer.name}</h2>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-2">Cabinetry Manufacturer</p>
                      </div>
                      <div className="space-y-1 text-xs text-slate-600">
                        <p className="flex items-center gap-2"><MapPin className="w-3 h-3 shrink-0" /> {dealer.address}</p>
                        <p className="flex items-center gap-2"><Phone className="w-3 h-3 shrink-0" /> {dealer.phone}</p>
                        <p className="flex items-center gap-2 font-medium text-sky-600">{dealer.email}</p>
                      </div>
                    </div>
                    <div className="text-right space-y-4 max-w-[48%] flex flex-col items-end">
                      <div>
                        <h1 className="text-4xl font-black text-slate-900 uppercase leading-none">Invoice</h1>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">Ref: {id.substring(0, 8).toUpperCase()}</p>
                      </div>
                      <div className="space-y-1 text-xs text-slate-900">
                        <p className="font-black uppercase tracking-widest text-[10px] text-slate-400 mb-1">Bill To:</p>
                        <p className="font-bold text-sm">{customer.name || 'VALUED CUSTOMER'}</p>
                        <p>{customer.address || 'PROJECT ADDRESS PENDING'}</p>
                        <p className="flex items-center justify-end gap-2"><Phone className="w-3 h-3 shrink-0" /> {customer.phone || 'PHONE PENDING'}</p>
                        {customer.delivery && (
                           <p className="flex items-center justify-end gap-2 text-sky-600 font-medium">
                             <Truck className="w-3 h-3 shrink-0" /> Ship to: {customer.delivery}
                           </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-12 min-h-[400px]">
                    {selectedRooms.filter(r => !activePrintRoom || r === activePrintRoom).map(roomName => {
                      const roomItems = bom.filter(i => i.room === roomName && i.is_billable);
                      if (roomItems.length === 0) return null;
                      return (
                        <div key={roomName} className="avoid-break mb-8">
                          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-4 bg-slate-50 p-2 border-l-4 border-slate-900">{roomName}</h3>
                          <Table>
                             <TableHeader className="bg-slate-50 border-y border-slate-200">
                               <TableRow className="h-10 hover:bg-transparent">
                                 <TableHead className="text-[10px] font-bold uppercase p-2 text-slate-900">CAB Code</TableHead>
                                 <TableHead className="text-center text-[10px] font-bold uppercase p-2 w-12 text-slate-900">QTY</TableHead>
                                 <TableHead className="text-right text-[10px] font-bold uppercase p-2 text-slate-900">Unit Price</TableHead>
                                 <TableHead className="text-right text-[10px] font-bold uppercase p-2 text-slate-900">Amount</TableHead>
                               </TableRow>
                             </TableHeader>
                             <TableBody>
                                {roomItems.map(item => (
                                  <TableRow key={item.id} className="border-b border-slate-100 h-10 hover:bg-transparent">
                                     <TableCell className="font-medium text-[11px] p-2">{item.sku}</TableCell>
                                     <TableCell className="text-center text-[11px] w-12 p-2">{item.qty}</TableCell>
                                     <TableCell className="text-right font-mono text-[11px] p-2">
                                       ${viewMode === 'internal' ? item.unit_price.toFixed(2) : (item.unit_price * (financials.grandTotal / financials.listSubtotal)).toFixed(2)}
                                     </TableCell>
                                     <TableCell className="text-right font-mono text-[11px] font-bold p-2 text-slate-900">
                                       ${(item.unit_price * item.qty * (viewMode === 'internal' ? 1 : (financials.grandTotal / financials.listSubtotal))).toFixed(2)}
                                     </TableCell>
                                  </TableRow>
                                ))}
                             </TableBody>
                          </Table>
                        </div>
                      )
                    })}
                  </div>

                  <div className="mt-20 pt-10 border-t-2 border-slate-900 flex flex-col items-end text-right avoid-break">
                    <div className="w-full max-w-sm space-y-4">
                      {viewMode === 'internal' && (
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
                      )}
                      
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
                            ${financials.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                         </span>
                      </div>

                      <div className="pt-8 space-y-1">
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Valid until: {new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString()}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Terms: Net 30</p>
                      </div>
                    </div>
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

                <div className="pt-6 border-t border-slate-100 space-y-3">
                   <div className="flex justify-between text-xs">
                      <span className="text-slate-400 font-bold uppercase tracking-widest">Net Value</span>
                      <span className="font-mono text-slate-900 font-bold">${financials.netTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                   </div>
                   <div className="flex justify-between items-center text-xs">
                      <span className="text-sky-600 font-bold uppercase tracking-widest">Dealer Cost</span>
                      <span className="font-mono text-sky-900 font-bold">${financials.dealerCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                   </div>
                   <div className="pt-4 border-t border-slate-50">
                      <p className="text-[10px] font-black uppercase text-sky-600 tracking-[0.3em] mb-1">Total Amount</p>
                      <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">
                         ${financials.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                  <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Est. Profit</span>
                  <span className="font-mono">+${financials.estimatedProfit.toFixed(2)}</span>
                </div>
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
