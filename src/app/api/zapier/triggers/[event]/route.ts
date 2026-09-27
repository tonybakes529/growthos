import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEnv } from '@/lib/env';
import { workspaceForRequest } from '@/lib/zapier-auth';

export const runtime = 'nodejs';

/**
 * Zapier's perform_list: recent real events of this type, so the Zap editor has something to show while
 * someone maps fields. Scoped to the workspace that owns the API key, so no other client's data appears.
 */
export async function GET(req: Request, { params }: { params: Promise<{ event: string }> }) {
  const orgId = await workspaceForRequest(req);
  if (!orgId) return NextResponse.json({ error: 'Unrecognised API key' }, { status: 401 });
  const { event } = await params;

  const admin = createAdminClient();
  const { data: known } = await admin.from('automation_trigger_types').select('key').eq('key', event).maybeSingle();
  if (!known) return NextResponse.json({ error: `Unknown event ${event}` }, { status: 404 });

  const { data } = await admin.from('domain_events')
    .select('id, event_type, entity_type, entity_id, payload, occurred_at')
    .eq('organization_id', orgId).eq('event_type', event)
    .order('occurred_at', { ascending: false }).limit(10);

  return NextResponse.json((data ?? []).map((e) => ({
    id: `evt_${e.id}`,
    event: e.event_type,
    occurred_at: e.occurred_at,
    workspace_id: orgId,
    entity_type: e.entity_type,
    entity_id: e.entity_id,
    app_url: getEnv().NEXT_PUBLIC_APP_URL,
    ...(e.payload as Record<string, unknown>),
  })));
}
