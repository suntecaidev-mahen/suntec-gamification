'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ----------------------------------------------------------------------------
 * API client for the customer UI (same-origin, session cookie).
 * ------------------------------------------------------------------------- */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem('sp_device');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('sp_device', id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string; json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Device-Id': deviceId(), ...((init.headers as Record<string, string>) ?? {}) };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError('NETWORK', 'You appear to be offline. Please check your connection and try again.', 0);
  }
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) throw new ApiError(body?.error?.code ?? 'INTERNAL', body?.error?.message ?? 'Something went wrong. Please try again.', res.status);
  return body as T;
}

/**
 * Loads `path` from the API. Pass `initial` (data the server already rendered with) to skip
 * the first request; `reload()` still fetches fresh data.
 */
export function useApi<T>(path: string | null, initial?: T | null) {
  const [data, setData] = useState<T | null>(initial ?? null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path) && !initial);
  const seq = useRef(0);
  const skipFirst = useRef(Boolean(initial));

  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e as ApiError);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    if (skipFirst.current) {
      skipFirst.current = false; // server already provided this data
      return;
    }
    const n = ++seq.current;
    api<T>(path).then(
      (d) => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (n !== seq.current) return;
        setError(e as ApiError);
        setLoading(false);
      },
    );
  }, [path]);

  return { data, error, loading, reload: load, setData };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/* ----------------------------------------------------------------------------
 * Native bridge: the Suntec+ app listens for these events in its WebView.
 *   iOS (WKWebView):   window.webkit.messageHandlers.suntecPlay.postMessage(msg)
 *   Android:           window.SuntecPlayAndroid.postMessage(JSON.stringify(msg))
 *   React Native:      window.ReactNativeWebView.postMessage(JSON.stringify(msg))
 *   Flutter:           window.SuntecPlayFlutter.postMessage(JSON.stringify(msg))
 *   Any iframe host:   window.parent.postMessage(msg, '*')
 * Events: ready, close, haptic, reward_won, share, open_url, balance_changed
 * ------------------------------------------------------------------------- */
type W = Window & {
  webkit?: { messageHandlers?: Record<string, { postMessage: (m: unknown) => void }> };
  SuntecPlayAndroid?: { postMessage: (m: string) => void };
  ReactNativeWebView?: { postMessage: (m: string) => void };
  SuntecPlayFlutter?: { postMessage: (m: string) => void };
};

export function emitBridge(type: string, data: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  const msg = { source: 'suntec-play', type, data };
  const w = window as W;
  try {
    w.webkit?.messageHandlers?.suntecPlay?.postMessage(msg);
    w.SuntecPlayAndroid?.postMessage(JSON.stringify(msg));
    w.ReactNativeWebView?.postMessage(JSON.stringify(msg));
    w.SuntecPlayFlutter?.postMessage(JSON.stringify(msg));
    if (window.parent !== window) window.parent.postMessage(msg, '*');
  } catch {
    /* host not listening — ignore */
  }
}

export function haptic(kind: 'light' | 'success' | 'warning' = 'light') {
  emitBridge('haptic', { kind });
  try {
    if (localStorage.getItem('sp_haptics') !== 'off') navigator.vibrate?.(kind === 'success' ? [30, 40, 60] : 15);
  } catch {
    /* ignore */
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ----------------------------------------------------------------------------
 * Play context. One experience at /play:
 *   mode "app" — opened from the Suntec+ app (member signed in by the app, native bridge on)
 *   mode "web" — opened from the public link (guest play, optional member sign-in)
 * ------------------------------------------------------------------------- */
export type PlayMode = 'app' | 'web';
export type Viewer = { guest: boolean; firstName: string | null; claimCode: string | null };
export const PLAY_BASE = '/play';
export const PlayContext = createContext<{ base: string; mode: PlayMode; viewer: Viewer; refreshBalance: () => void }>({
  base: PLAY_BASE,
  mode: 'web',
  viewer: { guest: true, firstName: null, claimCode: null },
  refreshBalance: () => undefined,
});
export const usePlay = () => useContext(PlayContext);

/** Maps template deep links (suntecplus://play/…) to in-module routes. */
export function deepLinkToPath(link: string | null | undefined, base: string): string {
  if (!link) return base;
  const m = link.match(/^suntecplus:\/\/play\/?(.*)$/);
  if (!m) return base;
  const [section] = (m[1] ?? '').split('/');
  return section === 'missions' || section === 'rewards' ? `${base}/${section}` : base;
}

/** "7K3MQ9XD" → "7K3M-Q9XD" (easier to read and type). */
export function formatClaimCode(code: string | null | undefined): string {
  if (!code) return '';
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
