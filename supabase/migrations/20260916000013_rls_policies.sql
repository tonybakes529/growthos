-- =============================================================================
-- 0013 CUSTOM ROW-LEVEL SECURITY POLICIES
-- Standard tables got module.read/create/update/delete policies from
-- private.standardize(). Everything registered with policy_mode = 'custom'
-- is handled here. A check at the bottom fails the migration if any custom
-- table was left without a SELECT policy.
--
-- Convention: every helper call is wrapped in (select ...) so Postgres
-- evaluates it once per statement instead of once per row.
-- =============================================================================

-- Users with a live relationship to an org (members + assigned staff).
create or replace function private.org_member_ids(p_org uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select user_id from public.organization_memberships where organization_id = p_org and status = 'active'
  union
  select user_id from public.team_assignments where organization_id = p_org and status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Identity & tenancy
-- ---------------------------------------------------------------------------
create policy users_select on public.users for select to authenticated using (
  id = (select private.effective_user_id())
  or (select private.is_platform_staff())
  or (select private.is_super_admin())
  or id in (select m.user_id from public.organization_memberships m
            where m.organization_id in (select private.orgs_with_permission('members.read')))
  or id in (select t.user_id from public.team_assignments t
            where t.status = 'active' and t.organization_id in (select private.orgs_with_access()))
);

create policy user_profiles_select on public.user_profiles for select to authenticated using (
  user_id in (select id from public.users)          -- inherits users_select
);
create policy user_profiles_update on public.user_profiles for update to authenticated
  using (user_id = (select private.effective_user_id()))
  with check (user_id = (select private.effective_user_id()));

create policy organizations_select on public.organizations for select to authenticated using (
  id in (select private.orgs_with_access())
  or (kind = 'template_library' and (select private.is_platform_staff()))
);
create policy organizations_update on public.organizations for update to authenticated
  using (id in (select private.orgs_with_permission('organization.update')))
  with check (id in (select private.orgs_with_permission('organization.update')));
-- status, kind, slug and billing ids are further protected by a trigger below
create policy organizations_insert on public.organizations for insert to authenticated
  with check ((select private.is_super_admin()));
create policy organizations_delete on public.organizations for delete to authenticated
  using ((select private.is_super_admin()));

create or replace function private.protect_org_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_super_admin()
     or current_setting('app.bypass_org_guard', true) = 'on' then return new; end if;
  if new.kind is distinct from old.kind or new.status is distinct from old.status
     or new.slug is distinct from old.slug or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'only a super admin can change kind, status, slug, billing or deletion state'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger protect_org_columns before update on public.organizations
  for each row execute function private.protect_org_columns();

create policy permissions_select on public.permissions for select to authenticated using (true);

create policy roles_select on public.roles for select to authenticated using (
  organization_id is null
  or organization_id in (select private.orgs_with_permission('roles.read'))
  or organization_id in (select private.orgs_with_permission('members.read'))
);
-- custom roles are created/edited through app.upsert_custom_role (subset check)
create policy role_permissions_select on public.role_permissions for select to authenticated using (
  role_id in (select id from public.roles)
);

create policy platform_staff_select on public.platform_staff for select to authenticated using (
  user_id = (select private.effective_user_id()) or (select private.is_platform_staff())
);
create policy platform_staff_write on public.platform_staff for all to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy memberships_select on public.organization_memberships for select to authenticated using (
  user_id = (select private.effective_user_id())
  or organization_id in (select private.orgs_with_permission('members.read'))
);
-- writes: app.accept_invitation / app.change_member_role / app.remove_member only

create policy team_assignments_select on public.team_assignments for select to authenticated using (
  user_id = (select private.effective_user_id())
  or organization_id in (select private.orgs_with_permission('members.read'))
);
-- writes: app.assign_team_member only

create policy permission_overrides_select on public.permission_overrides for select to authenticated using (
  user_id = (select private.effective_user_id())
  or organization_id in (select private.orgs_with_permission('roles.read'))
);

create policy invitations_select on public.invitations for select to authenticated using (
  organization_id in (select private.orgs_with_permission('members.read'))
);

create policy login_activity_select on public.login_activity for select to authenticated using (
  user_id = auth.uid() or (select private.is_real_super_admin())
);

create policy impersonation_sessions_select on public.impersonation_sessions for select to authenticated using (
  (select private.is_real_super_admin())
);

create policy audit_logs_select on public.audit_logs for select to authenticated using (
  (select private.is_super_admin())
  or organization_id in (select private.orgs_with_permission('audit.read'))
);

create policy activity_history_select on public.activity_history for select to authenticated using (
  organization_id in (select private.orgs_with_permission('organization.read'))
);

-- ---------------------------------------------------------------------------
-- Client profile: staff and client admins. Commercial/relationship columns are
-- staff-controlled (trigger below); client admins may edit business facts only.
-- ---------------------------------------------------------------------------
create policy client_profiles_select on public.client_profiles for select to authenticated using (
  organization_id in (select private.orgs_with_permission('organization.update'))
  or ((select private.is_platform_staff()) and organization_id in (select private.orgs_with_access()))
);
create policy client_profiles_update on public.client_profiles for update to authenticated
  using (organization_id in (select private.orgs_with_permission('organization.update')))
  with check (organization_id in (select private.orgs_with_permission('organization.update')));
create or replace function private.protect_client_profile_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  allowed text[] := array['legal_name', 'industry', 'business_model', 'team_size', 'primary_contact_user_id',
                          'current_monthly_revenue_cents', 'revenue_target_cents', 'updated_at', 'updated_by'];
  k text;
begin
  if auth.uid() is null or private.is_platform_staff(auth.uid())
     or current_setting('app.bypass_org_guard', true) = 'on' then return new; end if;
  for k in select key from jsonb_each(to_jsonb(new)) n
           where n.value is distinct from (to_jsonb(old) -> n.key) loop
    if not k = any (allowed) then
      raise exception 'column % on client_profiles is managed by the platform team', k using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
create trigger protect_client_profile_columns before update on public.client_profiles
  for each row execute function private.protect_client_profile_columns();

create policy client_profiles_insert on public.client_profiles for insert to authenticated
  with check ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Notes (organization / staff / private)
-- ---------------------------------------------------------------------------
create policy notes_select on public.notes for select to authenticated using (
  organization_id in (select private.orgs_with_permission('notes.read'))
  and (deleted_at is null or (select private.is_super_admin()))
  and (
    visibility = 'organization'
    or (visibility = 'staff' and (select private.is_platform_staff()))
    or created_by = (select private.effective_user_id())
    or (select private.is_super_admin())
  )
);
create policy notes_insert on public.notes for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('notes.create'))
  and (visibility <> 'staff' or (select private.is_platform_staff()))
);
create policy notes_update on public.notes for update to authenticated
  using (organization_id in (select private.orgs_with_permission('notes.update'))
         and (visibility = 'organization' or created_by = (select private.effective_user_id())))
  with check (organization_id in (select private.orgs_with_permission('notes.update')));
