import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg } from '@/lib/auth/context';
import { requirePlatformStaff, requireSuperAdmin } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

export const assignTeamMember = action(
  z.object({
    orgSlug: zSlug,
    userId: zId,
    roleKey: z.enum(['account_manager', 'coach', 'sales_manager', 'content_manager']),
    isPrimary: z.boolean().default(false),
  }),
  async (i) => {
    await requirePlatformStaff();
    const ctx = await requireOrg(i.orgSlug);
    const id = unwrap(
      await ctx.sb.schema('app').rpc('assign_team_member', {
        p_organization_id: ctx.organizationId, p_user_id: i.userId, p_role_key: i.roleKey, p_is_primary: i.isPrimary,
      }),
    );
    return { assignmentId: id as string };
  },
);

export const endTeamAssignment = action(z.object({ orgSlug: zSlug, userId: zId }), async (i) => {
  await requireSuperAdmin();
  const ctx = await requireOrg(i.orgSlug);
  unwrap(await ctx.sb.schema('app').rpc('end_team_assignment', { p_organization_id: ctx.organizationId, p_user_id: i.userId }));
  return null;
});

/** Internal team directory with each person's client assignments. */
export const listInternalTeam = action(z.object({}), async () => {
  const { sb } = await requirePlatformStaff();
  const [staff, assignments, profiles] = await Promise.all([
    sb.from('platform_staff').select('user_id, role_id, status, title'),
    sb.from('team_assignments').select('organization_id, user_id, role_id, is_primary, status').eq('status', 'active'),
    sb.from('user_profiles').select('user_id, display_name, avatar_url'),
  ]);
  const byUser = new Map<string, { organization_id: string; role_id: string; is_primary: boolean }[]>();
  for (const a of unwrap(assignments)) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a]);
  const profileById = new Map(unwrap(profiles).map((p) => [p.user_id, p]));
  return unwrap(staff).map((s) => ({ ...s, profile: profileById.get(s.user_id) ?? null, assignments: byUser.get(s.user_id) ?? [] }));
});
