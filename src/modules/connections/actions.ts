import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { unwrap } from '@/lib/errors';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashKey, newKey } from '@/lib/zapier-auth';
import { setupState, fetchAppAuthorizations } from '@/lib/zapier';
import { TEMPLATES, templateByKey } from './templates';

export type ConnectionView = {
  setup: { ready: boolean; missing: string[] };
  connection: {
    status: string; accountLabel: string | null; connectedAt: string | null;
    expiresAt: string | null; lastError: string | null; scopes: string[];
  } | null;
  apiKey: { prefix: string; lastUsedAt: string | null; createdAt: string } | null;
  subscriptions: { id: string; eventType: string; zapId: string | null; isActive: boolean; lastDeliveryAt: string | null; failureCount: number }[];
  /** Handed to Zapier, never confused with "the Slack message was sent". */
  recentDeliveries: { eventKey: string; status: string; attempts: number; responseCode: number | null; createdAt: string; deliveredAt: string | null }[];
  workflows: { id: string; templateKey: string; title: string; app: string; status: string; zapId: string | null; lastError: string | null }[];
  templates: typeof TEMPLATES;
};

/** Everything the Connections page shows. Secrets are not part of this and never leave the server. */
export const getConnections = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }): Promise<ConnectionView> => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'connections.read');
  const org = ctx.organizationId;

  const [conn, key, subs, deliveries, workflows] = await Promise.all([
    ctx.sb.from('zapier_connections')
      .select('status, account_label, connected_at, expires_at, last_error, scopes')
      .eq('organization_id', org).is('deleted_at', null).maybeSingle(),
    ctx.sb.from('zapier_api_keys').select('key_prefix, last_used_at, created_at')
      .eq('organization_id', org).is('revoked_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ctx.sb.from('zapier_subscriptions')
      .select('id, event_type, zap_id, is_active, last_delivery_at, failure_count')
      .eq('organization_id', org).is('deleted_at', null).order('created_at', { ascending: false }),
    ctx.sb.from('zapier_deliveries')
      .select('event_key, status, attempts, response_code, created_at, delivered_at')
      .eq('organization_id', org).order('created_at', { ascending: false }).limit(20),
    ctx.sb.from('zapier_workflows')
      .select('id, template_key, title, app, status, zap_id, last_error')
      .eq('organization_id', org).is('deleted_at', null).order('created_at', { ascending: false }),
  ]);

  const state = setupState();
  const c = conn.data;
  return {
    setup: state.ready ? { ready: true, missing: [] } : { ready: false, missing: state.missing },
    connection: c ? {
      status: c.status, accountLabel: c.account_label, connectedAt: c.connected_at,
      expiresAt: c.expires_at, lastError: c.last_error, scopes: c.scopes ?? [],
    } : null,
    apiKey: key.data ? { prefix: key.data.key_prefix, lastUsedAt: key.data.last_used_at, createdAt: key.data.created_at } : null,
    subscriptions: (subs.data ?? []).map((s) => ({
      id: s.id, eventType: s.event_type, zapId: s.zap_id, isActive: s.is_active,
      lastDeliveryAt: s.last_delivery_at, failureCount: s.failure_count,
    })),
    recentDeliveries: (deliveries.data ?? []).map((d) => ({
      eventKey: d.event_key, status: d.status, attempts: d.attempts,
      responseCode: d.response_code, createdAt: d.created_at, deliveredAt: d.delivered_at,
    })),
    workflows: (workflows.data ?? []).map((w) => ({
      id: w.id, templateKey: w.template_key, title: w.title, app: w.app,
      status: w.status, zapId: w.zap_id, lastError: w.last_error,
    })),
    templates: TEMPLATES,
  };
});

/**
 * Issues the key Zapier uses to reach this workspace's trigger endpoints. Shown once: only a hash is
 * kept, so it cannot be read back. Issuing again revokes the previous key.
 */
export const issueZapierKey = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'connections.manage');
  const raw = newKey();
  unwrap(await ctx.sb.schema('app').rpc('issue_zapier_key', {
    p_organization_id: ctx.organizationId,
    p_prefix: raw.slice(0, 8),
    p_hash: hashKey(raw),
    p_label: 'Zapier',
  }));
  return { key: raw, baseUrl: getEnv().NEXT_PUBLIC_APP_URL };
});

/**
 * Forgets this workspace's Zapier tokens and stops delivering.
 *
 * What it cannot do is delete Zaps that already exist in the customer's own Zapier account: those are
 * theirs. They keep existing, and will simply stop receiving events from here. The page says so.
 */
export const disconnectZapier = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'connections.manage');
  if (!getEnv().SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError('conflict', 'Disconnecting needs SUPABASE_SERVICE_ROLE_KEY in the environment.');
  }
  const admin = createAdminClient();
  const org = ctx.organizationId;

  // stop future delivery first, so nothing leaks out while the rest is tidied
  const { count } = await admin.from('zapier_subscriptions')
    .update({ is_active: false, deleted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('organization_id', org).is('deleted_at', null);
  await admin.from('zapier_deliveries').update({ status: 'dropped', last_error: 'Workspace disconnected Zapier' })
    .eq('organization_id', org).eq('status', 'pending');
  await admin.from('zapier_connection_secrets').delete().eq('organization_id', org);
  await admin.from('zapier_connections')
    .update({ status: 'disconnected', account_label: null, account_id: null, expires_at: null, last_error: null })
    .eq('organization_id', org);
  await admin.from('zapier_api_keys').update({ revoked_at: new Date().toISOString() })
    .eq('organization_id', org).is('revoked_at', null);

  return { subscriptionsStopped: count ?? 0 };
});