create policy notes_delete on public.notes for delete to authenticated using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------
create or replace function private.can_read_file(p_file uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  f   public.files;
  uid uuid := private.effective_user_id();
begin
  select * into f from public.files where id = p_file;
  if f.id is null then return false; end if;
  if private.is_super_admin() then return true; end if;
  if f.deleted_at is not null then return false; end if;
  if f.created_by = uid then return true; end if;
  if private.has_permission(f.organization_id, 'files.update') then return true; end if;  -- managers

  case f.visibility
    when 'organization' then
      return private.has_permission(f.organization_id, 'files.read');
    when 'managers', 'private' then
      return false;
    when 'linked' then
      case f.entity_type
        when 'lesson' then
          return private.has_permission(f.organization_id, 'programs.read')
              or private.can_view_lesson_content(f.entity_id);
        when 'resource' then
          return exists (select 1 from public.resources r where r.id = f.entity_id and r.deleted_at is null
                         and (r.visibility = 'organization' and private.has_permission(f.organization_id, 'files.read')
                              or r.visibility = 'program' and r.program_id in (select private.my_enrolled_program_ids())));
        when 'assignment_submission' then
          return exists (select 1 from public.assignment_submissions s where s.id = f.entity_id and s.user_id = uid)
              or private.has_permission(f.organization_id, 'programs.grade');
        when 'call_recording' then
          return exists (select 1 from public.call_recordings cr
                         join public.coaching_sessions cs on cs.id = cr.coaching_session_id
                         where cr.id = f.entity_id
                           and (private.has_permission(f.organization_id, 'coaching.update')
                                or cs.id in (select private.my_session_ids())
                                or (cr.is_replay_published and cs.audience = 'organization'
                                    and private.has_permission(f.organization_id, 'coaching.read'))
                                or (cr.is_replay_published and cs.audience = 'program'
                                    and cs.program_id in (select private.my_enrolled_program_ids()))));
        when 'program' then
          return private.has_permission(f.organization_id, 'programs.read')
              or f.entity_id in (select private.my_enrolled_program_ids());
        else
          return private.has_permission(f.organization_id, 'files.read');
      end case;
    else
      return false;
  end case;
end;
$$;

create policy files_select on public.files for select to authenticated using (
  organization_id in (select private.orgs_with_access())
  and private.can_read_file(id)
);
create policy files_insert on public.files for insert to authenticated with check (
  (organization_id in (select private.orgs_with_permission('files.create'))
   -- students may upload their own assignment files
   or (kind = 'assignment_upload' and visibility = 'linked' and organization_id in (select private.orgs_with_access())))
  and storage_path like organization_id::text || '/' || id::text || '/%'
);
create policy files_update on public.files for update to authenticated
  using (organization_id in (select private.orgs_with_permission('files.update'))
         or created_by = (select private.effective_user_id()))
  with check (organization_id in (select private.orgs_with_access()));
create policy files_delete on public.files for delete to authenticated using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Billing: managers see all; buyers see their own purchases/subscriptions/payments.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['purchases', 'subscriptions', 'payment_records'] loop
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated using (
      organization_id in (select private.orgs_with_permission('billing.read'))
      or user_id = (select private.effective_user_id()))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated with check (
      organization_id in (select private.orgs_with_permission('billing.create')))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
      using (organization_id in (select private.orgs_with_permission('billing.update')))
      with check (organization_id in (select private.orgs_with_permission('billing.update')))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated using ((select private.is_super_admin()))$p$, t);
  end loop;
