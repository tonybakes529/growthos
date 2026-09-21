import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';
import type { Permission } from '@/lib/permissions/keys';

type Role = { id: string; key: string; name: string };
type Profile = { user_id: string; display_name: string | null; first_name: string | null; last_name: string | null; avatar_url: string | null; job_title: string | null };
type Person = { id: string; email: string | null; last_login_at: string | null; profile: Profile | null };
const PERSON = 'id, email, last_login_at, profile:user_profiles!user_profiles_user_id_fkey(user_id, display_name, first_name, last_name, avatar_url, job_title)';

/**
 * Members + assigned staff with profile data. Members arrive with their login, profile and role embedded. Staff
 * need one more request: they link to users through platform_staff, which client users cannot read, so the embed
 * would come back empty for them.
 */
export const listMembers = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'members.read');
  const [members, staff] = await Promise.all([
    ctx.sb.from('organization_memberships')
      .select(`id, user_id, status, title, joined_at, last_active_at, role:roles!organization_memberships_role_id_fkey(id, key, name), user:users!organization_memberships_user_id_fkey(${PERSON})`)
      .eq('organization_id', ctx.organizationId).neq('status', 'removed')
      .overrideTypes<{ id: string; user_id: string; status: string; title: string | null; joined_at: string | null; last_active_at: string | null;
        role: Role | null; user: Person | null }[], { merge: false }>(),
    ctx.sb.from('team_assignments').select('id, user_id, is_primary, status, role:roles!team_assignments_role_id_fkey(id, key, name)')
      .eq('organization_id', ctx.organizationId).eq('status', 'active')
      .overrideTypes<{ id: string; user_id: string; is_primary: boolean; status: string; role: Role | null }[], { merge: false }>(),
  ]);
  const m = unwrap(members), s = unwrap(staff);
  const staffIds = [...new Set(s.map((x) => x.user_id))];
  const staffPeople = staffIds.length
    ? unwrap(await ctx.sb.from('users').select(PERSON).in('id', staffIds).overrideTypes<Person[], { merge: false }>())
    : [];
  const personById = new Map<string, Person>([...staffPeople, ...m.flatMap((x) => (x.user ? [x.user] : []))].map((p) => [p.id, p]));
  const shape = (userId: string, role: Role | null) => {
    const p = personById.get(userId);
    return { userId, email: p?.email ?? null, lastLoginAt: p?.last_login_at ?? null, profile: p?.profile ?? null, role };
  };
  return {
    members: m.map((x) => ({ membershipId: x.id, status: x.status, title: x.title, joinedAt: x.joined_at, ...shape(x.user_id, x.role) })),
    staff: s.map((x) => ({ assignmentId: x.id, isPrimary: x.is_primary, ...shape(x.user_id, x.role) })),
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
