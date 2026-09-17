import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requirePlatformStaff, requireSuperAdmin } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';
import type { Json } from '@/lib/supabase/database.types';
import { TEMPLATE_TYPES } from './constants';

const zTemplateType = z.enum(TEMPLATE_TYPES);

/** Everything in the template library, grouped by type. */
export const listTemplates = action(z.object({}), async () => {
  const { sb } = await requirePlatformStaff();
  const cols = 'id, name, description, category, is_active, created_at';
  const [program, lesson, scorecard, dashboard, task, sop, offer, pipeline, onboarding] = await Promise.all([
    sb.from('program_templates').select(cols),
    sb.from('lesson_templates').select(cols),
    sb.from('scorecard_templates').select(cols),
    sb.from('dashboard_templates').select(cols),
    sb.from('task_templates').select(cols),
    sb.from('sop_templates').select(cols),
    sb.from('offer_templates').select(cols),
    sb.from('pipeline_templates').select(cols),
    sb.from('onboarding_templates').select('id, name, description, is_default, is_active, questionnaire_id'),
  ]);
  return {
    program: unwrap(program), lesson: unwrap(lesson), scorecard: unwrap(scorecard), dashboard: unwrap(dashboard),
    task: unwrap(task), sop: unwrap(sop), offer: unwrap(offer), pipeline: unwrap(pipeline), onboarding: unwrap(onboarding),
  };
});

export const applyTemplate = action(
  z.object({
    orgSlug: zSlug,
    templateType: zTemplateType,
    templateId: zId,
    options: z.object({ module_id: zId.optional() }).passthrough().default({}),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'templates.apply');
    const rootId = unwrap(
      await ctx.sb.schema('app').rpc('apply_template', {
        p_template_type: i.templateType, p_template_id: i.templateId, p_organization_id: ctx.organizationId, p_options: i.options as Json,
      }),
    );
    return { rootId: rootId as string };
  },
);

/** Push one or more templates into several client workspaces at once. */
export const applyTemplatesBulk = action(
  z.object({
    items: z.array(z.object({ type: zTemplateType, id: zId, options: z.record(z.unknown()).optional() })).min(1).max(20),
    organizationIds: z.array(zId).min(1).max(200),
  }),
  async (i) => {
    const { sb } = await requireSuperAdmin();
    const applied = unwrap(
      await sb.schema('app').rpc('apply_templates_bulk', { p_items: i.items as never, p_organization_ids: i.organizationIds }),
    );
    return { applied: applied as number };
  },
);

/** Promote an existing library row into a registry entry (super admin). */
export const registerTemplate = action(
  z.object({
    templateType: z.enum(['program', 'lesson', 'scorecard', 'dashboard', 'sop', 'offer', 'pipeline']),
    sourceId: zId,
    name: z.string().min(2).max(120),
    description: z.string().max(500).optional(),
    category: z.string().max(60).optional(),
  }),
  async (i) => {
    const { sb } = await requireSuperAdmin();
    const base = { name: i.name, description: i.description, category: i.category };
    // The DB trigger rejects sources outside the template_library organization.
    switch (i.templateType) {
      case 'program': return unwrap(await sb.from('program_templates').insert({ ...base, source_program_id: i.sourceId }).select('id').single());
      case 'lesson': return unwrap(await sb.from('lesson_templates').insert({ ...base, source_lesson_id: i.sourceId }).select('id').single());
      case 'scorecard': return unwrap(await sb.from('scorecard_templates').insert({ ...base, source_scorecard_id: i.sourceId }).select('id').single());
      case 'dashboard': return unwrap(await sb.from('dashboard_templates').insert({ ...base, source_dashboard_id: i.sourceId }).select('id').single());
      case 'sop': return unwrap(await sb.from('sop_templates').insert({ ...base, source_sop_id: i.sourceId }).select('id').single());
      case 'offer': return unwrap(await sb.from('offer_templates').insert({ ...base, source_offer_id: i.sourceId }).select('id').single());
      case 'pipeline': return unwrap(await sb.from('pipeline_templates').insert({ ...base, source_pipeline_id: i.sourceId }).select('id').single());
    }
  },
);
