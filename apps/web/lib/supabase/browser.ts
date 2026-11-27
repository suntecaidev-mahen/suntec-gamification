'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@suntec/types';
import { publicEnv } from '../env';

/** Supabase client for Client Components. Uses the publishable/anon key; RLS applies. */
export function createSupabaseBrowserClient() {
  const env = publicEnv();
  return createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
