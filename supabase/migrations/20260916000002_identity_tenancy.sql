-- =============================================================================
-- 0002 IDENTITY, TENANCY, PERMISSIONS, AUDIT
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users / user_profiles (platform-level; mirror of auth.users)
-- ---------------------------------------------------------------------------
create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           extensions.citext not null unique,
  status          text not null default 'active' check (status in ('active', 'disabled')),
  last_login_at   timestamptz,
  last_seen_at    timestamptz
);

create table public.user_profiles (
  user_id                 uuid primary key references public.users(id) on delete cascade,
  first_name              text,
  last_name               text,
  display_name            text,
  avatar_url              text,
  phone                   text,
  job_title               text,
  bio                     text,
  timezone                text not null default 'America/New_York',
  locale                  text not null default 'en-US',
  onboarding_completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- organizations (tenant root)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null default 'client'
                      check (kind in ('platform', 'client', 'template_library')),
  name                text not null,
  slug                extensions.citext not null unique
                      check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status              text not null default 'onboarding'
                      check (status in ('onboarding', 'active', 'paused', 'suspended', 'archived')),
  timezone            text not null default 'America/New_York',
  currency            char(3) not null default 'USD',
  logo_url            text,
  website             text,
  stripe_customer_id  text unique,
  settings            jsonb not null default '{}'::jsonb,
  archived_at         timestamptz,
  suspended_at        timestamptz
);
-- organizations has no organization_id column, so standardize() adds no tenant key.

-- ---------------------------------------------------------------------------
-- roles / permissions
-- ---------------------------------------------------------------------------
create table public.permissions (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module        text not null,
  action        text not null,
  description   text,
  is_sensitive  boolean not null default false
);

create table public.roles (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid references public.organizations(id) on delete cascade,  -- null = system role
  key               text not null check (key ~ '^[a-z_]+$'),
  name              text not null,
  description       text,
  scope             text not null check (scope in ('platform', 'organization')),
  audience          text not null default 'member'
                    check (audience in ('member', 'staff', 'platform')),  -- who may hold it
  rank              int  not null default 0,
  is_system         boolean not null default false,
  check (scope = 'organization' or organization_id is null)
);
create unique index roles_system_key on public.roles (key) where organization_id is null;
create unique index roles_org_key on public.roles (organization_id, key) where organization_id is not null;

create table public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_id  uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- platform_staff: super admin + internal team. Never self-editable.
-- ---------------------------------------------------------------------------
create table public.platform_staff (
  user_id   uuid primary key references public.users(id) on delete cascade,
  role_id   uuid not null references public.roles(id),
  status    text not null default 'active' check (status in ('active', 'disabled')),
  title     text
);

-- ---------------------------------------------------------------------------
-- memberships (client users) / team_assignments (internal staff → client)
-- ---------------------------------------------------------------------------
create table public.organization_memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  role_id          uuid not null references public.roles(id),
  status           text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  title            text,
  joined_at        timestamptz not null default now(),
  invited_by       uuid references public.users(id) on delete set null,
  last_active_at   timestamptz,
  unique (organization_id, user_id)
);
create index organization_memberships_user_idx on public.organization_memberships (user_id) where status = 'active';

create table public.team_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.platform_staff(user_id) on delete cascade,
  role_id          uuid not null references public.roles(id),
  is_primary       boolean not null default false,
  status           text not null default 'active' check (status in ('active', 'ended')),
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz,
  unique (organization_id, user_id)
);
create index team_assignments_user_idx on public.team_assignments (user_id) where status = 'active';

create table public.permission_overrides (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  permission_id    uuid not null references public.permissions(id) on delete cascade,
  effect           text not null check (effect in ('grant', 'deny')),
  reason           text,
  expires_at       timestamptz,
  unique (organization_id, user_id, permission_id)
);
create index permission_overrides_user_idx on public.permission_overrides (user_id);

