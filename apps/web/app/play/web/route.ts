import { NextResponse, type NextRequest } from 'next/server';
import { APP_COOKIE } from '@/lib/api/guest';

/** GET /play/web — leave "app mode" (e.g. a handoff link opened in a normal browser) and play on the web. */
export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/play', req.nextUrl.origin));
  res.cookies.delete(APP_COOKIE);
  return res;
}