end $$;

-- Marketing spend = financial data.
create policy marketing_spend_select on public.marketing_spend for select to authenticated using (
  organization_id in (select private.orgs_with_permission('financials.read'))
);
create policy marketing_spend_write on public.marketing_spend for all to authenticated
  using (organization_id in (select private.orgs_with_permission('financials.read'))
         and organization_id in (select private.orgs_with_permission('sales.update')))
  with check (organization_id in (select private.orgs_with_permission('financials.read'))
              and organization_id in (select private.orgs_with_permission('sales.update')));

-- ---------------------------------------------------------------------------
-- Program content: builders (programs.read) see everything; enrolled users see
-- published content of programs they're enrolled in. Lesson blocks additionally
-- respect drip + sequential locks.
-- ---------------------------------------------------------------------------
create or replace function private.apply_program_content_policies(p_table text, p_soft boolean, p_published_col boolean)
returns void language plpgsql as $$
declare t text := format('public.%I', p_table);
begin
  execute format($p$create policy %1$s_select on %2$s for select to authenticated using (
      organization_id in (select private.orgs_with_permission('programs.read'))
      or (program_id in (select private.my_enrolled_program_ids()) %3$s %4$s))$p$,
    p_table, t,
    case when p_soft then 'and deleted_at is null' else '' end,
    case when p_published_col then 'and status = ''published''' else '' end);
  execute format($p$create policy %1$s_insert on %2$s for insert to authenticated with check (
      organization_id in (select private.orgs_with_permission('programs.create')))$p$, p_table, t);
  execute format($p$create policy %1$s_update on %2$s for update to authenticated
      using (organization_id in (select private.orgs_with_permission('programs.update')))
      with check (organization_id in (select private.orgs_with_permission('programs.update')))$p$, p_table, t);
  if p_soft then
    execute format($p$create policy %1$s_delete on %2$s for delete to authenticated using ((select private.is_super_admin()))$p$, p_table, t);
  else
    execute format($p$create policy %1$s_delete on %2$s for delete to authenticated using (
        organization_id in (select private.orgs_with_permission('programs.delete')))$p$, p_table, t);
  end if;
