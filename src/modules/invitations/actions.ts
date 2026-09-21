import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { unwrap } from '@/lib/errors';
import { getEnv } from '@/lib/env';

export const inviteMember = action(
  z.object({
    orgSlug: zSlug,
    email: z.string().email(),
    roleKey: z.string().regex(/^[a-z_]+$/),
    programIds: z.array(zId).max(50).default([]),
    message: z.string().max(1000).optional(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'members.create');
    const res = unwrap(
      await ctx.sb.schema('app').rpc('invite_member', {
        p_organization_id: ctx.organizationId,
        p_email: i.email,
        p_role_key: i.roleKey,
        p_program_ids: i.programIds,
        p_message: i.message,
      }),
    ) as { invitation_id: string; token: string };
    return { invitationId: res.invitation_id, inviteUrl: `${getEnv().NEXT_PUBLIC_APP_URL}/invite/${res.token}` };
  },
);

export const revokeInvitation = action(z.object({ invitationId: zId }), async ({ invitationId }) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('revoke_invitation', { p_invitation_id: invitationId }));
  return null;
});

export const listInvitations = action(z.object({ orgSlug: zSlug, pendingOnly: z.boolean().optional() }), async ({ orgSlug, pendingOnly }) => {
  const ctx = await requireOrg(orgSlug);
  let q = ctx.sb.from('invitations')
    .select('id, email, status, expires_at, created_at, role_id')
    .eq('organization_id', ctx.organizationId);
  if (pendingOnly) q = q.eq('status', 'pending');
  return unwrap(await q.order('created_at', { ascending: false }));
});

/** Public: used by the /invite/[token] page before sign-in. */
export const getInvitationPreview = action(z.object({ token: z.string().min(32).max(128) }), async ({ token }) => {
  const sb = await createClient();
  return unwrap(await sb.schema('app').rpc('get_invitation', { p_token: token })) as null | {
    email: string; organization_name: string; role_name: string; status: string; expires_at: string;
    organization_slug: string; logo_url: string | null; brand_color: string | null;
    /** A buyer of one or more courses, as opposed to a teammate being added to the workspace. */
    is_customer: boolean; first_name: string | null; account_exists: boolean; courses: string[];
  };
});

/** The signed-in user's email must match the invitation (checked in the database). */
export const acceptInvitation = action(z.object({ token: z.string().min(32).max(128) }), async ({ token }) => {
  const { sb } = await requireSession();
  const orgId = unwrap(await sb.schema('app').rpc('accept_invitation', { p_token: token })) as string;
  const org = unwrap(await sb.from('organizations').select('slug').eq('id', orgId).single());
  return { organizationId: orgId, slug: org.slug };
});
