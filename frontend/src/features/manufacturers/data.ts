import 'server-only';
import { scopedDb } from '@/lib/db';
import { DOCS_BUCKET, resolveFileUrls } from '@/lib/storage';

export async function getManufacturers() {
  try {
    const supabase = await scopedDb();
    const { data, error } = await supabase.from('manufacturers').select('*').order('name');
    if (error) throw new Error(error.message);
    return { manufacturers: data || [], error: null as string | null };
  } catch (err: any) {
    console.error('Server-side Manufacturers Fetch Error:', err.message);
    return { manufacturers: [] as any[], error: err.message as string };
  }
}

/** Every pricing sheet and spec book for the company (names + stored path, no signed URLs needed). */
export async function listManufacturerFiles() {
  try {
    const supabase = await scopedDb();
    const { data, error } = await supabase
      .from('manufacturer_files')
      .select('id, manufacturer_id, file_type, file_name, file_url, created_at')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return { files: (data || []) as any[], error: null as string | null };
  } catch (err: any) {
    console.error('Manufacturer Files Fetch Error:', err.message);
    return { files: [] as any[], error: err.message as string };
  }
}

export interface SpecsSummary {
  collections: number;
  styles: number;
  skuCount: number;
  totalRows: number;
  collectionBreakdown: { name: string; skuCount: number; rows: number }[];
}

const EMPTY_SUMMARY: SpecsSummary = { collections: 0, styles: 0, skuCount: 0, totalRows: 0, collectionBreakdown: [] };

export async function getManufacturerDetail(id: string) {
  let manufacturer: any = null;
  let files: any[] = [];
  let specsSummary: SpecsSummary = EMPTY_SUMMARY;
  let error: string | null = null;

  try {
    const supabase = await scopedDb();

    const [mRes, fRes] = await Promise.all([
      supabase.from('manufacturers').select('*').eq('id', id).single(),
      supabase.from('manufacturer_files').select('*').eq('manufacturer_id', id).order('created_at', { ascending: false }),
    ]);

    if (mRes.error) throw new Error(mRes.error.message);

    manufacturer = mRes.data;
    files = await resolveFileUrls(supabase, DOCS_BUCKET, fRes.data || [], 'file_url');

    // Calculate the summary live from the pricing table.
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
        if (batch.length < PAGE) keepFetching = false;
        else offset += PAGE;
      }

      if (allRows.length > 0) {
        const collections = new Set(allRows.map((s) => String(s.collection_name || '').trim()).filter(Boolean));
        const styles = new Set(allRows.map((s) => String(s.door_style || '').trim()).filter(Boolean));
        const skus = new Set(allRows.map((s) => String(s.sku || '').trim()).filter(Boolean));

        const colMap = new Map<string, { skuSet: Set<string>; rows: number }>();
        for (const row of allRows) {
          const col = String(row.collection_name || '').trim();
          if (!col) continue;
          if (!colMap.has(col)) colMap.set(col, { skuSet: new Set(), rows: 0 });
          const entry = colMap.get(col)!;
          const sku = String(row.sku || '').trim();
          if (sku) entry.skuSet.add(sku);
          entry.rows++;
        }
        const collectionBreakdown = Array.from(colMap.entries())
          .map(([name, { skuSet, rows }]) => ({ name, skuCount: skuSet.size, rows }))
          .sort((a, b) => b.skuCount - a.skuCount);

        specsSummary = { collections: collections.size, styles: styles.size, skuCount: skus.size, totalRows: allRows.length, collectionBreakdown };
      }
    }
  } catch (err: any) {
    console.error(`Manufacturer Detail Fetch Error [${id}]:`, err.message);
    error = err.message;
  }

  return { manufacturer, files, specsSummary, error };
}