end;
$$;

-- programs: `id` is the program id
create policy programs_select on public.programs for select to authenticated using (
  organization_id in (select private.orgs_with_permission('programs.read'))
  or id in (select private.my_enrolled_program_ids())
  or (visibility = 'organization' and status = 'published' and deleted_at is null
      and organization_id in (select private.orgs_with_access()))
);
create policy programs_insert on public.programs for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('programs.create')));
create policy programs_update on public.programs for update to authenticated
  using (organization_id in (select private.orgs_with_permission('programs.update')))
  with check (organization_id in (select private.orgs_with_permission('programs.update')));
create policy programs_delete on public.programs for delete to authenticated using ((select private.is_super_admin()));

select private.apply_program_content_policies('program_sections', true,  false);
select private.apply_program_content_policies('modules',          true,  false);
select private.apply_program_content_policies('lessons',          true,  true);
select private.apply_program_content_policies('assignments',      true,  false);
select private.apply_program_content_policies('quizzes',          true,  false);
select private.apply_program_content_policies('quiz_questions',   false, false);

create policy lesson_blocks_select on public.lesson_blocks for select to authenticated using (
  organization_id in (select private.orgs_with_permission('programs.read'))
  or (program_id in (select private.my_enrolled_program_ids()) and private.can_view_lesson_content(lesson_id))
  or lesson_id in (select l.id from public.lessons l where l.is_preview and l.status = 'published' and l.deleted_at is null
                   and l.organization_id in (select private.orgs_with_access()))
);
create policy lesson_blocks_insert on public.lesson_blocks for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('programs.create')));
create policy lesson_blocks_update on public.lesson_blocks for update to authenticated
  using (organization_id in (select private.orgs_with_permission('programs.update')))
  with check (organization_id in (select private.orgs_with_permission('programs.update')));
create policy lesson_blocks_delete on public.lesson_blocks for delete to authenticated using (
  organization_id in (select private.orgs_with_permission('programs.delete')));

create policy resources_select on public.resources for select to authenticated using (
  (deleted_at is null or (select private.is_super_admin()))
  and (
    organization_id in (select private.orgs_with_permission('files.update'))
    or (visibility = 'organization' and organization_id in (select private.orgs_with_permission('files.read')))
    or (visibility = 'program' and (program_id in (select private.my_enrolled_program_ids())
                                    or organization_id in (select private.orgs_with_permission('programs.read'))))
  )
);
create policy resources_insert on public.resources for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('files.create')));
create policy resources_update on public.resources for update to authenticated
  using (organization_id in (select private.orgs_with_permission('files.update')))
  with check (organization_id in (select private.orgs_with_permission('files.update')));
create policy resources_delete on public.resources for delete to authenticated using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Enrollment & progress: own rows, or enrollments.* in the org.
-- Learners never write progress directly; app.complete_lesson etc. do.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['program_enrollments', 'lesson_progress', 'module_progress', 'quiz_attempts', 'certificates', 'assignment_submissions', 'lesson_unlocks'] loop
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated using (
      user_id = (select private.effective_user_id())
      or organization_id in (select private.orgs_with_permission('enrollments.read')))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated with check (
      organization_id in (select private.orgs_with_permission('enrollments.create')))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
      using (organization_id in (select private.orgs_with_permission('enrollments.update')))
      with check (organization_id in (select private.orgs_with_permission('enrollments.update')))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated using (
      organization_id in (select private.orgs_with_permission('enrollments.delete')))$p$, t);
  end loop;
end $$;

-- graders see and review submissions
create policy assignment_submissions_grade on public.assignment_submissions for select to authenticated using (
  organization_id in (select private.orgs_with_permission('programs.grade'))
);
create policy assignment_submissions_grade_update on public.assignment_submissions for update to authenticated
  using (organization_id in (select private.orgs_with_permission('programs.grade')))
  with check (organization_id in (select private.orgs_with_permission('programs.grade')));

