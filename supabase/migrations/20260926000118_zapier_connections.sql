-- =============================================================================
-- 0118 CUSTOMER-OWNED ZAPIER CONNECTIONS
--
-- Each client workspace connects its OWN Zapier account. Zaps are created in
-- that account, run on that account's plan, and consume that account's tasks.
-- Growth OS never proxies through an operator account.
--
-- Two directions, deliberately separate:
--
--   outbound  Growth OS emits a workspace event. Zapier holds a REST Hook
--             subscription (a target URL) and we POST to it. That is
--             zapier_subscriptions + zapier_deliveries, and it works with any
--             published Zapier integration.
--
--   inbound   The workspace authorises Growth OS against their Zapier account
--             (OAuth 2.0, authorize at api.zapier.com/v2/authorize, token at
--             zapier.com/oauth/token/). That token is what the Workflow API
--             needs to create and manage Zaps on their behalf. Verified Sep
--             2026: the authenticated user is the end customer, and scopes
--             include zap:write, zap:pause, connection:read, authentication.
--
-- Tokens live in zapier_connection_secrets, which has RLS on and NO policy, so
-- only the service role can read it. The same deny-all posture as
-- domain_events and email_outbox. Ciphertext only: the app seals them with
-- AES-256-GCM before they are written.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Permissions. Students get none, which keeps isLearner, and therefore the
--    learner navigation, exactly as it was.
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module, action, is_sensitive, description) values
  ('connections.read',   'connections', 'read',   false, 'See which outside accounts this workspace has connected'),
  ('connections.manage', 'connections', 'manage', true,  'Connect, reconnect or disconnect outside accounts such as Zapier')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.organization_id is null
  and r.key in ('client_admin', 'account_manager')
  and p.key in ('connections.read', 'connections.manage')
on conflict do nothing;

-- Client team members may look, not change.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.organization_id is null and r.key = 'client_team_member' and p.key = 'connections.read'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. The workspace's Zapier account. One per workspace.
-- ---------------------------------------------------------------------------
create table public.zapier_connections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  status           text not null default 'disconnected'
                   check (status in ('disconnected', 'connected', 'expired', 'revoked', 'error')),
  -- whatever the Zapier profile endpoint gives us, so the page can say which account this is
  account_label    text,
  account_id       text,
  scopes           text[] not null default '{}',
  expires_at       timestamptz,
  connected_at     timestamptz,
  connected_by     uuid references public.users(id) on delete set null,
  last_checked_at  timestamptz,
  last_error       text,
  unique (organization_id)
);
select private.standardize('zapier_connections', 'connections', true, true, 'custom');

create policy zapier_connections_select on public.zapier_connections for select to authenticated using (
  organization_id in (select private.orgs_with_permission('connections.read')));
-- every write goes through the app functions below, which assert connections.manage

-- Tokens. RLS on, no policy at all: unreachable from the browser under any role.
create table public.zapier_connection_secrets (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  connection_id    uuid not null,
  access_token     jsonb not null,          -- {ct, iv, tag}, AES-256-GCM, sealed by the app
  refresh_token    jsonb,
  rotated_at       timestamptz not null default now(),
  foreign key (organization_id, connection_id) references public.zapier_connections(organization_id, id) on delete cascade
);
alter table public.zapier_connection_secrets enable row level security;
comment on table public.zapier_connection_secrets is
  'Service role only, deliberately without an RLS policy. Never select this from the browser.';

-- ---------------------------------------------------------------------------
-- 3. OAuth handshake state, so a callback cannot be forged or replayed
-- ---------------------------------------------------------------------------
create table public.zapier_oauth_states (
  state            text primary key,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  created_by       uuid not null references public.users(id) on delete cascade,
  redirect_path    text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '15 minutes',
  used_at          timestamptz
);
alter table public.zapier_oauth_states enable row level security;
create index zapier_oauth_states_expiry_idx on public.zapier_oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- 4. How Zapier authenticates INTO Growth OS for the trigger side.
--    Only a sha-256 hash is stored; the key itself is shown once.
-- ---------------------------------------------------------------------------
create table public.zapier_api_keys (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  label            text not null default 'Zapier',
  key_prefix       text not null,           -- first 8 characters, so a person can tell keys apart
  key_hash         text not null unique,
  last_used_at     timestamptz,
  revoked_at       timestamptz
);
select private.standardize('zapier_api_keys', 'connections', false, true, 'custom');
create index zapier_api_keys_live_idx on public.zapier_api_keys (organization_id) where revoked_at is null;

create policy zapier_api_keys_select on public.zapier_api_keys for select to authenticated using (
  organization_id in (select private.orgs_with_permission('connections.read')));

