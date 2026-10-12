"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Factory, Plus, Search, MoreHorizontal, Trash2, Eye, ChevronRight, Loader2, Edit } from 'lucide-react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { addManufacturer, deleteManufacturer, setManufacturerSelected, updateManufacturer } from './actions';

export function ManufacturersList({
  initialManufacturers,
  basePath = '/app',
  title = 'Manufacturers',
  subtitle = 'Manage cabinetry suppliers and their technical documentation.',
  readOnly = false,
  showSelection = false,
}: {
  initialManufacturers: any[];
  basePath?: string;
  title?: string;
  subtitle?: string;
  /** Dealers browse the shared catalog Super Admin curates — they can view
   *  details but not add/rename/delete manufacturers (the server actions
   *  already reject this; hiding the controls here avoids a confusing
   *  "action failed" toast for something that was never allowed). */
  readOnly?: boolean;
  /** Show the per-row "use this brand" toggle (manufacturer_org_hidden).
   *  Only meaningful for a dealer browsing the shared catalog — Super
   *  Admin manages the source list itself, not a per-org subset of it. */
  showSelection?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [manufacturers, setManufacturers] = useState(initialManufacturers);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newManufacturerName, setNewManufacturerName] = useState('');
  const [editingManufacturer, setEditingManufacturer] = useState<any>(null);
  const [editName, setEditName] = useState('');
  const [mounted, setMounted] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleToggleSelected = async (m: any, checked: boolean) => {
    setTogglingId(m.id);
    // Optimistic update
    setManufacturers(prev => prev.map(x => x.id === m.id ? { ...x, is_selected: checked } : x));
    try {
      const result = await setManufacturerSelected(m.id, checked);
      if (!result.success) throw new Error(result.error);
    } catch (err: any) {
      // Revert on failure
      setManufacturers(prev => prev.map(x => x.id === m.id ? { ...x, is_selected: !checked } : x));
      toast({ variant: 'destructive', title: 'Could not update selection', description: err.message });
    } finally {
      setTogglingId(null);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredManufacturers = manufacturers.filter(m => 
    m.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openEdit = (m: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingManufacturer(m);
    setEditName(m.name);
    setIsEditing(true);
  };

  const handleUpdate = async () => {
    if (!editName.trim() || !editingManufacturer) return;
    setIsSubmitting(true);
    try {
      const result = await updateManufacturer(editingManufacturer.id, { name: editName });
      if (result.success) {
        setManufacturers(prev => prev.map(m => m.id === editingManufacturer.id ? result.data : m));
        setIsEditing(false);
        toast({ title: 'Manufacturer updated' });
      } else throw new Error(result.error);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddManufacturer = async () => {
    if (!newManufacturerName.trim()) return;
    
    setIsSubmitting(true);
    try {
      const result = await addManufacturer(newManufacturerName);

      if (!result.success) {
        toast({ 
          variant: 'destructive', 
          title: 'Error adding manufacturer', 
          description: result.error 
        });
        return;
      }
      
      const newData = result.data;
      setManufacturers(prev => [...prev, newData].sort((a, b) => a.name.localeCompare(b.name)));
      setNewManufacturerName('');
      setIsAdding(false);
      toast({ title: 'Manufacturer added successfully' });
    } catch (error: any) {
      toast({ 
        variant: 'destructive', 
        title: 'System Error', 
        description: 'Failed to reach the server. Please try again.' 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Opens the confirmation dialog instead of calling window.confirm()
  // directly. A native confirm() fired synchronously from inside a Radix
  // DropdownMenuItem's onClick is a known-fragile combination — the menu's
  // own focus-trap/portal teardown can race with the dialog in some
  // browsers, so a click on "OK" sometimes never reaches the page and the
  // delete silently never runs with no visible error. A controlled
  // AlertDialog (same pattern already used for deleting a client/dealer)
  // sidesteps that interaction entirely.
  const requestDelete = (m: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(m);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setIsDeleting(true);
    try {
      const result = await deleteManufacturer(id);

      if (!result.success) {
        toast({
          variant: 'destructive',
          title: 'Error deleting manufacturer',
          description: result.error
        });
        return;
      }

      setManufacturers(prev => prev.filter(m => m.id !== id));
      toast({ title: 'Manufacturer removed' });
      setDeleteTarget(null);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'System Error',
        description: 'Failed to reach the server.'
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
          <p className="text-slate-500 mt-1">{subtitle}</p>
        </div>
        
        {!readOnly && (
          <Dialog open={isAdding} onOpenChange={setIsAdding}>
            <DialogTrigger asChild>
              <Button className="gradient-button">
                <Plus className="w-4 h-4 mr-2" />
                Add Manufacturer
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white">
              <DialogHeader>
                <DialogTitle>Add New Manufacturer</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Manufacturer Name</Label>
                  <Input
                    id="name"
                    value={newManufacturerName}
                    onChange={(e) => setNewManufacturerName(e.target.value)}
                    placeholder="e.g. Premium Cabinets Co."
                    disabled={isSubmitting}
                  />
                </div>
                <Button
                  onClick={handleAddManufacturer}
                  className="w-full gradient-button h-11"
                  disabled={isSubmitting || !newManufacturerName.trim()}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Manufacturer'
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="glass-card border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 flex items-center gap-4 bg-slate-50/50">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search manufacturers..." 
              className="pl-10 bg-white border-slate-200"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-slate-200">
              {showSelection && <TableHead className="text-slate-500 w-20">Use</TableHead>}
              <TableHead className="text-slate-500">Manufacturer</TableHead>
              <TableHead className="text-slate-500">Status</TableHead>
              <TableHead className="text-slate-500">Added Date</TableHead>
              <TableHead className="text-right text-slate-500">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredManufacturers.map((m: any) => (
              <TableRow 
                key={m.id} 
                className="border-slate-100 hover:bg-slate-50 cursor-pointer group"
                onClick={() => router.push(`${basePath}/manufacturers/${m.id}`)}
              >
                {showSelection && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={m.is_selected !== false}
                      disabled={togglingId === m.id}
                      onCheckedChange={(checked) => handleToggleSelected(m, checked)}
                      aria-label={`Use ${m.name} for quotations`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium text-slate-900">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center group-hover:bg-sky-100 transition-colors">
                      <Factory className="w-4 h-4 text-sky-600" />
                    </div>
                    <span className="group-hover:text-sky-600 transition-colors">{m.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className={cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider",
                    m.status === 'Active' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                  )}>
                    {m.status || 'Active'}
                  </span>
                </TableCell>
                <TableCell className="text-slate-500">
                  {mounted && m.created_at ? new Date(m.created_at).toLocaleDateString() : (m.created_at ? '...' : 'N/A')}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                     {readOnly ? (
                       <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-900" onClick={(e) => { e.stopPropagation(); router.push(`${basePath}/manufacturers/${m.id}`); }} aria-label="View details">
                         <Eye className="w-4 h-4" />
                       </Button>
                     ) : (
                       <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-900">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white border-slate-200 text-slate-700">
                          <DropdownMenuItem onClick={() => router.push(`${basePath}/manufacturers/${m.id}`)}>
                            <Eye className="w-4 h-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => openEdit(m, e)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit Name
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => requestDelete(m, e)} className="text-red-600 hover:text-red-700 focus:text-red-700">
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                     )}
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-sky-500 transition-colors" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredManufacturers.length === 0 && (
              <TableRow>
                <TableCell colSpan={showSelection ? 5 : 4} className="text-center py-12 text-slate-400">
                  No manufacturers found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Edit Manufacturer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Manufacturer Name</Label>
              <Input 
                id="edit-name" 
                value={editName} 
                onChange={(e) => setEditName(e.target.value)} 
                disabled={isSubmitting}
              />
            </div>
            <Button 
              onClick={handleUpdate} 
              className="w-full gradient-button h-11"
              disabled={isSubmitting || !editName.trim()}
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes this manufacturer, its spec/pricing files, and all its pricing data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