create table public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email            extensions.citext not null,
  role_id          uuid not null references public.roles(id),
  token_hash       text not null unique,
  status           text not null default 'pending'
                   check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by       uuid references public.users(id) on delete set null,
  expires_at       timestamptz not null default now() + interval '7 days',
  accepted_at      timestamptz,
  accepted_by      uuid references public.users(id) on delete set null,
  payload          jsonb not null default '{}'::jsonb  -- {program_ids:[], task_template_ids:[], message}
);
create unique index invitations_one_pending on public.invitations (organization_id, email) where status = 'pending';

-- ---------------------------------------------------------------------------
-- login activity, impersonation, audit, activity timeline, domain events
-- ---------------------------------------------------------------------------
create table public.login_activity (
  id               bigint generated always as identity primary key,
  user_id          uuid references public.users(id) on delete cascade,
  organization_id  uuid references public.organizations(id) on delete set null,
  event            text not null check (event in ('login', 'logout', 'failed_login', 'password_reset',
                                                   'impersonation_start', 'impersonation_end', 'workspace_switch')),
  ip_address       inet,
  user_agent       text,
  created_at       timestamptz not null default now()
);
create index login_activity_user_idx on public.login_activity (user_id, created_at desc);

create table public.impersonation_sessions (
  id               uuid primary key default gen_random_uuid(),
  admin_user_id    uuid not null references public.users(id) on delete cascade,
  target_user_id   uuid not null references public.users(id) on delete cascade,
  organization_id  uuid references public.organizations(id) on delete cascade,
  reason           text not null check (length(reason) >= 5),
  allow_writes     boolean not null default false,
  started_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '60 minutes',
  ended_at         timestamptz,
  check (admin_user_id <> target_user_id)
);
create unique index impersonation_one_active on public.impersonation_sessions (admin_user_id) where ended_at is null;

create table public.audit_logs (
  id                    bigint generated always as identity primary key,
  organization_id       uuid references public.organizations(id) on delete set null,
  actor_id              uuid,               -- real authenticated user (no FK: survive user deletion)
  impersonated_user_id  uuid,
  action                text not null,      -- insert | update | delete | soft_delete | <custom verb>
  table_name            text,
  record_id             uuid,
  old_values            jsonb,
  new_values            jsonb,
  changed_fields        text[],
  context               jsonb not null default '{}'::jsonb,  -- ip, user_agent, request_id, reason
  created_at            timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

create table public.activity_history (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  actor_id         uuid references public.users(id) on delete set null,
  entity_type      text not null,
  entity_id        uuid,
  verb             text not null,              -- 'created', 'completed', 'invited', ...
  summary          text not null,
  data             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index activity_history_org_idx on public.activity_history (organization_id, created_at desc);
create index activity_history_entity_idx on public.activity_history (entity_type, entity_id);

create table public.domain_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations(id) on delete cascade,
  event_type       text not null,              -- 'lesson.completed', 'kpi.missed', ...
  entity_type      text,
  entity_id        uuid,
  actor_id         uuid,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed', 'skipped')),
  attempts         int not null default 0,
  last_error       text,
  occurred_at      timestamptz not null default now(),
  processed_at     timestamptz
);
create index domain_events_pending_idx on public.domain_events (occurred_at) where status = 'pending';
create index domain_events_org_idx on public.domain_events (organization_id, event_type, occurred_at desc);

-- =============================================================================
-- PERMISSION ENGINE (private schema, SECURITY DEFINER, pinned search_path)
-- =============================================================================

create or replace function private.is_real_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_staff ps
    join public.roles r on r.id = ps.role_id
    where ps.user_id = auth.uid() and ps.status = 'active' and r.key = 'super_admin'
  );
$$;

create or replace function private.active_impersonation()
returns public.impersonation_sessions
language sql stable security definer set search_path = '' as $$
  select s.* from public.impersonation_sessions s
  where s.admin_user_id = auth.uid()
    and s.ended_at is null
    and s.expires_at > now()
    and private.is_real_super_admin()
  limit 1;
$$;

