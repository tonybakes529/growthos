import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEnv } from '@/lib/env';

/**
 * Hands committed workspace events to whoever is subscribed in Zapier.
 *
 * What this does and does not claim: a delivered row means Zapier accepted the POST. It does not mean
 * a Slack message was sent or a calendar event created. Those happen inside the customer's Zap, on
 * their plan, and Growth OS has no way to observe them from here.
 *
 * Duplicates: every payload carries a stable `id` (`evt_<domain event id>`), which is what Zapier
 * deduplicates REST Hook items on, and the database refuses a second delivery row for the same
 * (subscription, event) pair. A retry therefore resends the same id rather than creating a second item.
 */

const TIMEOUT_MS = 10_000;

type Claimed = {
  delivery_id: number; organization_id: string; subscription_id: string; target_url: string;
  event_key: string; event_type: string; occurred_at: string; payload: Record<string, unknown>;
  entity_type: string | null; entity_id: string | null; attempts: number;
};

export async function deliverToZapier(limit = 50): Promise<{ queued: number; sent: number; retried: number; failed: number }> {
  const admin = createAdminClient();

  const { data: queued } = await admin.schema('app').rpc('zapier_enqueue', { p_limit: 500 });
  const { data: claimed, error } = await admin.schema('app').rpc('zapier_claim', { p_limit: limit });
  if (error) throw error;

  let sent = 0, retried = 0, failed = 0;
  for (const row of (claimed ?? []) as Claimed[]) {
    let ok = false, code = 0, message: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(row.target_url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // lets a receiver recognise the source and the exact event without parsing the body
          'x-growthos-event': row.event_type,
          'x-growthos-event-id': row.event_key,
          'x-growthos-delivery': String(row.delivery_id),
        },
        body: JSON.stringify(zapierItem(row)),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      code = res.status;
      ok = res.ok;
      if (!ok) message = (await res.text()).slice(0, 500);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    await admin.schema('app').rpc('zapier_settle', {
      p_id: row.delivery_id, p_ok: ok, p_code: code || null, p_error: message,
    });

    if (ok) sent++;
    else if (code === 410 || row.attempts >= 6) failed++;
    else retried++;
  }
  return { queued: Number(queued ?? 0), sent, retried, failed };
}

/**
 * One REST Hook item. `id` is the deduplication key. Only this workspace's own event payload goes in;
 * nothing is joined in from anywhere else.
 */
function zapierItem(row: Claimed) {
  return {
    id: row.event_key,
    event: row.event_type,
    occurred_at: row.occurred_at,
    workspace_id: row.organization_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    app_url: getEnv().NEXT_PUBLIC_APP_URL,
    ...row.payload,
  };
}
