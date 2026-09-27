import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { workspaceForRequest } from '@/lib/zapier-auth';

export const runtime = 'nodejs';

/**
 * Zapier calls this when a Zap using a Growth OS trigger is switched on, handing us the URL to POST to.
 * What we return comes back to us on unsubscribe, so the id is all we need to keep.
 */
export async function POST(req: Request) {
  const orgId = await workspaceForRequest(req);
  if (!orgId) return NextResponse.json({ error: 'Unrecognised API key' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const targetUrl = String(body.hookUrl ?? body.target_url ?? body.targetUrl ?? '');
  const event = String(body.event ?? body.event_type ?? '');
  const zapId = body.zap_id ? String(body.zap_id) : null;

  if (!/^https:\/\//.test(targetUrl)) return NextResponse.json({ error: 'hookUrl must be https' }, { status: 400 });
  if (!event) return NextResponse.json({ error: 'event is required' }, { status: 400 });

  const { data, error } = await createAdminClient().schema('app')
    .rpc('zapier_subscribe', { p_org: orgId, p_event: event, p_url: targetUrl, p_zap: zapId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data, event, workspace_id: orgId }, { status: 201 });
}