-- The identity every permission check uses. Equals auth.uid() unless a super
-- admin is in an active "view as" session.
create or replace function private.effective_user_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((private.active_impersonation()).target_user_id, auth.uid());
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_real_super_admin() and (private.active_impersonation()).id is null;
$$;

create or replace function private.is_platform_staff(p_user uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_staff
    where user_id = coalesce(p_user, private.effective_user_id()) and status = 'active'
  );
$$;

-- Every (organization_id, permission_key) the given user holds. Deny overrides win.
create or replace function private.user_grants(p_user uuid)
returns table (organization_id uuid, permission_key text)
language sql stable security definer set search_path = '' as $$
  with staff as (
    select exists (select 1 from public.platform_staff where user_id = p_user and status = 'active') as is_staff
  ),
  raw as (
    select m.organization_id, rp.permission_id
    from public.organization_memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.user_id = p_user and m.status = 'active'
    union
    select t.organization_id, rp.permission_id
    from public.team_assignments t
    join public.role_permissions rp on rp.role_id = t.role_id
    cross join staff
    where t.user_id = p_user and t.status = 'active' and staff.is_staff
      and t.starts_at <= now() and (t.ends_at is null or t.ends_at > now())
    union
    select o.organization_id, o.permission_id
    from public.permission_overrides o
    where o.user_id = p_user and o.effect = 'grant'
      and (o.expires_at is null or o.expires_at > now())
      -- a grant override needs a live relationship with the org
      and (exists (select 1 from public.organization_memberships m
                   where m.user_id = p_user and m.organization_id = o.organization_id and m.status = 'active')
           or exists (select 1 from public.team_assignments t
                      where t.user_id = p_user and t.organization_id = o.organization_id and t.status = 'active'))
  )
  select distinct r.organization_id, p.key
  from raw r
  join public.permissions p on p.id = r.permission_id
  join public.organizations org on org.id = r.organization_id
  cross join staff
  where (org.status in ('onboarding', 'active', 'paused') or staff.is_staff)
    and not exists (
      select 1 from public.permission_overrides d
      where d.user_id = p_user and d.organization_id = r.organization_id
        and d.permission_id = r.permission_id and d.effect = 'deny'
        and (d.expires_at is null or d.expires_at > now())
    );
$$;

