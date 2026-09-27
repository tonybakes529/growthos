import 'server-only';
import { getEnv } from '@/lib/env';
import { open, seal, canSealSecrets, type Sealed } from '@/lib/secrets';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Talking to a customer's own Zapier account.
 *
 * Verified against Zapier's documentation in September 2026:
 *   authorize  https://api.zapier.com/v2/authorize
 *   token      https://zapier.com/oauth/token/
 *   api        https://api.zapier.com/v2/...   (Authorization: Bearer <user access token>)
 *
 * The token belongs to the person who authorised, so every Zap created with it lives in THEIR
 * Zapier account and runs on THEIR plan and task allowance. Growth OS never holds a Zap.
 *
 * The Workflow API additionally requires the Growth OS integration to be published to Zapier's App
 * Directory. Until that exists there is no client id, `isConfigured()` is false, and the UI says so
 * rather than offering a button that cannot work.
 */

export const ZAPIER_AUTHORIZE_URL = 'https://api.zapier.com/v2/authorize';
export const ZAPIER_TOKEN_URL = 'https://zapier.com/oauth/token/';
export const ZAPIER_API = 'https://api.zapier.com/v2';

/** What Growth OS asks for. Read the profile, and create and manage Zaps on the person's behalf. */
export const ZAPIER_SCOPES = [
  'profile',
  'zap',
  'zap:write',
  'zap:update',
  'zap:pause',
  'authentication',
  'connection:read',
] as const;

export type ZapierSetup =
  | { ready: true }
  | { ready: false; missing: string[] };

/** Everything that has to exist before a workspace can connect. Drives the "Setup required" state. */
export function setupState(): ZapierSetup {
  const env = getEnv();
  const missing: string[] = [];
  if (!env.ZAPIER_CLIENT_ID) missing.push('ZAPIER_CLIENT_ID');
  if (!env.ZAPIER_CLIENT_SECRET) missing.push('ZAPIER_CLIENT_SECRET');
  if (!canSealSecrets()) missing.push('ZAPIER_TOKEN_KEY');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing.length ? { ready: false, missing } : { ready: true };
}

export const isConfigured = () => setupState().ready;

export function authorizeUrl(state: string): string {
  const env = getEnv();
  const params = new URLSearchParams({
    client_id: env.ZAPIER_CLIENT_ID!,
    redirect_uri: `${env.NEXT_PUBLIC_APP_URL}/api/zapier/oauth/callback`,
    response_type: 'code',
    scope: ZAPIER_SCOPES.join(' '),
    state,
  });
  return `${ZAPIER_AUTHORIZE_URL}?${params}`;
}

type TokenResponse = {
  access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string;
};

