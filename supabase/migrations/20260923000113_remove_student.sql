-- =============================================================================
-- 0113 REMOVE A STUDENT
--
-- You could add a student with a button but only remove one with a database
-- query. This adds the missing half.
--
-- Removal is a soft delete, like every other record in here that carries
-- history. Someone's onboarding answers are their own words about their
-- business; taking them off the list should not burn them. A super admin can
-- still see and restore a removed student.
--
-- The two partial unique indexes gain "and deleted_at is null", so removing
-- someone and later adding them again gives a clean record rather than
-- resurrecting the old one. Every ON CONFLICT on this table has to name the
-- index predicate exactly, which is why the four writers reappear below with
-- that one line changed.
-- =============================================================================

alter table public.customer_onboardings
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.users(id) on delete set null;
create index customer_onboardings_live_idx on public.customer_onboardings (organization_id) where deleted_at is null;

drop index public.customer_onboardings_course_key;
drop index public.customer_onboardings_intake_key;
create unique index customer_onboardings_course_key
  on public.customer_onboardings (organization_id, program_id, email) where program_id is not null and deleted_at is null;
create unique index customer_onboardings_intake_key
  on public.customer_onboardings (organization_id, email) where program_id is null and deleted_at is null;

-- a removed student stops being "mine" for row level security
create or replace function private.my_onboarding_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.customer_onboardings where user_id = private.effective_user_id() and deleted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- The writers, with the index predicate named
-- ---------------------------------------------------------------------------
create or replace function private.track_student_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  mail    extensions.citext;
  cid     uuid;
  oid     uuid;
  created boolean;
begin
  if new.status <> 'active'
     or not exists (select 1 from public.roles r where r.id = new.role_id and r.key = 'student') then
    return new;
  end if;

  select email into mail from public.users where id = new.user_id;
  if mail is null then return new; end if;

  select id into cid from public.contacts
  where organization_id = new.organization_id and email = mail and deleted_at is null;
  if cid is null then
    insert into public.contacts (organization_id, email, user_id, lifecycle_stage, source)
    values (new.organization_id, mail, new.user_id, 'customer', 'membership') returning id into cid;
  else
    update public.contacts set user_id = new.user_id where id = cid and user_id is null;
  end if;

  insert into public.customer_onboardings (organization_id, program_id, email, contact_id, user_id, status, registered_at)
  values (new.organization_id, null, mail, cid, new.user_id, 'registered', now())
  on conflict (organization_id, email) where program_id is null and deleted_at is null do update
    set user_id    = excluded.user_id,
        contact_id = coalesce(public.customer_onboardings.contact_id, excluded.contact_id)
  returning id, (xmax = 0) into oid, created;

  if created then
    perform private.emit_event(new.organization_id, 'customer.registered', 'contact', cid,
      jsonb_build_object('onboarding_id', oid, 'program_id', null, 'user_id', new.user_id,
                         'email', mail::text, 'contact_id', cid));
  end if;
  return new;
end;
$$;

create or replace function private.track_customer_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  pid uuid;
  cid uuid;
  oid uuid;
begin
  if jsonb_array_length(coalesce(new.payload->'program_ids', '[]')) = 0
     or not exists (select 1 from public.roles r where r.id = new.role_id and r.key = 'student') then
    return new;
  end if;

  insert into public.contacts (organization_id, email, lifecycle_stage, source)
  values (new.organization_id, new.email, 'customer', 'invitation')
  on conflict (organization_id, email) where email is not null and deleted_at is null
  do update set lifecycle_stage = case when public.contacts.lifecycle_stage in ('subscriber', 'lead', 'prospect')
                                       then 'customer' else public.contacts.lifecycle_stage end
  returning id into cid;

  for pid in select (jsonb_array_elements_text(new.payload->'program_ids'))::uuid loop
    continue when not exists (select 1 from public.programs p where p.id = pid and p.organization_id = new.organization_id);
    insert into public.customer_onboardings (organization_id, program_id, email, contact_id, invitation_id, purchase_id, status)
    values (new.organization_id, pid, new.email, cid, new.id, nullif(new.payload->>'purchase_id', '')::uuid, 'invited')
    on conflict (organization_id, program_id, email) where program_id is not null and deleted_at is null do update
      set invitation_id = excluded.invitation_id,
          contact_id    = coalesce(public.customer_onboardings.contact_id, excluded.contact_id),
          purchase_id   = coalesce(public.customer_onboardings.purchase_id, excluded.purchase_id),
          invited_at    = now()
      where public.customer_onboardings.status = 'invited'
    returning id into oid;
    if oid is not null then
      perform private.emit_event(new.organization_id, 'customer.invited', 'contact', cid,
        jsonb_build_object('onboarding_id', oid, 'program_id', pid, 'email', new.email::text, 'contact_id', cid));
    end if;
  end loop;
  return new;