-- Hot path for RLS: `organization_id in (select private.orgs_with_permission('x.read'))`
create or replace function private.orgs_with_permission(p_permission text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.organizations where private.is_super_admin()
  union
  select g.organization_id from private.user_grants(private.effective_user_id()) g
  where g.permission_key = p_permission;
$$;

create or replace function private.has_permission(p_org uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_org in (select private.orgs_with_permission(p_permission));
$$;

-- Any live relationship with the org (member or assigned staff).
create or replace function private.orgs_with_access()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.organizations where private.is_super_admin()
  union
  select distinct g.organization_id from private.user_grants(private.effective_user_id()) g
  union
  select m.organization_id from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = private.effective_user_id() and m.status = 'active'
    and o.status in ('onboarding', 'active', 'paused');
$$;

create or replace function private.assert_permission(p_org uuid, p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org is null or not private.has_permission(p_org, p_permission) then
    raise exception 'permission denied: % on organization %', p_permission, p_org
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_super_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'super admin required' using errcode = '42501';
  end if;
end;
$$;

-- Permission keys a given user holds in an org (used for anti-elevation).
create or replace function private.permission_set(p_org uuid, p_user uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.platform_staff ps join public.roles r on r.id = ps.role_id
                 where ps.user_id = p_user and ps.status = 'active' and r.key = 'super_admin')
      then (select array_agg(key) from public.permissions)
    else coalesce((select array_agg(permission_key) from private.user_grants(p_user) where organization_id = p_org), '{}')
  end;
$$;

-- Real body for the impersonation write guard used by stamp().
create or replace function private.assert_writable()
returns void language plpgsql stable security definer set search_path = '' as $$
declare s public.impersonation_sessions;
begin
  if auth.uid() is null then return; end if;   -- service role / migrations
  s := private.active_impersonation();
  if s.id is not null and not s.allow_writes then
    raise exception 'read-only impersonation session: writes are disabled' using errcode = '42501';
  end if;
end;
$$;

-- Generic audit trigger.
create or replace function private.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb := coalesce(n, o);
  changed text[];
  act text := lower(tg_op);
  imp uuid := (private.active_impersonation()).target_user_id;
begin
  if tg_op = 'UPDATE' then
    select array_agg(k) into changed
    from jsonb_object_keys(n) k
    where n->k is distinct from o->k and k not in ('updated_at', 'updated_by');
    if changed is null then return null; end if;
    if (n ? 'deleted_at') and (o->>'deleted_at') is null and (n->>'deleted_at') is not null then
      act := 'soft_delete';
    end if;
  end if;

  insert into public.audit_logs (organization_id, actor_id, impersonated_user_id, action,
                                 table_name, record_id, old_values, new_values, changed_fields, context)
  values (
    case when tg_table_name = 'organizations' then (r->>'id')::uuid
         else nullif(r->>'organization_id', '')::uuid end,
    auth.uid(), imp, act, tg_table_name,
    case when (r->>'id') ~ '^[0-9a-f-]{36}$' then (r->>'id')::uuid end,
    o, n, changed,
    jsonb_strip_nulls(jsonb_build_object(
      'request_id', nullif(current_setting('request.headers', true), '')::jsonb->>'x-request-id',
      'user_agent', nullif(current_setting('request.headers', true), '')::jsonb->>'user-agent'
    ))
  );
  return null;
end;
$$;

-- Standard policy generator: module.read / create / update / delete.
create or replace function private.apply_standard_policies(p_table text, p_module text, p_soft_delete boolean)
returns void language plpgsql as $$
declare t text := format('public.%I', p_table);
begin
  execute format('drop policy if exists %I on %s', p_table || '_select', t);
  execute format('drop policy if exists %I on %s', p_table || '_insert', t);
  execute format('drop policy if exists %I on %s', p_table || '_update', t);
  execute format('drop policy if exists %I on %s', p_table || '_delete', t);

  execute format($p$create policy %I on %s for select to authenticated using (
      organization_id in (select private.orgs_with_permission(%L)) %s)$p$,
    p_table || '_select', t, p_module || '.read',
    case when p_soft_delete then 'and (deleted_at is null or (select private.is_super_admin()))' else '' end);

  execute format($p$create policy %I on %s for insert to authenticated with check (
      organization_id in (select private.orgs_with_permission(%L)))$p$,
    p_table || '_insert', t, p_module || '.create');

  execute format($p$create policy %I on %s for update to authenticated
      using (organization_id in (select private.orgs_with_permission(%L)))
      with check (organization_id in (select private.orgs_with_permission(%L)))$p$,
    p_table || '_update', t, p_module || '.update', p_module || '.update');

  -- soft-delete tables: hard delete is super-admin only (use app.soft_delete otherwise)
  if p_soft_delete then
    execute format($p$create policy %I on %s for delete to authenticated using ((select private.is_super_admin()))$p$,
      p_table || '_delete', t);
  else
    execute format($p$create policy %I on %s for delete to authenticated using (
        organization_id in (select private.orgs_with_permission(%L)))$p$,
      p_table || '_delete', t, p_module || '.delete');
  end if;
end;
$$;

-- Event + activity helpers used by every workflow.
create or replace function private.emit_event(p_org uuid, p_type text, p_entity_type text, p_entity_id uuid, p_payload jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.domain_events (organization_id, event_type, entity_type, entity_id, actor_id, payload)
  values (p_org, p_type, p_entity_type, p_entity_id, auth.uid(), coalesce(p_payload, '{}'));
$$;

create or replace function private.log_activity(p_org uuid, p_entity_type text, p_entity_id uuid, p_verb text, p_summary text, p_data jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_history (organization_id, actor_id, entity_type, entity_id, verb, summary, data)
  values (p_org, auth.uid(), p_entity_type, p_entity_id, p_verb, p_summary, coalesce(p_data, '{}'));
$$;

create or replace function private.log_audit(p_org uuid, p_action text, p_table text, p_record uuid, p_context jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, actor_id, impersonated_user_id, action, table_name, record_id, context)
  values (p_org, auth.uid(), (private.active_impersonation()).target_user_id, p_action, p_table, p_record, coalesce(p_context, '{}'));
$$;

-- =============================================================================
-- Standardize identity tables (custom policies below)
-- =============================================================================
select private.standardize('users',                    'members',  false, false, 'custom', false);
select private.standardize('user_profiles',            'members',  false, false, 'custom', false);
select private.standardize('organizations',            'organization', true, true, 'custom');
select private.standardize('permissions',              'roles',    false, false, 'custom', false);
select private.standardize('roles',                    'roles',    false, true,  'custom');
select private.standardize('role_permissions',         'roles',    false, true,  'custom');
select private.standardize('platform_staff',           'platform', false, true,  'custom');
select private.standardize('organization_memberships', 'members',  false, true,  'custom');
select private.standardize('team_assignments',         'members',  false, true,  'custom');
select private.standardize('permission_overrides',     'roles',    false, true,  'custom');
select private.standardize('invitations',              'members',  false, true,  'custom');

-- Append-only tables: RLS on, no stamp trigger (the impersonation guard must not block them).
alter table public.login_activity enable row level security;
alter table public.impersonation_sessions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.activity_history enable row level security;
alter table public.domain_events enable row level security;
insert into private.rls_registry (table_name, module, org_scoped, policy_mode) values
  ('login_activity', 'platform', false, 'custom'),
  ('impersonation_sessions', 'platform', false, 'custom'),
  ('audit_logs', 'audit', false, 'custom'),
  ('activity_history', 'organization', true, 'custom'),
  ('domain_events', 'platform', false, 'service_only');

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Mirror auth.users → public.users + user_profiles.
create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (user_id, first_name, last_name, display_name)
  values (new.id,
          new.raw_user_meta_data->>'first_name',
          new.raw_user_meta_data->>'last_name',
          coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function private.handle_new_auth_user();

-- Role/holder compatibility: platform roles only on platform_staff, staff roles
-- only on team_assignments, member roles only on memberships; custom roles must
-- belong to the same org.
create or replace function private.check_role_holder()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.roles;
begin
  select * into r from public.roles where id = new.role_id;
  if tg_table_name = 'platform_staff' and r.scope <> 'platform' then
    raise exception 'platform_staff requires a platform role';
  elsif tg_table_name = 'team_assignments' and (r.scope <> 'organization' or r.audience <> 'staff') then
    raise exception 'team assignments require a staff role';
  elsif tg_table_name = 'organization_memberships' and (r.scope <> 'organization' or r.audience <> 'member') then
    raise exception 'memberships require a member role';
  elsif tg_table_name = 'invitations' and (r.scope <> 'organization' or r.audience <> 'member') then
    raise exception 'invitations require a member role';
  end if;
  if tg_table_name <> 'platform_staff' and r.organization_id is not null then
    if r.organization_id <> (to_jsonb(new)->>'organization_id')::uuid then
      raise exception 'custom role belongs to another organization';
    end if;
  end if;
  return new;
end;
$$;
create trigger check_role before insert or update of role_id on public.platform_staff for each row execute function private.check_role_holder();
create trigger check_role before insert or update of role_id on public.team_assignments for each row execute function private.check_role_holder();
create trigger check_role before insert or update of role_id on public.organization_memberships for each row execute function private.check_role_holder();
create trigger check_role before insert or update of role_id on public.invitations for each row execute function private.check_role_holder();

-- Never leave the platform without an active super admin.
create or replace function private.protect_last_super_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.platform_staff ps join public.roles r on r.id = ps.role_id
    where r.key = 'super_admin' and ps.status = 'active'
  ) and exists (select 1 from public.roles where key = 'super_admin') then
    raise exception 'cannot remove the last active super admin';
  end if;
  return null;
end;
$$;
create constraint trigger protect_last_super_admin after update or delete on public.platform_staff
  deferrable initially deferred for each row execute function private.protect_last_super_admin();

-- =============================================================================
-- Seed: permission catalog + system roles
-- =============================================================================
insert into public.permissions (key, module, action, is_sensitive)
select m || '.' || a, m, a, m in ('billing', 'financials', 'roles', 'audit', 'health')
from (values
  ('organization'), ('members'), ('contacts'), ('notes'), ('files'), ('custom_fields'),
  ('offers'), ('billing'), ('programs'), ('enrollments'), ('coaching'), ('accountability'),
  ('goals'), ('kpis'), ('dashboards'), ('tasks'), ('sops'), ('meetings'), ('sales'),
  ('content'), ('community'), ('messages'), ('automations'), ('health')
) mods(m)
cross join (values ('read'), ('create'), ('update'), ('delete')) acts(a);

insert into public.permissions (key, module, action, is_sensitive, description) values
  ('financials.read',     'financials', 'read',   true,  'See revenue, cash, spend and financial KPIs'),
  ('roles.read',          'roles',      'read',   false, 'See roles and permission overrides'),
  ('roles.manage',        'roles',      'manage', true,  'Change member roles, overrides and custom roles'),
  ('audit.read',          'audit',      'read',   true,  'Read the organization audit log'),
  ('reports.read',        'reports',    'read',   false, 'Open reports'),
  ('reports.export',      'reports',    'export', true,  'Export CSV data'),
  ('contacts.export',     'contacts',   'export', true,  'Export contacts'),
  ('sales.export',        'sales',      'export', true,  'Export sales data'),
  ('kpis.export',         'kpis',       'export', false, 'Export KPI data'),
  ('billing.export',      'billing',    'export', true,  'Export billing data'),
  ('tasks.read_all',      'tasks',      'read_all', false, 'See restricted tasks not assigned to you'),
  ('programs.grade',      'programs',   'grade',  false, 'Review assignments and give feedback'),
  ('community.moderate',  'community',  'moderate', false, 'Pin, hide and delete any post'),
  ('templates.apply',     'templates',  'apply',  false, 'Copy templates into this workspace'),
  ('organization.export', 'organization','export', true,  'Export the full workspace');

insert into public.roles (key, name, scope, audience, rank, is_system, description) values
  ('super_admin',        'Super Admin',         'platform',     'platform', 100, true, 'Platform owner. Full access everywhere.'),
  ('internal_team',      'Internal Team',       'platform',     'platform', 60,  true, 'Staff. Access only via team assignments.'),
  ('account_manager',    'Account Manager',     'organization', 'staff',    80,  true, 'Owns the client relationship. Full workspace control.'),
  ('coach',              'Coach',               'organization', 'staff',    70,  true, 'Delivers programs, calls, accountability.'),
  ('sales_manager',      'Sales Manager',       'organization', 'staff',    60,  true, 'Runs the client sales system.'),
  ('content_manager',    'Content Manager',     'organization', 'staff',    60,  true, 'Runs the client content system.'),
  ('client_admin',       'Client Admin',        'organization', 'member',   50,  true, 'Owner/admin of the client company.'),
  ('client_team_member', 'Client Team Member',  'organization', 'member',   20,  true, 'Employee of the client.'),
  ('student',            'Student',             'organization', 'member',   10,  true, 'Program participant.');

-- helper for readable grants
create or replace function private.grant_permissions(p_role text, p_keys text[])
returns void language sql as $$
  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where r.key = p_role and r.organization_id is null and p.key = any (p_keys)
  on conflict do nothing;
$$;

do $$
declare
  all_keys text[] := (select array_agg(key) from public.permissions);
  crud     text[];
begin
  -- account manager: everything
  perform private.grant_permissions('account_manager', all_keys);

  -- client admin: everything except staff-only health and template library
  perform private.grant_permissions('client_admin',
    (select array_agg(key) from public.permissions
     where module not in ('health', 'templates')));

  -- coach
  perform private.grant_permissions('coach', array[
    'organization.read', 'members.read', 'contacts.read', 'notes.read', 'notes.create', 'notes.update',
    'files.read', 'files.create', 'files.update', 'files.delete',
    'offers.read', 'programs.read', 'programs.create', 'programs.update', 'programs.delete', 'programs.grade',
    'enrollments.read', 'enrollments.create', 'enrollments.update', 'enrollments.delete',
    'coaching.read', 'coaching.create', 'coaching.update', 'coaching.delete',
    'accountability.read', 'accountability.create', 'accountability.update', 'accountability.delete',
    'goals.read', 'goals.create', 'goals.update', 'goals.delete',
    'kpis.read', 'kpis.create', 'kpis.update', 'kpis.delete', 'financials.read',
    'dashboards.read', 'dashboards.create', 'dashboards.update', 'dashboards.delete',
    'tasks.read', 'tasks.read_all', 'tasks.create', 'tasks.update', 'tasks.delete',
    'sops.read', 'sops.create', 'sops.update', 'sops.delete',
    'meetings.read', 'meetings.create', 'meetings.update', 'meetings.delete',
    'sales.read', 'content.read',
    'community.read', 'community.create', 'community.update', 'community.delete', 'community.moderate',
    'messages.read', 'messages.create', 'automations.read',
    'health.read', 'health.update', 'reports.read', 'templates.apply', 'custom_fields.read']);

  -- sales manager
  perform private.grant_permissions('sales_manager', array[
    'organization.read', 'members.read', 'contacts.read', 'contacts.create', 'contacts.update', 'contacts.delete', 'contacts.export',
    'notes.read', 'notes.create', 'notes.update', 'files.read', 'files.create',
    'offers.read', 'billing.read', 'financials.read', 'coaching.read', 'accountability.read',
    'goals.read', 'kpis.read', 'kpis.create', 'kpis.update', 'dashboards.read',
    'tasks.read', 'tasks.read_all', 'tasks.create', 'tasks.update', 'tasks.delete',
    'sops.read', 'meetings.read',
    'sales.read', 'sales.create', 'sales.update', 'sales.delete', 'sales.export',
    'community.read', 'community.create', 'messages.read', 'messages.create',
    'health.read', 'reports.read', 'custom_fields.read']);

  -- content manager
  perform private.grant_permissions('content_manager', array[
    'organization.read', 'members.read', 'contacts.read', 'notes.read', 'notes.create',
    'files.read', 'files.create', 'files.update', 'files.delete',
    'accountability.read', 'goals.read', 'kpis.read', 'kpis.create', 'kpis.update', 'dashboards.read',
    'tasks.read', 'tasks.read_all', 'tasks.create', 'tasks.update', 'tasks.delete',
    'sops.read', 'meetings.read',
    'content.read', 'content.create', 'content.update', 'content.delete',
    'community.read', 'community.create', 'messages.read', 'messages.create', 'reports.read']);

  -- client team member
  perform private.grant_permissions('client_team_member', array[
    'organization.read', 'members.read', 'contacts.read', 'contacts.create', 'contacts.update',
    'notes.read', 'notes.create', 'notes.update', 'files.read', 'files.create', 'custom_fields.read',
    'offers.read', 'coaching.read',
    'accountability.read', 'accountability.create', 'accountability.update',
    'goals.read', 'kpis.read', 'kpis.create', 'dashboards.read',
    'tasks.read', 'tasks.create', 'tasks.update',
    'sops.read', 'meetings.read',
    'sales.read', 'sales.create', 'sales.update',
    'content.read', 'content.create', 'content.update',
    'community.read', 'community.create', 'messages.read', 'messages.create']);

  -- student
  perform private.grant_permissions('student', array[
    'community.read', 'community.create', 'messages.read', 'messages.create']);
end $$;