async function token(body: Record<string, string>): Promise<TokenResponse> {
  const env = getEnv();
  const res = await fetch(ZAPIER_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.ZAPIER_CLIENT_ID!,
      client_secret: env.ZAPIER_CLIENT_SECRET!,
      ...body,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zapier token endpoint returned ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as TokenResponse;
}

export const exchangeCode = (code: string) => token({
  grant_type: 'authorization_code',
  code,
  redirect_uri: `${getEnv().NEXT_PUBLIC_APP_URL}/api/zapier/oauth/callback`,
});

export const refresh = (refreshToken: string) => token({ grant_type: 'refresh_token', refresh_token: refreshToken });

/** Stores the tokens sealed, and the non-secret parts where the page can read them. */
export async function saveConnection(orgId: string, userId: string, t: TokenResponse, profile?: { id?: string; label?: string }) {
  const admin = createAdminClient();
  const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
  const { data: conn, error } = await admin.from('zapier_connections').upsert({
    organization_id: orgId,
    status: 'connected',
    account_id: profile?.id ?? null,
    account_label: profile?.label ?? null,
    scopes: t.scope ? t.scope.split(/\s+/) : [...ZAPIER_SCOPES],
    expires_at: expiresAt,
    connected_at: new Date().toISOString(),
    connected_by: userId,
    last_checked_at: new Date().toISOString(),
    last_error: null,
    deleted_at: null,
  }, { onConflict: 'organization_id' }).select('id').single();
  if (error) throw error;

  const { error: secretError } = await admin.from('zapier_connection_secrets').upsert({
    organization_id: orgId,
    connection_id: conn.id,
    access_token: seal(t.access_token) as unknown as Record<string, string>,
    refresh_token: t.refresh_token ? (seal(t.refresh_token) as unknown as Record<string, string>) : null,
    rotated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id' });
  if (secretError) throw secretError;
  return conn.id as string;
}

/**
 * A usable access token for this workspace, refreshing first if it is close to expiry.
 * Returns null when the workspace has not connected, which callers must treat as "not connected"
 * rather than as an error.
 */
export async function accessTokenFor(orgId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: conn } = await admin.from('zapier_connections')
    .select('id, status, expires_at').eq('organization_id', orgId).is('deleted_at', null).maybeSingle();
  if (!conn || conn.status === 'disconnected' || conn.status === 'revoked') return null;

  const { data: secret } = await admin.from('zapier_connection_secrets')
    .select('access_token, refresh_token').eq('organization_id', orgId).maybeSingle();
  if (!secret) return null;

  const soon = conn.expires_at && Date.parse(conn.expires_at) - Date.now() < 120_000;
  if (!soon) return open(secret.access_token as unknown as Sealed);

  const sealedRefresh = secret.refresh_token as unknown as Sealed | null;
  if (!sealedRefresh) {
    await admin.from('zapier_connections').update({ status: 'expired', last_error: 'No refresh token' }).eq('id', conn.id);
    return null;
  }
  try {
    const fresh = await refresh(open(sealedRefresh));
    await saveConnection(orgId, '00000000-0000-0000-0000-000000000000', fresh);
    return fresh.access_token;
  } catch (e) {
    await admin.from('zapier_connections')
      .update({ status: 'expired', last_error: e instanceof Error ? e.message : String(e) }).eq('id', conn.id);
    return null;
  }
}

/** A call against the customer's Zapier account. Throws with the status so callers can be honest about failures. */
export async function zapierFetch(orgId: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const accessToken = await accessTokenFor(orgId);
  if (!accessToken) throw new Error('This workspace has not connected a Zapier account');
  const res = await fetch(`${ZAPIER_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zapier ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Who this token belongs to, so Connections can name the account rather than just saying "connected". */
export async function fetchProfile(accessToken: string): Promise<{ id?: string; label?: string }> {
  const res = await fetch(`${ZAPIER_API}/me`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!res.ok) return {};
  const body = (await res.json()) as Record<string, unknown>;
  const data = (body.data ?? body) as Record<string, unknown>;
  const label = [data.email, data.username, data.name].find((v) => typeof v === 'string' && v) as string | undefined;
  return { id: data.id ? String(data.id) : undefined, label };
}

/**
 * The app accounts the customer has authorised inside their own Zapier account.
 *
 * This is how Connections can say whether Slack or Google Calendar is genuinely authorised instead of
 * assuming it. It needs the `connection:read` scope, so it only works once the integration is
 * published and the workspace has connected; it throws otherwise, and the caller must report that as
 * "not confirmed" rather than quietly showing the app as connected.
 */
export async function fetchAppAuthorizations(orgId: string): Promise<{ app: string; title: string | null }[]> {
  const body = (await zapierFetch(orgId, '/authentications')) as Record<string, unknown> | unknown[];
  const rows = (Array.isArray(body) ? body : (body?.data as unknown[])) ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    // Zapier has named this field differently across API versions, so read whichever is present
    const app = [row.app, row.selected_api, row.api, row.service].find((v) => typeof v === 'string' && v) as string | undefined;
    return { app: String(app ?? ''), title: typeof row.title === 'string' ? row.title : null };
  }).filter((r) => r.app);
}