end;
$$;

create or replace function private.track_customer_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  mail extensions.citext;
  cid  uuid;
  oid  uuid;
  was  text;
begin
  select email into mail from public.users where id = new.user_id;
  if mail is null then return new; end if;

  select status into was from public.customer_onboardings
  where organization_id = new.organization_id and program_id = new.program_id and email = mail and deleted_at is null;

  -- staff and client admins enrolling themselves to review a course are not customers
  if was is null and not exists (
       select 1 from public.organization_memberships m join public.roles r on r.id = m.role_id
       where m.organization_id = new.organization_id and m.user_id = new.user_id and m.status = 'active' and r.key = 'student') then
    return new;
  end if;

  select id into cid from public.contacts
  where organization_id = new.organization_id and email = mail and deleted_at is null;
  if cid is null then
    insert into public.contacts (organization_id, email, user_id, lifecycle_stage, source)
    values (new.organization_id, mail, new.user_id, 'customer', 'enrollment') returning id into cid;
  else
    update public.contacts set user_id = new.user_id where id = cid and user_id is null;
  end if;

  insert into public.customer_onboardings (organization_id, program_id, email, contact_id, user_id, purchase_id, status, registered_at)
  values (new.organization_id, new.program_id, mail, cid, new.user_id, new.source_purchase_id, 'registered', now())
  on conflict (organization_id, program_id, email) where program_id is not null and deleted_at is null do update
    set user_id       = excluded.user_id,
        contact_id    = coalesce(public.customer_onboardings.contact_id, excluded.contact_id),
        registered_at = coalesce(public.customer_onboardings.registered_at, now()),
        status        = case when public.customer_onboardings.status = 'invited' then 'registered'
                             else public.customer_onboardings.status end
  returning id into oid;

  if was is distinct from 'registered' and was is distinct from 'in_progress' and was is distinct from 'completed' then
    perform private.emit_event(new.organization_id, 'customer.registered', 'contact', cid,
      jsonb_build_object('onboarding_id', oid, 'program_id', new.program_id, 'user_id', new.user_id, 'email', mail::text, 'contact_id', cid));
  end if;
  return new;
end;
$$;

