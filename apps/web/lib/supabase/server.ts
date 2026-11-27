import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@suntec/types';
import { publicEnv } from '../env';

/**
 * Supabase client bound to the current user's session cookie (Server Components,
 * Route Handlers, Server Actions). RLS applies as the signed-in user.
 */
export async function createSupabaseServerClient() {
  const env = publicEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy refreshes sessions.
        }
      },
    },
  });
}

/**
 * The signed-in user for this request, verified and cached (layout, page and helpers share one
 * lookup). Uses getClaims(): with Supabase asymmetric JWT signing keys the token is verified
 * locally (no network round trip); with legacy HS256 keys it falls back to one Auth call.
 */
export const getVerifiedUser = cache(async (): Promise<{ id: string; email: string | null } | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
});
