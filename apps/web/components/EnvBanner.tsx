import { appEnv } from '@/lib/env';

/** Thin ribbon on every page outside production, so testers never mistake UAT for the live service. */
export function EnvBanner() {
  const env = appEnv();
  if (env === 'production') return null;
  return (
    <div role="note" className="border-b border-warning/30 bg-warning-subtle px-4 py-1 text-center text-xs font-semibold text-warning">
      {env === 'uat' ? 'UAT · Test environment — rewards and points are not real' : 'Local development'}
    </div>
  );
}
