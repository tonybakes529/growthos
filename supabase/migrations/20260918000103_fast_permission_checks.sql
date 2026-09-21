-- =============================================================================
-- 0103 FAST PERMISSION CHECKS
--
-- Every row-level-security policy asks "which organizations may this user do X in?"
-- through private.orgs_with_permission(). Measured on the live database, a query
-- that reads three rows spent 8 of its 9 ms inside that one check.
--
-- Why it was slow: the permission helpers were SQL-language SECURITY DEFINER
-- functions that call each other. Postgres cannot inline those, and it parses and
-- plans a SQL function's body again for every calling query, so each API request
-- re-planned the whole chain (super admin check, impersonation check, the full
-- grants query) before reading any data.
--
-- The fix, with no change in behaviour:
--   * the same bodies as PL/pgSQL, whose plans are cached per database connection
--     (PostgREST keeps its connections open, so planning happens once, not per request)
--   * a super admin short-circuits: they see every organization, so their grants
--     are never computed
--   * orgs_with_permission() filters on the permission before joining, instead of
--     building every (organization, permission) pair and discarding all but one
--
-- Signatures, return types, volatility, SECURITY DEFINER, search_path and EXECUTE
-- grants are unchanged, so every policy and caller keeps working as it is.
-- Verified on the live data set by snapshotting the output of every helper, the
-- context RPCs and the row visibility of every non-empty table for each user
-- (including impersonation, overrides, expired assignments and a suspended
-- workspace) before and after, inside a transaction that was rolled back.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create or replace function private.is_real_super_admin()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (
    select 1 from public.platform_staff ps
    join public.roles r on r.id = ps.role_id
    where ps.user_id = auth.uid() and ps.status = 'active' and r.key = 'super_admin'
  );
end;
$$;

create or replace function private.active_impersonation()
returns public.impersonation_sessions
language plpgsql stable security definer set search_path = '' as $$
declare s public.impersonation_sessions;
begin
  -- Almost nobody is inside a "view as" session, so look for one first (one index probe)
  -- and only then confirm the caller is still a real super admin.
  select i.* into s from public.impersonation_sessions i
  where i.admin_user_id = auth.uid() and i.ended_at is null and i.expires_at > now()
  limit 1;
  if s.id is null or not private.is_real_super_admin() then return null; end if;
  return s;
end;
$$;

-- The identity every permission check uses. Equals auth.uid() unless a super
-- admin is in an active "view as" session.
create or replace function private.effective_user_id()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((private.active_impersonation()).target_user_id, auth.uid());
end;
$$;

create or replace function private.is_super_admin()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_real_super_admin() then return false; end if;
  return (private.active_impersonation()).id is null;
end;
$$;

