import 'server-only';

import { z } from 'zod';
import { action, zId } from '@/lib/action';
import { requireSession, requireSuperAdmin } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';
import { SOFT_DELETE_TABLES } from './constants';


export const softDelete = action(z.object({ table: z.enum(SOFT_DELETE_TABLES), id: zId }), async (i) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('soft_delete', { p_table: i.table, p_id: i.id }));
  return null;
});

export const restore = action(z.object({ table: z.enum(SOFT_DELETE_TABLES), id: zId }), async (i) => {
  const { sb } = await requireSuperAdmin();
  unwrap(await sb.schema('app').rpc('restore', { p_table: i.table, p_id: i.id }));
  return null;
});