create policy assignment_feedback_select on public.assignment_feedback for select to authenticated using (
  submission_id in (select id from public.assignment_submissions)
);
create policy assignment_feedback_insert on public.assignment_feedback for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('programs.grade'))
  and author_id = (select private.effective_user_id())
);
create policy assignment_feedback_update on public.assignment_feedback for update to authenticated
  using (author_id = (select private.effective_user_id()))
  with check (author_id = (select private.effective_user_id()));

-- ---------------------------------------------------------------------------
-- Coaching delivery
-- ---------------------------------------------------------------------------
create policy coaching_sessions_select on public.coaching_sessions for select to authenticated using (
  (deleted_at is null or (select private.is_super_admin()))
  and (
    organization_id in (select private.orgs_with_permission('coaching.update'))
    or id in (select private.my_session_ids())
    or (audience = 'organization' and organization_id in (select private.orgs_with_permission('coaching.read')))
    or (audience = 'program' and program_id in (select private.my_enrolled_program_ids()))
  )
);
create policy coaching_sessions_insert on public.coaching_sessions for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('coaching.create')));
create policy coaching_sessions_update on public.coaching_sessions for update to authenticated
  using (organization_id in (select private.orgs_with_permission('coaching.update')))
  with check (organization_id in (select private.orgs_with_permission('coaching.update')));
create policy coaching_sessions_delete on public.coaching_sessions for delete to authenticated using ((select private.is_super_admin()));

create policy session_attendees_select on public.session_attendees for select to authenticated using (
  coaching_session_id in (select id from public.coaching_sessions)
);
create policy session_attendees_write on public.session_attendees for all to authenticated
  using (organization_id in (select private.orgs_with_permission('coaching.update')))
  with check (organization_id in (select private.orgs_with_permission('coaching.update')));
create policy session_attendees_rsvp on public.session_attendees for update to authenticated
  using (user_id = (select private.effective_user_id()))
  with check (user_id = (select private.effective_user_id()));

create policy session_notes_select on public.session_notes for select to authenticated using (
  deleted_at is null
  and coaching_session_id in (select id from public.coaching_sessions)
  and (visibility = 'shared' or organization_id in (select private.orgs_with_permission('coaching.update')))
);
create policy session_notes_write on public.session_notes for all to authenticated
  using (organization_id in (select private.orgs_with_permission('coaching.update')))
  with check (organization_id in (select private.orgs_with_permission('coaching.update')));

create policy call_recordings_select on public.call_recordings for select to authenticated using (
  deleted_at is null
  and coaching_session_id in (select id from public.coaching_sessions)
  and (is_replay_published
       or coaching_session_id in (select private.my_session_ids())
       or organization_id in (select private.orgs_with_permission('coaching.update')))
);
create policy call_recordings_write on public.call_recordings for all to authenticated
  using (organization_id in (select private.orgs_with_permission('coaching.update')))
  with check (organization_id in (select private.orgs_with_permission('coaching.update')));

create policy action_items_select on public.action_items for select to authenticated using (
  deleted_at is null and (
    owner_id = (select private.effective_user_id())
    or organization_id in (select private.orgs_with_permission('coaching.read'))
  )
);
create policy action_items_insert on public.action_items for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('coaching.create')));
create policy action_items_update on public.action_items for update to authenticated
  using (owner_id = (select private.effective_user_id())
         or organization_id in (select private.orgs_with_permission('coaching.update')))
  with check (organization_id in (select private.orgs_with_access()));

create policy checkins_select on public.accountability_checkins for select to authenticated using (
  user_id = (select private.effective_user_id())
  or organization_id in (select private.orgs_with_permission('accountability.read'))
);
create policy checkins_insert on public.accountability_checkins for insert to authenticated with check (
  organization_id in (select private.orgs_with_access())
  and (user_id = (select private.effective_user_id())
       or organization_id in (select private.orgs_with_permission('accountability.create')))
);
create policy checkins_update on public.accountability_checkins for update to authenticated
  using (user_id = (select private.effective_user_id())
         or organization_id in (select private.orgs_with_permission('accountability.update')))
  with check (organization_id in (select private.orgs_with_access()));

