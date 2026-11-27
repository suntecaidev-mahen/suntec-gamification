import { z } from 'zod';

/**
 * Environment validation. Parsed lazily so that `next build` works without secrets;
 * the first request that needs a value fails fast with a clear message instead.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: 'NEXT_PUBLIC_SUPABASE_URL must be a URL' }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is missing'),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY is missing'),
  FINGERPRINT_SALT: z.string().min(16, 'FINGERPRINT_SALT must be at least 16 characters'),
  CRON_SECRET: z.string().min(16).optional(),
  LOYALTY_ADAPTER: z.enum(['mock', 'capillary']).default('mock'),
  SUNTEC_API_BASE_URL: z.string().optional(),
  SUNTEC_API_KEY: z.string().optional(),
  SUNTEC_API_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function format(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
}

let cachedPublic: PublicEnv | undefined;
let cachedServer: ServerEnv | undefined;

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;
  // NEXT_PUBLIC_* must be referenced literally so Next.js can inline them in the browser bundle.
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    throw new Error(`Invalid public environment variables:\n${format(parsed.error)}`);
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}

/** Server-only variables. Never import the result into client components. */
export function serverEnv(): ServerEnv {
  if (cachedServer) return cachedServer;
  if (typeof window !== 'undefined') throw new Error('serverEnv() called in the browser');
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment variables:\n${format(parsed.error)}`);
  }
  cachedServer = parsed.data;
  return cachedServer;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export type AppEnv = 'local' | 'uat' | 'production';

/** Which environment this deployment is (NEXT_PUBLIC_APP_ENV). Defaults to "local". */
export function appEnv(): AppEnv {
  const v = process.env.NEXT_PUBLIC_APP_ENV;
  return v === 'uat' || v === 'production' ? v : 'local';
}
