import 'server-only';
import { toAppError, rpc } from './core';
import { loyalty } from './loyalty';

type OutboxRow = {
  id: string;
  kind: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/**
 * Delivers queued external side effects (Capillary points, VMS vouchers, push).
 * Claimed rows are locked (SKIP LOCKED) so several workers can run safely.
 * The upstream idempotency key is always the aggregate id (our transaction id),
 * so a retry after a timeout can never double-award.
 */
export async function processOutbox(opts: { limit?: number; ids?: string[] } = {}) {
  const rows = await rpc<OutboxRow[]>('outbox_claim', { p_limit: opts.limit ?? 20, p_ids: opts.ids ?? null });
  const results: { id: string; kind: string; ok: boolean; error?: string }[] = [];
  for (const row of rows ?? []) {
    try {
      const p = row.payload as Record<string, string | number | null>;
      let result: Record<string, unknown> = {};
      if (row.kind === 'loyalty.award_points') {
        const r = await loyalty().awardPoints({
          memberId: String(p.suntec_member_id),
          points: Number(p.points),
          idempotencyKey: row.aggregate_id,
          reason: String(p.reason ?? 'gamification'),
        });
        result = { external_ref: r.externalRef };
      } else if (row.kind === 'voucher.issue') {
        const r = await loyalty().issueVoucher({
          memberId: String(p.suntec_member_id),
          seriesId: String(p.series_id),
          idempotencyKey: row.aggregate_id,
        });
        result = { external_ref: r.externalRef, code: r.code, expires_at: r.expiresAt };
      } else if (row.kind === 'push.send') {
        const r = await loyalty().sendPush({
          memberId: String(p.suntec_member_id),
          title: String(p.title),
          body: String(p.body),
          deepLink: (p.deep_link as string) ?? null,
          idempotencyKey: row.aggregate_id,
        });
        result = { external_ref: r.externalRef };
      } else {
        throw new Error(`Unknown outbox kind ${row.kind}`);
      }
      await rpc('outbox_complete', { p_id: row.id, p_ok: true, p_result: result, p_error: null });
      results.push({ id: row.id, kind: row.kind, ok: true });
    } catch (e) {
      const msg = toAppError(e).message || String(e);
      await rpc('outbox_complete', { p_id: row.id, p_ok: false, p_result: {}, p_error: msg.slice(0, 500) }).catch(() => undefined);
      results.push({ id: row.id, kind: row.kind, ok: false, error: msg });
    }
  }
  return results;
}

/** Best-effort immediate delivery for the jobs created by one request. */
export async function deliverNow(aggregateIds: (string | null | undefined)[]) {
  const ids = aggregateIds.filter((x): x is string => Boolean(x));
  if (ids.length === 0) return;
  try {
    const { supabaseAdmin } = await import('../supabase/admin');
    const { data } = await supabaseAdmin().from('outbox').select('id').in('aggregate_id', ids).in('status', ['pending', 'retry']);
    if (data && data.length > 0) await processOutbox({ ids: data.map((r) => r.id as string) });
  } catch (e) {
    console.error('deliverNow failed (will be retried by the job)', e);
  }
}
