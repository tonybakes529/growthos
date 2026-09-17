import 'server-only';

import { z } from 'zod';
import { action, zDate, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

export const listGoals = action(z.object({ orgSlug: zSlug, year: z.number().int().optional(), quarter: z.number().int().min(1).max(4).optional() }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'goals.read');
  let qg = ctx.sb.from('quarterly_goals').select('*').eq('organization_id', ctx.organizationId).is('deleted_at', null);
  if (i.year) qg = qg.eq('year', i.year);
  if (i.quarter) qg = qg.eq('quarter', i.quarter);
  const [goals, quarterly, projects] = await Promise.all([
    ctx.sb.from('goals').select('*').eq('organization_id', ctx.organizationId).is('deleted_at', null).order('created_at'),
    qg.order('year').order('quarter'),
    ctx.sb.from('growth_projects').select('id, title, status, priority, goal_id, quarterly_goal_id, progress_percent, due_on')
      .eq('organization_id', ctx.organizationId).is('deleted_at', null),
  ]);
  const q = unwrap(quarterly);
  const p = unwrap(projects);
  return unwrap(goals).map((g) => ({
    ...g,
    quarterly: q.filter((x) => x.goal_id === g.id),
    projects: p.filter((x) => x.goal_id === g.id),
  }));
});

export const createGoal = action(
  z.object({
    orgSlug: zSlug,
    title: z.string().min(2).max(200),
    description: z.string().max(5000).optional(),
    level: z.enum(['company', 'team', 'individual']).default('company'),
    timeframe: z.enum(['annual', 'multi_year', 'custom']).default('annual'),
    startsOn: zDate.optional(),
    endsOn: zDate.optional(),
    targetValue: z.number().optional(),
    unit: z.string().max(20).optional(),
    kpiId: zId.optional(),
    ownerId: zId.optional(),
    parentGoalId: zId.optional(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'goals.create');
    return unwrap(await ctx.sb.from('goals').insert({
      organization_id: ctx.organizationId, title: i.title, description: i.description, level: i.level, timeframe: i.timeframe,
      starts_on: i.startsOn, ends_on: i.endsOn, target_value: i.targetValue, unit: i.unit, kpi_definition_id: i.kpiId,
      owner_id: i.ownerId ?? ctx.ctx.effective_user_id, parent_goal_id: i.parentGoalId,
    }).select('id').single());
  },
);

export const createQuarterlyGoal = action(
  z.object({
    orgSlug: zSlug,
    goalId: zId.optional(),
    year: z.number().int().min(2000).max(2100),
    quarter: z.number().int().min(1).max(4),
    title: z.string().min(2).max(200),
    description: z.string().max(5000).optional(),
    kpiId: zId.optional(),
    targetValue: z.number().optional(),
    ownerId: zId.optional(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'goals.create');
    return unwrap(await ctx.sb.from('quarterly_goals').insert({
      organization_id: ctx.organizationId, goal_id: i.goalId, year: i.year, quarter: i.quarter, title: i.title,
      description: i.description, kpi_definition_id: i.kpiId, target_value: i.targetValue, owner_id: i.ownerId,
    }).select('id').single());
  },
);

/** One target per KPI per month (upsert). */
export const setMonthlyTarget = action(
  z.object({
    orgSlug: zSlug,
    kpiId: zId,
    month: z.string().regex(/^\d{4}-\d{2}$/),
    targetValue: z.number(),
    stretchValue: z.number().optional(),
    quarterlyGoalId: zId.optional(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'goals.update');
    return unwrap(await ctx.sb.from('monthly_targets').upsert({
      organization_id: ctx.organizationId, kpi_definition_id: i.kpiId, month_start: `${i.month}-01`,
      target_value: i.targetValue, stretch_value: i.stretchValue, quarterly_goal_id: i.quarterlyGoalId,
    }, { onConflict: 'kpi_definition_id,month_start' }).select('id').single());
  },
);

export const updateGoalProgress = action(
  z.object({ goalId: zId, currentValue: z.number(), status: z.enum(['not_started', 'on_track', 'at_risk', 'off_track', 'achieved', 'abandoned']).optional() }),
  async (i) => {
    const { sb } = await requireSession();
    unwrap(await sb.schema('app').rpc('update_goal_progress', { p_goal_id: i.goalId, p_current_value: i.currentValue, p_status: i.status }));
    return null;
  },
);
