import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@suntec/types';
import { serverEnv } from '../env';

let client: SupabaseClient<Database> | undefined;

/**
 * Service-role client. BYPASSES RLS — server-only, used exclusively by the API layer
 * to call engine RPCs on behalf of an already-authenticated caller.
 */
export function supabaseAdmin(): SupabaseClient<Database> {
  if (client) return client;
  const env = serverEnv();
  client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-client-info': 'suntec-play-server' } },
  });
  return client;
}
