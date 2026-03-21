declare namespace NodeJS {
  export interface ProcessEnv {
    // === Genkit & AI ===
    GEMINI_API_KEY: string;
    GOOGLE_GENAI_API_KEY: string;

    // === Supabase ===
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY: string;

    // === Environment ===
    NODE_ENV: 'development' | 'production' | 'test';
  }
}
