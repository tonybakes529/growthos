import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { workspaceForRequest } from '@/lib/zapier-auth';

export const runtime = 'nodejs';

/** Zapier calls this when the Zap is switched off, passing back whatever subscribe returned. */
async function stop(req: Request) {
  const orgId = await workspaceForRequest(req);
  if (!orgId) return NextResponse.json({ error: 'Unrecognised API key' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? new URL(req.url).searchParams.get('id') ?? '');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { data, error } = await createAdminClient().schema('app')
    .rpc('zapier_unsubscribe', { p_org: orgId, p_subscription: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // already gone is a success: Zapier must be able to retry an unsubscribe safely
  return NextResponse.json({ stopped: data === true });
}

export const POST = stop;
export const DELETE = stop;