-- ---------------------------------------------------------------------------
-- 5. REST Hook subscriptions. Zapier calls subscribe when a Zap is switched on
--    and unsubscribe when it is switched off, handing back what subscribe
--    returned.
-- ---------------------------------------------------------------------------
create table public.zapier_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  event_type       text not null references public.automation_trigger_types(key),
  target_url       text not null check (target_url ~ '^https://'),
  zap_id           text,
  api_key_id       uuid,
  is_active        boolean not null default true,
  last_delivery_at timestamptz,
  failure_count    int not null default 0,
  foreign key (organization_id, api_key_id) references public.zapier_api_keys(organization_id, id) on delete set null (api_key_id)
);
select private.standardize('zapier_subscriptions', 'connections', true, true, 'custom');
-- the same Zap must not subscribe twice to the same event
create unique index zapier_subscriptions_target_key on public.zapier_subscriptions (organization_id, event_type, target_url)
  where deleted_at is null;
create index zapier_subscriptions_active_idx on public.zapier_subscriptions (event_type, organization_id)
  where is_active and deleted_at is null;

create policy zapier_subscriptions_select on public.zapier_subscriptions for select to authenticated using (
  organization_id in (select private.orgs_with_permission('connections.read')));

-- ---------------------------------------------------------------------------
-- 6. Delivery log. This records that Growth OS handed the event to Zapier, and
--    nothing more. Whether Slack actually posted is Zapier's business and is
--    never inferred from a row here.
-- ---------------------------------------------------------------------------
create table public.zapier_deliveries (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  subscription_id  uuid not null,
  domain_event_id  bigint not null references public.domain_events(id) on delete cascade,
  event_key        text not null,           -- stable id Zapier can deduplicate on
  status           text not null default 'pending'
                   check (status in ('pending', 'delivered', 'failed', 'dropped')),
  attempts         int not null default 0,
  response_code    int,
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  -- one row per event per subscription: a retry can never become a second delivery
  unique (subscription_id, domain_event_id),
  foreign key (organization_id, subscription_id) references public.zapier_subscriptions(organization_id, id) on delete cascade
);
alter table public.zapier_deliveries enable row level security;
create index zapier_deliveries_due_idx on public.zapier_deliveries (next_attempt_at) where status = 'pending';
create index zapier_deliveries_recent_idx on public.zapier_deliveries (organization_id, created_at desc);

create policy zapier_deliveries_select on public.zapier_deliveries for select to authenticated using (
  organization_id in (select private.orgs_with_permission('connections.read')));

-- ---------------------------------------------------------------------------
-- 7. What the workspace configured through the guided setup. The Zap itself
--    lives in their Zapier account; this is our reference to it.
-- ---------------------------------------------------------------------------
create table public.zapier_workflows (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  template_key     text not null,
  title            text not null,
  event_type       text not null references public.automation_trigger_types(key),
  app              text not null,           -- 'slack', 'google_calendar'
  status           text not null default 'draft'
                   check (status in ('draft', 'needs_setup', 'on', 'off', 'error')),
  zap_id           text,
  config           jsonb not null default '{}'::jsonb,
  last_synced_at   timestamptz,
  last_error       text,
  created_by       uuid references public.users(id) on delete set null
);
-- standardize already adds zapier_workflows_org_idx on (organization_id) where deleted_at is null
select private.standardize('zapier_workflows', 'connections', true, true, 'custom');

create policy zapier_workflows_select on public.zapier_workflows for select to authenticated using (
  organization_id in (select private.orgs_with_permission('connections.read')));

-- ---------------------------------------------------------------------------
-- 8. A coach being assigned becomes a real event, so it can trigger a Zap.
--    0117 only wrote it to the activity log.
-- ---------------------------------------------------------------------------
insert into public.automation_trigger_types (key, description) values
  ('coach.assigned', 'A student was assigned a coach. Payload carries the student, the coach and the workspace.')
on conflict (key) do nothing;

