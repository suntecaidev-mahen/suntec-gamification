import 'server-only';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { AppError, isErrorCode, statusForCode, type ErrorCode } from '@suntec/core';
import { supabaseAdmin } from '../supabase/admin';
import { isSupabaseConfigured, serverEnv } from '../env';

/* ----------------------------------------------------------------------------
 * Responses & errors — every endpoint returns either data or
 *   { "error": { "code": "NO_ATTEMPTS", "message": "…", "request_id": "…" } }
 * ------------------------------------------------------------------------- */
export function ok(data: unknown, init?: ResponseInit & { headers?: Record<string, string> }) {
  return NextResponse.json(data, init);
}

type PgLikeError = { code?: string; message?: string; hint?: string | null; details?: string | null };

/** Converts anything thrown (Zod, Postgres/PostgREST, AppError) into an AppError. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ZodError) {
    return new AppError('VALIDATION_FAILED', 'Request validation failed', e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const pg = e as PgLikeError;
  if (pg && typeof pg === 'object' && typeof pg.message === 'string') {
    if (pg.hint && isErrorCode(pg.hint)) return new AppError(pg.hint, pg.message);
    if (pg.code === '42501') return new AppError('FORBIDDEN', 'Permission denied');
    if (pg.code === '23505') return new AppError('INVALID', 'Duplicate request');
  }
  return new AppError('INTERNAL', 'Something went wrong. Please try again.');
}

export function errorResponse(e: unknown, requestId: string) {
  const err = toAppError(e);
  if (err.status >= 500) console.error(`[${requestId}]`, e);
  return NextResponse.json(
    { error: { code: err.code, message: err.message, details: err.details, request_id: requestId } },
    { status: err.status, headers: { 'X-Request-Id': requestId } },
  );
}

export function fail(code: ErrorCode, message: string, details?: unknown): never {
  throw new AppError(code, message, details);
}

export async function parseJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      fail('INVALID', 'Body must be valid JSON');
    }
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

/* ----------------------------------------------------------------------------
 * Engine RPC (service role). Errors raised in SQL carry their code in HINT.
 * ------------------------------------------------------------------------- */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

/* ----------------------------------------------------------------------------
 * Hashing — IPs, device ids, API keys and handoff codes are never stored raw.
 * ------------------------------------------------------------------------- */
export function fingerprint(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHmac('sha256', serverEnv().FINGERPRINT_SALT).update(value).digest('hex').slice(0, 40);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function clientIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
}

/* ----------------------------------------------------------------------------
 * Rate limiting (Postgres fixed window)
 * ------------------------------------------------------------------------- */
export async function enforceRateLimit(key: string, limit: number, windowSeconds = 60) {
  const r = await rpc<{ allowed: boolean; remaining: number; reset_at: string }>('rate_limit_hit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (!r.allowed) fail('RATE_LIMITED', 'Too many requests. Please slow down.', { reset_at: r.reset_at });
  return r;
}

/* ----------------------------------------------------------------------------
 * Route wrapper: request id, configuration guard, uniform error envelope.
 * ------------------------------------------------------------------------- */
export type RouteParams = Record<string, string>;
export type RouteContext<P extends RouteParams> = { params: Promise<P> };

export function route<P extends RouteParams = RouteParams>(
  handler: (req: NextRequest, params: P, requestId: string) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>) => {
    const requestId = req.headers.get('x-request-id')?.slice(0, 64) || randomUUID();
    try {
      if (!isSupabaseConfigured()) fail('NOT_CONFIGURED', 'The server is not configured yet (see SETUP.md).');
      const res = await handler(req, (await ctx.params) ?? ({} as P), requestId);
      res.headers.set('X-Request-Id', requestId);
      return res;
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}
