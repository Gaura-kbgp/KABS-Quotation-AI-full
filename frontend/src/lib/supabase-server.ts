
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client for Server Components and Server Actions.
 * Uses service role key for full database access.
 * 
 * IMPROVED: Added environment variable guards to prevent build-time crashes
 * during Next.js static analysis in production environments.
 */
export const createServerSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // For build-time static generation or CI environments, we handle missing keys gracefully
  if (!supabaseUrl || !supabaseServiceKey) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Build Warning] Supabase environment variables are missing. This is normal during the static build phase if no dynamic data is fetched.');
    }
    // Return a dummy client that won't crash the build process
    return createClient('https://placeholder-project.supabase.co', 'placeholder-key');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
};
