import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Client-side Supabase client for interactive components.
 * Strictly uses public anon key for security.
 */
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);