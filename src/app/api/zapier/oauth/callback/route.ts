import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession } from '@/lib/auth/session';
import { exchangeCode, fetchProfile, saveConnection } from '@/lib/zapier';

export const runtime = 'nodejs';

/**
 * Where Zapier sends the customer back. Nothing here is trusted until the state matches an unused,
 * unexpired row that this same person created, which is what stops a forged callback attaching
 * somebody else's Zapier account to this workspace.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');
  const admin = createAdminClient();

  if (!state) return NextResponse.redirect(new URL('/?err=Missing+state', req.url), { status: 303 });

  const { data: row } = await admin.from('zapier_oauth_states')
    .select('state, organization_id, created_by, redirect_path, expires_at, used_at')
    .eq('state', state).maybeSingle();

  const back = row?.redirect_path ?? '/';
  const fail = (m: string) => NextResponse.redirect(new URL(`${back}?err=${encodeURIComponent(m)}`, req.url), { status: 303 });

  if (!row) return fail('That sign-in link is not one we issued. Start again from Connections.');
  if (row.used_at) return fail('That sign-in link has already been used. Start again from Connections.');
  if (Date.parse(row.expires_at) < Date.now()) return fail('That sign-in link expired. Start again from Connections.');

  // burn the state before doing anything else, so a replay cannot race this
  await admin.from('zapier_oauth_states').update({ used_at: new Date().toISOString() }).eq('state', state);

  const session = await getSession();
  if (!session || session.ctx.effective_user_id !== row.created_by) {
    return fail('Finish connecting from the same account that started it.');
  }
  if (denied) return fail(`Zapier reported: ${denied}`);
  if (!code) return fail('Zapier did not return an authorisation code.');

  try {
    const tokens = await exchangeCode(code);
    const profile = await fetchProfile(tokens.access_token);
    await saveConnection(row.organization_id, row.created_by, tokens, profile);
  } catch (e) {
    await admin.from('zapier_connections').update({
      status: 'error', last_error: e instanceof Error ? e.message : String(e),
    }).eq('organization_id', row.organization_id);
    return fail(e instanceof Error ? e.message : 'Could not finish connecting to Zapier.');
  }
  return NextResponse.redirect(new URL(`${back}?msg=${encodeURIComponent('Zapier connected')}`, req.url), { status: 303 });
}