-- ---------------------------------------------------------------------------
-- KPIs: financial definitions/entries need financials.read
-- ---------------------------------------------------------------------------
create policy kpi_definitions_select on public.kpi_definitions for select to authenticated using (
  organization_id in (select private.orgs_with_permission('kpis.read'))
  and (deleted_at is null or (select private.is_super_admin()))
  and (not is_financial or organization_id in (select private.orgs_with_permission('financials.read')))
);
create policy kpi_definitions_insert on public.kpi_definitions for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('kpis.create'))
  and organization_id in (select private.orgs_with_permission('kpis.update'))
  and (not is_financial or organization_id in (select private.orgs_with_permission('financials.read')))
);
create policy kpi_definitions_update on public.kpi_definitions for update to authenticated
  using (organization_id in (select private.orgs_with_permission('kpis.update'))
         and (not is_financial or organization_id in (select private.orgs_with_permission('financials.read'))))
  with check (organization_id in (select private.orgs_with_permission('kpis.update'))
              and (not is_financial or organization_id in (select private.orgs_with_permission('financials.read'))));
create policy kpi_definitions_delete on public.kpi_definitions for delete to authenticated using ((select private.is_super_admin()));

create policy kpi_entries_select on public.kpi_entries for select to authenticated using (
  kpi_definition_id in (select id from public.kpi_definitions)    -- inherits financial gate
);
create policy kpi_entries_insert on public.kpi_entries for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('kpis.create'))
  and kpi_definition_id in (select id from public.kpi_definitions)
);
create policy kpi_entries_update on public.kpi_entries for update to authenticated
  using (kpi_definition_id in (select id from public.kpi_definitions)
         and (organization_id in (select private.orgs_with_permission('kpis.update'))
              or entered_by = (select private.effective_user_id())))
  with check (organization_id in (select private.orgs_with_permission('kpis.create')));
create policy kpi_entries_delete on public.kpi_entries for delete to authenticated using (
  organization_id in (select private.orgs_with_permission('kpis.delete')));

-- ---------------------------------------------------------------------------
-- Dashboards
-- ---------------------------------------------------------------------------
create policy dashboards_select on public.dashboards for select to authenticated using (
  (deleted_at is null or (select private.is_super_admin()))
  and organization_id in (select private.orgs_with_access())
  and (
    organization_id in (select private.orgs_with_permission('dashboards.update'))
    or owner_id = (select private.effective_user_id())
    or (visibility = 'organization' and organization_id in (select private.orgs_with_permission('dashboards.read')))
    or (visibility = 'shared' and (select private.effective_user_id()) = any (shared_with))
  )
);
create policy dashboards_insert on public.dashboards for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('dashboards.create')));
create policy dashboards_update on public.dashboards for update to authenticated
  using (organization_id in (select private.orgs_with_permission('dashboards.update'))
         or owner_id = (select private.effective_user_id()))
  with check (organization_id in (select private.orgs_with_access()));
create policy dashboards_delete on public.dashboards for delete to authenticated using ((select private.is_super_admin()));

create policy dashboard_widgets_select on public.dashboard_widgets for select to authenticated using (
  dashboard_id in (select id from public.dashboards)
);
create policy dashboard_widgets_write on public.dashboard_widgets for all to authenticated
  using (dashboard_id in (select id from public.dashboards d
                          where d.organization_id in (select private.orgs_with_permission('dashboards.update'))
                             or d.owner_id = (select private.effective_user_id())))
  with check (dashboard_id in (select id from public.dashboards d
                          where d.organization_id in (select private.orgs_with_permission('dashboards.update'))
                             or d.owner_id = (select private.effective_user_id())));

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create policy tasks_select on public.tasks for select to authenticated using (
  (deleted_at is null or (select private.is_super_admin()))
  -- staff-only tasks never reach client users, whatever their permissions
  and (visibility <> 'staff' or (select private.is_platform_staff()) or (select private.is_super_admin()))
  and (
    organization_id in (select private.orgs_with_permission('tasks.read_all'))
    or id in (select private.my_task_ids())
    or (created_by = (select private.effective_user_id()) and organization_id in (select private.orgs_with_access()))
    or (visibility = 'organization' and organization_id in (select private.orgs_with_permission('tasks.read')))
  )
);
create policy tasks_insert on public.tasks for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('tasks.create'))
  and (visibility <> 'staff' or (select private.is_platform_staff()))
);
create policy tasks_update on public.tasks for update to authenticated
  using (
    (visibility <> 'staff' or (select private.is_platform_staff()) or (select private.is_super_admin()))
    and organization_id in (select private.orgs_with_permission('tasks.update'))
      and (organization_id in (select private.orgs_with_permission('tasks.read_all'))
           or visibility = 'organization' or created_by = (select private.effective_user_id()))
    or (visibility <> 'staff' and id in (select private.my_task_ids()))
  )
  with check (organization_id in (select private.orgs_with_access()));
