import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { workspaceForRequest } from '@/lib/zapier-auth';

export const runtime = 'nodejs';

/** Zapier's authentication test. Confirms the key and names the workspace it belongs to. */
export async function GET(req: Request) {
  const orgId = await workspaceForRequest(req);
  if (!orgId) return NextResponse.json({ error: 'Unrecognised API key' }, { status: 401 });
  const { data } = await createAdminClient().from('organizations').select('id, name, slug').eq('id', orgId).single();
  return NextResponse.json({ workspace_id: data?.id, workspace: data?.name, slug: data?.slug });
}
