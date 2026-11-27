import { ok, route, rpc } from '@/lib/api/core';
import { requireCron } from '@/lib/api/auth';
import { processOutbox } from '@/lib/api/outbox';
import { serverEnv } from '@/lib/env';

/**
 * GET|POST /api/v1/jobs/tick — scheduled maintenance (run every 1–5 minutes by
 * Vercel Cron, Supabase pg_cron + pg_net, or any scheduler) with
 * `Authorization: Bearer $CRON_SECRET`:
 *   expire sessions & rewards, expiry reminders, campaign/game schedule transitions,
 *   leaderboard period close + prizes, outbox delivery (Capillary, VMS, push), purges.
 */
const handler = route(async (req) => {
  requireCron(req, serverEnv().CRON_SECRET);
  const maintenance = await rpc<Record<string, unknown>>('maintenance_tick');
  const guests = await rpc<Record<string, unknown>>('guest_maintenance');
  const delivered = await processOutbox({ limit: 100 });
  return ok({
    maintenance: { ...maintenance, ...guests },
    outbox: { processed: delivered.length, failed: delivered.filter((d) => !d.ok).length },
  });
});

export const GET = handler;
export const POST = handler;
