import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { AppError, unwrap, unwrapRequired } from '@/lib/errors';

/** Move a deal to another stage; won/lost stages close it. */
export const moveOpportunity = action(z.object({ orgSlug: zSlug, opportunityId: zId, stageId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sales.update');
  const stage = unwrapRequired(await ctx.sb.from('pipeline_stages').select('id, stage_type, pipeline_id')
    .eq('id', i.stageId).eq('organization_id', ctx.organizationId).maybeSingle(), 'Stage');
  const status = stage.stage_type === 'won' ? 'won' : stage.stage_type === 'lost' ? 'lost' : 'open';
  return unwrap(await ctx.sb.from('opportunities').update({
    stage_id: stage.id, status, stage_entered_at: new Date().toISOString(),
    closed_at: status === 'open' ? null : new Date().toISOString(),
  }).eq('id', i.opportunityId).eq('pipeline_id', stage.pipeline_id).select('id').single());
});

/** Quick-add: creates the contact and a deal in the pipeline's first stage. */
export const createOpportunity = action(
  z.object({
    orgSlug: zSlug,
    pipelineId: zId,
    firstName: z.string().min(1).max(80),
    lastName: z.string().max(80).optional(),
    email: z.string().email().optional(),
    title: z.string().min(1).max(160),
    valueCents: z.number().int().nonnegative().default(0),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'sales.create', 'contacts.create');
    const first = unwrap(await ctx.sb.from('pipeline_stages').select('id').eq('pipeline_id', i.pipelineId)
      .eq('organization_id', ctx.organizationId).order('position').limit(1))[0];
    if (!first) throw new AppError('validation', 'Pipeline has no stages');
    const contact = unwrap(await ctx.sb.from('contacts').insert({
      organization_id: ctx.organizationId, first_name: i.firstName, last_name: i.lastName, email: i.email,
      lifecycle_stage: 'prospect', source: 'manual',
    }).select('id').single());
    return unwrap(await ctx.sb.from('opportunities').insert({
      organization_id: ctx.organizationId, pipeline_id: i.pipelineId, stage_id: first.id,
      contact_id: contact.id, title: i.title, value_cents: i.valueCents, owner_id: ctx.ctx.effective_user_id,
    }).select('id').single());
  },
);
