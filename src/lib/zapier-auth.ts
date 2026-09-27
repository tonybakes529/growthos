import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

/** Keys are shown once and stored only as a hash, so a database leak does not hand over the trigger endpoints. */
export const hashKey = (raw: string) => createHash('sha256').update(raw).digest('hex');
export const newKey = () => `gos_${randomBytes(24).toString('base64url')}`;

/**
 * Which workspace is calling. Zapier sends the key it was given when the customer set up the
 * connection, so every request is pinned to one workspace and can never see another's events.
 */
export async function workspaceForRequest(req: Request): Promise<string | null> {
  const header = req.headers.get('x-api-key')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? new URL(req.url).searchParams.get('api_key');
  if (!header) return null;
  const { data } = await createAdminClient().schema('app').rpc('zapier_org_for_key', { p_hash: hashKey(header) });
  return (data as string | null) ?? null;
}
