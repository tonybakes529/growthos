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
  // Each staff member's profile rides along with them. This used to download every profile on the platform
  // (every client's customers included), and past 1,000 profiles staff lost their names in the dropdowns.
  const [staff, assignments] = await Promise.all([
    sb.from('platform_staff')
      .select('user_id, role_id, status, title, user:users!platform_staff_user_id_fkey(profile:user_profiles!user_profiles_user_id_fkey(user_id, display_name, avatar_url))')
      .overrideTypes<{ user_id: string; role_id: string; status: string; title: string | null;
        user: { profile: { user_id: string; display_name: string | null; avatar_url: string | null } | null } | null }[], { merge: false }>(),
    sb.from('team_assignments').select('organization_id, user_id, role_id, is_primary, status').eq('status', 'active'),
  ]);
  const byUser = new Map<string, { organization_id: string; role_id: string; is_primary: boolean }[]>();
  for (const a of unwrap(assignments)) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a]);
  return unwrap(staff).map(({ user, ...s }) => ({ ...s, profile: user?.profile ?? null, assignments: byUser.get(s.user_id) ?? [] }));
});
