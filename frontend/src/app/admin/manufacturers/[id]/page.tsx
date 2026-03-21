import { createServerSupabase } from '@/lib/supabase-server';
import { ManufacturerDetailClient } from './manufacturer-detail-client';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, ArrowLeft, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

// Ensure the page is never cached to provide live extraction summaries
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ManufacturerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  let manufacturer = null;
  let files: any[] = [];
  let specsSummary = {
    collections: 0,
    styles: 0,
    skuCount: 0,
    totalRows: 0
  };
  let error: string | null = null;

  try {
    const supabase = createServerSupabase();
    
    // Fetch live data directly from database tables
    const [mRes, fRes, sRes] = await Promise.all([
      supabase.from('manufacturers').select('*').eq('id', id).single(),
      supabase.from('manufacturer_files').select('*').eq('manufacturer_id', id).order('created_at', { ascending: false }),
      supabase.from('manufacturer_pricing').select('collection_name, door_style, sku').eq('manufacturer_id', id)
    ]);

    if (mRes.error) throw new Error(mRes.error.message);
    
    manufacturer = mRes.data;
    files = fRes.data || [];
    
    // Calculate Summary dynamically from the live pricing table
    // Only calculate if there are actually files present to avoid showing stray/orphan data
    if (files.length > 0 && sRes.data && sRes.data.length > 0) {
      const collections = new Set(sRes.data.map(s => String(s.collection_name || "").trim()).filter(Boolean));
      const styles = new Set(sRes.data.map(s => String(s.door_style || "").trim()).filter(Boolean));
      const skus = new Set(sRes.data.map(s => String(s.sku || "").trim()).filter(Boolean));
      
      specsSummary = {
        collections: collections.size,
        styles: styles.size,
        skuCount: skus.size,
        totalRows: sRes.data.length
      };
    } else {
      // If no files exist, force the summary to zero even if stray records remain
      specsSummary = {
        collections: 0,
        styles: 0,
        skuCount: 0,
        totalRows: 0
      };
    }
  } catch (err: any) {
    console.error(`Manufacturer Detail Page Error [${id}]:`, err.message);
    error = err.message;
  }

  if (error) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-6">
        <Link href="/admin/manufacturers">
           <Button variant="ghost" className="mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Manufacturers
           </Button>
        </Link>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-bold">System Connection Error</AlertTitle>
          <AlertDescription className="mt-2 text-red-700 leading-relaxed">
            The server encountered an error while loading this manufacturer: {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!manufacturer) {
    return (
      <div className="p-20 text-center">
        <h2 className="text-2xl font-bold text-slate-900">Manufacturer not found</h2>
        <Link href="/admin/manufacturers">
           <Button variant="outline" className="mt-6">Return to List</Button>
        </Link>
      </div>
    );
  }

  return (
    <ManufacturerDetailClient 
      id={id} 
      manufacturer={manufacturer} 
      initialFiles={files} 
      initialSpecsSummary={specsSummary} 
    />
  );
}
