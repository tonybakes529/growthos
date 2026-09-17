import 'server-only';
import { cache } from 'react';
import { createClient, type ServerClient } from '@/lib/supabase/server';
import { AppError, unwrap } from '@/lib/errors';

export type SessionContext = {
  real_user_id: string;
  effective_user_id: string;
  is_super_admin: boolean;
  is_real_super_admin: boolean;
  is_platform_staff: boolean;
  impersonation: null | {
    session_id: string;
    target_user_id: string;
    organization_id: string | null;
    allow_writes: boolean;
    expires_at: string;
  };
};

export type Session = { sb: ServerClient; userId: string; email: string | undefined; ctx: SessionContext };

/** Returns null when signed out. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const sb = await createClient();
  // Signature + expiry are verified locally against the project's JWKS (no Auth server round trip).
  // Postgres re-verifies the same JWT on every query, and get_session_context() is the authority
  // on who the caller is, so a forged or revoked-and-expired token never reaches any data.
  const { data } = await sb.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const ctx = unwrap(await sb.schema('app').rpc('get_session_context')) as unknown as SessionContext;
  return { sb, userId: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined, ctx };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AppError('unauthenticated', 'Please sign in');
  return s;
}

export async function requirePlatformStaff(): Promise<Session> {
  const s = await requireSession();
  if (!s.ctx.is_platform_staff && !s.ctx.is_super_admin) throw new AppError('forbidden', 'Internal team only');
  return s;
}

export async function requireSuperAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.ctx.is_super_admin) throw new AppError('forbidden', 'Super admin only');
  return s;
}
