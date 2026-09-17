import 'server-only';
import { createHmac } from 'node:crypto';
import { createAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { matches } from './conditions';
import type { Condition, DomainEvent, Recipient } from './types';

type ActionRow = { id: string; action_type: string; config: Record<string, unknown>; position: number; delay_minutes: number };
type Ctx = { admin: AdminClient; event: DomainEvent; orgId: string };

/**
 * Drains public.domain_events (outbox pattern) and runs matching automations.
 * Safe to run concurrently: events are claimed with a conditional update.
 * Schedule via /api/cron (e.g. every minute).
 */
export async function processDomainEvents(limit = 100): Promise<{ claimed: number; runs: number; failed: number }> {
  const admin = createAdminClient();
  const { data: pending, error } = await admin.from('domain_events')
    .select('id, organization_id, event_type, entity_type, entity_id, actor_id, payload, occurred_at')
    .eq('status', 'pending').order('occurred_at').limit(limit);
  if (error) throw error;

  let runs = 0, failed = 0, claimed = 0;
  for (const row of pending ?? []) {
    const { data: claim } = await admin.from('domain_events').update({ status: 'processing' })
      .eq('id', row.id).eq('status', 'pending').select('attempts').maybeSingle();
    if (!claim) continue; // another worker took it
    claimed++;
    const event = row as unknown as DomainEvent;
    try {
      runs += event.organization_id ? await runAutomationsFor(admin, event) : 0;
      await admin.from('domain_events').update({ status: 'processed', processed_at: new Date().toISOString(), attempts: claim.attempts + 1 }).eq('id', row.id);
    } catch (e) {
      failed++;
      const attempts = claim.attempts + 1;
      await admin.from('domain_events').update({
        status: attempts >= 5 ? 'failed' : 'pending', attempts, last_error: e instanceof Error ? e.message : String(e),
      }).eq('id', row.id);
    }
  }
  runs += await processScheduledSteps(admin);
  return { claimed, runs, failed };
}

async function runAutomationsFor(admin: AdminClient, event: DomainEvent): Promise<number> {
  const orgId = event.organization_id!;
  const { data: automations } = await admin.from('automations')
    .select('id, trigger_config, run_limit_per_subject')
    .eq('organization_id', orgId).eq('trigger_type', event.event_type).eq('is_active', true).is('deleted_at', null);
  let count = 0;
  for (const a of automations ?? []) {
    if (!triggerConfigMatches(a.trigger_config as Record<string, unknown>, event)) continue;
    const { data: conds } = await admin.from('automation_conditions').select('field, operator, value, group_key').eq('automation_id', a.id);
    if (!matches((conds ?? []) as Condition[], event)) continue;

    const subjectId = (event.payload.user_id as string | undefined) ?? event.entity_id ?? null;
    if (a.run_limit_per_subject && subjectId) {
      const { count: prior } = await admin.from('automation_runs').select('id', { count: 'exact', head: true })
        .eq('automation_id', a.id).eq('subject_id', subjectId).eq('status', 'succeeded');
      if ((prior ?? 0) >= a.run_limit_per_subject) continue;
    }

    const { data: run } = await admin.from('automation_runs').insert({
      organization_id: orgId, automation_id: a.id, domain_event_id: event.id,
      subject_type: event.entity_type, subject_id: subjectId, status: 'running', started_at: new Date().toISOString(),
    }).select('id').single();
    if (!run) continue;

    const { data: actions } = await admin.from('automation_actions').select('id, action_type, config, position, delay_minutes')
      .eq('automation_id', a.id).order('position');
    let delay = 0;
    let status: 'succeeded' | 'failed' | 'waiting' = 'succeeded';
    let runError: string | null = null;
    for (const act of (actions ?? []) as ActionRow[]) {
      delay += act.delay_minutes + (act.action_type === 'wait' ? Number(act.config.minutes ?? 0) : 0);
      if (act.action_type === 'wait') continue;
      if (delay > 0) {
        await admin.from('automation_run_steps').insert({
          organization_id: orgId, automation_run_id: run.id, automation_action_id: act.id, status: 'scheduled',
          run_after: new Date(Date.now() + delay * 60_000).toISOString(),
        });
        status = 'waiting';
        continue;
      }
      try {
        const result = await execute({ admin, event, orgId }, act);
        await admin.from('automation_run_steps').insert({
          organization_id: orgId, automation_run_id: run.id, automation_action_id: act.id, status: 'succeeded', attempts: 1, result: result as Json,
        });
      } catch (e) {
        runError = e instanceof Error ? e.message : String(e);
        status = 'failed';
        await admin.from('automation_run_steps').insert({
          organization_id: orgId, automation_run_id: run.id, automation_action_id: act.id, status: 'failed', attempts: 1, error: runError,
        });
        break;
      }
    }
    await admin.from('automation_runs').update({
      status, error: runError, finished_at: status === 'waiting' ? null : new Date().toISOString(),
    }).eq('id', run.id);
    await admin.from('automations').update({ last_run_at: new Date().toISOString() }).eq('id', a.id);
    count++;
  }
  return count;
}

/** Delayed steps whose run_after has passed. */
async function processScheduledSteps(admin: AdminClient): Promise<number> {
  const { data: steps } = await admin.from('automation_run_steps')
    .select('id, organization_id, automation_run_id, automation_action_id, attempts')
    .eq('status', 'scheduled').lte('run_after', new Date().toISOString()).limit(100);
  let n = 0;
  for (const s of steps ?? []) {
    const { data: run } = await admin.from('automation_runs').select('domain_event_id').eq('id', s.automation_run_id).single();
    const { data: ev } = run?.domain_event_id
      ? await admin.from('domain_events').select('id, organization_id, event_type, entity_type, entity_id, actor_id, payload, occurred_at').eq('id', run.domain_event_id).single()
      : { data: null };
    const { data: act } = s.automation_action_id
      ? await admin.from('automation_actions').select('id, action_type, config, position, delay_minutes').eq('id', s.automation_action_id).single()
      : { data: null };
    if (!ev || !act) {
      await admin.from('automation_run_steps').update({ status: 'skipped' }).eq('id', s.id);
      continue;
    }
    try {
      const result = await execute({ admin, event: ev as unknown as DomainEvent, orgId: s.organization_id }, act as unknown as ActionRow);
      await admin.from('automation_run_steps').update({ status: 'succeeded', attempts: s.attempts + 1, result: result as Json }).eq('id', s.id);
    } catch (e) {
      await admin.from('automation_run_steps').update({ status: 'failed', attempts: s.attempts + 1, error: String(e) }).eq('id', s.id);
    }
    const { count } = await admin.from('automation_run_steps').select('id', { count: 'exact', head: true })
      .eq('automation_run_id', s.automation_run_id).eq('status', 'scheduled');
    if (!count) await admin.from('automation_runs').update({ status: 'succeeded', finished_at: new Date().toISOString() }).eq('id', s.automation_run_id).eq('status', 'waiting');
    n++;
  }
  return n;
}

function triggerConfigMatches(config: Record<string, unknown>, event: DomainEvent): boolean {
  // e.g. {"program_id": "..."} only fires for that program; keys are compared against the payload or entity id
  return Object.entries(config ?? {}).every(([k, v]) => {
    if (['inactive_days', 'overdue_hours'].includes(k)) return true; // used by scheduled checks
    const actual = k === 'entity_id' ? event.entity_id : event.payload[k];
    return actual === undefined || String(actual) === String(v);
  });
}

async function resolveRecipients({ admin, event, orgId }: Ctx, r: Recipient | undefined): Promise<string[]> {
  const subject = (event.payload.user_id as string | undefined) ?? (event.entity_type === 'user' ? event.entity_id : null);
  if (!r || r === 'subject_user') return subject ? [subject] : [];
  if (r === 'actor') return event.actor_id ? [event.actor_id] : [];
  if (typeof r === 'object') return [r.user_id];
  if (r === 'client_admins') {
    const { data } = await admin.from('organization_memberships').select('user_id, role_id').eq('organization_id', orgId).eq('status', 'active');
    const { data: role } = await admin.from('roles').select('id').eq('key', 'client_admin').is('organization_id', null).single();
    return (data ?? []).filter((m) => m.role_id === role?.id).map((m) => m.user_id);
  }
  const { data: profile } = await admin.from('client_profiles').select('account_manager_id, primary_coach_id').eq('organization_id', orgId).maybeSingle();
  if (r === 'coach') return profile?.primary_coach_id ? [profile.primary_coach_id] : [];
  if (r === 'account_manager') return profile?.account_manager_id ? [profile.account_manager_id] : [];
  const { data: staff } = await admin.from('team_assignments').select('user_id').eq('organization_id', orgId).eq('status', 'active');
  return (staff ?? []).map((s) => s.user_id);
}

const render = (tpl: unknown, event: DomainEvent) =>
  String(tpl ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), event);
    return v === undefined || v === null ? '' : String(v);
  });

