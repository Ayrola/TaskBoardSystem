import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

const missing = [
  !url && 'VITE_SUPABASE_URL',
  !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
].filter(Boolean);

if (missing.length) {
  throw new Error(
    `Supabase is not configured. Missing: ${missing.join(', ')}. ` +
      'Copy .env.example to .env, fill in the values, and restart the dev server.',
  );
}

export const supabaseClient = createClient(url, publishableKey);