create or replace function app.add_customer(p_organization_id uuid, p_program_id uuid, p_email text,
                                            p_first_name text default null, p_last_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  mail text := lower(btrim(p_email));
  r    public.roles;
  uid  uuid;
  cid  uuid;
  oid  uuid;
  inv  jsonb;
begin
  perform private.require_user();
  perform private.assert_permission(p_organization_id, 'enrollments.create');
  if mail !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  if not exists (select 1 from public.programs p
                 where p.id = p_program_id and p.organization_id = p_organization_id and p.deleted_at is null) then
    raise exception 'course does not belong to this workspace';
  end if;

  insert into public.contacts (organization_id, email, first_name, last_name, lifecycle_stage, source)
  values (p_organization_id, mail, nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''), 'customer', 'manual')
  on conflict (organization_id, email) where email is not null and deleted_at is null
  do update set first_name = coalesce(nullif(btrim(p_first_name), ''), public.contacts.first_name),
                last_name  = coalesce(nullif(btrim(p_last_name), ''), public.contacts.last_name),
                lifecycle_stage = case when public.contacts.lifecycle_stage in ('subscriber', 'lead', 'prospect')
                                       then 'customer' else public.contacts.lifecycle_stage end
  returning id into cid;

  select u.id into uid from public.users u
  join public.organization_memberships m on m.user_id = u.id and m.organization_id = p_organization_id and m.status = 'active'
  where u.email = mail::extensions.citext;

  if uid is not null then
    perform private.enroll(p_organization_id, p_program_id, uid, 'manual');
    insert into public.customer_onboardings (organization_id, program_id, email, contact_id, user_id, status, registered_at)
    values (p_organization_id, p_program_id, mail, cid, uid, 'registered', now())
    on conflict (organization_id, program_id, email) where program_id is not null and deleted_at is null do nothing;
    select id into oid from public.customer_onboardings
    where organization_id = p_organization_id and program_id = p_program_id and email = mail::extensions.citext and deleted_at is null;
    return jsonb_build_object('onboarding_id', oid, 'status', 'enrolled');
  end if;

  r := private.role_by_key(null, 'student');
  perform private.assert_subset_of_caller(p_organization_id, private.role_permission_keys(r.id), 'role ' || r.key);
  inv := private.create_invitation(p_organization_id, mail, r.id, jsonb_build_object('program_ids', jsonb_build_array(p_program_id)));

  select id into oid from public.customer_onboardings
  where organization_id = p_organization_id and program_id = p_program_id and email = mail::extensions.citext and deleted_at is null;
  return jsonb_build_object('onboarding_id', oid, 'status', 'invited',
                            'token', inv->>'token', 'accept_path', inv->>'accept_path');
end;
$$;

-- ---------------------------------------------------------------------------
-- The readers: a removed student has nothing to fill in and counts for nothing
-- ---------------------------------------------------------------------------
create or replace function app.get_pending_onboarding()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('onboarding_id', co.id, 'organization_slug', o.slug)
  from public.customer_onboardings co
  join public.organizations o on o.id = co.organization_id
  left join public.programs p on p.id = co.program_id and p.deleted_at is null
  join public.onboarding_forms f
    on f.id = private.intake_form_id(co.organization_id, co.program_id, co.form_id)
   and f.status = 'published' and f.deleted_at is null
  where co.user_id = private.effective_user_id()
    and co.deleted_at is null
    and co.status <> 'completed'
    and (co.program_id is null or p.id is not null)
  order by (co.program_id is not null), co.invited_at
  limit 1;
$$;

create or replace function app.get_my_onboarding(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  co  public.customer_onboardings;
  o   public.organizations;
  p   public.programs;
  f   public.onboarding_forms;
begin
  select * into o from public.organizations where slug = p_slug::extensions.citext;
  if o.id is null then return null; end if;

  select c.* into co from public.customer_onboardings c
  left join public.programs pr on pr.id = c.program_id and pr.deleted_at is null
  join public.onboarding_forms fm
    on fm.id = private.intake_form_id(c.organization_id, c.program_id, c.form_id) and fm.deleted_at is null
  where c.organization_id = o.id and c.user_id = uid and c.deleted_at is null
    and (c.program_id is null or pr.id is not null)
    and (c.status = 'completed' or fm.status = 'published')
  order by (c.status = 'completed'),
           case when c.status = 'completed' then c.completed_at end desc nulls last,
           (c.program_id is not null), c.invited_at
  limit 1;
  if co.id is null then return null; end if;

  select * into p from public.programs where id = co.program_id;
  select * into f from public.onboarding_forms
  where id = private.intake_form_id(co.organization_id, co.program_id, co.form_id);

  return jsonb_build_object(
    'onboarding', jsonb_build_object('id', co.id, 'status', co.status, 'completed_at', co.completed_at),
    'organization', jsonb_build_object('name', o.name, 'slug', o.slug, 'logo_url', o.logo_url, 'brand_color', o.settings->>'brand_color'),
    'program', case when p.id is null then null else jsonb_build_object('id', p.id, 'title', p.title) end,
    'first_name', (select coalesce(nullif(up.first_name, ''), c.first_name) from public.users u
                   left join public.user_profiles up on up.user_id = u.id
                   left join public.contacts c on c.id = co.contact_id where u.id = uid),
    'form', jsonb_build_object('id', f.id, 'name', f.name, 'welcome_heading', f.welcome_heading,
                               'welcome_message', f.welcome_message, 'completion_message', f.completion_message),
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', q.id, 'key', q.key, 'label', q.label, 'help_text', q.help_text, 'question_type', q.question_type,
                     'options', q.options, 'is_required', q.is_required) order by q.position, q.created_at)
                   from public.onboarding_form_questions q where q.form_id = f.id and q.deleted_at is null), '[]'),
    'answers', coalesce((select jsonb_object_agg(a.question_id::text, a.value)
                         from public.customer_onboarding_answers a where a.onboarding_id = co.id), '{}'));