create or replace function app.assign_coach(p_onboarding_id uuid, p_coach uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  co  public.customer_onboardings;
  n   int;
  who text;
begin
  perform private.require_user();
  select * into co from public.customer_onboardings where id = p_onboarding_id and deleted_at is null;
  if co.id is null then raise exception 'student not found' using errcode = 'P0002'; end if;
  perform private.assert_permission(co.organization_id, 'enrollments.update');

  if p_coach is not null and not exists (
       select 1 from public.organization_memberships m
       join public.roles r on r.id = m.role_id
       where m.organization_id = co.organization_id and m.user_id = p_coach
         and m.status = 'active' and r.key <> 'student'
       union all
       select 1 from public.team_assignments t
       where t.organization_id = co.organization_id and t.user_id = p_coach and t.status = 'active') then
    raise exception 'that person is not on this workspace''s team';
  end if;

  update public.customer_onboardings set coach_id = p_coach
  where organization_id = co.organization_id and email = co.email and deleted_at is null;
  get diagnostics n = row_count;

  who := coalesce((select nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')
                   from public.contacts c where c.id = co.contact_id), co.email::text);
  perform private.log_activity(co.organization_id, 'contact', co.contact_id, 'coach_assigned',
    case when p_coach is null then 'Took the coach off ' || who
         else who || ' was assigned a coach' end,
    jsonb_build_object('onboarding_id', co.id, 'coach_id', p_coach, 'records', n));

  -- only on assignment, not on clearing: nothing downstream wants "a coach was removed"
  if p_coach is not null then
    perform private.emit_event(co.organization_id, 'coach.assigned', 'contact', co.contact_id,
      jsonb_build_object(
        'onboarding_id', co.id, 'student_name', who, 'student_email', co.email::text,
        'student_user_id', co.user_id, 'contact_id', co.contact_id,
        'coach_user_id', p_coach,
        'coach_name', (select coalesce(nullif(btrim(up.display_name), ''), u.email::text)
                       from public.users u left join public.user_profiles up on up.user_id = u.id
                       where u.id = p_coach),
        'coach_email', (select u.email::text from public.users u where u.id = p_coach)));
  end if;

  return jsonb_build_object('onboarding_id', co.id, 'coach_id', p_coach, 'records', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Workflows. Every one asserts a permission and stays inside one workspace.
-- ---------------------------------------------------------------------------

-- Issues a key for Zapier to authenticate with. The caller hands in the hash; the raw key never
-- reaches the database. Re-issuing revokes whatever came before.
create or replace function app.issue_zapier_key(p_organization_id uuid, p_prefix text, p_hash text, p_label text default 'Zapier')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare kid uuid;
begin
  perform private.require_user();
  perform private.assert_permission(p_organization_id, 'connections.manage');
  if p_hash !~ '^[a-f0-9]{64}$' then raise exception 'expected a sha-256 hash'; end if;

  update public.zapier_api_keys set revoked_at = now()
  where organization_id = p_organization_id and revoked_at is null;

  insert into public.zapier_api_keys (organization_id, label, key_prefix, key_hash)
  values (p_organization_id, coalesce(nullif(btrim(p_label), ''), 'Zapier'), p_prefix, p_hash)
  returning id into kid;

  perform private.log_activity(p_organization_id, 'organization', p_organization_id, 'zapier_key_issued',
                               'Issued a Zapier API key', jsonb_build_object('key_id', kid));
  return jsonb_build_object('key_id', kid, 'prefix', p_prefix);
end;
$$;

-- Resolves a key hash to a workspace. Used by the trigger endpoints, service role only.
create or replace function private.zapier_org_for_key(p_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare oid uuid;
begin
  select organization_id into oid from public.zapier_api_keys
  where key_hash = p_hash and revoked_at is null;
  if oid is not null then
    update public.zapier_api_keys set last_used_at = now() where key_hash = p_hash;
  end if;
  return oid;
end;
$$;

-- Zapier switching a Zap on. Idempotent: the same target for the same event returns the same row.
create or replace function private.zapier_subscribe(p_org uuid, p_event text, p_url text, p_zap text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if not exists (select 1 from public.automation_trigger_types t where t.key = p_event) then
    raise exception 'unknown event type %', p_event;
  end if;
  insert into public.zapier_subscriptions (organization_id, event_type, target_url, zap_id)
  values (p_org, p_event, p_url, p_zap)
  on conflict (organization_id, event_type, target_url) where deleted_at is null
  do update set is_active = true, failure_count = 0, zap_id = coalesce(excluded.zap_id, public.zapier_subscriptions.zap_id)
  returning id into sid;
  return sid;
end;
$$;

create or replace function private.zapier_unsubscribe(p_org uuid, p_subscription uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.zapier_subscriptions set is_active = false, deleted_at = now()
  where id = p_subscription and organization_id = p_org and deleted_at is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Privileges
-- ---------------------------------------------------------------------------
revoke all on function app.issue_zapier_key(uuid, text, text, text) from public, anon;
grant execute on function app.issue_zapier_key(uuid, text, text, text) to authenticated, service_role;

revoke all on function private.zapier_org_for_key(text), private.zapier_subscribe(uuid, text, text, text),
                       private.zapier_unsubscribe(uuid, uuid) from public, anon, authenticated;
grant execute on function private.zapier_org_for_key(text), private.zapier_subscribe(uuid, text, text, text),
                          private.zapier_unsubscribe(uuid, uuid) to service_role;
