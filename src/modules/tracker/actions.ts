import 'server-only';

import { z } from 'zod';
import { action, zDate, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

export type TrackerRow = {
  kpi_id: string; key: string; name: string; unit: string;
  entry_method: 'manual' | 'counted' | 'calculated' | 'automated';
  goal_value: number | null; direction: string; value: number | null; status: string | null;
};
export type TrackerLead = {
  id: string; captured_on: string; name: string | null; phone: string | null; email: string | null;
  answered: boolean; qualified: boolean; booked: boolean; taken: boolean; converted: boolean;
  objection_id: string | null; cash_collected: number; revenue: number;
  follow_up_attempts: number; notes: string | null;
};
export type Tracker = {
  week_start: string; week_end: string; today: string;
  scorecard: { id: string; name: string } | null;
  student: { user_id: string; email: string; name: string } | null;
  /** One entry per day of the week, in order, each holding that day's figures. */
  days: { date: string; rows: TrackerRow[] }[];
  /** The same rows for the whole week, worked out from the week's totals rather than by adding up days. */
  week: TrackerRow[];
  leads: TrackerLead[];
  objections: { id: string; label: string; count: number }[];
};

/** Null userId means "mine", which is why a student needs no kpis.* permission to use their own tracker. */
export const getTracker = action(
  z.object({ orgSlug: zSlug, week: zDate.optional(), userId: zId.optional() }),
  async ({ orgSlug, week, userId }) => {
    const { sb } = await requireSession();
    return unwrap(await sb.schema('app').rpc('get_tracker', {
      p_slug: orgSlug, p_week: week ?? new Date().toISOString().slice(0, 10), p_user: userId ?? undefined,
    })) as unknown as Tracker | null;
  },
);

export const saveTrackerValue = action(
  z.object({ kpiId: zId, day: zDate, value: z.number().finite().nullable(), userId: zId.optional() }),
  async ({ kpiId, day, value, userId }) => {
    const { sb } = await requireSession();
    unwrap(await sb.schema('app').rpc('save_tracker_value', {
      p_kpi_id: kpiId, p_day: day, p_value: value, p_user: userId ?? undefined,
    }));
    return null;
  },
);

const zLead = z.object({
  id: zId.optional(),
  captured_on: zDate.optional(),
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().max(320).optional(),
  answered: z.boolean().default(false),
  qualified: z.boolean().default(false),
  booked: z.boolean().default(false),
  taken: z.boolean().default(false),
  converted: z.boolean().default(false),
  objection_id: zId.nullable().optional(),
  cash_collected: z.number().min(0).max(1e9).default(0),
  revenue: z.number().min(0).max(1e9).default(0),
  follow_up_attempts: z.number().int().min(0).max(1000).default(0),
  notes: z.string().trim().max(5000).optional(),
});

export const saveLead = action(
  z.object({ orgSlug: zSlug, lead: zLead, userId: zId.optional() }),
  async ({ orgSlug, lead, userId }) => {
    const ctx = await requireOrg(orgSlug);
    return unwrap(await ctx.sb.schema('app').rpc('save_lead', {
      p_org: ctx.organizationId, p_lead: lead, p_user: userId ?? undefined,
    })) as unknown as { id: string; captured_on: string };
  },
);

export const deleteLead = action(z.object({ leadId: zId }), async ({ leadId }) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('delete_lead', { p_lead_id: leadId }));
  return null;
});

/** Builds the standard sales tracker for a workspace: Ad Spend typed, the funnel counted, the ratios worked out. */
export const installStudentTracker = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'kpis.create');
  return unwrap(await ctx.sb.schema('app').rpc('install_student_tracker', {
    p_organization_id: ctx.organizationId,
  })) as unknown as { scorecard_id: string; rows: number };
});


/** How a tracker row reads: 1,234 / $1,234 / 40% / 2.5x. Long decimal tails come back from numeric maths. */
export function formatKpi(value: number | null, unit: string): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  switch (unit) {
    case 'currency': return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    case 'percent': return `${Math.round(n * 10) / 10}%`;
    case 'ratio': return `${Math.round(n * 100) / 100}x`;
    default: return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
}
