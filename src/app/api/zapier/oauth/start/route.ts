import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { authorizeUrl, setupState } from '@/lib/zapier';

export const runtime = 'nodejs';

/**
 * Begins the handshake with the customer's own Zapier account. The state is single use, tied to the
 * workspace and the person, and expires, so a callback cannot be replayed or aimed at another workspace.
 */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('workspace') ?? '';
  const back = `/w/${slug}/connections`;

  const setup = setupState();
  if (!setup.ready) {
    return NextResponse.redirect(new URL(`${back}?err=${encodeURIComponent(
      `Zapier is not configured yet. Missing: ${setup.missing.join(', ')}`)}`, req.url), { status: 303 });
  }

  const ctx = await requireOrg(slug);
  assertCan(ctx, 'connections.manage');

  const state = randomBytes(32).toString('base64url');
  const { error } = await createAdminClient().from('zapier_oauth_states').insert({
    state, organization_id: ctx.organizationId, created_by: ctx.ctx.effective_user_id, redirect_path: back,
  });
  if (error) {
    return NextResponse.redirect(new URL(`${back}?err=${encodeURIComponent(error.message)}`, req.url), { status: 303 });
  }
  return NextResponse.redirect(authorizeUrl(state), { status: 303 });
}