create policy tasks_delete on public.tasks for delete to authenticated using ((select private.is_super_admin()));

create policy task_assignments_select on public.task_assignments for select to authenticated using (
  task_id in (select id from public.tasks)
);
create policy task_assignments_write on public.task_assignments for all to authenticated
  using (organization_id in (select private.orgs_with_permission('tasks.update')))
  with check (organization_id in (select private.orgs_with_permission('tasks.update'))
              and user_id in (select private.org_member_ids(organization_id)));

create policy task_comments_select on public.task_comments for select to authenticated using (
  deleted_at is null and task_id in (select id from public.tasks)
);
create policy task_comments_insert on public.task_comments for insert to authenticated with check (
  author_id = (select private.effective_user_id())
  and task_id in (select id from public.tasks)
);
create policy task_comments_update on public.task_comments for update to authenticated
  using (author_id = (select private.effective_user_id()))
  with check (author_id = (select private.effective_user_id()));

-- ---------------------------------------------------------------------------
-- Community
-- ---------------------------------------------------------------------------
create or replace function private.can_see_program_scope(p_org uuid, p_program uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_program is null then private.has_permission(p_org, 'community.read')
    else private.has_permission(p_org, 'programs.read')
         or (private.has_permission(p_org, 'community.read') and p_program in (select private.my_enrolled_program_ids()))
  end;
$$;

create policy announcements_select on public.announcements for select to authenticated using (
  deleted_at is null
  and organization_id in (select private.orgs_with_permission('community.read'))
  and (publish_at <= now() or organization_id in (select private.orgs_with_permission('community.moderate')))
  and private.can_see_program_scope(organization_id, program_id)
);
create policy announcements_write on public.announcements for all to authenticated
  using (organization_id in (select private.orgs_with_permission('community.moderate')))
  with check (organization_id in (select private.orgs_with_permission('community.moderate')));

create policy discussions_select on public.discussions for select to authenticated using (
  deleted_at is null
  and organization_id in (select private.orgs_with_permission('community.read'))
  and (not is_hidden or organization_id in (select private.orgs_with_permission('community.moderate'))
       or author_id = (select private.effective_user_id()))
  and private.can_see_program_scope(organization_id, program_id)
);
create policy discussions_insert on public.discussions for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('community.create'))
  and author_id = (select private.effective_user_id())
  and private.can_see_program_scope(organization_id, program_id)
);
create policy discussions_update on public.discussions for update to authenticated
  using (author_id = (select private.effective_user_id())
         or organization_id in (select private.orgs_with_permission('community.moderate')))
  with check (organization_id in (select private.orgs_with_permission('community.read')));

create policy discussion_comments_select on public.discussion_comments for select to authenticated using (
  deleted_at is null
  and discussion_id in (select id from public.discussions)
  and (not is_hidden or organization_id in (select private.orgs_with_permission('community.moderate'))
       or author_id = (select private.effective_user_id()))
);
create policy discussion_comments_insert on public.discussion_comments for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('community.create'))
  and author_id = (select private.effective_user_id())
  and discussion_id in (select id from public.discussions where not is_locked)
);
create policy discussion_comments_update on public.discussion_comments for update to authenticated
  using (author_id = (select private.effective_user_id())
         or organization_id in (select private.orgs_with_permission('community.moderate')))
  with check (organization_id in (select private.orgs_with_permission('community.read')));

-- ---------------------------------------------------------------------------
-- Direct messages (participants only; conversations created via RPC)
-- ---------------------------------------------------------------------------
create policy conversations_select on public.conversations for select to authenticated using (
  id in (select private.my_conversation_ids())
);
create policy conversations_update on public.conversations for update to authenticated
  using (id in (select private.my_conversation_ids()))
  with check (id in (select private.my_conversation_ids()));

