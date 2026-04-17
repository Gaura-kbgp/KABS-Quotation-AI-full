"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { addManufacturer, deleteManufacturer, updateManufacturer } from '../actions';

export function ManufacturersList({ initialManufacturers }: { initialManufacturers: any[] }) {
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

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this manufacturer?')) return;
    
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
    } catch (error: any) {
      toast({ 
        variant: 'destructive', 
        title: 'System Error', 
        description: 'Failed to reach the server.' 
      });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Manufacturers</h1>
          <p className="text-slate-500 mt-1">Manage cabinetry suppliers and their technical documentation.</p>
        </div>
        
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
                onClick={() => router.push(`/admin/manufacturers/${m.id}`)}
              >
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
                     <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-900">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-white border-slate-200 text-slate-700">
                        <DropdownMenuItem onClick={() => router.push(`/admin/manufacturers/${m.id}`)}>
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => openEdit(m, e)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit Name
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => handleDelete(m.id, e)} className="text-red-600 hover:text-red-700 focus:text-red-700">
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-sky-500 transition-colors" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredManufacturers.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-slate-400">
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
    </div>
  );
}