end;
$$;

create or replace function app.reopen_onboarding(p_onboarding_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  co  public.customer_onboardings;
  who text;
begin
  perform private.require_user();
  select * into co from public.customer_onboardings where id = p_onboarding_id and deleted_at is null;
  if co.id is null then raise exception 'onboarding not found' using errcode = 'P0002'; end if;
  perform private.assert_permission(co.organization_id, 'enrollments.update');
  if co.status <> 'completed' then raise exception 'this onboarding is not finished, so there is nothing to reopen'; end if;

  update public.customer_onboardings set status = 'in_progress', completed_at = null where id = co.id;

  who := coalesce((select nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')
                   from public.contacts c where c.id = co.contact_id), co.email::text);
  perform private.log_activity(co.organization_id, 'contact', co.contact_id, 'onboarding_reopened',
                               'Reopened the onboarding form for ' || who,
                               jsonb_build_object('onboarding_id', co.id));
  return jsonb_build_object('onboarding_id', co.id, 'status', 'in_progress');
end;
$$;

create or replace function app.remind_onboarding(p_onboarding_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  co public.customer_onboardings;
  o  public.organizations;
  f  public.onboarding_forms;
begin
  perform private.require_user();
  select * into co from public.customer_onboardings where id = p_onboarding_id and deleted_at is null;
  if co.id is null then raise exception 'onboarding not found' using errcode = 'P0002'; end if;
  perform private.assert_permission(co.organization_id, 'enrollments.update');
  if co.status = 'completed' then raise exception 'they have already finished, so there is nothing to remind them about'; end if;
  if co.user_id is null then raise exception 'they have not created their login yet, so send them their invitation link instead'; end if;

  select * into o from public.organizations where id = co.organization_id;
  select * into f from public.onboarding_forms
  where id = private.intake_form_id(co.organization_id, co.program_id, co.form_id) and status = 'published' and deleted_at is null;
  if f.id is null then raise exception 'there is no onboarding form to fill in yet'; end if;

  insert into public.email_outbox (organization_id, template_key, to_email, to_user_id, variables)
  values (co.organization_id, 'onboarding_reminder', co.email, co.user_id, jsonb_build_object(
    'organization_name', o.name, 'form_name', f.name, 'start_path', '/start/' || o.slug,
    'first_name', coalesce((select nullif(btrim(c.first_name), '') from public.contacts c where c.id = co.contact_id), 'there')));

  perform private.log_activity(co.organization_id, 'contact', co.contact_id, 'onboarding_reminded',
                               'Sent an onboarding reminder to ' || co.email::text,
                               jsonb_build_object('onboarding_id', co.id));
  return jsonb_build_object('onboarding_id', co.id, 'to', co.email::text);
end;
$$;

create or replace function app.workspace_counts(p_org uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'customers', c.total, 'invited', c.invited, 'joined', c.joined, 'completed', c.completed,
    'new_30d', c.new_30d, 'completed_30d', c.completed_30d, 'unfinished_with_form', c.unfinished_with_form,
    'enrolled', e.enrolled, 'avg_progress', e.avg_progress,
    'open_deals', d.open_deals, 'open_value_cents', d.open_value_cents
  )
  from (
    select count(*) as total,
           count(*) filter (where co.status = 'invited') as invited,
           count(*) filter (where co.status <> 'invited') as joined,
           count(*) filter (where co.status = 'completed') as completed,
           count(*) filter (where co.invited_at >= now() - interval '30 days') as new_30d,
           count(*) filter (where co.completed_at >= now() - interval '30 days') as completed_30d,
           count(*) filter (where co.status in ('registered', 'in_progress')
                              and coalesce(p.onboarding_form_id, org.default_onboarding_form_id) is not null
                              and (co.program_id is null or p.deleted_at is null)) as unfinished_with_form
    from public.customer_onboardings co
    join public.organizations org on org.id = co.organization_id
    left join public.programs p on p.id = co.program_id
    where co.organization_id = p_org and co.deleted_at is null
  ) c,
  (
    select count(*) as enrolled, round(avg(pe.progress_percent)) as avg_progress
    from public.program_enrollments pe
    where pe.organization_id = p_org and pe.status in ('active', 'completed')
  ) e,
  (
    select count(*) as open_deals, coalesce(sum(o.value_cents), 0) as open_value_cents
    from public.opportunities o
    where o.organization_id = p_org and o.status = 'open' and o.deleted_at is null
  ) d;
$$;

-- ---------------------------------------------------------------------------
-- Removing a student: everything that makes them a student here, in one go
-- ---------------------------------------------------------------------------
create or replace function app.remove_student(p_onboarding_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := private.require_user();
  co   public.customer_onboardings;
  mem  public.organization_memberships;
  n_ob int;
  n_en int := 0;
  who  text;
begin
  select * into co from public.customer_onboardings where id = p_onboarding_id and deleted_at is null;
  if co.id is null then raise exception 'student not found' using errcode = 'P0002'; end if;
  perform private.assert_permission(co.organization_id, 'enrollments.delete');

  -- taking away a login is a different decision from taking someone off the list
  if co.user_id is not null then
    select m.* into mem from public.organization_memberships m
    join public.roles r on r.id = m.role_id
    where m.organization_id = co.organization_id and m.user_id = co.user_id
      and m.status = 'active' and r.key = 'student';
    if mem.id is not null then perform private.assert_permission(co.organization_id, 'members.delete'); end if;
  end if;

  -- every onboarding record they hold here, not only the one that was clicked
  update public.customer_onboardings set deleted_at = now(), deleted_by = uid
  where organization_id = co.organization_id and email = co.email and deleted_at is null;
  get diagnostics n_ob = row_count;

  if co.user_id is not null then
    update public.program_enrollments set status = 'revoked'
    where organization_id = co.organization_id and user_id = co.user_id and status <> 'revoked';
    get diagnostics n_en = row_count;
  end if;

  if mem.id is not null then
    update public.organization_memberships set status = 'removed' where id = mem.id;
  end if;

  -- an invitation they never used stops working
  update public.invitations set status = 'revoked'
  where organization_id = co.organization_id and email = co.email and status = 'pending';

  who := coalesce((select nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')
                   from public.contacts c where c.id = co.contact_id), co.email::text);
  perform private.log_activity(co.organization_id, 'contact', co.contact_id, 'student_removed',
                               'Removed ' || who || ' from students',
                               jsonb_build_object('onboarding_id', co.id, 'onboardings', n_ob, 'enrollments', n_en));
  return jsonb_build_object('email', co.email::text, 'name', who, 'onboardings', n_ob,
                            'enrollments', n_en, 'lost_access', mem.id is not null);
end;
$$;

revoke all on function app.remove_student(uuid) from public, anon;
grant execute on function app.remove_student(uuid) to authenticated, service_role;
