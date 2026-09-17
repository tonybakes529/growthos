import 'server-only';

import { z } from 'zod';
import { action, zDate, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

const kpiFields = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  category: z.enum(['revenue', 'sales', 'marketing', 'content', 'fulfillment', 'team', 'finance', 'engagement', 'general']),
  unit: z.enum(['count', 'currency', 'percent', 'ratio', 'duration', 'number']),
  currency: z.string().length(3).optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly']),
  aggregation: z.enum(['sum', 'average', 'last', 'max', 'min']).default('sum'),
  direction: z.enum(['higher_is_better', 'lower_is_better']).default('higher_is_better'),
  goalValue: z.number().optional(),
  onTrackPct: z.number().min(0).max(100).default(90),
  offTrackPct: z.number().min(0).max(100).default(75),
  dataSource: z.string().max(60).default('manual'),
  entryMethod: z.enum(['manual', 'automated', 'calculated']).default('manual'),
  formula: z.object({ op: z.enum(['divide', 'multiply', 'subtract', 'add']), numerator: z.string(), denominator: z.string(), multiply: z.number().optional() }).optional(),
  ownerId: zId.optional(),
  isFinancial: z.boolean().default(false),
});

const toRow = (k: Partial<z.infer<typeof kpiFields>>) => ({
  key: k.key, name: k.name, description: k.description, category: k.category, unit: k.unit, currency: k.currency,
  frequency: k.frequency, aggregation: k.aggregation, direction: k.direction, goal_value: k.goalValue,
  at_risk_threshold_pct: k.onTrackPct, off_track_threshold_pct: k.offTrackPct, data_source: k.dataSource,
  entry_method: k.entryMethod, formula: k.formula, owner_id: k.ownerId, is_financial: k.isFinancial,
});

export const listKpis = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  const [defs, latest] = await Promise.all([
    ctx.sb.from('kpi_definitions').select('*').eq('organization_id', ctx.organizationId).is('deleted_at', null).order('position'),
    ctx.sb.from('kpi_latest_v').select('kpi_definition_id, period_start, value, target_value, previous_value, change_percent, status')
      .eq('organization_id', ctx.organizationId),
  ]);
  const latestById = new Map(unwrap(latest).map((l) => [l.kpi_definition_id, l]));
  return unwrap(defs).map((d) => ({ ...d, latest: latestById.get(d.id) ?? null }));
});

export const createKpiDefinition = action(kpiFields.extend({ orgSlug: zSlug }), async ({ orgSlug, ...k }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'kpis.create', 'kpis.update');
  if (k.isFinancial) assertCan(ctx, 'financials.read');
  const row = toRow(k);
  return unwrap(await ctx.sb.from('kpi_definitions').insert({
    ...row, key: k.key, name: k.name, organization_id: ctx.organizationId,
  }).select('id').single());
});

export const updateKpiDefinition = action(
  kpiFields.partial().extend({ orgSlug: zSlug, kpiId: zId, isActive: z.boolean().optional() }),
  async ({ orgSlug, kpiId, isActive, ...k }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'kpis.update');
    // undefined fields are dropped by JSON serialization, so a partial row is a valid patch
    const patch = { ...toRow(k), is_active: isActive };
    return unwrap(await ctx.sb.from('kpi_definitions').update(patch).eq('id', kpiId).eq('organization_id', ctx.organizationId).select('id').single());
  },
);

export const upsertKpiEntry = action(
  z.object({ kpiId: zId, date: zDate, value: z.number().finite(), note: z.string().max(1000).optional() }),
  async (i) => {
    const { sb } = await requireSession();
    return unwrap(await sb.schema('app').rpc('upsert_kpi_entry', {
      p_kpi_definition_id: i.kpiId, p_date: i.date, p_value: i.value, p_note: i.note,
    })) as { entry_id: string; period_start: string; value: number; target: number | null; previous_value: number | null; change_percent: number | null; status: string };
  },
);

/** Load a scorecard for a given week: KPIs, this week's values, and status. */
export const getWeeklyScorecard = action(z.object({ orgSlug: zSlug, scorecardId: zId, weekOf: zDate }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'kpis.read');
  const monday = new Date(`${i.weekOf}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);
  const [card, links, week, entries] = await Promise.all([
    ctx.sb.from('scorecards').select('id, name, description, due_weekday').eq('id', i.scorecardId).single(),
    ctx.sb.from('scorecard_kpis').select('kpi_definition_id, position, is_required').eq('scorecard_id', i.scorecardId).order('position'),
    ctx.sb.from('weekly_scorecards').select('*').eq('scorecard_id', i.scorecardId).eq('period_start', weekStart).maybeSingle(),
    ctx.sb.from('kpi_entry_status_v').select('kpi_definition_id, value, target_value, previous_value, change_percent, status').eq('period_start', weekStart),
  ]);
  const kpiIds = unwrap(links).map((l) => l.kpi_definition_id);
  // RLS drops financial KPIs for users without financials.read
  const defs = kpiIds.length ? unwrap(await ctx.sb.from('kpi_definitions').select('id, key, name, unit, direction, goal_value, is_financial, entry_method').in('id', kpiIds)) : [];
  const entryById = new Map(unwrap(entries).map((e) => [e.kpi_definition_id, e]));
  return {
    scorecard: unwrap(card),
    weekStart,
    submission: unwrap(week),
    rows: unwrap(links).flatMap((l) => {
      const def = defs.find((d) => d.id === l.kpi_definition_id);
      return def ? [{ ...def, isRequired: l.is_required, entry: entryById.get(def.id) ?? null }] : [];
    }),
  };
});

export const submitWeeklyScorecard = action(
  z.object({
    scorecardId: zId,
    weekOf: zDate,
    values: z.record(zId, z.number().finite()),
    summary: z.string().max(5000).optional(),
    wins: z.array(z.string().min(1).max(300)).max(20).default([]),
    blockers: z.array(z.string().min(1).max(300)).max(20).default([]),
  }),
  async (i) => {
    const { sb } = await requireSession();
    const id = unwrap(await sb.schema('app').rpc('submit_weekly_scorecard', {
      p_scorecard_id: i.scorecardId, p_week_of: i.weekOf, p_values: i.values, p_summary: i.summary, p_wins: i.wins, p_blockers: i.blockers,
    }));
    return { weeklyScorecardId: id as string };
  },
);

export const getKpiTrend = action(
  z.object({ kpiId: zId, from: zDate, to: zDate, granularity: z.enum(['week', 'month', 'quarter', 'year']).default('week') }),
  async (i) => {
    const { sb } = await requireSession();
    return unwrap(await sb.schema('app').rpc('kpi_trend', { p_kpi_definition_id: i.kpiId, p_from: i.from, p_to: i.to, p_granularity: i.granularity }));
  },
);

/** Any date range vs the immediately preceding range of the same length. */
export const getKpiComparison = action(z.object({ orgSlug: zSlug, from: zDate, to: zDate }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  return unwrap(await ctx.sb.schema('app').rpc('kpi_period_comparison', { p_organization_id: ctx.organizationId, p_from: i.from, p_to: i.to }));
});