/**
 * Records what someone configured in the guided setup. It is deliberately NOT marked on: creating and
 * switching on the Zap happens in the customer's Zapier account through the Workflow API, which needs
 * the published integration. Until then this is a saved intention, and says so.
 */
export const saveWorkflow = action(
  z.object({
    orgSlug: zSlug,
    templateKey: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  }),
  async ({ orgSlug, templateKey, title, config }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'connections.manage');
    const template = templateByKey(templateKey);
    if (!template) throw new AppError('validation', 'Unknown template');
    if (!template.available) throw new AppError('validation', template.unavailableReason ?? 'That template is not available');

    const ready = setupState().ready;
    return unwrap(await ctx.sb.from('zapier_workflows').insert({
      organization_id: ctx.organizationId,
      template_key: template.key,
      title,
      event_type: template.eventType,
      app: template.app,
      // never 'on': nothing has been created in Zapier yet
      status: ready ? 'draft' : 'needs_setup',
      config,
      created_by: ctx.ctx.effective_user_id,
    }).select('id, status').single());
  },
);

export const removeWorkflow = action(z.object({ orgSlug: zSlug, workflowId: zId }), async ({ orgSlug, workflowId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'connections.manage');
  unwrap(await ctx.sb.from('zapier_workflows')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', workflowId).eq('organization_id', ctx.organizationId).select('id').single());
  return null;
});

/** How Zapier names the apps we offer, matched loosely because the field has been renamed across API versions. */
const APP_MATCH: Record<'slack' | 'google_calendar', RegExp> = {
  slack: /slack/i,
  google_calendar: /google.?calendar/i,
};

export type AppAuthorization = {
  app: 'slack' | 'google_calendar';
  label: string;
  /** True only when this workspace's own Zapier account was asked and answered. Never inferred. */
  confirmed: boolean;
  accountTitle: string | null;
};

/**
 * Asks the customer's Zapier account which app accounts they have authorised.
 *
 * `checked: false` with a reason is the honest answer whenever we could not ask, and the page shows
 * the apps as unconfirmed in that case. An app is never reported as authorised on the strength of the
 * Zapier account being connected: those are two different things, and the page says so.
 */
export const checkAppAuthorizations = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }): Promise<{
  checked: boolean; reason?: string; apps: AppAuthorization[];
}> => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'connections.read');
  const blank: AppAuthorization[] = [
    { app: 'slack', label: 'Slack', confirmed: false, accountTitle: null },
    { app: 'google_calendar', label: 'Google Calendar', confirmed: false, accountTitle: null },
  ];
  if (!setupState().ready) return { checked: false, reason: 'Zapier is not configured on this deployment yet.', apps: blank };
  try {
    const found = await fetchAppAuthorizations(ctx.organizationId);
    return {
      checked: true,
      apps: blank.map((a) => {
        const hit = found.find((f) => APP_MATCH[a.app].test(f.app));
        return hit ? { ...a, confirmed: true, accountTitle: hit.title } : a;
      }),
    };
  } catch (e) {
    return { checked: false, reason: e instanceof Error ? e.message : String(e), apps: blank };
  }
});

/**
 * Sends one sample event to whatever Zap of theirs is listening for this template's trigger.
 *
 * This is a real request to their Zap, so it runs on their plan and uses one task from their
 * allowance. The page says that in as many words before the button can be pressed, and the person
 * pressing it is the workspace's own admin authorising their own account.
 *
 * It is deliberately not recorded in the delivery log and carries `test: true` with a `test_` id:
 * the log is for committed business events, and a sample is not one.
 */
export const sendTestEvent = action(
  z.object({ orgSlug: zSlug, templateKey: z.string().min(1).max(100) }),
  async ({ orgSlug, templateKey }): Promise<{ status: number; targetHost: string }> => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'connections.manage');
    const template = templateByKey(templateKey);
    if (!template) throw new AppError('validation', 'Unknown template');

    const { data: sub } = await ctx.sb.from('zapier_subscriptions')
      .select('target_url').eq('organization_id', ctx.organizationId)
      .eq('event_type', template.eventType).eq('is_active', true).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!sub) {
      throw new AppError('conflict',
        'Nothing is listening yet. Build the Zap in your own Zapier account and switch it on, then '
        + 'this trigger will appear here and a test can be sent.');
    }

    const body = {
      id: `test_${randomUUID()}`,
      event: template.eventType,
      test: true,
      occurred_at: new Date().toISOString(),
      workspace_id: ctx.organizationId,
      app_url: getEnv().NEXT_PUBLIC_APP_URL,
      ...Object.fromEntries(template.eventFields.map((f) => [f, `sample ${f.replace(/_/g, ' ')}`])),
    };
    const res = await fetch(sub.target_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-growthos-event': template.eventType, 'x-growthos-test': '1' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, targetHost: new URL(sub.target_url).host };
  },
);