create policy conversation_participants_select on public.conversation_participants for select to authenticated using (
  conversation_id in (select private.my_conversation_ids())
);
create policy conversation_participants_update on public.conversation_participants for update to authenticated
  using (user_id = (select private.effective_user_id()))
  with check (user_id = (select private.effective_user_id()));

create policy direct_messages_select on public.direct_messages for select to authenticated using (
  deleted_at is null and conversation_id in (select private.my_conversation_ids())
);
create policy direct_messages_insert on public.direct_messages for insert to authenticated with check (
  sender_id = (select private.effective_user_id())
  and conversation_id in (select private.my_conversation_ids())
  and organization_id in (select private.orgs_with_permission('messages.create'))
);
create policy direct_messages_update on public.direct_messages for update to authenticated
  using (sender_id = (select private.effective_user_id()))
  with check (sender_id = (select private.effective_user_id()));

create policy notifications_select on public.notifications for select to authenticated using (
  user_id = (select private.effective_user_id())
);
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select private.effective_user_id()))
  with check (user_id = (select private.effective_user_id()));

create policy notification_preferences_all on public.notification_preferences for all to authenticated
  using (user_id = (select private.effective_user_id()))
  with check (user_id = (select private.effective_user_id())
              and (organization_id is null or organization_id in (select private.orgs_with_access())));

create policy email_templates_select on public.email_templates for select to authenticated using (
  organization_id is null
  or organization_id in (select private.orgs_with_permission('organization.read'))
);
create policy email_templates_write on public.email_templates for all to authenticated
  using (case when organization_id is null then (select private.is_super_admin())
              else organization_id in (select private.orgs_with_permission('organization.update')) end)
  with check (case when organization_id is null then (select private.is_super_admin())
                   else organization_id in (select private.orgs_with_permission('organization.update')) end);

-- ---------------------------------------------------------------------------
-- Templates, onboarding, health models (platform-level)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['program_templates', 'lesson_templates', 'scorecard_templates', 'dashboard_templates',
                           'sop_templates', 'offer_templates', 'pipeline_templates', 'task_templates',
                           'task_template_items', 'onboarding_templates', 'onboarding_template_items',
                           'health_score_models', 'health_score_factors'] loop
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated using (
      (select private.is_platform_staff()) or (select private.is_super_admin()))$p$, t);
    execute format($p$create policy %1$s_write on public.%1$I for all to authenticated
      using ((select private.is_super_admin())) with check ((select private.is_super_admin()))$p$, t);
  end loop;
  foreach t in array array['onboarding_questionnaires', 'questionnaire_questions',
                           'automation_trigger_types', 'automation_action_types'] loop
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated using (true)$p$, t);
  end loop;
  foreach t in array array['onboarding_questionnaires', 'questionnaire_questions'] loop
    execute format($p$create policy %1$s_write on public.%1$I for all to authenticated
      using ((select private.is_super_admin())) with check ((select private.is_super_admin()))$p$, t);
  end loop;
end $$;

create policy questionnaire_responses_select on public.questionnaire_responses for select to authenticated using (
  organization_id in (select private.orgs_with_permission('organization.update'))
  or user_id = (select private.effective_user_id())
);

create policy template_applications_select on public.template_applications for select to authenticated using (
  organization_id in (select private.orgs_with_permission('templates.apply'))
);

create policy automation_runs_select on public.automation_runs for select to authenticated using (
  organization_id in (select private.orgs_with_permission('automations.read'))
);
create policy automation_run_steps_select on public.automation_run_steps for select to authenticated using (
  organization_id in (select private.orgs_with_permission('automations.read'))
);

-- ---------------------------------------------------------------------------
-- Guard: every custom-mode table must have a SELECT (or ALL) policy.
-- ---------------------------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(r.table_name, ', ') into missing
  from private.rls_registry r
  where r.policy_mode = 'custom'
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = r.table_name
                      and p.cmd in ('SELECT', 'ALL'));
  if missing is not null then
    raise exception 'custom-policy tables without a SELECT policy: %', missing;
  end if;
end $$;
