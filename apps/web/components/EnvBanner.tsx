import { appEnv } from '@/lib/env';
import { EnvRibbon } from './EnvRibbon';

/** Environment tag on every page outside production (e.g. PORTAL-UAT), so testers never mistake it for the live service. */
export function EnvBanner() {
  const env = appEnv();
  if (env === 'production') return null;
  return <EnvRibbon env={env} />;
}
