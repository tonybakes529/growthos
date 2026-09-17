-- =============================================================================
-- 0014 WORKFLOWS (schema `app`, exposed via PostgREST as RPC)
--
-- Every function is SECURITY DEFINER with an empty search_path, so it bypasses
-- RLS internally. Each one therefore performs its OWN permission checks via
-- private.assert_* before touching data, and never trusts an organization id
-- without checking the caller's rights to it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.effective_user_id();
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  return uid;
end;
$$;

create or replace function private.role_by_key(p_org uuid, p_key text)
returns public.roles language sql stable security definer set search_path = '' as $$
  select r.* from public.roles r
  where r.key = p_key and (r.organization_id = p_org or r.organization_id is null)
  order by r.organization_id nulls last
  limit 1;
$$;

create or replace function private.role_permission_keys(p_role uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.key), '{}') from public.role_permissions rp
  join public.permissions p on p.id = rp.permission_id where rp.role_id = p_role;
$$;

-- Anti-elevation: you may only hand out what you already hold.
create or replace function private.assert_subset_of_caller(p_org uuid, p_keys text[], p_what text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  mine text[];
  extra text[];
begin
  if private.is_super_admin() then return; end if;
  mine := private.permission_set(p_org, private.effective_user_id());
  select array_agg(k) into extra from unnest(p_keys) k where not k = any (mine);
  if extra is not null then
    raise exception 'cannot grant %: you do not hold %', p_what, array_to_string(extra, ', ')
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_member_of_org(p_org uuid, p_user uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.org_member_ids(p_org) m where m = p_user) then
    raise exception 'user % is not a member of this workspace', p_user using errcode = '42501';
  end if;
end;
$$;

-- Generic deep-copy primitive: clone one row, strip audit columns, apply overrides.
create or replace function private.clone_row(p_table text, p_id uuid, p_overrides jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  j      jsonb;
  new_id uuid := gen_random_uuid();
begin
  execute format('select to_jsonb(t) from public.%I t where id = $1', p_table) into j using p_id;
  if j is null then raise exception 'clone_row: %.% not found', p_table, p_id; end if;
  j := j - 'created_at' - 'updated_at' - 'created_by' - 'updated_by' - 'deleted_at' - 'deleted_by';
  j := j || jsonb_build_object('id', new_id);
  if j ? 'copied_from_id' then j := j || jsonb_build_object('copied_from_id', p_id); end if;
  j := j || coalesce(p_overrides, '{}');
  execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', p_table, p_table) using j;
  return new_id;
end;
$$;

-- Scoped bypass for the column guards on organizations/client_profiles.
-- Always paired with end_org_guard_bypass() so the flag never outlives the
-- workflow statement that needed it.
create or replace function private.bypass_org_guard()
returns void language sql as $$ select set_config('app.bypass_org_guard', 'on', true); $$;
create or replace function private.end_org_guard_bypass()
returns void language sql as $$ select set_config('app.bypass_org_guard', 'off', true); $$;

-- ---------------------------------------------------------------------------
-- Session / context
-- ---------------------------------------------------------------------------
create or replace function app.get_session_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.impersonation_sessions := private.active_impersonation();
begin
  return jsonb_build_object(
    'real_user_id', auth.uid(),
    'effective_user_id', private.effective_user_id(),
    'is_super_admin', private.is_super_admin(),
    'is_real_super_admin', private.is_real_super_admin(),
    'is_platform_staff', private.is_platform_staff(),
    'impersonation', case when s.id is null then null else jsonb_build_object(
        'session_id', s.id, 'target_user_id', s.target_user_id, 'organization_id', s.organization_id,
        'allow_writes', s.allow_writes, 'expires_at', s.expires_at) end
  );
end;
$$;

create or replace function app.get_my_workspaces()
returns table (organization_id uuid, name text, slug text, kind text, status text, access_type text, role_key text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.slug::text, o.kind, o.status,
         case when m.id is not null then 'member' when t.id is not null then 'staff' else 'super_admin' end,
         coalesce(mr.key, tr.key, case when private.is_super_admin() then 'super_admin' end)
  from public.organizations o
  left join public.organization_memberships m on m.organization_id = o.id and m.user_id = private.effective_user_id() and m.status = 'active'
  left join public.roles mr on mr.id = m.role_id
  left join public.team_assignments t on t.organization_id = o.id and t.user_id = private.effective_user_id() and t.status = 'active'
  left join public.roles tr on tr.id = t.role_id
  where o.id in (select private.orgs_with_access()) and o.deleted_at is null
  order by o.kind, o.name;
$$;

-- Resolve a URL slug into a verified org context. The ONLY way the app turns
-- browser input into an organization id.
create or replace function app.get_org_context(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.organizations;
  uid uuid := private.require_user();
  role_key text;
  access text;
begin
  select * into o from public.organizations where slug = p_slug::extensions.citext and deleted_at is null;
  if o.id is null or o.id not in (select private.orgs_with_access()) then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  select r.key, 'member' into role_key, access from public.organization_memberships m
    join public.roles r on r.id = m.role_id
    where m.organization_id = o.id and m.user_id = uid and m.status = 'active';
  if role_key is null then
    select r.key, 'staff' into role_key, access from public.team_assignments t
      join public.roles r on r.id = t.role_id
      where t.organization_id = o.id and t.user_id = uid and t.status = 'active';
  end if;
  if role_key is null and private.is_super_admin() then role_key := 'super_admin'; access := 'super_admin'; end if;

  return jsonb_build_object(
    'organization_id', o.id, 'name', o.name, 'slug', o.slug, 'kind', o.kind, 'status', o.status,
    'timezone', o.timezone, 'currency', o.currency,
    'role_key', role_key, 'access_type', access,
    'permissions', to_jsonb(private.permission_set(o.id, uid))
  );
end;
$$;

create or replace function app.record_login(p_organization_id uuid default null, p_user_agent text default null, p_ip inet default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  insert into public.login_activity (user_id, organization_id, event, ip_address, user_agent)
  values (uid, case when p_organization_id in (select private.orgs_with_access()) then p_organization_id end,
          case when p_organization_id is null then 'login' else 'workspace_switch' end, p_ip, p_user_agent);
  update public.users set last_login_at = now(), last_seen_at = now() where id = uid;
  -- client-side logins (not staff) drive the "last client login" signal
  update public.client_profiles cp set last_client_login_at = now()
  where cp.organization_id in (select organization_id from public.organization_memberships
                               where user_id = uid and status = 'active');
  update public.organization_memberships set last_active_at = now() where user_id = uid and status = 'active';
end;
$$;

-- ---------------------------------------------------------------------------
-- Impersonation (read-only by default)
-- ---------------------------------------------------------------------------
create or replace function app.start_impersonation(p_target_user uuid, p_organization_id uuid, p_reason text,
                                                   p_allow_writes boolean default false, p_minutes int default 60)
returns uuid language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if not private.is_real_super_admin() then
    raise exception 'only a super admin can impersonate' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_staff ps join public.roles r on r.id = ps.role_id
             where ps.user_id = p_target_user and r.key = 'super_admin') then
    raise exception 'cannot impersonate another super admin' using errcode = '42501';
  end if;
  if p_organization_id is not null and not exists (select 1 from private.org_member_ids(p_organization_id) m where m = p_target_user) then
    raise exception 'target user is not part of that workspace';
  end if;
  update public.impersonation_sessions set ended_at = now() where admin_user_id = auth.uid() and ended_at is null;
  insert into public.impersonation_sessions (admin_user_id, target_user_id, organization_id, reason, allow_writes, expires_at)
  values (auth.uid(), p_target_user, p_organization_id, p_reason, p_allow_writes,
          now() + make_interval(mins => least(greatest(p_minutes, 5), 240)))
  returning id into sid;
  insert into public.login_activity (user_id, organization_id, event) values (auth.uid(), p_organization_id, 'impersonation_start');
  insert into public.audit_logs (organization_id, actor_id, impersonated_user_id, action, table_name, record_id, context)
  values (p_organization_id, auth.uid(), p_target_user, 'impersonation_start', 'impersonation_sessions', sid,
          jsonb_build_object('reason', p_reason, 'allow_writes', p_allow_writes));
  return sid;
end;
$$;

create or replace function app.end_impersonation()
returns void language plpgsql security definer set search_path = '' as $$
declare s public.impersonation_sessions;
begin
  update public.impersonation_sessions set ended_at = now()
  where admin_user_id = auth.uid() and ended_at is null
  returning * into s;
  if s.id is not null then
    insert into public.login_activity (user_id, organization_id, event) values (auth.uid(), s.organization_id, 'impersonation_end');
    insert into public.audit_logs (organization_id, actor_id, impersonated_user_id, action, table_name, record_id)
    values (s.organization_id, auth.uid(), s.target_user_id, 'impersonation_end', 'impersonation_sessions', s.id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations & memberships
-- ---------------------------------------------------------------------------
create or replace function private.create_invitation(p_org uuid, p_email text, p_role uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  inv_id uuid;
  org_name text;
  role_name text;
begin
  update public.invitations set status = 'revoked'
  where organization_id = p_org and email = p_email::extensions.citext and status = 'pending';

  insert into public.invitations (organization_id, email, role_id, token_hash, invited_by, payload)
  values (p_org, lower(p_email), p_role, encode(extensions.digest(token, 'sha256'), 'hex'), auth.uid(), coalesce(p_payload, '{}'))
  returning id into inv_id;

  select name into org_name from public.organizations where id = p_org;
  select name into role_name from public.roles where id = p_role;

  -- worker renders the email; accept link carries the raw token (outbox is service-role only)
  insert into public.email_outbox (organization_id, template_key, to_email, variables)
  values (p_org, 'invitation', lower(p_email), jsonb_build_object(
    'organization_name', org_name, 'role_name', role_name,
    'accept_path', '/invite/' || token, 'message', p_payload->>'message'));

  perform private.log_activity(p_org, 'user', null, 'invited', 'Invited ' || lower(p_email) || ' as ' || role_name,
                               jsonb_build_object('invitation_id', inv_id));
  perform private.emit_event(p_org, 'client.invited', 'invitation', inv_id,
                             jsonb_build_object('email', lower(p_email), 'role', role_name));
  return jsonb_build_object('invitation_id', inv_id, 'token', token);
end;
$$;

create or replace function app.invite_member(p_organization_id uuid, p_email text, p_role_key text,
                                             p_program_ids uuid[] default '{}', p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.roles;
begin
  perform private.require_user();
  perform private.assert_permission(p_organization_id, 'members.create');
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  r := private.role_by_key(p_organization_id, p_role_key);
  if r.id is null or r.audience <> 'member' then raise exception 'unknown member role %', p_role_key; end if;
  perform private.assert_subset_of_caller(p_organization_id, private.role_permission_keys(r.id), 'role ' || r.key);
  if exists (select 1 from unnest(p_program_ids) pid
             where not exists (select 1 from public.programs p where p.id = pid and p.organization_id = p_organization_id)) then
    raise exception 'program does not belong to this workspace';
  end if;
  if exists (select 1 from public.organization_memberships m join public.users u on u.id = m.user_id
             where m.organization_id = p_organization_id and u.email = p_email::extensions.citext and m.status = 'active') then
    raise exception 'already a member';
  end if;
  return private.create_invitation(p_organization_id, p_email, r.id,
    jsonb_build_object('program_ids', to_jsonb(coalesce(p_program_ids, '{}')), 'message', p_message));
end;
$$;

create or replace function app.revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.invitations;
begin
  select * into i from public.invitations where id = p_invitation_id;
  perform private.assert_permission(i.organization_id, 'members.delete');
  update public.invitations set status = 'revoked' where id = i.id and status = 'pending';
end;
$$;

-- Public preview (callable by anon) for the accept page.
create or replace function app.get_invitation(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'email', i.email, 'organization_name', o.name, 'role_name', r.name,
    'status', case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
    'expires_at', i.expires_at)
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  join public.roles r on r.id = i.role_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

create or replace function private.enroll(p_org uuid, p_program uuid, p_user uuid, p_source text,
                                          p_access_days int default null, p_purchase uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  eid uuid;
  total int;
  p public.programs;
begin
  select * into p from public.programs where id = p_program and organization_id = p_org and deleted_at is null;
  if p.id is null then raise exception 'program not found in this workspace'; end if;
  select count(*) into total from public.lessons where program_id = p_program and deleted_at is null and status = 'published';

  insert into public.program_enrollments (organization_id, program_id, user_id, source, source_purchase_id, enrolled_by,
                                          access_expires_at, lessons_total)
  values (p_org, p_program, p_user, p_source, p_purchase, auth.uid(),
          case when coalesce(p_access_days, p.default_access_days) is not null
               then now() + make_interval(days => coalesce(p_access_days, p.default_access_days)) end,
          total)
  on conflict (program_id, user_id) do update
    set status = case when public.program_enrollments.status in ('revoked', 'expired') then 'active'
                      else public.program_enrollments.status end,
        access_expires_at = excluded.access_expires_at,
        lessons_total = excluded.lessons_total
  returning id into eid;

  perform private.emit_event(p_org, 'enrollment.created', 'program', p_program,
                             jsonb_build_object('user_id', p_user, 'enrollment_id', eid, 'source', p_source));
  perform private.notify(p_org, p_user, 'enrollment.created', 'You now have access to ' || p.title,
                         null, '/programs/' || p.slug, 'program', p.id);
  return eid;
end;
$$;

create or replace function app.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  i     public.invitations;
  r     public.roles;
  pid   uuid;
  mid   uuid;
  staff uuid;
begin
  if uid is null then raise exception 'sign in to accept this invitation' using errcode = '28000'; end if;
  select * into i from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if i.id is null then raise exception 'invitation not found' using errcode = 'P0002'; end if;
  if i.status <> 'pending' then raise exception 'invitation is %', i.status; end if;
  if i.expires_at < now() then
    update public.invitations set status = 'expired' where id = i.id;
    raise exception 'invitation expired';
  end if;
  if not exists (select 1 from public.users u where u.id = uid and u.email = i.email) then
    raise exception 'this invitation was sent to a different email address' using errcode = '42501';
  end if;
  select * into r from public.roles where id = i.role_id;

  insert into public.organization_memberships (organization_id, user_id, role_id, status, invited_by)
  values (i.organization_id, uid, i.role_id, 'active', i.invited_by)
  on conflict (organization_id, user_id) do update
    set role_id = excluded.role_id, status = 'active', joined_at = now()
  returning id into mid;

  update public.invitations set status = 'accepted', accepted_at = now(), accepted_by = uid where id = i.id;

  for pid in select (jsonb_array_elements_text(coalesce(i.payload->'program_ids', '[]')))::uuid loop
    perform private.enroll(i.organization_id, pid, uid, 'invitation');
  end loop;

  -- tasks from onboarding templates waiting for this role
  insert into public.task_assignments (organization_id, task_id, user_id)
  select t.organization_id, t.id, uid from public.tasks t
  where t.organization_id = i.organization_id and t.assignee_role_key = r.key and t.deleted_at is null
    and not exists (select 1 from public.task_assignments ta where ta.task_id = t.id)
  on conflict do nothing;

  if r.key = 'client_admin' then
    update public.client_profiles set primary_contact_user_id = coalesce(primary_contact_user_id, uid)
    where organization_id = i.organization_id;
  end if;

  perform private.log_activity(i.organization_id, 'user', uid, 'joined', 'Joined the workspace as ' || r.name);
  perform private.log_audit(i.organization_id, 'invitation_accepted', 'invitations', i.id);
  perform private.emit_event(i.organization_id, 'member.joined', 'user', uid, jsonb_build_object('role', r.key));
  for staff in select t.user_id from public.team_assignments t where t.organization_id = i.organization_id and t.status = 'active' loop
    perform private.notify(i.organization_id, staff, 'member.joined', (select email::text from public.users where id = uid) || ' joined', null, '/team');
  end loop;
  return i.organization_id;
end;
$$;

create or replace function app.change_member_role(p_membership_id uuid, p_role_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.organization_memberships;
  r public.roles;
begin
  select * into m from public.organization_memberships where id = p_membership_id for update;
  if m.id is null then raise exception 'membership not found'; end if;
  perform private.assert_permission(m.organization_id, 'roles.manage');
  if m.user_id = private.effective_user_id() or m.user_id = auth.uid() then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;
  r := private.role_by_key(m.organization_id, p_role_key);
  if r.id is null or r.audience <> 'member' then raise exception 'unknown member role %', p_role_key; end if;
  -- must cover both the current and the new permission sets
  perform private.assert_subset_of_caller(m.organization_id, private.permission_set(m.organization_id, m.user_id), 'changes to this member');
  perform private.assert_subset_of_caller(m.organization_id, private.role_permission_keys(r.id), 'role ' || r.key);
  update public.organization_memberships set role_id = r.id where id = m.id;
  perform private.log_activity(m.organization_id, 'user', m.user_id, 'role_changed', 'Role changed to ' || r.name);
end;
$$;

create or replace function app.remove_member(p_membership_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.organization_memberships;
begin
  select * into m from public.organization_memberships where id = p_membership_id for update;
  if m.id is null then raise exception 'membership not found'; end if;
  perform private.assert_permission(m.organization_id, 'members.delete');
  if m.user_id = private.effective_user_id() then raise exception 'you cannot remove yourself' using errcode = '42501'; end if;
  perform private.assert_subset_of_caller(m.organization_id, private.permission_set(m.organization_id, m.user_id), 'removal of this member');
  update public.organization_memberships set status = 'removed' where id = m.id;
  update public.program_enrollments set status = 'revoked' where organization_id = m.organization_id and user_id = m.user_id and status = 'active';
  perform private.log_activity(m.organization_id, 'user', m.user_id, 'removed', 'Member removed');
end;
$$;

create or replace function app.set_permission_override(p_organization_id uuid, p_user_id uuid, p_permission_key text,
                                                       p_effect text, p_reason text default null, p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare perm uuid;
begin
  perform private.assert_permission(p_organization_id, 'roles.manage');
  if p_user_id = private.effective_user_id() or p_user_id = auth.uid() then
    raise exception 'you cannot change your own permissions' using errcode = '42501';
  end if;
  perform private.assert_member_of_org(p_organization_id, p_user_id);
  select id into perm from public.permissions where key = p_permission_key;
  if perm is null then raise exception 'unknown permission %', p_permission_key; end if;
  -- you can only grant what you hold, and only restrict people you fully cover
  perform private.assert_subset_of_caller(p_organization_id, array[p_permission_key], p_permission_key);
  perform private.assert_subset_of_caller(p_organization_id, private.permission_set(p_organization_id, p_user_id), 'changes to this user');

  if p_effect is null then
    delete from public.permission_overrides
    where organization_id = p_organization_id and user_id = p_user_id and permission_id = perm;
  elsif p_effect in ('grant', 'deny') then
    insert into public.permission_overrides (organization_id, user_id, permission_id, effect, reason, expires_at)
    values (p_organization_id, p_user_id, perm, p_effect, p_reason, p_expires_at)
    on conflict (organization_id, user_id, permission_id)
    do update set effect = excluded.effect, reason = excluded.reason, expires_at = excluded.expires_at;
  else
    raise exception 'effect must be grant, deny or null';
  end if;
end;
$$;

create or replace function app.upsert_custom_role(p_organization_id uuid, p_key text, p_name text,
                                                  p_permission_keys text[], p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  perform private.assert_permission(p_organization_id, 'roles.manage');
  if exists (select 1 from public.roles where key = p_key and organization_id is null) then
    raise exception 'role key % is reserved', p_key;
  end if;
  if exists (select 1 from unnest(p_permission_keys) k where not exists (select 1 from public.permissions p where p.key = k)) then
    raise exception 'unknown permission in list';
  end if;
  perform private.assert_subset_of_caller(p_organization_id, p_permission_keys, 'custom role');

  insert into public.roles (organization_id, key, name, description, scope, audience, rank, is_system)
  values (p_organization_id, p_key, p_name, p_description, 'organization', 'member', 30, false)
  on conflict (organization_id, key) where organization_id is not null
  do update set name = excluded.name, description = excluded.description
  returning id into rid;

  delete from public.role_permissions where role_id = rid;
  insert into public.role_permissions (role_id, permission_id)
  select rid, p.id from public.permissions p where p.key = any (p_permission_keys);
  return rid;
end;
$$;

create or replace function app.assign_team_member(p_organization_id uuid, p_user_id uuid, p_role_key text, p_is_primary boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.roles;
  aid uuid;
begin
  if not (private.is_super_admin()
          or (private.is_platform_staff() and private.has_permission(p_organization_id, 'members.update'))) then
    raise exception 'only the super admin or an assigned account manager can assign staff' using errcode = '42501';
  end if;
  if not exists (select 1 from public.platform_staff where user_id = p_user_id and status = 'active') then
    raise exception 'user is not an active internal team member';
  end if;
  r := private.role_by_key(null, p_role_key);
  if r.id is null or r.audience <> 'staff' then raise exception 'unknown staff role %', p_role_key; end if;
  perform private.assert_subset_of_caller(p_organization_id, private.role_permission_keys(r.id), 'role ' || r.key);

  insert into public.team_assignments (organization_id, user_id, role_id, is_primary, status, ends_at)
  values (p_organization_id, p_user_id, r.id, p_is_primary, 'active', null)
  on conflict (organization_id, user_id) do update
    set role_id = excluded.role_id, is_primary = excluded.is_primary, status = 'active', ends_at = null
  returning id into aid;

  if p_is_primary then
    perform private.bypass_org_guard();
    update public.client_profiles
       set account_manager_id = case when r.key = 'account_manager' then p_user_id else account_manager_id end,
           primary_coach_id   = case when r.key = 'coach' then p_user_id else primary_coach_id end
     where organization_id = p_organization_id;
    perform private.end_org_guard_bypass();
  end if;
  perform private.notify(p_organization_id, p_user_id, 'team.assigned',
                         'You were assigned to ' || (select name from public.organizations where id = p_organization_id),
                         'Role: ' || r.name, '/admin/clients/' || p_organization_id);
  perform private.log_activity(p_organization_id, 'user', p_user_id, 'staff_assigned', r.name || ' assigned');
  return aid;
end;
$$;

create or replace function app.end_team_assignment(p_organization_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_super_admin();
  update public.team_assignments set status = 'ended', ends_at = now()
  where organization_id = p_organization_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create or replace function private.ensure_kpi(p_src_kpi uuid, p_org uuid, p_template uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  k text;
  kid uuid;
begin
  select key into k from public.kpi_definitions where id = p_src_kpi;
  select id into kid from public.kpi_definitions where organization_id = p_org and key = k and deleted_at is null;
  if kid is null then
    kid := private.clone_row('kpi_definitions', p_src_kpi,
             jsonb_build_object('organization_id', p_org, 'owner_id', null, 'source_template_id', p_template));
  end if;
  return kid;
end;
$$;

create or replace function private.copy_program(p_src uuid, p_org uuid, p_template uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  map      jsonb := '{}';
  new_prog uuid;
  v_slug   text;
  r        record;
  nid      uuid;
begin
  select slug into v_slug from public.programs where id = p_src;
  while exists (select 1 from public.programs where organization_id = p_org and slug = v_slug) loop
    v_slug := v_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
  end loop;
  new_prog := private.clone_row('programs', p_src, jsonb_build_object(
    'organization_id', p_org, 'slug', v_slug, 'source_template_id', p_template, 'cover_file_id', null));

  for r in select id from public.program_sections where program_id = p_src and deleted_at is null order by position loop
    nid := private.clone_row('program_sections', r.id, jsonb_build_object('organization_id', p_org, 'program_id', new_prog));
    map := map || jsonb_build_object(r.id::text, nid);
  end loop;
  for r in select id, section_id from public.modules where program_id = p_src and deleted_at is null loop
    nid := private.clone_row('modules', r.id, jsonb_build_object('organization_id', p_org, 'program_id', new_prog,
             'section_id', map->>r.section_id::text));
    map := map || jsonb_build_object(r.id::text, nid);
  end loop;
  for r in select id, module_id from public.lessons where program_id = p_src and deleted_at is null loop
    nid := private.clone_row('lessons', r.id, jsonb_build_object('organization_id', p_org, 'program_id', new_prog,
             'module_id', map->>r.module_id::text, 'source_template_id', p_template));
    map := map || jsonb_build_object(r.id::text, nid);
  end loop;
  for r in select id, lesson_id, file_id, content from public.lesson_blocks where program_id = p_src loop
    -- files are tenant-scoped: the library file id is kept in content for a media-copy job
    perform private.clone_row('lesson_blocks', r.id, jsonb_build_object('organization_id', p_org, 'program_id', new_prog,
             'lesson_id', map->>r.lesson_id::text, 'file_id', null,
             'content', case when r.file_id is not null
                             then r.content || jsonb_build_object('library_file_id', r.file_id) else r.content end));
  end loop;
  for r in select id, module_id, lesson_id from public.resources
           where program_id = p_src and deleted_at is null and file_id is null loop
    perform private.clone_row('resources', r.id, jsonb_build_object('organization_id', p_org, 'program_id', new_prog,
             'module_id', map->>r.module_id::text, 'lesson_id', map->>r.lesson_id::text));
  end loop;
  for r in select id, lesson_id from public.assignments where program_id = p_src and deleted_at is null loop
    perform private.clone_row('assignments', r.id, jsonb_build_object('organization_id', p_org, 'program_id', new_prog,
             'lesson_id', map->>r.lesson_id::text));
  end loop;
  for r in select id, lesson_id from public.quizzes where program_id = p_src and deleted_at is null loop
    nid := private.clone_row('quizzes', r.id, jsonb_build_object('organization_id', p_org, 'program_id', new_prog,
             'lesson_id', map->>r.lesson_id::text));
    map := map || jsonb_build_object(r.id::text, nid);
  end loop;
  for r in select q.id, q.quiz_id, k.correct from public.quiz_questions q
           left join public.quiz_answer_keys k on k.question_id = q.id
           where q.program_id = p_src loop
    nid := private.clone_row('quiz_questions', r.id, jsonb_build_object('organization_id', p_org, 'program_id', new_prog,
             'quiz_id', map->>r.quiz_id::text));
    if r.correct is not null then
      insert into public.quiz_answer_keys (question_id, organization_id, correct) values (nid, p_org, r.correct);
    end if;
  end loop;
  return new_prog;
end;
$$;

create or replace function private.apply_template(p_type text, p_template uuid, p_org uuid, p_options jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  src   uuid;
  root  uuid;
  r     record;
  nid   uuid;
  map   jsonb := '{}';
  uids  uuid[];
begin
  if not exists (select 1 from public.organizations where id = p_org and kind = 'client') then
    raise exception 'templates can only be applied to client workspaces';
  end if;

  case p_type
  when 'program' then
    select source_program_id into src from public.program_templates where id = p_template and is_active;
    if src is null then raise exception 'program template not found'; end if;
    root := private.copy_program(src, p_org, p_template);

  when 'lesson' then
    select source_lesson_id into src from public.lesson_templates where id = p_template and is_active;
    if src is null then raise exception 'lesson template not found'; end if;
    select id, program_id into r from public.modules
      where id = (p_options->>'module_id')::uuid and organization_id = p_org and deleted_at is null;
    if r.id is null then raise exception 'lesson templates need options.module_id in the target workspace'; end if;
    root := private.clone_row('lessons', src, jsonb_build_object('organization_id', p_org, 'program_id', r.program_id,
              'module_id', r.id, 'source_template_id', p_template,
              'position', coalesce((select max(position) + 1 from public.lessons where module_id = r.id), 0)));
    insert into public.lesson_blocks (organization_id, program_id, lesson_id, block_type, position, content)
    select p_org, r.program_id, root, block_type, position, content from public.lesson_blocks where lesson_id = src;

  when 'scorecard' then
    select source_scorecard_id into src from public.scorecard_templates where id = p_template and is_active;
    if src is null then raise exception 'scorecard template not found'; end if;
    root := private.clone_row('scorecards', src, jsonb_build_object('organization_id', p_org, 'owner_id', null, 'source_template_id', p_template));
    for r in select kpi_definition_id, position, is_required from public.scorecard_kpis where scorecard_id = src loop
      insert into public.scorecard_kpis (organization_id, scorecard_id, kpi_definition_id, position, is_required)
      values (p_org, root, private.ensure_kpi(r.kpi_definition_id, p_org, p_template), r.position, r.is_required)
      on conflict do nothing;
    end loop;

  when 'dashboard' then
    select source_dashboard_id into src from public.dashboard_templates where id = p_template and is_active;
    if src is null then raise exception 'dashboard template not found'; end if;
    root := private.clone_row('dashboards', src, jsonb_build_object('organization_id', p_org, 'owner_id', null,
              'shared_with', '{}'::uuid[], 'source_template_id', p_template));
    for r in select id, kpi_definition_id from public.dashboard_widgets where dashboard_id = src loop
      perform private.clone_row('dashboard_widgets', r.id, jsonb_build_object('organization_id', p_org, 'dashboard_id', root,
        'kpi_definition_id', case when r.kpi_definition_id is not null then private.ensure_kpi(r.kpi_definition_id, p_org, p_template) end));
    end loop;

  when 'sop' then
    select source_sop_id into src from public.sop_templates where id = p_template and is_active;
    if src is null then raise exception 'SOP template not found'; end if;
    root := private.clone_row('standard_operating_procedures', src, jsonb_build_object('organization_id', p_org,
              'owner_id', null, 'current_version_id', null, 'source_template_id', p_template));
    select current_version_id into r from public.standard_operating_procedures where id = src;
    if r.current_version_id is not null then
      nid := private.clone_row('sop_versions', r.current_version_id, jsonb_build_object('organization_id', p_org, 'sop_id', root, 'version', 1));
      update public.standard_operating_procedures set current_version_id = nid where id = root;
    end if;

  when 'offer' then
    select source_offer_id into src from public.offer_templates where id = p_template and is_active;
    if src is null then raise exception 'offer template not found'; end if;
    root := private.clone_row('offers', src, jsonb_build_object('organization_id', p_org, 'current_version_id', null,
              'stripe_product_id', null, 'status', 'draft', 'source_template_id', p_template));
    for r in select id from public.offer_versions where offer_id = src loop
      nid := private.clone_row('offer_versions', r.id, jsonb_build_object('organization_id', p_org, 'offer_id', root));
      map := map || jsonb_build_object(r.id::text, nid);
    end loop;
    update public.offers set current_version_id = (map->>(select current_version_id::text from public.offers where id = src))::uuid
    where id = root;
    for r in select id, offer_version_id from public.pricing_options where offer_id = src and deleted_at is null loop
      perform private.clone_row('pricing_options', r.id, jsonb_build_object('organization_id', p_org, 'offer_id', root,
        'offer_version_id', map->>r.offer_version_id::text, 'stripe_price_id', null));
    end loop;
    -- entitlements map onto programs previously copied from the same library program
    insert into public.offer_entitlements (organization_id, offer_id, entitlement_type, program_id, access_days)
    select p_org, root, e.entitlement_type, cp.id, e.access_days
    from public.offer_entitlements e
    join lateral (select p.id from public.programs p
                  where p.organization_id = p_org and p.copied_from_id = e.program_id and p.deleted_at is null
                  order by p.created_at desc limit 1) cp on true
    where e.offer_id = src;

  when 'pipeline' then
    select source_pipeline_id into src from public.pipeline_templates where id = p_template and is_active;
    if src is null then raise exception 'pipeline template not found'; end if;
    root := private.clone_row('pipelines', src, jsonb_build_object('organization_id', p_org, 'source_template_id', p_template,
              'is_default', not exists (select 1 from public.pipelines where organization_id = p_org and deleted_at is null)));
    for r in select id from public.pipeline_stages where pipeline_id = src loop
      perform private.clone_row('pipeline_stages', r.id, jsonb_build_object('organization_id', p_org, 'pipeline_id', root));
    end loop;

  when 'task' then
    if not exists (select 1 from public.task_templates where id = p_template and is_active) then
      raise exception 'task template not found';
    end if;
    for r in select * from public.task_template_items where task_template_id = p_template order by position loop
      select coalesce(array_agg(distinct x.user_id), '{}') into uids from (
        select m.user_id from public.organization_memberships m join public.roles ro on ro.id = m.role_id
        where m.organization_id = p_org and m.status = 'active' and ro.key = r.assignee_role_key
        union
        select t.user_id from public.team_assignments t join public.roles ro on ro.id = t.role_id
        where t.organization_id = p_org and t.status = 'active' and ro.key = r.assignee_role_key
      ) x;
      insert into public.tasks (organization_id, title, description, task_type, priority, visibility, due_at,
                                position, source_template_id, assignee_role_key)
      values (p_org, r.title, r.description, r.task_type, r.priority, r.visibility,
              case when r.due_offset_days is not null then now() + make_interval(days => r.due_offset_days) end,
              r.position, p_template, r.assignee_role_key)
      returning id into nid;
      insert into public.task_assignments (organization_id, task_id, user_id)
      select p_org, nid, u from unnest(uids) u;
      root := coalesce(root, nid);
    end loop;

  else
    raise exception 'unknown template type %', p_type;
  end case;

  insert into public.template_applications (organization_id, template_type, template_id, created_root_id, detail)
  values (p_org, p_type, p_template, root, coalesce(p_options, '{}'));
  perform private.log_activity(p_org, 'organization', p_org, 'template_applied',
                               'Applied ' || p_type || ' template', jsonb_build_object('template_id', p_template, 'root_id', root));
  return root;
end;
$$;

create or replace function app.apply_template(p_template_type text, p_template_id uuid, p_organization_id uuid, p_options jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.is_super_admin() then
    perform private.assert_permission(p_organization_id, 'templates.apply');
  end if;
  return private.apply_template(p_template_type, p_template_id, p_organization_id, p_options);
end;
$$;

-- p_items: [{"type":"program","id":"...","options":{}}]
create or replace function app.apply_templates_bulk(p_items jsonb, p_organization_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  it  jsonb;
  n   int := 0;
begin
  perform private.assert_super_admin();
  foreach org in array p_organization_ids loop
    for it in select * from jsonb_array_elements(p_items) loop
      perform private.apply_template(it->>'type', (it->>'id')::uuid, org, coalesce(it->'options', '{}'));
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client organization lifecycle
-- ---------------------------------------------------------------------------
create or replace function app.create_client_organization(
  p_name                   text,
  p_slug                   text,
  p_onboarding_template_id uuid default null,
  p_admin_email            text default null,
  p_account_manager_id     uuid default null,
  p_coach_id               uuid default null,
  p_profile                jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  org_id   uuid;
  item     record;
  inv      jsonb;
  admin_programs uuid[] := '{}';
  root     uuid;
  tmpl     public.onboarding_templates;
begin
  perform private.assert_super_admin();

  insert into public.organizations (kind, name, slug, status, timezone, currency, website)
  values ('client', p_name, lower(p_slug), 'onboarding',
          coalesce(p_profile->>'timezone', 'America/New_York'), coalesce(p_profile->>'currency', 'USD'), p_profile->>'website')
  returning id into org_id;

  select * into tmpl from public.onboarding_templates
  where id = coalesce(p_onboarding_template_id, (select id from public.onboarding_templates where is_default and is_active));

  insert into public.client_profiles (organization_id, legal_name, industry, business_model, start_date, renewal_date,
                                      contract_term_months, contract_value_cents, mrr_cents,
                                      current_monthly_revenue_cents, revenue_target_cents, onboarding_template_id, tags)
  values (org_id, p_profile->>'legal_name', p_profile->>'industry', p_profile->>'business_model',
          coalesce((p_profile->>'start_date')::date, current_date), (p_profile->>'renewal_date')::date,
          (p_profile->>'contract_term_months')::int, (p_profile->>'contract_value_cents')::bigint,
          (p_profile->>'mrr_cents')::bigint, (p_profile->>'current_monthly_revenue_cents')::bigint,
          (p_profile->>'revenue_target_cents')::bigint, tmpl.id,
          coalesce(array(select jsonb_array_elements_text(p_profile->'tags')), '{}'));

  if p_account_manager_id is not null then
    perform app.assign_team_member(org_id, p_account_manager_id, 'account_manager', true);
  end if;
  if p_coach_id is not null then
    perform app.assign_team_member(org_id, p_coach_id, 'coach', true);
  end if;

  if tmpl.id is not null then
    for item in select * from public.onboarding_template_items where onboarding_template_id = tmpl.id order by position loop
      root := private.apply_template(item.template_type, item.template_id, org_id, item.options);
      if item.template_type = 'program' and coalesce((item.options->>'enroll_invited_admin')::boolean, true) then
        admin_programs := admin_programs || root;
      end if;
    end loop;
  end if;

  if p_admin_email is not null then
    inv := private.create_invitation(org_id, p_admin_email, (private.role_by_key(null, 'client_admin')).id,
             jsonb_build_object('program_ids', to_jsonb(admin_programs), 'message', tmpl.welcome_message));
  end if;

  perform private.log_activity(org_id, 'organization', org_id, 'created', 'Client workspace created');
  perform private.emit_event(org_id, 'client.created', 'organization', org_id,
                             jsonb_build_object('onboarding_template_id', tmpl.id));
  return jsonb_build_object('organization_id', org_id,
                            'invitation_id', inv->>'invitation_id',
                            'invitation_token', inv->>'token');
end;
$$;

create or replace function app.set_organization_status(p_organization_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare old_status text;
begin
  perform private.assert_super_admin();
  select status into old_status from public.organizations where id = p_organization_id for update;
  update public.organizations
     set status = p_status,
         suspended_at = case when p_status = 'suspended' then now() else null end,
         archived_at  = case when p_status = 'archived' then now() else null end
   where id = p_organization_id;
  perform private.log_audit(p_organization_id, 'status_change', 'organizations', p_organization_id,
                            jsonb_build_object('from', old_status, 'to', p_status, 'reason', p_reason));
  perform private.emit_event(p_organization_id, 'client.status_changed', 'organization', p_organization_id,
                             jsonb_build_object('from', old_status, 'to', p_status));
end;
$$;

-- Clients cannot read the template registry, so the questionnaire is served here.
create or replace function app.get_onboarding_questionnaire(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare qid uuid;
begin
  if p_organization_id not in (select private.orgs_with_access()) then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  select t.questionnaire_id into qid from public.client_profiles cp
    join public.onboarding_templates t on t.id = cp.onboarding_template_id
    where cp.organization_id = p_organization_id;
  if qid is null then return null; end if;
  return (
    select jsonb_build_object(
      'questionnaire_id', q.id, 'name', q.name, 'description', q.description,
      'submitted_at', (select submitted_at from public.questionnaire_responses r
                       where r.organization_id = p_organization_id and r.questionnaire_id = q.id),
      'answers', (select answers from public.questionnaire_responses r
                  where r.organization_id = p_organization_id and r.questionnaire_id = q.id),
      'questions', (select jsonb_agg(jsonb_build_object('key', qq.key, 'label', qq.label, 'help_text', qq.help_text,
                      'type', qq.question_type, 'options', qq.options, 'required', qq.is_required) order by qq.position)
                    from public.questionnaire_questions qq where qq.questionnaire_id = q.id))
    from public.onboarding_questionnaires q where q.id = qid);
end;
$$;

create or replace function app.unlock_lesson(p_lesson_id uuid, p_user_id uuid, p_reason text default null, p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.lessons;
begin
  select * into l from public.lessons where id = p_lesson_id and deleted_at is null;
  if l.id is null then raise exception 'lesson not found' using errcode = 'P0002'; end if;
  perform private.assert_permission(l.organization_id, 'enrollments.update');
  perform private.assert_member_of_org(l.organization_id, p_user_id);
  insert into public.lesson_unlocks (organization_id, lesson_id, user_id, reason, expires_at)
  values (l.organization_id, l.id, p_user_id, p_reason, p_expires_at)
  on conflict (lesson_id, user_id) do update set reason = excluded.reason, expires_at = excluded.expires_at;
  perform private.notify(l.organization_id, p_user_id, 'lesson.unlocked', 'Unlocked: ' || l.title, p_reason, null, 'lesson', l.id);
end;
$$;

create or replace function app.submit_onboarding_questionnaire(p_organization_id uuid, p_answers jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := private.require_user();
  qid    uuid;
  q      record;
  ans    jsonb;
  rid    uuid;
  kid    uuid;
  kpi    public.kpi_definitions;
  profile_cols text[] := array['legal_name', 'industry', 'business_model', 'team_size',
                               'current_monthly_revenue_cents', 'revenue_target_cents'];
begin
  perform private.assert_permission(p_organization_id, 'organization.update');
  select t.questionnaire_id into qid from public.client_profiles cp
    join public.onboarding_templates t on t.id = cp.onboarding_template_id
    where cp.organization_id = p_organization_id;
  if qid is null then raise exception 'no onboarding questionnaire for this workspace'; end if;

  for q in select * from public.questionnaire_questions where questionnaire_id = qid and is_required loop
    if coalesce(p_answers->>q.key, '') = '' then raise exception 'answer required: %', q.label; end if;
  end loop;

  insert into public.questionnaire_responses (organization_id, questionnaire_id, user_id, answers, status, submitted_at)
  values (p_organization_id, qid, uid, p_answers, 'submitted', now())
  on conflict (organization_id, questionnaire_id) do update
    set answers = excluded.answers, user_id = excluded.user_id, submitted_at = now(), status = 'submitted'
  returning id into rid;

  perform private.bypass_org_guard();
  for q in select * from public.questionnaire_questions where questionnaire_id = qid and maps_to_type is not null loop
    ans := p_answers->q.key;
    continue when ans is null or ans = 'null'::jsonb;
    case q.maps_to_type
    when 'client_profile' then
      if q.maps_to_key = any (profile_cols) then
        execute format('update public.client_profiles set %I = ($1 #>> ''{}'')::%s where organization_id = $2',
                       q.maps_to_key,
                       case when q.maps_to_key in ('team_size') then 'int'
                            when q.maps_to_key like '%_cents' then 'bigint' else 'text' end)
          using ans, p_organization_id;
      end if;
    when 'kpi_baseline' then
      select * into kpi from public.kpi_definitions
        where organization_id = p_organization_id and key = q.maps_to_key and deleted_at is null;
      if kpi.id is not null then
        insert into public.kpi_entries (organization_id, kpi_definition_id, period_start, period_end, value, target_value, source, note, entered_by)
        select p_organization_id, kpi.id, b.period_start, b.period_end, (ans #>> '{}')::numeric, kpi.goal_value,
               'onboarding_baseline', 'Baseline from onboarding questionnaire', uid
        from private.period_bounds(kpi.frequency, (current_date - case kpi.frequency when 'weekly' then 7 when 'daily' then 1
                                                                              when 'monthly' then 28 else 90 end)) b
        on conflict (kpi_definition_id, period_start) do nothing;
      end if;
    when 'custom_field' then
      insert into public.custom_field_values (organization_id, custom_field_id, entity_id, value)
      select p_organization_id, cf.id, p_organization_id, ans from public.custom_fields cf
      where cf.organization_id = p_organization_id and cf.entity_type = 'organization' and cf.key = q.maps_to_key
      on conflict (custom_field_id, entity_id) do update set value = excluded.value;
    when 'goal' then
      insert into public.goals (organization_id, title, target_value, timeframe, starts_on, ends_on, owner_id)
      values (p_organization_id, q.label, nullif(regexp_replace(ans #>> '{}', '[^0-9.]', '', 'g'), '')::numeric,
              'annual', current_date, (current_date + interval '1 year')::date, uid);
    else null;
    end case;
  end loop;

  update public.client_profiles
     set baseline = baseline || jsonb_build_object('questionnaire', p_answers, 'captured_at', now()),
         onboarding_completed_at = now(),
         last_interaction_at = now()
   where organization_id = p_organization_id;
  update public.organizations set status = 'active' where id = p_organization_id and status = 'onboarding';
  perform private.end_org_guard_bypass();

  perform private.log_activity(p_organization_id, 'organization', p_organization_id, 'questionnaire_submitted', 'Onboarding questionnaire submitted');
  perform private.emit_event(p_organization_id, 'questionnaire.submitted', 'organization', p_organization_id, '{}');
  return rid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Programs: enrollment, outline, progress
-- ---------------------------------------------------------------------------
create or replace function app.enroll_user(p_organization_id uuid, p_program_id uuid, p_user_id uuid,
                                           p_source text default 'manual', p_access_days int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_permission(p_organization_id, 'enrollments.create');
  perform private.assert_member_of_org(p_organization_id, p_user_id);
  return private.enroll(p_organization_id, p_program_id, p_user_id, p_source, p_access_days);
end;
$$;

create or replace function app.revoke_enrollment(p_enrollment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.program_enrollments;
begin
  select * into e from public.program_enrollments where id = p_enrollment_id;
  perform private.assert_permission(e.organization_id, 'enrollments.update');
  update public.program_enrollments set status = 'revoked' where id = e.id;
end;
$$;

create or replace function app.get_program_outline(p_program_id uuid)
returns table (
  section_id uuid, section_title text, section_position int,
  module_id uuid, module_title text, module_position int,
  lesson_id uuid, lesson_title text, lesson_position int, estimated_minutes int,
  is_available boolean, unlocks_at timestamptz, lock_reason text,
  progress_status text, completed_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  p public.programs;
  e public.program_enrollments;
  builder boolean;
begin
  select * into p from public.programs where id = p_program_id and deleted_at is null;
  if p.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;
  builder := private.has_permission(p.organization_id, 'programs.read');
  if not builder and p.id not in (select private.my_enrolled_program_ids()) then
    raise exception 'not enrolled in this program' using errcode = '42501';
  end if;
  select * into e from public.program_enrollments where program_id = p.id and user_id = uid;

  return query
  select s.id, s.title, s.position, m.id, m.title, m.position,
         l.id, l.title, l.position, l.estimated_minutes,
         case when builder and e.id is null then true else a.is_available end,
         a.unlocks_at,
         case when builder and e.id is null then null else a.lock_reason end,
         coalesce(lp.status, 'not_started'), lp.completed_at
  from public.program_sections s
  join public.modules m on m.section_id = s.id and m.deleted_at is null
  join public.lessons l on l.module_id = m.id and l.deleted_at is null and (l.status = 'published' or builder)
  left join public.lesson_progress lp on lp.lesson_id = l.id and lp.enrollment_id = e.id
  cross join lateral private.lesson_availability(l.id, uid) a
  where s.program_id = p.id and s.deleted_at is null
  order by s.position, m.position, l.position;
end;
$$;

create or replace function private.recalc_enrollment(p_enrollment uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e       public.program_enrollments;
  p       public.programs;
  total   int;
  done    int;
  pct     numeric;
  cert    uuid;
  just_completed boolean := false;
begin
  select * into e from public.program_enrollments where id = p_enrollment for update;
  select * into p from public.programs where id = e.program_id;

  insert into public.module_progress (organization_id, enrollment_id, module_id, user_id, lessons_completed, lessons_total, progress_percent, completed_at)
  select e.organization_id, e.id, m.id, e.user_id,
         count(lp.id) filter (where lp.status = 'completed'),
         count(l.id),
         round(100.0 * count(lp.id) filter (where lp.status = 'completed') / greatest(count(l.id), 1), 2),
         case when count(l.id) > 0 and count(lp.id) filter (where lp.status = 'completed') = count(l.id) then now() end
  from public.modules m
  join public.lessons l on l.module_id = m.id and l.deleted_at is null and l.status = 'published'
  left join public.lesson_progress lp on lp.lesson_id = l.id and lp.enrollment_id = e.id
  where m.program_id = e.program_id and m.deleted_at is null
  group by m.id
  on conflict (enrollment_id, module_id) do update
    set lessons_completed = excluded.lessons_completed, lessons_total = excluded.lessons_total,
        progress_percent = excluded.progress_percent,
        completed_at = coalesce(public.module_progress.completed_at, excluded.completed_at),
        updated_at = now();

  select count(*), count(lp.id) filter (where lp.status = 'completed')
    into total, done
  from public.lessons l
  left join public.lesson_progress lp on lp.lesson_id = l.id and lp.enrollment_id = e.id
  where l.program_id = e.program_id and l.deleted_at is null and l.status = 'published';
  pct := round(100.0 * done / greatest(total, 1), 2);

  if total > 0 and done = total and e.completed_at is null then
    just_completed := true;
  end if;

  update public.program_enrollments
     set lessons_total = total, lessons_completed = done, progress_percent = pct,
         last_activity_at = now(),
         completed_at = case when just_completed then now() else completed_at end,
         status = case when just_completed then 'completed' else status end
   where id = e.id;

  if just_completed then
    if p.certificate_enabled then
      insert into public.certificates (organization_id, enrollment_id, program_id, user_id)
      values (e.organization_id, e.id, e.program_id, e.user_id)
      on conflict (enrollment_id) do nothing
      returning id into cert;
    end if;
    perform private.emit_event(e.organization_id, 'program.completed', 'program', e.program_id,
                               jsonb_build_object('user_id', e.user_id, 'enrollment_id', e.id, 'certificate_id', cert));
    perform private.notify(e.organization_id, e.user_id, 'program.completed', 'You completed ' || p.title, null, '/programs/' || p.slug);
  end if;

  return jsonb_build_object('progress_percent', pct, 'lessons_completed', done, 'lessons_total', total,
                            'program_completed', just_completed, 'certificate_id', cert);
end;
$$;

create or replace function app.record_lesson_view(p_lesson_id uuid, p_percent_watched numeric default null, p_position_s int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.lessons;
  e public.program_enrollments;
begin
  select * into l from public.lessons where id = p_lesson_id;
  select * into e from public.program_enrollments where program_id = l.program_id and user_id = uid;
  if e.id is null or not (select is_available from private.lesson_availability(l.id, uid)) then
    raise exception 'lesson is not available' using errcode = '42501';
  end if;
  insert into public.lesson_progress (organization_id, enrollment_id, lesson_id, user_id, status, percent_watched, last_position_s)
  values (l.organization_id, e.id, l.id, uid, 'in_progress', p_percent_watched, p_position_s)
  on conflict (enrollment_id, lesson_id) do update
    set percent_watched = greatest(coalesce(public.lesson_progress.percent_watched, 0), coalesce(excluded.percent_watched, 0)),
        last_position_s = coalesce(excluded.last_position_s, public.lesson_progress.last_position_s);
  update public.program_enrollments set last_activity_at = now() where id = e.id;
end;
$$;

create or replace function app.complete_lesson(p_lesson_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := private.require_user();
  l    public.lessons;
  e    public.program_enrollments;
  av   record;
  res  jsonb;
begin
  select * into l from public.lessons where id = p_lesson_id and deleted_at is null;
  if l.id is null then raise exception 'lesson not found' using errcode = 'P0002'; end if;
  select * into e from public.program_enrollments where program_id = l.program_id and user_id = uid;
  if e.id is null then raise exception 'not enrolled' using errcode = '42501'; end if;
  select * into av from private.lesson_availability(l.id, uid);
  if not av.is_available then
    raise exception 'lesson locked: %', av.lock_reason using errcode = '42501',
      detail = coalesce('unlocks at ' || av.unlocks_at::text, av.lock_reason);
  end if;

  if l.completion_rule = 'quiz_passed' and not exists (
      select 1 from public.quiz_attempts qa join public.quizzes q on q.id = qa.quiz_id
      where q.lesson_id = l.id and qa.user_id = uid and qa.passed) then
    raise exception 'pass the lesson quiz first';
  elsif l.completion_rule = 'assignment_submitted' and not exists (
      select 1 from public.assignment_submissions s join public.assignments a on a.id = s.assignment_id
      where a.lesson_id = l.id and s.user_id = uid and s.status in ('submitted', 'approved')) then
    raise exception 'submit the lesson assignment first';
  end if;

  insert into public.lesson_progress (organization_id, enrollment_id, lesson_id, user_id, status, completed_at)
  values (l.organization_id, e.id, l.id, uid, 'completed', now())
  on conflict (enrollment_id, lesson_id) do update
    set status = 'completed', completed_at = coalesce(public.lesson_progress.completed_at, now());

  res := private.recalc_enrollment(e.id);
  perform private.emit_event(l.organization_id, 'lesson.completed', 'lesson', l.id,
                             jsonb_build_object('user_id', uid, 'program_id', l.program_id, 'progress_percent', res->'progress_percent'));
  return res || jsonb_build_object('lesson_id', l.id);
end;
$$;

create or replace function app.submit_assignment(p_assignment_id uuid, p_body text default null,
                                                 p_links text[] default '{}', p_file_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  a   public.assignments;
  e   public.program_enrollments;
  sid uuid;
  n   int;
  grader uuid;
begin
  select * into a from public.assignments where id = p_assignment_id and deleted_at is null;
  if a.id is null then raise exception 'assignment not found'; end if;
  select * into e from public.program_enrollments where program_id = a.program_id and user_id = uid;
  if e.id is null or not (select is_available from private.lesson_availability(a.lesson_id, uid)) then
    raise exception 'assignment is not available' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_file_ids) f
             where not exists (select 1 from public.files x where x.id = f and x.organization_id = a.organization_id and x.created_by = uid)) then
    raise exception 'attached files must be your own uploads in this workspace' using errcode = '42501';
  end if;
  select coalesce(max(attempt), 0) + 1 into n from public.assignment_submissions where assignment_id = a.id and user_id = uid;

  insert into public.assignment_submissions (organization_id, assignment_id, enrollment_id, user_id, attempt, body, links, file_ids, status, submitted_at)
  values (a.organization_id, a.id, e.id, uid, n, p_body, p_links, p_file_ids,
          case when a.requires_review then 'submitted' else 'approved' end, now())
  returning id into sid;
  update public.files set entity_type = 'assignment_submission', entity_id = sid, visibility = 'linked'
  where id = any (p_file_ids);

  perform private.emit_event(a.organization_id, 'assignment.submitted', 'assignment_submission', sid,
                             jsonb_build_object('user_id', uid, 'assignment_id', a.id));
  for grader in select t.user_id from public.team_assignments t join public.roles r on r.id = t.role_id
                where t.organization_id = a.organization_id and t.status = 'active' and r.key in ('coach', 'account_manager') loop
    perform private.notify(a.organization_id, grader, 'assignment.submitted', 'New submission: ' || a.title, null,
                           '/reviews/' || sid, 'assignment_submission', sid);
  end loop;
  return sid;
end;
$$;

create or replace function app.review_submission(p_submission_id uuid, p_status text, p_feedback text default null, p_grade numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.assignment_submissions;
begin
  select * into s from public.assignment_submissions where id = p_submission_id for update;
  perform private.assert_permission(s.organization_id, 'programs.grade');
  if p_status not in ('needs_revision', 'approved', 'rejected') then raise exception 'invalid review status'; end if;
  update public.assignment_submissions
     set status = p_status, grade = p_grade, reviewed_at = now(), reviewed_by = private.effective_user_id()
   where id = s.id;
  if p_feedback is not null then
    insert into public.assignment_feedback (organization_id, submission_id, author_id, body)
    values (s.organization_id, s.id, private.effective_user_id(), p_feedback);
  end if;
  perform private.notify(s.organization_id, s.user_id, 'assignment.reviewed', 'Your assignment was reviewed: ' || replace(p_status, '_', ' '),
                         p_feedback, '/assignments/' || s.id, 'assignment_submission', s.id);
  perform private.emit_event(s.organization_id, 'assignment.reviewed', 'assignment_submission', s.id,
                             jsonb_build_object('status', p_status, 'user_id', s.user_id));
end;
$$;

-- p_answers: {"<question_id>": "<option_id>" | ["<option_id>", ...] | "free text"}
create or replace function app.submit_quiz_attempt(p_quiz_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  qz  public.quizzes;
  e   public.program_enrollments;
  n   int;
  earned numeric := 0;
  possible numeric := 0;
  q   record;
  given jsonb;
  ok  boolean;
  pct numeric;
begin
  select * into qz from public.quizzes where id = p_quiz_id and deleted_at is null;
  if qz.id is null then raise exception 'quiz not found'; end if;
  select * into e from public.program_enrollments where program_id = qz.program_id and user_id = uid;
  if e.id is null or not (select is_available from private.lesson_availability(qz.lesson_id, uid)) then
    raise exception 'quiz is not available' using errcode = '42501';
  end if;
  select count(*) + 1 into n from public.quiz_attempts where quiz_id = qz.id and user_id = uid;
  if qz.max_attempts is not null and n > qz.max_attempts then raise exception 'no attempts left'; end if;

  for q in select qq.id, qq.question_type, qq.points, k.correct
           from public.quiz_questions qq left join public.quiz_answer_keys k on k.question_id = qq.id
           where qq.quiz_id = qz.id loop
    possible := possible + q.points;
    given := p_answers->(q.id::text);
    ok := case q.question_type
      when 'multiple_choice' then
        (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(coalesce(given, '[]')) x)
        = (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(q.correct) x)
      when 'short_answer' then
        lower(trim(given #>> '{}')) = lower(trim(q.correct->>'text'))
      else
        (given #>> '{}') = (q.correct->>0)
    end;
    if coalesce(ok, false) then earned := earned + q.points; end if;
  end loop;
  pct := round(100 * earned / nullif(possible, 0), 2);

  insert into public.quiz_attempts (organization_id, quiz_id, enrollment_id, user_id, attempt, answers,
                                    score_points, max_points, score_percent, passed, submitted_at)
  values (qz.organization_id, qz.id, e.id, uid, n, p_answers, earned, possible, pct, coalesce(pct >= qz.pass_percent, false), now());
  return jsonb_build_object('attempt', n, 'score_percent', pct, 'passed', coalesce(pct >= qz.pass_percent, false));
end;
$$;

-- ---------------------------------------------------------------------------
-- KPIs & scorecards
-- ---------------------------------------------------------------------------
create or replace function private.refresh_goals_for_kpi(p_kpi uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g record;
  k public.kpi_definitions;
  val numeric;
  pct numeric;
  new_status text;
begin
  select * into k from public.kpi_definitions where id = p_kpi;
  -- quarterly goals
  for g in select * from public.quarterly_goals where kpi_definition_id = p_kpi and deleted_at is null loop
    select case k.aggregation when 'sum' then sum(value) when 'average' then avg(value)
                              when 'max' then max(value) when 'min' then min(value)
                              else (array_agg(value order by period_start desc))[1] end
      into val
    from public.kpi_entries
    where kpi_definition_id = p_kpi
      and period_start >= make_date(g.year, (g.quarter - 1) * 3 + 1, 1)
      and period_start <  (make_date(g.year, (g.quarter - 1) * 3 + 1, 1) + interval '3 months');
    pct := case when g.target_value > 0 then least(round(100 * coalesce(val, 0) / g.target_value, 2), 999) else 0 end;
    new_status := case when pct >= 100 then 'achieved'
                       else private.kpi_status(val, g.target_value, k.direction, k.at_risk_threshold_pct, k.off_track_threshold_pct) end;
    update public.quarterly_goals set current_value = val, progress_percent = least(pct, 100),
           status = case when new_status in ('no_data', 'no_target') then status else new_status end
     where id = g.id;
  end loop;
  -- annual goals
  for g in select * from public.goals where kpi_definition_id = p_kpi and deleted_at is null and status <> 'abandoned' loop
    select case k.aggregation when 'sum' then sum(value) when 'average' then avg(value)
                              when 'max' then max(value) when 'min' then min(value)
                              else (array_agg(value order by period_start desc))[1] end
      into val
    from public.kpi_entries
    where kpi_definition_id = p_kpi
      and (g.starts_on is null or period_start >= g.starts_on)
      and (g.ends_on is null or period_start <= g.ends_on);
    pct := case when g.target_value > 0 then round(100 * coalesce(val, 0) / g.target_value, 2) else 0 end;
    update public.goals set current_value = val, progress_percent = least(pct, 100),
           status = case when pct >= 100 then 'achieved' else status end,
           achieved_at = case when pct >= 100 and achieved_at is null then now() else achieved_at end
     where id = g.id;
    if pct >= 100 and g.achieved_at is null then
      perform private.emit_event(g.organization_id, 'goal.achieved', 'goal', g.id, jsonb_build_object('value', val));
    end if;
  end loop;
end;
$$;

create or replace function private.upsert_kpi_entry(p_kpi uuid, p_date date, p_value numeric, p_note text,
                                                    p_scorecard uuid, p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k      public.kpi_definitions;
  b      record;
  target numeric;
  eid    uuid;
  prev   numeric;
  st     text;
begin
  select * into k from public.kpi_definitions where id = p_kpi and deleted_at is null;
  if k.id is null then raise exception 'KPI not found'; end if;
  select * into b from private.period_bounds(k.frequency, p_date);
  select mt.target_value into target from public.monthly_targets mt
    where mt.kpi_definition_id = k.id and mt.month_start = date_trunc('month', b.period_start)::date
      and k.frequency in ('monthly');
  target := coalesce(target, k.goal_value);

  insert into public.kpi_entries (organization_id, kpi_definition_id, period_start, period_end, value, target_value,
                                  source, weekly_scorecard_id, note, entered_by)
  values (k.organization_id, k.id, b.period_start, b.period_end, p_value, target, p_source, p_scorecard, p_note, auth.uid())
  on conflict (kpi_definition_id, period_start) do update
    set value = excluded.value, target_value = excluded.target_value, note = coalesce(excluded.note, public.kpi_entries.note),
        weekly_scorecard_id = coalesce(excluded.weekly_scorecard_id, public.kpi_entries.weekly_scorecard_id),
        source = excluded.source, entered_by = excluded.entered_by
  returning id into eid;

  select value into prev from public.kpi_entries
   where kpi_definition_id = k.id and period_start < b.period_start order by period_start desc limit 1;
  st := private.kpi_status(p_value, target, k.direction, k.at_risk_threshold_pct, k.off_track_threshold_pct);

  perform private.bypass_org_guard();
  update public.client_profiles set last_kpi_update_at = now() where organization_id = k.organization_id;
  perform private.end_org_guard_bypass();
  perform private.refresh_goals_for_kpi(k.id);
  perform private.emit_event(k.organization_id, case when st = 'off_track' then 'kpi.missed' else 'kpi.submitted' end,
                             'kpi_definition', k.id,
                             jsonb_build_object('entry_id', eid, 'value', p_value, 'target', target, 'status', st,
                                                'period_start', b.period_start));
  return jsonb_build_object('entry_id', eid, 'period_start', b.period_start, 'period_end', b.period_end,
                            'value', p_value, 'target', target, 'previous_value', prev,
                            'change_percent', case when prev is not null and prev <> 0 then round(100 * (p_value - prev) / abs(prev), 2) end,
                            'status', st);
end;
$$;

create or replace function app.upsert_kpi_entry(p_kpi_definition_id uuid, p_date date, p_value numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.kpi_definitions;
begin
  perform private.require_user();
  select * into k from public.kpi_definitions where id = p_kpi_definition_id;
  perform private.assert_permission(k.organization_id, 'kpis.create');
  if k.is_financial then perform private.assert_permission(k.organization_id, 'financials.read'); end if;
  if k.entry_method = 'calculated' then raise exception 'calculated KPIs cannot be entered manually'; end if;
  return private.upsert_kpi_entry(k.id, p_date, p_value, p_note, null, 'manual');
end;
$$;

-- p_values: {"<kpi_definition_id>": 123.4, ...}
create or replace function app.submit_weekly_scorecard(p_scorecard_id uuid, p_week_of date, p_values jsonb,
                                                       p_summary text default null,
                                                       p_wins text[] default '{}', p_blockers text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  sc  public.scorecards;
  ws  uuid;
  ps  date := date_trunc('week', p_week_of)::date;
  kv  record;
  missing text;
  w   text;
begin
  select * into sc from public.scorecards where id = p_scorecard_id and deleted_at is null;
  if sc.id is null then raise exception 'scorecard not found'; end if;
  perform private.assert_permission(sc.organization_id, 'kpis.create');

  select string_agg(kd.name, ', ') into missing
  from public.scorecard_kpis sk join public.kpi_definitions kd on kd.id = sk.kpi_definition_id
  where sk.scorecard_id = sc.id and sk.is_required and kd.entry_method <> 'calculated'
    and not (p_values ? kd.id::text)
    and (not kd.is_financial or private.has_permission(sc.organization_id, 'financials.read'));
  if missing is not null then raise exception 'missing values for: %', missing; end if;

  insert into public.weekly_scorecards (organization_id, scorecard_id, period_start, period_end, status, submitted_by, submitted_at, summary)
  values (sc.organization_id, sc.id, ps, ps + 6, 'submitted', uid, now(), p_summary)
  on conflict (scorecard_id, period_start) do update
    set status = 'submitted', submitted_by = uid, submitted_at = now(), summary = excluded.summary
  returning id into ws;

  for kv in select key::uuid as kpi_id, value from jsonb_each(p_values) loop
    if not exists (select 1 from public.scorecard_kpis where scorecard_id = sc.id and kpi_definition_id = kv.kpi_id) then
      raise exception 'KPI % is not on this scorecard', kv.kpi_id;
    end if;
    if (select is_financial from public.kpi_definitions where id = kv.kpi_id) then
      perform private.assert_permission(sc.organization_id, 'financials.read');
    end if;
    perform private.upsert_kpi_entry(kv.kpi_id, ps, (kv.value #>> '{}')::numeric, null, ws, 'scorecard');
  end loop;

  foreach w in array coalesce(p_wins, '{}') loop
    insert into public.client_wins (organization_id, title, occurred_on, reported_by) values (sc.organization_id, w, ps + 6, uid);
  end loop;
  foreach w in array coalesce(p_blockers, '{}') loop
    insert into public.client_blockers (organization_id, title, reported_by) values (sc.organization_id, w, uid);
  end loop;

  perform private.log_activity(sc.organization_id, 'kpi_definition', null, 'scorecard_submitted',
                               sc.name || ' submitted for week of ' || ps);
  return ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tasks & goals
-- ---------------------------------------------------------------------------
create or replace function app.create_task(
  p_organization_id uuid, p_title text, p_description text default null, p_due_at timestamptz default null,
  p_priority text default 'medium', p_assignee_ids uuid[] default '{}', p_visibility text default 'organization',
  p_task_type text default 'general', p_related_type text default null, p_related_id uuid default null,
  p_growth_project_id uuid default null, p_parent_task_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  tid uuid;
  a   uuid;
begin
  perform private.assert_permission(p_organization_id, 'tasks.create');
  if p_visibility = 'staff' and not private.is_platform_staff() and not private.is_super_admin() then
    raise exception 'only staff can create staff-only tasks' using errcode = '42501';
  end if;
  foreach a in array coalesce(p_assignee_ids, '{}') loop
    perform private.assert_member_of_org(p_organization_id, a);
  end loop;

  insert into public.tasks (organization_id, title, description, due_at, priority, visibility, task_type,
                            related_type, related_id, growth_project_id, parent_task_id)
  values (p_organization_id, p_title, p_description, p_due_at, p_priority, p_visibility, p_task_type,
          p_related_type, p_related_id, p_growth_project_id, p_parent_task_id)
  returning id into tid;

  foreach a in array coalesce(p_assignee_ids, '{}') loop
    insert into public.task_assignments (organization_id, task_id, user_id, assigned_by)
    values (p_organization_id, tid, a, uid) on conflict do nothing;
    if a <> uid then
      perform private.notify(p_organization_id, a, 'task.assigned', 'New task: ' || p_title, p_description,
                             '/tasks/' || tid, 'task', tid, 'task_assigned');
    end if;
  end loop;
  perform private.emit_event(p_organization_id, 'task.created', 'task', tid, jsonb_build_object('assignees', to_jsonb(p_assignee_ids)));
  return tid;
end;
$$;

create or replace function app.set_task_status(p_task_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  t   public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and deleted_at is null for update;
  if t.id is null then raise exception 'task not found'; end if;
  if not (private.has_permission(t.organization_id, 'tasks.update')
          or exists (select 1 from public.task_assignments where task_id = t.id and user_id = uid)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.tasks
     set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end,
         completed_by = case when p_status = 'done' then uid else null end
   where id = t.id;
  if p_status = 'done' and t.status <> 'done' then
    perform private.emit_event(t.organization_id, 'task.completed', 'task', t.id, jsonb_build_object('user_id', uid));
    perform private.log_activity(t.organization_id, 'task', t.id, 'completed', 'Completed: ' || t.title);
  end if;
end;
$$;

create or replace function app.assign_task(p_task_id uuid, p_user_ids uuid[], p_replace boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  a uuid;
begin
  select * into t from public.tasks where id = p_task_id and deleted_at is null;
  perform private.assert_permission(t.organization_id, 'tasks.update');
  if p_replace then delete from public.task_assignments where task_id = t.id and not user_id = any (p_user_ids); end if;
  foreach a in array p_user_ids loop
    perform private.assert_member_of_org(t.organization_id, a);
    insert into public.task_assignments (organization_id, task_id, user_id, assigned_by)
    values (t.organization_id, t.id, a, private.effective_user_id()) on conflict do nothing;
    perform private.notify(t.organization_id, a, 'task.assigned', 'Task assigned: ' || t.title, null, '/tasks/' || t.id, 'task', t.id);
  end loop;
end;
$$;

create or replace function app.update_goal_progress(p_goal_id uuid, p_current_value numeric, p_status text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.goals;
begin
  select * into g from public.goals where id = p_goal_id and deleted_at is null;
  perform private.assert_permission(g.organization_id, 'goals.update');
  update public.goals
     set current_value = p_current_value,
         progress_percent = case when target_value > 0 then least(round(100 * p_current_value / target_value, 2), 100) else progress_percent end,
         status = coalesce(p_status, case when target_value > 0 and p_current_value >= target_value then 'achieved' else status end),
         achieved_at = case when target_value > 0 and p_current_value >= target_value then coalesce(achieved_at, now()) else achieved_at end
   where id = g.id;
  if g.achieved_at is null and g.target_value > 0 and p_current_value >= g.target_value then
    perform private.emit_event(g.organization_id, 'goal.achieved', 'goal', g.id, jsonb_build_object('value', p_current_value));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Coaching
-- ---------------------------------------------------------------------------
-- p_attendance: {"<user_id>": true|false}; p_action_items: [{"title","owner_id","due_at"}]
create or replace function app.complete_coaching_session(p_session_id uuid, p_summary text default null,
                                                         p_attendance jsonb default '{}', p_action_items jsonb default '[]')
returns void language plpgsql security definer set search_path = '' as $$
declare
  s  public.coaching_sessions;
  ai jsonb;
  tid uuid;
begin
  select * into s from public.coaching_sessions where id = p_session_id and deleted_at is null for update;
  perform private.assert_permission(s.organization_id, 'coaching.update');
  update public.coaching_sessions set status = 'completed', completed_at = now(), summary = coalesce(p_summary, summary) where id = s.id;
  update public.session_attendees sa set attended = (p_attendance->>sa.user_id::text)::boolean
   where sa.coaching_session_id = s.id and p_attendance ? sa.user_id::text;
  for ai in select * from jsonb_array_elements(p_action_items) loop
    tid := app.create_task(s.organization_id, ai->>'title', ai->>'description', (ai->>'due_at')::timestamptz, 'medium',
                           case when ai ? 'owner_id' then array[(ai->>'owner_id')::uuid] else '{}' end,
                           'organization', 'action_item', 'coaching_session', s.id);
    insert into public.action_items (organization_id, coaching_session_id, title, owner_id, due_at, task_id)
    values (s.organization_id, s.id, ai->>'title', (ai->>'owner_id')::uuid, (ai->>'due_at')::timestamptz, tid);
  end loop;
  perform private.bypass_org_guard();
  update public.client_profiles set last_interaction_at = now() where organization_id = s.organization_id;
  perform private.end_org_guard_bypass();
  perform private.emit_event(s.organization_id, 'call.completed', 'coaching_session', s.id, '{}');
end;
$$;

create or replace function app.start_conversation(p_organization_id uuid, p_user_ids uuid[], p_subject text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  cid uuid;
  u   uuid;
begin
  perform private.assert_permission(p_organization_id, 'messages.create');
  insert into public.conversations (organization_id, subject, kind)
  values (p_organization_id, p_subject, case when cardinality(p_user_ids) > 1 then 'group' else 'direct' end)
  returning id into cid;
  foreach u in array array_append(p_user_ids, uid) loop
    perform private.assert_member_of_org(p_organization_id, u);
    insert into public.conversation_participants (organization_id, conversation_id, user_id)
    values (p_organization_id, cid, u) on conflict do nothing;
  end loop;
  return cid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Soft delete / restore / export logging
-- ---------------------------------------------------------------------------
create or replace function app.soft_delete(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r   private.rls_registry;
  org uuid;
begin
  select * into r from private.rls_registry where table_name = p_table;
  if r.table_name is null or not r.soft_delete or not r.org_scoped then
    raise exception 'soft delete is not supported for %', p_table;
  end if;
  execute format('select organization_id from public.%I where id = $1 and deleted_at is null', p_table) into org using p_id;
  if org is null then raise exception 'record not found' using errcode = 'P0002'; end if;
  perform private.assert_permission(org, r.module || '.delete');
  execute format('update public.%I set deleted_at = now(), deleted_by = $2 where id = $1', p_table)
    using p_id, private.effective_user_id();
  if not r.audited then
    perform private.log_audit(org, 'soft_delete', p_table, p_id);
  end if;
end;
$$;

create or replace function app.restore(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r private.rls_registry;
begin
  perform private.assert_super_admin();
  select * into r from private.rls_registry where table_name = p_table and soft_delete;
  if r.table_name is null then raise exception 'restore is not supported for %', p_table; end if;
  execute format('update public.%I set deleted_at = null, deleted_by = null where id = $1', p_table) using p_id;
  perform private.log_audit(null, 'restore', p_table, p_id);
end;
$$;

create or replace function app.log_export(p_organization_id uuid, p_scope text, p_row_count int default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_super_admin()
          or private.has_permission(p_organization_id, 'reports.export')
          or private.has_permission(p_organization_id, p_scope || '.export')) then
    raise exception 'export not permitted' using errcode = '42501';
  end if;
  perform private.log_audit(p_organization_id, 'export', p_scope, null, jsonb_build_object('rows', p_row_count));
end;
$$;

-- ---------------------------------------------------------------------------
-- Client health scoring
-- ---------------------------------------------------------------------------
create or replace function private.health_factor_raw(p_org uuid, p_factor text, p_days int)
returns table (raw numeric, explanation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
  v numeric;
  a numeric;
  b numeric;
begin
  case p_factor
  when 'login_frequency' then
    select count(distinct date_trunc('day', la.created_at)) into v
    from public.login_activity la
    join public.organization_memberships m on m.user_id = la.user_id and m.organization_id = p_org and m.status = 'active'
    where la.event in ('login', 'workspace_switch') and la.created_at >= since;
    return query select v, format('%s active login days in the last %s days', v, p_days);
  when 'lesson_completion' then
    select avg(progress_percent) into v from public.program_enrollments
    where organization_id = p_org and status in ('active', 'completed');
    return query select round(v, 1), case when v is null then 'No active enrollments'
                                          else format('Average program progress %s%%', round(v, 1)) end;
  when 'kpi_submission_consistency' then
    select count(*) into a from public.kpi_definitions
      where organization_id = p_org and is_active and deleted_at is null and frequency = 'weekly' and entry_method <> 'calculated';
    select count(*) into b from public.kpi_entries ke join public.kpi_definitions kd on kd.id = ke.kpi_definition_id
      where ke.organization_id = p_org and kd.frequency = 'weekly' and ke.period_start >= since::date;
    v := case when a > 0 then least(100, round(100 * b / (a * greatest(p_days / 7, 1)), 1)) end;
    return query select v, case when v is null then 'No weekly KPIs defined'
                                else format('%s of %s expected weekly KPI entries submitted', b, a * greatest(p_days / 7, 1)) end;
  when 'attendance' then
    select count(*) filter (where sa.attended), count(*) into a, b
    from public.session_attendees sa join public.coaching_sessions cs on cs.id = sa.coaching_session_id
    join public.organization_memberships m on m.user_id = sa.user_id and m.organization_id = p_org
    where cs.organization_id = p_org and cs.status in ('completed', 'no_show') and cs.scheduled_start >= since;
    v := case when b > 0 then round(100 * a / b, 1) end;
    return query select v, case when v is null then 'No calls in window' else format('Attended %s of %s calls', a, b) end;
  when 'task_completion' then
    select count(*) filter (where status = 'done'), count(*) into a, b
    from public.tasks where organization_id = p_org and deleted_at is null and status <> 'canceled'
      and due_at between since and now();
    v := case when b > 0 then round(100 * a / b, 1) end;
    return query select v, case when v is null then 'No tasks due in window' else format('%s of %s due tasks completed', a, b) end;
  when 'goal_progress' then
    select avg(progress_percent) into v from public.quarterly_goals
    where organization_id = p_org and deleted_at is null
      and year = extract(year from now())::int and quarter = extract(quarter from now())::int;
    return query select round(v, 1), case when v is null then 'No goals this quarter'
                                          else format('Average quarterly goal progress %s%%', round(v, 1)) end;
  when 'revenue_progress' then
    select case when revenue_target_cents > 0 then round(100.0 * current_monthly_revenue_cents / revenue_target_cents, 1) end
      into v from public.client_profiles where organization_id = p_org;
    return query select v, case when v is null then 'No revenue target set' else format('Revenue at %s%% of target', v) end;
  when 'days_since_last_interaction' then
    select extract(day from now() - greatest(
             (select last_interaction_at from public.client_profiles where organization_id = p_org),
             (select max(completed_at) from public.coaching_sessions where organization_id = p_org),
             (select max(submitted_at) from public.accountability_checkins where organization_id = p_org),
             (select max(submitted_at) from public.weekly_scorecards where organization_id = p_org)))
      into v;
    return query select v, case when v is null then 'No interactions recorded' else format('%s days since last interaction', v) end;
  when 'open_blockers' then
    select coalesce(sum(case severity when 'critical' then 3 when 'high' then 2 else 1 end), 0) into v
    from public.client_blockers where organization_id = p_org and deleted_at is null and status in ('open', 'in_progress');
    return query select v, format('Open blocker weight %s', v);
  when 'coach_rating' then
    select rating into v from public.coach_ratings where organization_id = p_org order by rated_on desc, created_at desc limit 1;
    return query select v, case when v is null then 'No coach rating' else format('Latest coach rating %s/10', v) end;
  else
    return query select null::numeric, 'Unknown factor';
  end case;
end;
$$;

create or replace function private.calculate_health_score(p_org uuid, p_model uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  m        public.health_score_models;
  f        record;
  raw      record;
  norm     numeric;
  total_w  numeric := 0;
  total    numeric := 0;
  score    numeric;
  band     text;
  prev     public.client_health_scores;
  sid      uuid;
  comps    jsonb := '[]';
  c        jsonb;
begin
  select * into m from public.health_score_models
  where id = coalesce(p_model, (select id from public.health_score_models where is_default and is_active limit 1));
  if m.id is null then raise exception 'no health score model configured'; end if;

  for f in select * from public.health_score_factors where model_id = m.id and is_active and weight > 0 loop
    select * into raw from private.health_factor_raw(p_org, f.factor_key, f.lookback_days);
    if raw.raw is null then
      comps := comps || jsonb_build_object('factor_key', f.factor_key, 'raw', null, 'norm', null, 'weight', f.weight,
                                           'explanation', raw.explanation || ' (excluded)');
      continue;
    end if;
    norm := case when f.best_value = f.worst_value then 100
                 else greatest(0, least(100, 100 * (raw.raw - f.worst_value) / (f.best_value - f.worst_value))) end;
    total_w := total_w + f.weight;
    total := total + norm * f.weight;
    comps := comps || jsonb_build_object('factor_key', f.factor_key, 'raw', raw.raw, 'norm', round(norm, 2),
                                         'weight', f.weight, 'explanation', raw.explanation);
  end loop;

  score := case when total_w > 0 then round(total / total_w, 2) else 50 end;
  band := case when score >= m.healthy_min then 'healthy' when score >= m.watch_min then 'watch'
               when score >= m.at_risk_min then 'at_risk' else 'critical' end;

  select * into prev from public.client_health_scores where organization_id = p_org and is_latest;
  update public.client_health_scores set is_latest = false where organization_id = p_org and is_latest;
  insert into public.client_health_scores (organization_id, model_id, score, band, previous_score, is_latest)
  values (p_org, m.id, score, band, prev.score, true)
  returning id into sid;

  for c in select * from jsonb_array_elements(comps) loop
    insert into public.client_health_score_components (organization_id, health_score_id, factor_key, raw_value,
                                                        normalized_score, weight, weighted_contribution, explanation)
    values (p_org, sid, c->>'factor_key', (c->>'raw')::numeric, coalesce((c->>'norm')::numeric, 0), (c->>'weight')::numeric,
            case when c->>'norm' is null or total_w = 0 then 0
                 else round((c->>'norm')::numeric * (c->>'weight')::numeric / total_w, 2) end,
            c->>'explanation');
  end loop;

  if band in ('at_risk', 'critical') and coalesce(prev.band, 'healthy') not in ('at_risk', 'critical') then
    perform private.emit_event(p_org, 'client.at_risk', 'organization', p_org,
                               jsonb_build_object('score', score, 'band', band, 'previous_score', prev.score));
  end if;
  return sid;
end;
$$;

create or replace function app.calculate_health_score(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  perform private.assert_permission(p_organization_id, 'health.update');
  sid := private.calculate_health_score(p_organization_id);
  return (select jsonb_build_object('id', s.id, 'score', s.score, 'band', s.band, 'previous_score', s.previous_score,
            'components', (select jsonb_agg(jsonb_build_object('factor', c.factor_key, 'raw', c.raw_value,
                              'normalized', c.normalized_score, 'weight', c.weight,
                              'contribution', c.weighted_contribution, 'why', c.explanation) order by c.weighted_contribution desc)
                           from public.client_health_score_components c where c.health_score_id = s.id))
          from public.client_health_scores s where s.id = sid);
end;
$$;

-- For the scheduled job (service role) or the super admin.
create or replace function app.calculate_all_health_scores()
returns int language plpgsql security definer set search_path = '' as $$
declare
  o uuid;
  n int := 0;
begin
  if auth.uid() is not null then perform private.assert_super_admin(); end if;
  for o in select id from public.organizations where kind = 'client' and status in ('onboarding', 'active', 'paused') and deleted_at is null loop
    perform private.calculate_health_score(o);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: nothing in `app` is callable by anon except the invitation preview.
-- private.* must be executable by authenticated because RLS policies call them.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
grant execute on function app.get_invitation(text) to anon;

-- Only the read-only helpers that RLS policies and views evaluate are granted.
-- Workflow internals (clone_row, apply_template, create_invitation, ...) are
-- reachable solely through the permission-checked app.* functions.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
grant execute on function
  private.effective_user_id(), private.active_impersonation(), private.is_super_admin(), private.is_real_super_admin(),
  private.is_platform_staff(uuid), private.orgs_with_permission(text), private.orgs_with_access(),
  private.has_permission(uuid, text), private.my_enrolled_program_ids(), private.my_session_ids(),
  private.my_task_ids(), private.my_conversation_ids(), private.org_member_ids(uuid),
  private.can_view_lesson_content(uuid), private.can_read_file(uuid), private.can_see_program_scope(uuid, uuid),
  private.kpi_status(numeric, numeric, text, numeric, numeric), private.period_bounds(text, date),
  private.valid_entity_type(text)
to authenticated;
