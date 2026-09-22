-- =============================================================================
-- 0109 ADD A MEMBER DIRECTLY
--
-- Until now the only way into a workspace was an invitation the person had to accept, which needs working email.
-- These two functions let an admin hand someone a login instead: the app creates the account with a password
-- (service role, in the server action) and then calls add_member_now, which does exactly what accepting an
-- invitation does, minus the token.
--
-- Both run under the caller's permissions, not the service role, so the rules are unchanged:
--   * members.create to add, members.update to reset a password;
--   * assert_subset_of_caller: nobody can hand out a role with more access than they hold themselves;
--   * a Growth OS staff member's password can only be reset by a super admin.
-- =============================================================================

create or replace function app.add_member_now(p_organization_id uuid, p_user_id uuid, p_role_key text,
                                              p_program_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r   public.roles;
  u   public.users;
  mid uuid;
  pid uuid;
begin
  perform private.require_user();
  perform private.assert_permission(p_organization_id, 'members.create');
  select * into u from public.users where id = p_user_id;
  if u.id is null then raise exception 'user not found' using errcode = 'P0002'; end if;
  r := private.role_by_key(p_organization_id, p_role_key);
  if r.id is null or r.audience <> 'member' then raise exception 'unknown member role %', p_role_key; end if;
  perform private.assert_subset_of_caller(p_organization_id, private.role_permission_keys(r.id), 'role ' || r.key);
  if exists (select 1 from unnest(p_program_ids) x
             where not exists (select 1 from public.programs p where p.id = x and p.organization_id = p_organization_id)) then
    raise exception 'program does not belong to this workspace';
  end if;
  if exists (select 1 from public.organization_memberships m
             where m.organization_id = p_organization_id and m.user_id = p_user_id and m.status = 'active') then
    raise exception 'already a member';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role_id, status, invited_by)
  values (p_organization_id, p_user_id, r.id, 'active', private.effective_user_id())
  on conflict (organization_id, user_id) do update
    set role_id = excluded.role_id, status = 'active', joined_at = now()
  returning id into mid;

  for pid in select unnest(p_program_ids) loop
    perform private.enroll(p_organization_id, pid, p_user_id, 'manual');
  end loop;

  -- tasks from onboarding templates waiting for this role, same as accepting an invitation
  insert into public.task_assignments (organization_id, task_id, user_id)
  select t.organization_id, t.id, p_user_id from public.tasks t
  where t.organization_id = p_organization_id and t.assignee_role_key = r.key and t.deleted_at is null
    and not exists (select 1 from public.task_assignments ta where ta.task_id = t.id)
  on conflict do nothing;

  if r.key = 'client_admin' then
    update public.client_profiles set primary_contact_user_id = coalesce(primary_contact_user_id, p_user_id)
    where organization_id = p_organization_id;
  end if;

  perform private.log_activity(p_organization_id, 'user', p_user_id, 'joined', 'Added to the workspace as ' || r.name);
  perform private.log_audit(p_organization_id, 'member_added', 'organization_memberships', mid);
  return jsonb_build_object('membership_id', mid, 'user_id', p_user_id, 'email', u.email::text);
end;
$$;

-- Authorises a password reset and hands back the address to set it on, so the app never takes the target
-- from the browser's word alone.
create or replace function app.member_for_password_reset(p_organization_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u      public.users;
  caller uuid := private.effective_user_id();
begin
  perform private.require_user();
  perform private.assert_permission(p_organization_id, 'members.update');
  if not exists (select 1 from public.organization_memberships m
                 where m.organization_id = p_organization_id and m.user_id = p_user_id and m.status = 'active') then
    raise exception 'not a member of this workspace' using errcode = 'P0002';
  end if;
  if private.is_platform_staff(p_user_id) and not private.is_super_admin() then
    raise exception 'only a super admin can set a Growth OS team member''s password' using errcode = '42501';
  end if;
  if not private.is_super_admin()
     and not (private.permission_set(p_organization_id, p_user_id) <@ private.permission_set(p_organization_id, caller)) then
    raise exception 'you cannot set the password of someone with more access than you' using errcode = '42501';
  end if;
  select * into u from public.users where id = p_user_id;
  perform private.log_audit(p_organization_id, 'password_set', 'users', p_user_id);
  return jsonb_build_object('user_id', u.id, 'email', u.email::text);
end;
$$;

revoke all on function app.add_member_now(uuid, uuid, text, uuid[]) from public, anon;
revoke all on function app.member_for_password_reset(uuid, uuid) from public, anon;
grant execute on function app.add_member_now(uuid, uuid, text, uuid[]) to authenticated, service_role;
grant execute on function app.member_for_password_reset(uuid, uuid) to authenticated, service_role;