async function execute(ctx: Ctx, act: ActionRow): Promise<unknown> {
  const { admin, event, orgId } = ctx;
  const c = act.config;
  switch (act.action_type) {
    case 'send_notification':
    case 'notify_coach': {
      const recipients = await resolveRecipients(ctx, (c.recipient as Recipient) ?? (act.action_type === 'notify_coach' ? 'coach' : 'subject_user'));
      if (!recipients.length) return { skipped: 'no recipients' };
      const { error } = await admin.from('notifications').insert(recipients.map((user_id) => ({
        organization_id: orgId, user_id, notification_type: `automation.${event.event_type}`,
        title: render(c.title ?? event.event_type, event), body: render(c.body, event) || null,
        link_path: (c.link_path as string) ?? null, entity_type: event.entity_type, entity_id: event.entity_id,
      })));
      if (error) throw error;
      return { notified: recipients.length };
    }
    case 'send_email': {
      const recipients = await resolveRecipients(ctx, c.recipient as Recipient);
      const { data: users } = recipients.length ? await admin.from('users').select('id, email').in('id', recipients) : { data: [] };
      const { error } = await admin.from('email_outbox').insert((users ?? []).map((u) => ({
        organization_id: orgId, template_key: String(c.template_key), to_email: u.email, to_user_id: u.id,
        variables: { ...event.payload, ...(c.variables as object) } as Json,
      })));
      if (error) throw error;
      return { queued: users?.length ?? 0 };
    }
    case 'create_task': {
      const assignees = await resolveRecipients(ctx, c.assignee as Recipient);
      const { data: task, error } = await admin.from('tasks').insert({
        organization_id: orgId, title: render(c.title, event), description: render(c.description, event) || null,
        priority: (c.priority as string) ?? 'medium', task_type: (c.task_type as string) ?? 'general',
        visibility: (c.visibility as string) ?? 'organization',
        due_at: c.due_in_days ? new Date(Date.now() + Number(c.due_in_days) * 864e5).toISOString() : null,
        related_type: event.entity_type && ['task', 'goal', 'program', 'lesson', 'opportunity', 'organization', 'user'].includes(event.entity_type) ? event.entity_type : null,
        related_id: event.entity_id,
      }).select('id').single();
      if (error) throw error;
      if (assignees.length) await admin.from('task_assignments').insert(assignees.map((user_id) => ({ organization_id: orgId, task_id: task.id, user_id })));
      return { task_id: task.id };
    }
    case 'assign_program': {
      const [user] = await resolveRecipients(ctx, (c.recipient as Recipient) ?? 'subject_user');
      if (!user) return { skipped: 'no subject user' };
      const { count } = await admin.from('lessons').select('id', { count: 'exact', head: true })
        .eq('program_id', String(c.program_id)).eq('status', 'published').is('deleted_at', null);
      const { error } = await admin.from('program_enrollments').upsert({
        organization_id: orgId, program_id: String(c.program_id), user_id: user, source: 'automation', lessons_total: count ?? 0,
      }, { onConflict: 'program_id,user_id', ignoreDuplicates: true });
      if (error) throw error;
      return { enrolled: user };
    }
    case 'unlock_lesson': {
      const [user] = await resolveRecipients(ctx, (c.recipient as Recipient) ?? 'subject_user');
      if (!user) return { skipped: 'no subject user' };
      const { error } = await admin.from('lesson_unlocks').upsert({
        organization_id: orgId, lesson_id: String(c.lesson_id), user_id: user, source: 'automation', reason: `automation: ${event.event_type}`,
      }, { onConflict: 'lesson_id,user_id' });
      if (error) throw error;
      return { unlocked: c.lesson_id };
    }
    case 'update_client_status': {
      const { error } = await admin.from('organizations').update({ status: String(c.status) }).eq('id', orgId).eq('kind', 'client');
      if (error) throw error;
      return { status: c.status };
    }
    case 'add_tag':
    case 'remove_tag': {
      const tag = String(c.tag);
      const { data: p } = await admin.from('client_profiles').select('tags').eq('organization_id', orgId).single();
      const tags = new Set(p?.tags ?? []);
      if (act.action_type === 'add_tag') tags.add(tag); else tags.delete(tag);
      const { error } = await admin.from('client_profiles').update({ tags: [...tags] }).eq('organization_id', orgId);
      if (error) throw error;
      return { tags: [...tags] };
    }
    case 'create_follow_up': {
      const opportunityId = event.entity_type === 'opportunity' ? event.entity_id : (event.payload.opportunity_id as string | undefined);
      const [assignee] = await resolveRecipients(ctx, c.assignee as Recipient);
      const { data, error } = await admin.from('follow_up_tasks').insert({
        organization_id: orgId, opportunity_id: opportunityId ?? null, channel: (c.channel as string) ?? 'call',
        due_at: new Date(Date.now() + Number(c.due_in_hours ?? 24) * 36e5).toISOString(), assigned_to: assignee ?? null,
      }).select('id').single();
      if (error) throw error;
      return { follow_up_id: data.id };
    }
    case 'trigger_webhook': {
      const { data: hook } = await admin.from('webhook_endpoints').select('id, url, secret_ref, is_active, failure_count')
        .eq('id', String(c.webhook_endpoint_id)).eq('organization_id', orgId).is('deleted_at', null).single();
      if (!hook?.is_active) return { skipped: 'endpoint inactive' };
      const body = JSON.stringify({ id: event.id, type: event.event_type, occurred_at: event.occurred_at, organization_id: orgId,
                                    entity: { type: event.entity_type, id: event.entity_id }, data: event.payload });
      const secret = hook.secret_ref ? process.env[hook.secret_ref] : undefined; // Vault-backed in production
      const ts = Math.floor(Date.now() / 1000);
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-growthos-event': event.event_type,
          ...(secret ? { 'x-growthos-signature': `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await admin.from('webhook_endpoints').update({
        last_delivery_at: new Date().toISOString(), failure_count: res.ok ? 0 : hook.failure_count + 1,
        is_active: res.ok || hook.failure_count + 1 < 20,
      }).eq('id', hook.id);
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
      return { status: res.status };
    }
    default:
      return { skipped: `unsupported action ${act.action_type}` };
  }
}

/**
 * Scheduled checks that have no single write to hang an event on:
 * overdue tasks and inactive clients. Emits events the automations consume.
 */
export async function emitScheduledEvents(): Promise<{ overdue: number; inactive: number }> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data: overdue } = await admin.from('tasks').select('id, organization_id, title, due_at')
    .lt('due_at', new Date().toISOString()).gte('due_at', since).not('status', 'in', '(done,canceled)').is('deleted_at', null).limit(1000);
  for (const t of overdue ?? []) {
    const { count } = await admin.from('domain_events').select('id', { count: 'exact', head: true }).eq('event_type', 'task.overdue').eq('entity_id', t.id);
    if (!count) await admin.from('domain_events').insert({ organization_id: t.organization_id, event_type: 'task.overdue', entity_type: 'task', entity_id: t.id, payload: { title: t.title, due_at: t.due_at } });
  }
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: stale } = await admin.from('client_profiles').select('organization_id, last_client_login_at').lt('last_client_login_at', cutoff).limit(1000);
  let inactive = 0;
  for (const p of stale ?? []) {
    const { count } = await admin.from('domain_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'client.inactive').eq('organization_id', p.organization_id).gte('occurred_at', cutoff);
    if (!count) {
      inactive++;
      await admin.from('domain_events').insert({ organization_id: p.organization_id, event_type: 'client.inactive', entity_type: 'organization', entity_id: p.organization_id, payload: { last_client_login_at: p.last_client_login_at } });
    }
  }
  return { overdue: overdue?.length ?? 0, inactive };
}
