-- =============================================================================
-- 0117 A STUDENT HAS A COACH
--
-- team_assignments links a Growth OS staff member to a whole workspace, which
-- says nothing about who looks after which student. The Coaches page needs
-- exactly that, so a student record carries the coach responsible for them.
--
-- The coach belongs to the person, not to one of their courses, so it is
-- written to every onboarding record that person holds here, the same way
-- app.remove_student treats them as one.
-- =============================================================================

alter table public.customer_onboardings
  add column coach_id uuid references public.users(id) on delete set null;
create index customer_onboardings_coach_idx on public.customer_onboardings (organization_id, coach_id)
  where coach_id is not null and deleted_at is null;

-- Null clears it. The coach must actually belong to this workspace, as a member who is not a
-- student or as assigned Growth OS staff, so nobody can be handed to a stranger.
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
  return jsonb_build_object('onboarding_id', co.id, 'coach_id', p_coach, 'records', n);
end;
$$;

revoke all on function app.assign_coach(uuid, uuid) from public, anon;
grant execute on function app.assign_coach(uuid, uuid) to authenticated, service_role;
