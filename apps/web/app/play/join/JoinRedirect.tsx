'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Card } from '@suntec/ui';
import { formatClaimCode } from '@/components/play/client';
import { SUNTEC, appSignupLink } from '@/lib/brand';

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

/**
 * Phones: try to open the Suntec+ app's sign-up screen; if the app isn't installed the
 * page is still visible after a moment, so we continue to the App Store / Google Play.
 * Android uses an intent:// link, which falls back to the Play Store natively.
 * Desktop: show store links and a QR code to continue on the phone.
 */
export function JoinRedirect({ claimCode }: { claimCode: string | null }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const appLink = appSignupLink(claimCode);
  const store = platform === 'android' ? SUNTEC.links.googlePlay : SUNTEC.links.appStore;

  useEffect(() => {
    const p = detectPlatform();
    // Platform is only known in the browser; set once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(p);
    if (p === 'desktop') {
      QRCode.toDataURL(window.location.href, { margin: 1, width: 220, color: { dark: '#021F47', light: '#FFFFFF' } }).then(setQr, () => setQr(null));
      return;
    }
    const storeUrl = p === 'android' ? SUNTEC.links.googlePlay : SUNTEC.links.appStore;
    if (!appLink) {
      window.location.href = storeUrl;
      return;
    }
    if (p === 'android') {
      const u = new URL(appLink);
      const intent = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=${SUNTEC.androidPackage};S.browser_fallback_url=${encodeURIComponent(storeUrl)};end`;
      window.location.href = intent;
      return;
    }
    // iOS: try the app; if we are still here shortly after, the app isn't installed.
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') window.location.href = storeUrl;
    }, 1600);
    window.location.href = appLink;
    return () => window.clearTimeout(timer);
  }, [appLink]);

  return (
    <Card className="space-y-4 p-6 text-center">
      {platform === null || platform !== 'desktop' ? (
        <>
          <p className="text-sm text-text-muted" aria-live="polite">
            {appLink ? 'Opening the Suntec+ app…' : `Opening the ${platform === 'android' ? 'Google Play Store' : 'App Store'}…`}
          </p>
          <div className="flex flex-col gap-2">
            {appLink && (
              <a href={appLink} className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
                I have the Suntec+ app — open sign-up
              </a>
            )}
            <a href={store} className="inline-flex h-11 items-center justify-center rounded-md border border-brand-200 bg-primary-subtle px-4 text-sm font-semibold text-primary-subtle-fg hover:bg-primary-subtle-hover">
              Download the Suntec+ app
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">Scan with your phone to download the Suntec+ app:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="QR code to open this page on your phone" width={180} height={180} className="mx-auto" />}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <a href={SUNTEC.links.appStore} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center rounded-md bg-brand-navy px-4 text-sm font-semibold text-white">
              App Store
            </a>
            <a href={SUNTEC.links.googlePlay} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center rounded-md bg-brand-navy px-4 text-sm font-semibold text-white">
              Google Play
            </a>
          </div>
        </>
      )}

      {claimCode && (
        <div className="rounded-lg border border-dashed border-brand-200 bg-primary-subtle p-3 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-subtle-fg">Your claim code</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-brand-navy">{formatClaimCode(claimCode)}</p>
          <p className="mt-1 text-xs text-text-muted">
            After you join, open <strong>Play &amp; Win</strong> in the Suntec+ app → <strong>My rewards</strong> → <strong>Enter your claim code</strong>. Your winnings are saved for 30 days.
          </p>
        </div>
      )}

      <Link href="/play" className="block text-sm font-medium text-text-muted hover:underline">
        Back to Play &amp; Win
      </Link>
    </Card>
  );
}
