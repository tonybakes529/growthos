import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getEnv, requireEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Service-role client. BYPASSES RLS.
 * Only for: webhook handlers (after signature verification), cron/worker jobs,
 * and signed-URL generation after an RLS-checked lookup. Never for user actions.
 */
export function createAdminClient() {
  return createClient<Database>(getEnv().NEXT_PUBLIC_SUPABASE_URL, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
