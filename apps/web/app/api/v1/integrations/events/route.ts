import { after } from 'next/server';
import { eventsBodySchema, type InboundEvent } from '@suntec/core';
import { ok, parseJson, route, rpc, toAppError } from '@/lib/api/core';
import { requireClient } from '@/lib/api/auth';
import { processOutbox } from '@/lib/api/outbox';

/**
 * POST /api/v1/integrations/events  (scope: events:write)
 * Behavioural events from Suntec+ / Capillary / POS: transaction, mall_visit,
 * voucher_redeemed, campaign_participation, activity. Accepts one event or
 * {"events":[…]} (max 100). Idempotent on (client, external_id): re-sending is safe.
 */
export const POST = route(async (req) => {
  const client = await requireClient(req, 'events:write');
  const body = await parseJson(req, eventsBodySchema);
  const events: InboundEvent[] = 'events' in body ? body.events : [body];
  const results = [];
  for (const ev of events) {
    try {
      const r = await rpc<Record<string, unknown>>('ingest_event', {
        p_source: `client:${client.id}`,
        p_client: client.id,
        p_type: ev.type,
        p_external_id: ev.external_id,
        p_suntec_member_id: ev.member_id,
        p_occurred_at: ev.occurred_at ?? new Date().toISOString(),
        p_payload: ev.payload ?? {},
        p_profile: ev.profile ?? null,
      });
      results.push({ external_id: ev.external_id, ...r });
    } catch (e) {
      const err = toAppError(e);
      results.push({ external_id: ev.external_id, status: 'failed', error: { code: err.code, message: err.message } });
    }
  }
  after(async () => {
    await processOutbox({ limit: 20 }).catch(() => undefined);
  });
  return ok({ results }, { status: 202 });
});
