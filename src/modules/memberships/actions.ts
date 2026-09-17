import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';
import type { Permission } from '@/lib/permissions/keys';

/** Members + assigned staff with profile data (two queries; no cross-schema embedding). */
export const listMembers = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'members.read');
  const [members, staff, roles] = await Promise.all([
    ctx.sb.from('organization_memberships').select('id, user_id, role_id, status, title, joined_at, last_active_at')
      .eq('organization_id', ctx.organizationId).neq('status', 'removed'),
    ctx.sb.from('team_assignments').select('id, user_id, role_id, is_primary, status')
      .eq('organization_id', ctx.organizationId).eq('status', 'active'),
    ctx.sb.from('roles').select('id, key, name'),
  ]);
  const m = unwrap(members), s = unwrap(staff), r = unwrap(roles);
  const ids = [...new Set([...m, ...s].map((x) => x.user_id))];
  const profiles = ids.length
    ? unwrap(await ctx.sb.from('user_profiles').select('user_id, display_name, first_name, last_name, avatar_url, job_title').in('user_id', ids))
    : [];
  const users = ids.length ? unwrap(await ctx.sb.from('users').select('id, email, last_login_at').in('id', ids)) : [];
  const roleById = new Map(r.map((x) => [x.id, x]));
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const shape = (userId: string, roleId: string) => ({
    userId,
    email: userById.get(userId)?.email ?? null,
    lastLoginAt: userById.get(userId)?.last_login_at ?? null,
    profile: profileById.get(userId) ?? null,
    role: roleById.get(roleId) ?? null,
  });
  return {
    members: m.map((x) => ({ membershipId: x.id, status: x.status, title: x.title, joinedAt: x.joined_at, ...shape(x.user_id, x.role_id) })),
    staff: s.map((x) => ({ assignmentId: x.id, isPrimary: x.is_primary, ...shape(x.user_id, x.role_id) })),
  };
});

export const changeMemberRole = action(z.object({ membershipId: zId, roleKey: z.string().regex(/^[a-z_]+$/) }), async (i) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('change_member_role', { p_membership_id: i.membershipId, p_role_key: i.roleKey }));
  return null;
});

export const removeMember = action(z.object({ membershipId: zId }), async ({ membershipId }) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('remove_member', { p_membership_id: membershipId }));
  return null;
});

export const setPermissionOverride = action(
  z.object({
    orgSlug: zSlug,
    userId: zId,
    permission: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
    effect: z.enum(['grant', 'deny']).nullable(),
    reason: z.string().max(500).optional(),
    expiresAt: z.string().datetime().optional(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'roles.manage');
    unwrap(
      await ctx.sb.schema('app').rpc('set_permission_override', {
        p_organization_id: ctx.organizationId,
        p_user_id: i.userId,
        p_permission_key: i.permission,
        // null removes the override; the generated type marks it non-null, so cast deliberately
        p_effect: i.effect as string,
        p_reason: i.reason,
        p_expires_at: i.expiresAt,
      }),
    );
    return null;
  },
);

export const upsertCustomRole = action(
  z.object({
    orgSlug: zSlug,
    key: z.string().regex(/^[a-z_]{2,40}$/),
    name: z.string().min(2).max(60),
    description: z.string().max(300).optional(),
    permissions: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).min(1),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'roles.manage');
    // Fail fast in the UI; the database performs the authoritative subset check.
    const extra = i.permissions.filter((p) => !ctx.ctx.is_super_admin && !ctx.permissions.has(p as Permission));
    if (extra.length) return { roleId: null, rejected: extra };
    const roleId = unwrap(
      await ctx.sb.schema('app').rpc('upsert_custom_role', {
        p_organization_id: ctx.organizationId, p_key: i.key, p_name: i.name,
        p_permission_keys: i.permissions, p_description: i.description,
      }),
    ) as string;
    return { roleId, rejected: [] as string[] };
  },
);
