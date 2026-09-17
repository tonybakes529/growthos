import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { unwrap } from '@/lib/errors';

export const listAutomations = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'automations.read');
  const [autos, actions] = await Promise.all([
    ctx.sb.from('automations').select('id, name, description, trigger_type, trigger_config, is_active, last_run_at')
      .eq('organization_id', ctx.organizationId).order('created_at'),
    ctx.sb.from('automation_actions').select('automation_id, action_type, config, position').eq('organization_id', ctx.organizationId).order('position'),
  ]);
  const acts = unwrap(actions);
  return unwrap(autos).map((a) => ({ ...a, actions: acts.filter((x) => x.automation_id === a.id) }));
});

export const setAutomationActive = action(z.object({ orgSlug: zSlug, automationId: zId, active: z.boolean() }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'automations.update');
  unwrap(await ctx.sb.from('automations').update({ is_active: i.active }).eq('id', i.automationId).eq('organization_id', ctx.organizationId).select('id').single());
  return null;
});

/**
 * One ready-made recipe rather than a builder: tell someone when a customer finishes onboarding.
 * It is an ordinary automation row, so the existing worker runs it and a future builder can edit it.
 */
export const createOnboardingAlert = action(
  z.object({ orgSlug: zSlug, programId: zId.optional(), recipient: z.enum(['client_admins', 'coach', 'account_manager', 'assigned_staff']) }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'automations.create');
    const auto = unwrap(await ctx.sb.from('automations').insert({
      organization_id: ctx.organizationId,
      name: 'Alert when a customer completes onboarding',
      description: 'Created from the Automations page',
      trigger_type: 'customer.onboarding_completed',
      trigger_config: i.programId ? { program_id: i.programId } : {},
      is_active: true,
    }).select('id').single());
    const step = await ctx.sb.from('automation_actions').insert({
      organization_id: ctx.organizationId, automation_id: auto.id, action_type: 'send_notification', position: 0,
      config: {
        recipient: i.recipient,
        title: '{{payload.email}} completed onboarding',
        body: '{{payload.program_title}}',
        link_path: '/customers',
      },
    });
    if (step.error) {
      await ctx.sb.from('automations').delete().eq('id', auto.id);   // never leave a trigger with nothing to do
      unwrap(step);
    }
    return { automationId: auto.id };
  },
);
