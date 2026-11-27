import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health — liveness probe (no auth).
 * ?db=1 also measures the server → database round trip (3 tiny queries, in ms),
 * useful to check that the app servers and the database are in the same region.
 */
export async function GET(req: NextRequest) {
  const body: Record<string, unknown> = {
    status: 'ok',
    service: 'suntec-play-api',
    version: 'v1',
    supabase_configured: isSupabaseConfigured(),
    region: process.env.VERCEL_REGION ?? null,
    time: new Date().toISOString(),
  };
  if (req.nextUrl.searchParams.get('db') === '1' && isSupabaseConfigured()) {
    const db = supabaseAdmin();
    const ms: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      await db.from('app_settings').select('timezone').limit(1);
      ms.push(Math.round(performance.now() - t));
    }
    body.db_round_trip_ms = ms;
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
