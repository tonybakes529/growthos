import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug, zDate } from '@/lib/action';
import { requireSession, requireSuperAdmin, requirePlatformStaff } from '@/lib/auth/session';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { AppError, unwrap } from '@/lib/errors';
import { getEnv } from '@/lib/env';

/** Platform: create a client workspace from an onboarding template and invite its admin. */
export const createClientOrganization = action(
  z.object({
    name: z.string().min(2).max(120),
    slug: zSlug,
    onboardingTemplateId: zId.optional(),
    adminEmail: z.string().email().optional(),
    accountManagerId: zId.optional(),
    coachId: zId.optional(),
    profile: z
      .object({
        industry: z.string().optional(),
        businessModel: z.string().optional(),
        startDate: zDate.optional(),
        renewalDate: zDate.optional(),
        contractTermMonths: z.number().int().positive().optional(),
        contractValueCents: z.number().int().nonnegative().optional(),
        mrrCents: z.number().int().nonnegative().optional(),
        currentMonthlyRevenueCents: z.number().int().nonnegative().optional(),
        revenueTargetCents: z.number().int().nonnegative().optional(),
        tags: z.array(z.string().max(40)).max(20).optional(),
        timezone: z.string().optional(),
        website: z.string().url().optional(),
      })
      .default({}),
  }),
  async (input) => {
    const { sb } = await requireSuperAdmin();
    const p = input.profile;
    const res = unwrap(
      await sb.schema('app').rpc('create_client_organization', {
        p_name: input.name,
        p_slug: input.slug,
        p_onboarding_template_id: input.onboardingTemplateId,
        p_admin_email: input.adminEmail,
        p_account_manager_id: input.accountManagerId,
        p_coach_id: input.coachId,
        p_profile: {
          industry: p.industry, business_model: p.businessModel, start_date: p.startDate, renewal_date: p.renewalDate,
          contract_term_months: p.contractTermMonths, contract_value_cents: p.contractValueCents, mrr_cents: p.mrrCents,
          current_monthly_revenue_cents: p.currentMonthlyRevenueCents, revenue_target_cents: p.revenueTargetCents,
          tags: p.tags, timezone: p.timezone, website: p.website,
        },
      }),
    ) as { organization_id: string; invitation_id: string | null; invitation_token: string | null };
    return {
      organizationId: res.organization_id,
      slug: input.slug,
      // The email worker sends this link; it is returned so the admin can copy it too.
      inviteUrl: res.invitation_token ? `${getEnv().NEXT_PUBLIC_APP_URL}/invite/${res.invitation_token}` : null,
    };
  },
);

const listSchema = z.object({
  search: z.string().max(100).optional(),
  statuses: z.array(z.enum(['onboarding', 'active', 'paused', 'suspended', 'archived'])).optional(),
  tag: z.string().optional(),
  healthBands: z.array(z.enum(['healthy', 'watch', 'at_risk', 'critical'])).optional(),
  accountManagerId: zId.optional(),
  needsAttention: z.boolean().optional(),
  renewingWithinDays: z.number().int().positive().optional(),
  sort: z.enum(['name', 'health_score', 'renewal_date', 'mrr_cents', 'last_client_login_at']).default('name'),
  ascending: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

/** Platform control plane list (super admin sees all; staff see their assignments via RLS). */
export const listClients = action(listSchema, async (f) => {
  const { sb } = await requirePlatformStaff();
  let q = sb.from('admin_client_overview_v').select('*', { count: 'exact' });
  if (f.search) q = q.or(`name.ilike.%${f.search.replace(/[%,()]/g, '')}%,slug.ilike.%${f.search.replace(/[%,()]/g, '')}%`);
  if (f.statuses?.length) q = q.in('status', f.statuses);
  if (f.tag) q = q.contains('tags', [f.tag]);
  if (f.healthBands?.length) q = q.in('health_band', f.healthBands);
  if (f.accountManagerId) q = q.eq('account_manager_id', f.accountManagerId);
  if (f.needsAttention) q = q.eq('needs_attention', true);
  if (f.renewingWithinDays) q = q.lte('days_to_renewal', f.renewingWithinDays).gte('days_to_renewal', 0);
  const res = await q.order(f.sort, { ascending: f.ascending, nullsFirst: false }).range(f.offset, f.offset + f.limit - 1);
  return { rows: unwrap(res), total: res.count ?? 0 };
});

export const getPlatformMetrics = action(z.object({}), async () => {
  const { sb } = await requireSuperAdmin();
  return unwrap(await sb.schema('app').rpc('platform_metrics'));
});

export const setClientStatus = action(
  z.object({ orgSlug: zSlug, status: z.enum(['onboarding', 'active', 'paused', 'suspended', 'archived']), reason: z.string().max(500).optional() }),
  async ({ orgSlug, status, reason }) => {
    await requireSuperAdmin();
    const ctx = await requireOrg(orgSlug);
    unwrap(await ctx.sb.schema('app').rpc('set_organization_status', { p_organization_id: ctx.organizationId, p_status: status, p_reason: reason }));
    return { status };
  },
);

/** Client admins may edit business facts; commercial fields are staff-only (enforced by a DB trigger). */
export const updateClientProfile = action(
  z.object({
    orgSlug: zSlug,
    patch: z
      .object({
        legal_name: z.string().max(200),
        industry: z.string().max(100),
        business_model: z.string().max(100),
        team_size: z.number().int().nonnegative(),
        current_monthly_revenue_cents: z.number().int().nonnegative(),
        revenue_target_cents: z.number().int().nonnegative(),
        renewal_date: zDate,
        mrr_cents: z.number().int().nonnegative(),
        contract_value_cents: z.number().int().nonnegative(),
        tags: z.array(z.string()),
      })
      .partial(),
  }),
  async ({ orgSlug, patch }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'organization.update');
    return unwrap(
      await ctx.sb.from('client_profiles').update(patch).eq('organization_id', ctx.organizationId).select().single(),
    );
  },
);

export const getMyWorkspaces = action(z.object({}), async () => {
  const { sb } = await requireSession();
  return unwrap(await sb.schema('app').rpc('get_my_workspaces'));
});

export const recordLogin = action(z.object({ orgSlug: zSlug.optional(), userAgent: z.string().max(400).optional() }), async (i) => {
  const { sb } = await requireSession();
  const orgId = i.orgSlug ? (await requireOrg(i.orgSlug)).organizationId : undefined;
  unwrap(await sb.schema('app').rpc('record_login', { p_organization_id: orgId, p_user_agent: i.userAgent }));
  return null;
});

/** Full workspace export (JSON per table). Logged in the audit trail. */
export const exportClientData = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'organization.export');
  const tables = [
    'client_profiles', 'contacts', 'offers', 'pricing_options', 'purchases', 'programs', 'program_enrollments',
    'kpi_definitions', 'kpi_entries', 'goals', 'quarterly_goals', 'tasks', 'opportunities', 'leads',
    'content_items', 'client_wins', 'client_blockers', 'coaching_sessions',
  ] as const;
  const out: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of tables) {
    const data = unwrap(await ctx.sb.from(t).select('*').eq('organization_id', ctx.organizationId).limit(50_000));
    out[t] = data ?? [];
    rows += out[t]!.length;
  }
  unwrap(await ctx.sb.schema('app').rpc('log_export', { p_organization_id: ctx.organizationId, p_scope: 'organization', p_row_count: rows }));
  if (!rows) throw new AppError('not_found', 'Nothing to export');
  return { exportedAt: new Date().toISOString(), organization: ctx.slug, tables: out };
});
