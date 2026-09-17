import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireSession } from '@/lib/auth/session';
import { requireOrg } from '@/lib/auth/context';
import { AppError, unwrap } from '@/lib/errors';

/**
 * "View as" a client user. The super admin keeps their own session; the
 * database swaps the effective user for every RLS check and blocks writes
 * unless allowWrites is true. Every start/end is audited.
 */
export const startImpersonation = action(
  z.object({
    targetUserId: zId,
    orgSlug: zSlug.optional(),
    reason: z.string().min(5).max(500),
    allowWrites: z.boolean().default(false),
    minutes: z.number().int().min(5).max(240).default(60),
  }),
  async (i) => {
    const { sb, ctx } = await requireSession();
    if (!ctx.is_real_super_admin) throw new AppError('forbidden', 'Super admin only');
    const orgId = i.orgSlug ? (await requireOrg(i.orgSlug)).organizationId : undefined;
    const id = unwrap(await sb.schema('app').rpc('start_impersonation', {
      p_target_user: i.targetUserId, p_organization_id: orgId as string, p_reason: i.reason,
      p_allow_writes: i.allowWrites, p_minutes: i.minutes,
    }));
    return { sessionId: id as string };
  },
);

export const endImpersonation = action(z.object({}), async () => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('end_impersonation'));
  return null;
});

export const getSessionContext = action(z.object({}), async () => (await requireSession()).ctx);
