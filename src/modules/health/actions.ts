import 'server-only';

import { z } from 'zod';
import { action, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSuperAdmin } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

export type HealthBreakdown = {
  id: string; score: number; band: 'healthy' | 'watch' | 'at_risk' | 'critical'; previous_score: number | null;
  components: { factor: string; raw: number | null; normalized: number; weight: number; contribution: number; why: string }[];
};

export const recalculateHealth = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'health.update');
  return unwrap(await ctx.sb.schema('app').rpc('calculate_health_score', { p_organization_id: ctx.organizationId })) as unknown as HealthBreakdown;
});

/** Latest score plus the factor-by-factor explanation and 12-point history. */
export const getHealthBreakdown = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'health.read');
  const [latest, history] = await Promise.all([
    ctx.sb.from('client_health_scores').select('id, score, band, previous_score, calculated_at, override_band, override_reason')
      .eq('organization_id', ctx.organizationId).eq('is_latest', true).maybeSingle(),
    ctx.sb.from('client_health_scores').select('score, band, calculated_at')
      .eq('organization_id', ctx.organizationId).order('calculated_at', { ascending: false }).limit(12),
  ]);
  const l = unwrap(latest);
  const components = l
    ? unwrap(await ctx.sb.from('client_health_score_components')
        .select('factor_key, raw_value, normalized_score, weight, weighted_contribution, explanation')
        .eq('health_score_id', l.id).order('weighted_contribution', { ascending: true }))
    : [];
  return { latest: l, components, history: unwrap(history).reverse() };
});

export const overrideHealthBand = action(
  z.object({ orgSlug: zSlug, band: z.enum(['healthy', 'watch', 'at_risk', 'critical']).nullable(), reason: z.string().max(500).optional() }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'health.update');
    return unwrap(await ctx.sb.from('client_health_scores').update({ override_band: i.band, override_reason: i.reason })
      .eq('organization_id', ctx.organizationId).eq('is_latest', true).select('id').single());
  },
);

export const recalculateAllHealth = action(z.object({}), async () => {
  const { sb } = await requireSuperAdmin();
  return { clients: unwrap(await sb.schema('app').rpc('calculate_all_health_scores')) as number };
});
