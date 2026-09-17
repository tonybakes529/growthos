import 'server-only';

import { z } from 'zod';
import { action, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { unwrap } from '@/lib/errors';

export const listAuditLog = action(
  z.object({
    orgSlug: zSlug,
    table: z.string().max(60).optional(),
    action: z.string().max(40).optional(),
    actorId: z.string().uuid().optional(),
    before: z.number().int().optional(), // cursor = id
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'audit.read');
    let q = ctx.sb.from('audit_logs')
      .select('id, actor_id, impersonated_user_id, action, table_name, record_id, changed_fields, old_values, new_values, context, created_at')
      .eq('organization_id', ctx.organizationId);
    if (i.table) q = q.eq('table_name', i.table);
    if (i.action) q = q.eq('action', i.action);
    if (i.actorId) q = q.eq('actor_id', i.actorId);
    if (i.before) q = q.lt('id', i.before);
    const rows = unwrap(await q.order('id', { ascending: false }).limit(i.limit));
    return { rows, nextCursor: rows.length === i.limit ? rows[rows.length - 1]!.id : null };
  },
);

export const listActivity = action(
  z.object({ orgSlug: zSlug, entityType: z.string().optional(), entityId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(50) }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    let q = ctx.sb.from('activity_history').select('*').eq('organization_id', ctx.organizationId);
    if (i.entityType) q = q.eq('entity_type', i.entityType);
    if (i.entityId) q = q.eq('entity_id', i.entityId);
    return unwrap(await q.order('created_at', { ascending: false }).limit(i.limit));
  },
);