create or replace function private.is_platform_staff(p_user uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := coalesce(p_user, private.effective_user_id());
begin
  return exists (select 1 from public.platform_staff ps where ps.user_id = uid and ps.status = 'active');
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The one place the grant rules live. p_permission = null returns every permission;
-- a key narrows the work to that single permission before any join. Deny overrides win.
create or replace function private.user_grants_for(p_user uuid, p_permission text)
returns table (organization_id uuid, permission_key text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  pid uuid;
  is_staff boolean;
begin
  if p_permission is not null then
    select p.id into pid from public.permissions p where p.key = p_permission;
    if pid is null then return; end if;   -- unknown permission: nobody holds it
  end if;
  is_staff := exists (select 1 from public.platform_staff ps where ps.user_id = p_user and ps.status = 'active');

  return query
  with raw as (
    select m.organization_id, rp.permission_id
    from public.organization_memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.user_id = p_user and m.status = 'active'
      and (pid is null or rp.permission_id = pid)
    union
    select t.organization_id, rp.permission_id
    from public.team_assignments t
    join public.role_permissions rp on rp.role_id = t.role_id
    where t.user_id = p_user and t.status = 'active' and is_staff
      and t.starts_at <= now() and (t.ends_at is null or t.ends_at > now())
      and (pid is null or rp.permission_id = pid)
    union
    select o.organization_id, o.permission_id
    from public.permission_overrides o
    where o.user_id = p_user and o.effect = 'grant'
      and (o.expires_at is null or o.expires_at > now())
      and (pid is null or o.permission_id = pid)
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
  where (org.status in ('onboarding', 'active', 'paused') or is_staff)
    and not exists (
      select 1 from public.permission_overrides d
      where d.user_id = p_user and d.organization_id = r.organization_id
        and d.permission_id = r.permission_id and d.effect = 'deny'
        and (d.expires_at is null or d.expires_at > now())
    );
end;
$$;

revoke all on function private.user_grants_for(uuid, text) from public, anon, authenticated;
grant execute on function private.user_grants_for(uuid, text) to service_role;

-- Every (organization_id, permission_key) the given user holds.
create or replace function private.user_grants(p_user uuid)
returns table (organization_id uuid, permission_key text)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query select g.organization_id, g.permission_key from private.user_grants_for(p_user, null) g;
end;
$$;

-- Hot path for RLS: `organization_id in (select private.orgs_with_permission('x.read'))`
create or replace function private.orgs_with_permission(p_permission text)
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.is_super_admin() then
    return query select o.id from public.organizations o;
  elsif p_permission is not null then   -- a null permission matches nothing, as before (never "every permission")
    return query select distinct g.organization_id
                 from private.user_grants_for(private.effective_user_id(), p_permission) g;
  end if;
end;
$$;

create or replace function private.has_permission(p_org uuid, p_permission text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return p_org in (select private.orgs_with_permission(p_permission));
end;
$$;

-- Any live relationship with the org (member or assigned staff).
create or replace function private.orgs_with_access()
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid;
begin
  if private.is_super_admin() then
    return query select o.id from public.organizations o;
    return;
  end if;
  uid := private.effective_user_id();
  return query
    select g.organization_id from private.user_grants_for(uid, null) g
    union
    select m.organization_id from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = uid and m.status = 'active'
      and o.status in ('onboarding', 'active', 'paused');
end;
$$;

-- Permission keys a given user holds in an org (used for anti-elevation and the app's permission set).
create or replace function private.permission_set(p_org uuid, p_user uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.platform_staff ps join public.roles r on r.id = ps.role_id
             where ps.user_id = p_user and ps.status = 'active' and r.key = 'super_admin') then
    return (select array_agg(p.key) from public.permissions p);
  end if;
  return coalesce((select array_agg(g.permission_key) from private.user_grants_for(p_user, null) g
                   where g.organization_id = p_org), '{}');
end;
$$;

-- ---------------------------------------------------------------------------
-- "Mine" helpers used by policies: same queries, identity resolved once
-- ---------------------------------------------------------------------------
create or replace function private.my_enrolled_program_ids()
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.effective_user_id();
begin
  return query
  select e.program_id
  from public.program_enrollments e
  join public.programs p on p.id = e.program_id
  where e.user_id = uid
    and e.status in ('active', 'completed')
    and (e.access_expires_at is null or e.access_expires_at > now())
    and p.status = 'published' and p.deleted_at is null
    and e.organization_id in (select private.orgs_with_access());
end;
$$;

create or replace function private.my_task_ids()
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.effective_user_id();
begin
  return query select ta.task_id from public.task_assignments ta where ta.user_id = uid;
end;
$$;

create or replace function private.my_session_ids()
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.effective_user_id();
begin
  return query select sa.coaching_session_id from public.session_attendees sa where sa.user_id = uid;
end;
$$;

create or replace function private.my_conversation_ids()
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.effective_user_id();
begin
  return query select cp.conversation_id from public.conversation_participants cp where cp.user_id = uid;
end;
$$;

create or replace function private.my_onboarding_ids()
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.effective_user_id();
begin
  return query select co.id from public.customer_onboardings co where co.user_id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workspace switcher: runs on every full page load. The SQL version evaluated
-- effective_user_id() and is_super_admin() inside the joins, once per row.
-- ---------------------------------------------------------------------------
create or replace function app.get_my_workspaces()
returns table (organization_id uuid, name text, slug text, kind text, status text, access_type text, role_key text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := private.effective_user_id();
  super boolean := private.is_super_admin();
begin
  return query
  select o.id, o.name, o.slug::text, o.kind, o.status,
         case when m.id is not null then 'member' when t.id is not null then 'staff' else 'super_admin' end,
         coalesce(mr.key, tr.key, case when super then 'super_admin' end)
  from public.organizations o
  left join public.organization_memberships m on m.organization_id = o.id and m.user_id = uid and m.status = 'active'
  left join public.roles mr on mr.id = m.role_id
  left join public.team_assignments t on t.organization_id = o.id and t.user_id = uid and t.status = 'active'
  left join public.roles tr on tr.id = t.role_id
  where o.id in (select private.orgs_with_access()) and o.deleted_at is null
  order by o.kind, o.name;
end;
$$;
