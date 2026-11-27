import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** GET /api/v1/health — liveness probe (no auth, no DB access). */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'suntec-play-api',
    version: 'v1',
    supabase_configured: isSupabaseConfigured(),
    time: new Date().toISOString(),
  });
}
