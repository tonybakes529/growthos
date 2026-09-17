import 'server-only';

import { z } from 'zod';
import { action, zDate, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { unwrap } from '@/lib/errors';
import { toCsv } from './csv';

const zRange = z.object({ orgSlug: zSlug, from: zDate, to: zDate });

/** Monthly funnel + unit economics (leads → appointments → shows → closes → cash, CPL, CAC, ROAS). */
export const getGrowthMetrics = action(zRange, async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'reports.read');
  return unwrap(await ctx.sb.from('org_growth_metrics_monthly_v').select('*')
    .eq('organization_id', ctx.organizationId).gte('month', i.from).lte('month', i.to).order('month'));
});

export const getSalesByRep = action(zRange, async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sales.read');
  return unwrap(await ctx.sb.from('sales_by_rep_monthly_v').select('*')
    .eq('organization_id', ctx.organizationId).gte('month', i.from).lte('month', i.to));
});

export const getSalesByOffer = action(zRange, async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'billing.read');
  return unwrap(await ctx.sb.from('sales_by_offer_monthly_v').select('*')
    .eq('organization_id', ctx.organizationId).gte('month', i.from).lte('month', i.to));
});

export const getProgramCompletion = action(z.object({ orgSlug: zSlug }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'enrollments.read');
  return unwrap(await ctx.sb.from('program_completion_v').select('*').eq('organization_id', ctx.organizationId));
});

export const getContentPerformance = action(zRange, async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'content.read');
  return unwrap(await ctx.sb.from('content_performance_v').select('*')
    .eq('organization_id', ctx.organizationId).gte('published_at', i.from).lte('published_at', `${i.to}T23:59:59Z`)
    .order('views', { ascending: false, nullsFirst: false }));
});

export const getTeamPerformance = action(z.object({ orgSlug: zSlug }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'reports.read');
  return unwrap(await ctx.sb.from('team_performance_v').select('*').eq('organization_id', ctx.organizationId));
});

const REPORTS = {
  growth_metrics: { view: 'org_growth_metrics_monthly_v', dateCol: 'month', permission: 'reports.export' },
  sales_by_rep: { view: 'sales_by_rep_monthly_v', dateCol: 'month', permission: 'sales.export' },
  sales_by_offer: { view: 'sales_by_offer_monthly_v', dateCol: 'month', permission: 'billing.export' },
  kpi_entries: { view: 'kpi_entry_status_v', dateCol: 'period_start', permission: 'kpis.export' },
  content_performance: { view: 'content_performance_v', dateCol: 'published_at', permission: 'reports.export' },
} as const;

/** CSV export of any report for a date range. Audited. */
export const exportCsv = action(zRange.extend({ report: z.enum(Object.keys(REPORTS) as [keyof typeof REPORTS]) }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  const r = REPORTS[i.report];
  assertCan(ctx, r.permission);
  const rows = unwrap(await ctx.sb.from(r.view).select('*').eq('organization_id', ctx.organizationId)
    .gte(r.dateCol, i.from).lte(r.dateCol, r.dateCol === 'published_at' ? `${i.to}T23:59:59Z` : i.to).limit(100_000)) as Record<string, unknown>[];
  unwrap(await ctx.sb.schema('app').rpc('log_export', { p_organization_id: ctx.organizationId, p_scope: r.permission.split('.')[0]!, p_row_count: rows.length }));
  return { filename: `${ctx.slug}-${i.report}-${i.from}-to-${i.to}.csv`, csv: toCsv(rows) };
});
