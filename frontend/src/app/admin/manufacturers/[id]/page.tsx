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
  let specsSummary: {
    collections: number;
    styles: number;
    skuCount: number;
    totalRows: number;
    collectionBreakdown: { name: string; skuCount: number; rows: number }[];
  } = {
    collections: 0,
    styles: 0,
    skuCount: 0,
    totalRows: 0,
    collectionBreakdown: [],
  };
  let error: string | null = null;

  try {
    const supabase = createServerSupabase();
    
    // Fetch live data directly from database tables
    const [mRes, fRes] = await Promise.all([
      supabase.from('manufacturers').select('*').eq('id', id).single(),
      supabase.from('manufacturer_files').select('*').eq('manufacturer_id', id).order('created_at', { ascending: false }),
    ]);

    if (mRes.error) throw new Error(mRes.error.message);

    manufacturer = mRes.data;
    files = fRes.data || [];

    // Calculate Summary dynamically from the live pricing table.
    // Supabase PostgREST caps unranged queries at 1,000 rows — paginate to get all.
    if (files.length > 0) {
      const PAGE = 5000;
      let allRows: { collection_name: string; door_style: string; sku: string }[] = [];
      let offset = 0;
      let keepFetching = true;

      while (keepFetching) {
        const { data, error: sErr } = await supabase
          .from('manufacturer_pricing')
          .select('collection_name, door_style, sku')
          .eq('manufacturer_id', id)
          .range(offset, offset + PAGE - 1);
        if (sErr) break;
        const batch = data || [];
        allRows = allRows.concat(batch);
        if (batch.length < PAGE) {
          keepFetching = false;
        } else {
          offset += PAGE;
        }
      }

      if (allRows.length > 0) {
        const collections = new Set(allRows.map(s => String(s.collection_name || "").trim()).filter(Boolean));
        const styles = new Set(allRows.map(s => String(s.door_style || "").trim()).filter(Boolean));
        const skus = new Set(allRows.map(s => String(s.sku || "").trim()).filter(Boolean));

        const colMap = new Map<string, { skuSet: Set<string>; rows: number }>();
        for (const row of allRows) {
          const col = String(row.collection_name || "").trim();
          if (!col) continue;
          if (!colMap.has(col)) colMap.set(col, { skuSet: new Set(), rows: 0 });
          const entry = colMap.get(col)!;
          const sku = String(row.sku || "").trim();
          if (sku) entry.skuSet.add(sku);
          entry.rows++;
        }
        const collectionBreakdown = Array.from(colMap.entries())
          .map(([name, { skuSet, rows }]) => ({ name, skuCount: skuSet.size, rows }))
          .sort((a, b) => b.skuCount - a.skuCount);

        specsSummary = {
          collections: collections.size,
          styles: styles.size,
          skuCount: skus.size,
          totalRows: allRows.length,
          collectionBreakdown,
        };
      } else {
        specsSummary = { collections: 0, styles: 0, skuCount: 0, totalRows: 0, collectionBreakdown: [] };
      }
    } else {
      // No files — force summary to zero even if stray records remain
      specsSummary = { collections: 0, styles: 0, skuCount: 0, totalRows: 0, collectionBreakdown: [] };
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
