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

/** Same as getManufacturers(), but each row also carries is_selected — whether
 *  the signed-in company has this manufacturer enabled for their own
 *  Select Manufacturer / Configure Brands pickers (see manufacturer_org_hidden
 *  in lib/db.ts). Used by the manufacturer management list so it can render
 *  a toggle per row. */
export async function getManufacturersWithSelection() {
  try {
    const supabase = await scopedDb();
    const [mRes, hRes] = await Promise.all([
      supabase.from('manufacturers').select('*').order('name'),
      supabase.from('manufacturer_org_hidden').select('manufacturer_id'),
    ]);
    if (mRes.error) throw new Error(mRes.error.message);
    const hidden = new Set((hRes.data || []).map((r: any) => r.manufacturer_id));
    const manufacturers = (mRes.data || []).map((m: any) => ({ ...m, is_selected: !hidden.has(m.id) }));
    return { manufacturers, error: null as string | null };
  } catch (err: any) {
    console.error('Server-side Manufacturers Fetch Error:', err.message);
    return { manufacturers: [] as any[], error: err.message as string };
  }
}

/** Only the manufacturers the signed-in company has NOT hidden — this is
 *  what quotation flows (detect-manufacturer, review) should offer in their
 *  Select Manufacturer pickers, so a dealer who unselected a brand doesn't
 *  see it show up when starting a new quotation. */
export async function getSelectedManufacturers() {
  try {
    const supabase = await scopedDb();
    const [mRes, hRes] = await Promise.all([
      supabase.from('manufacturers').select('id, name').eq('status', 'Active').order('name'),
      supabase.from('manufacturer_org_hidden').select('manufacturer_id'),
    ]);
    if (mRes.error) throw new Error(mRes.error.message);
    const hidden = new Set((hRes.data || []).map((r: any) => r.manufacturer_id));
    const manufacturers = (mRes.data || []).filter((m: any) => !hidden.has(m.id));
    return { manufacturers, error: null as string | null };
  } catch (err: any) {
    console.error('Server-side Selected Manufacturers Fetch Error:', err.message);
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
    // NOTE: the project's own PostgREST db-max-rows setting silently caps EVERY
    // batch at 1,000 too, regardless of the page size requested via .range() —
    // so a requested page of 5000 can still come back as exactly 1000 rows even
    // when more rows exist. Stopping on "batch smaller than requested" (the old
    // condition) mistook that short-but-nonempty batch for the last page and
    // silently truncated large catalogs (e.g. 9,873 rows displaying as 1,000).
    // Only an EMPTY batch reliably means "no more rows".
    if (files.length > 0) {
      const PAGE = 1000;
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
        if (batch.length === 0) keepFetching = false;
        else offset += batch.length;
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
