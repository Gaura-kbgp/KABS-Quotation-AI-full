import 'server-only';

/**
 * manufacturer-docs and training-docs are PRIVATE buckets. New uploads store
 * the storage PATH (not a URL) in the database; a signed URL is minted on
 * demand, right before a page or the backend needs to read the file.
 */
export const DOCS_BUCKET = 'manufacturer-docs';
export const TRAINING_BUCKET = 'training-docs';
export const LOGOS_BUCKET = 'company-logos'; // public: logos are not sensitive

const BROKEN = new Set(['', '#', 'local_temp', 'null', 'undefined']);

/** Accepts a plain path, a public URL, or a signed URL (legacy rows from
 *  before the bucket went private) and returns the object path, or null. */
export function extractStoragePath(urlOrPath: string | null | undefined, bucket: string): string | null {
  if (!urlOrPath || BROKEN.has(urlOrPath)) return null;
  if (!/^https?:\/\//i.test(urlOrPath)) return urlOrPath; // already a path
  for (const marker of [`/object/public/${bucket}/`, `/object/sign/${bucket}/`]) {
    const i = urlOrPath.indexOf(marker);
    if (i !== -1) return decodeURIComponent(urlOrPath.slice(i + marker.length).split('?')[0]);
  }
  return null;
}

/** Signed URL (1 hour by default) for a stored path/legacy URL, or null. */
export async function resolveFileUrl(
  supabase: any,
  bucket: string,
  urlOrPath: string | null | undefined,
  expiresIn = 3600
): Promise<string | null> {
  const path = extractStoragePath(urlOrPath, bucket);
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) {
    console.error('[resolveFileUrl]', bucket, path, error.message);
    return null;
  }
  return data.signedUrl as string;
}

/** Same as resolveFileUrl, applied to one field across a list of rows. */
export async function resolveFileUrls<T extends Record<string, any>>(
  supabase: any,
  bucket: string,
  rows: T[],
  field: keyof T,
  expiresIn = 3600
): Promise<T[]> {
  return Promise.all(
    rows.map(async (r) => ({ ...r, [field]: await resolveFileUrl(supabase, bucket, r[field] as any, expiresIn) }))
  );
}
