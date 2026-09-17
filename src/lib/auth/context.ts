import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { AppError, unwrap } from '@/lib/errors';
import type { Permission } from '@/lib/permissions/keys';
import { createClient } from '@/lib/supabase/server';
import { requireSession, type Session } from './session';

export type OrgContext = Session & {
  organizationId: string;
  name: string;
  slug: string;
  kind: 'platform' | 'client' | 'template_library';
  status: string;
  timezone: string;
  currency: string;
  roleKey: string | null;
  accessType: 'member' | 'staff' | 'super_admin' | null;
  permissions: ReadonlySet<Permission>;
};

type OrgContextRow = {
  organization_id: string; name: string; slug: string; kind: OrgContext['kind']; status: string;
  timezone: string; currency: string; role_key: string | null; access_type: OrgContext['accessType'];
  permissions: Permission[];
};

/**
 * The ONLY way to turn a URL slug into an organization id. The database
 * verifies membership / assignment and returns the caller's permission set.
 * Never accept organization ids from the browser; accept slugs and call this.
 */
export const requireOrg = cache(async (slug: string): Promise<OrgContext> => {
  // Both RPCs only need the caller's JWT, so run them together instead of back to back.
  // requireSession() rejects first when signed out, so the org result is never read unauthenticated.
  const [session, orgRes] = await Promise.all([
    requireSession(),
    createClient().then((sb) => sb.schema('app').rpc('get_org_context', { p_slug: slug })),
  ]);
  const row = unwrap(orgRes) as unknown as OrgContextRow;
  return {
    ...session,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    roleKey: row.role_key,
    accessType: row.access_type,
    permissions: new Set(row.permissions),
  };
});

/**
 * requireOrg for pages. A workspace the viewer cannot enter looks exactly like one that does not exist (404),
 * instead of surfacing as an application error. Actions keep using requireOrg so they can report the reason.
 */
export async function requireOrgPage(slug: string): Promise<OrgContext> {
  try {
    return await requireOrg(slug);
  } catch (e) {
    if (e instanceof AppError && e.code === 'unauthenticated') redirect('/login');
    if (e instanceof AppError && (e.code === 'not_found' || e.code === 'forbidden' || e.code === 'validation')) notFound();
    throw e;
  }
}

export function can(ctx: OrgContext, permission: Permission): boolean {
  return ctx.ctx.is_super_admin || ctx.permissions.has(permission);
}

/** UX-level guard. The database enforces the same rule again; this just fails fast with a clear message. */
export function assertCan(ctx: OrgContext, ...permissions: Permission[]): void {
  const missing = permissions.filter((p) => !can(ctx, p));
  if (missing.length) throw new AppError('forbidden', `Missing permission: ${missing.join(', ')}`);
}

export function assertWritable(ctx: Session): void {
  if (ctx.ctx.impersonation && !ctx.ctx.impersonation.allow_writes) {
    throw new AppError('forbidden', 'You are viewing as another user in read-only mode');
  }
}
