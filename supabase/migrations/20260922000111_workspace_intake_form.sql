-- =============================================================================
-- 0111 WORKSPACE INTAKE FORM
--
-- Until now an onboarding form could only reach someone through a course:
-- publish the form, attach it to a course, add the person as a customer of that
-- course. A coach with no courses had no way to onboard anyone at all, and a
-- form that was never attached silently reached nobody.
--
-- After this migration a workspace has one intake form that every student
-- fills in. A course may still override it with its own form, which is what
-- someone selling several courses wants. The resolution order lives in one
-- place, private.intake_form_id.
--
-- Everything else about 0102 is reused: the answers table, row level security,
-- the events, the staff view. The only structural change is that an onboarding
-- record no longer needs a course.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The workspace's intake form
-- ---------------------------------------------------------------------------
alter table public.organizations add column default_onboarding_form_id uuid;
-- the composite FK makes another workspace's form impossible, the same trick programs uses
alter table public.organizations add constraint organizations_default_onboarding_form_fk
  foreign key (id, default_onboarding_form_id)
  references public.onboarding_forms(organization_id, id) on delete set null (default_onboarding_form_id);
create index organizations_default_onboarding_form_idx on public.organizations (default_onboarding_form_id)
  where default_onboarding_form_id is not null;

-- Same rule a course already has: a draft form cannot be put in front of anyone.
create or replace function private.check_org_intake_form()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.default_onboarding_form_id is not null
     and new.default_onboarding_form_id is distinct from old.default_onboarding_form_id
     and not exists (select 1 from public.onboarding_forms f
                     where f.id = new.default_onboarding_form_id and f.organization_id = new.id
                       and f.status = 'published' and f.deleted_at is null) then
    raise exception 'publish the onboarding form before making it the intake form';
  end if;
  return new;
end;
$$;
create trigger check_intake_form before update of default_onboarding_form_id on public.organizations
  for each row execute function private.check_org_intake_form();

-- ---------------------------------------------------------------------------
-- 2. An onboarding record no longer needs a course
--    program_id null means "the workspace intake", one per person.
-- ---------------------------------------------------------------------------
alter table public.customer_onboardings alter column program_id drop not null;
alter table public.customer_onboardings
  drop constraint customer_onboardings_organization_id_program_id_email_key;
-- two partial indexes, because a plain unique constraint does not catch duplicate NULLs
create unique index customer_onboardings_course_key
  on public.customer_onboardings (organization_id, program_id, email) where program_id is not null;
create unique index customer_onboardings_intake_key
  on public.customer_onboardings (organization_id, email) where program_id is null;

-- ---------------------------------------------------------------------------
-- 3. Which form does this record show? One answer, used everywhere.
--    The form they already started beats the course's, which beats the workspace's.
-- ---------------------------------------------------------------------------
create or replace function private.intake_form_id(p_org uuid, p_program uuid, p_form uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_form,
    (select p.onboarding_form_id from public.programs p
     where p.id = p_program and p.organization_id = p_org and p.deleted_at is null),
    (select o.default_onboarding_form_id from public.organizations o where o.id = p_org));
$$;

-- ---------------------------------------------------------------------------
-- 4. Every student gets an intake record, whichever door they came through
--    (Team page, invitation, join link, purchase). Mirrors track_customer_enrollment,
--    which already does this for course enrollments.
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
  on conflict (organization_id, email) where program_id is null do update
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
create trigger track_student after insert or update of role_id, status on public.organization_memberships
  for each row execute function private.track_student_membership();

-- Backfill: people who are already students but predate the trigger. No events are emitted for
-- these, because nothing has just happened to them.
insert into public.contacts (organization_id, email, user_id, lifecycle_stage, source)
select om.organization_id, u.email, u.id, 'customer', 'membership'
from public.organization_memberships om
join public.roles r on r.id = om.role_id and r.key = 'student'
join public.users u on u.id = om.user_id
where om.status = 'active'
on conflict (organization_id, email) where email is not null and deleted_at is null do nothing;

insert into public.customer_onboardings (organization_id, program_id, email, contact_id, user_id, status, registered_at)
select om.organization_id, null, u.email, c.id, u.id, 'registered', now()
from public.organization_memberships om
join public.roles r on r.id = om.role_id and r.key = 'student'
join public.users u on u.id = om.user_id
left join public.contacts c on c.organization_id = om.organization_id and c.email = u.email and c.deleted_at is null
where om.status = 'active'
on conflict (organization_id, email) where program_id is null do nothing;

-- ---------------------------------------------------------------------------
-- 5. ON CONFLICT now has to name the partial index predicate, so the three
--    course-scoped writers are recreated with that one line changed.
-- ---------------------------------------------------------------------------
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
    on conflict (organization_id, program_id, email) where program_id is not null do update
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
  where organization_id = new.organization_id and program_id = new.program_id and email = mail;

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
  on conflict (organization_id, program_id, email) where program_id is not null do update
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
    -- already has a login in this workspace: grant access now, no invitation needed
    perform private.enroll(p_organization_id, p_program_id, uid, 'manual');
    insert into public.customer_onboardings (organization_id, program_id, email, contact_id, user_id, status, registered_at)
    values (p_organization_id, p_program_id, mail, cid, uid, 'registered', now())
    on conflict (organization_id, program_id, email) where program_id is not null do nothing;
    select id into oid from public.customer_onboardings
    where organization_id = p_organization_id and program_id = p_program_id and email = mail::extensions.citext;
    return jsonb_build_object('onboarding_id', oid, 'status', 'enrolled');
  end if;

  r := private.role_by_key(null, 'student');
  perform private.assert_subset_of_caller(p_organization_id, private.role_permission_keys(r.id), 'role ' || r.key);
  inv := private.create_invitation(p_organization_id, mail, r.id, jsonb_build_object('program_ids', jsonb_build_array(p_program_id)));

  select id into oid from public.customer_onboardings
  where organization_id = p_organization_id and program_id = p_program_id and email = mail::extensions.citext;
  return jsonb_build_object('onboarding_id', oid, 'status', 'invited',
                            'token', inv->>'token', 'accept_path', inv->>'accept_path');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The customer-facing reads, now course-optional
-- ---------------------------------------------------------------------------

-- Where should this student go right now? The workspace intake comes before any course form.
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

  -- oldest unfinished onboarding that has a live form; otherwise the latest finished one (thank-you screen)
  select c.* into co from public.customer_onboardings c
  left join public.programs pr on pr.id = c.program_id and pr.deleted_at is null
  join public.onboarding_forms fm
    on fm.id = private.intake_form_id(c.organization_id, c.program_id, c.form_id) and fm.deleted_at is null
  where c.organization_id = o.id and c.user_id = uid
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
    -- null when this is the workspace intake rather than a course's own form
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

create or replace function app.save_onboarding_answers(p_onboarding_id uuid, p_answers jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := private.require_user();
  co      public.customer_onboardings;
  o       public.organizations;
  p       public.programs;
  f       public.onboarding_forms;
  q       public.onboarding_form_questions;
  v       jsonb;
  clean   jsonb;
  txt     text;
  missing text[] := '{}';
  first   boolean;
  staff   uuid;
  who     text;
  what    text;
begin
  select * into co from public.customer_onboardings where id = p_onboarding_id for update;
  if co.id is null or co.user_id is distinct from uid then
    raise exception 'onboarding not found' using errcode = 'P0002';   -- same answer for "not yours" and "does not exist"
  end if;
  if co.status = 'completed' then raise exception 'this onboarding is already complete'; end if;
  if jsonb_typeof(coalesce(p_answers, '{}')) <> 'object' then raise exception 'answers must be an object'; end if;

  select * into o from public.organizations where id = co.organization_id;
  select * into p from public.programs where id = co.program_id;      -- null for the workspace intake
  select * into f from public.onboarding_forms
  where id = private.intake_form_id(co.organization_id, co.program_id, co.form_id)
    and organization_id = co.organization_id and deleted_at is null;
  if f.id is null or f.status <> 'published' then raise exception 'there is no onboarding form to fill in yet'; end if;
  first := co.started_at is null;
  what  := coalesce(p.title, o.name);

  for q in select * from public.onboarding_form_questions
           where form_id = f.id and deleted_at is null order by position, created_at loop
    if p_answers ? q.id::text then
      v := p_answers -> q.id::text;
      clean := null;
      case
        when jsonb_typeof(v) = 'null' then clean := null;
        when q.question_type in ('short_text', 'long_text', 'email', 'url', 'single_select') then
          if jsonb_typeof(v) <> 'string' then raise exception '"%" expects text', q.label; end if;
          txt := btrim(v #>> '{}');
          if txt = '' then clean := null;
          elsif length(txt) > 10000 then raise exception '"%" is too long', q.label;
          elsif q.question_type = 'email' and txt !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
            raise exception '"%" needs a valid email address', q.label;
          elsif q.question_type = 'url' and txt !~* '^https?://[^\s]+\.[^\s]+$' then
            raise exception '"%" needs a full link starting with http:// or https://', q.label;
          elsif q.question_type = 'single_select' and not q.options ? txt then
            raise exception '"%" has an option that is not on the form', q.label;
          else clean := to_jsonb(txt);
          end if;
        when q.question_type = 'number' then
          if jsonb_typeof(v) = 'number' then clean := v;
          elsif jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '' then clean := null;
          elsif jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then
            clean := to_jsonb((btrim(v #>> '{}'))::numeric);
          else raise exception '"%" needs a number', q.label;
          end if;
        when q.question_type = 'multi_select' then
          if jsonb_typeof(v) <> 'array' then raise exception '"%" expects a list', q.label; end if;
          if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or not q.options ? (e #>> '{}')) then
            raise exception '"%" has an option that is not on the form', q.label;
          end if;
          clean := case when jsonb_array_length(v) = 0 then null else v end;
        when q.question_type = 'checkbox' then
          if jsonb_typeof(v) <> 'boolean' then raise exception '"%" expects yes or no', q.label; end if;
          clean := case when v = 'true'::jsonb then v else null end;    -- unchecked is "no answer"
      end case;

      if clean is null then
        delete from public.customer_onboarding_answers where onboarding_id = co.id and question_id = q.id;
      else
        insert into public.customer_onboarding_answers (organization_id, onboarding_id, question_id, value)
        values (co.organization_id, co.id, q.id, clean)
        on conflict (onboarding_id, question_id) do update set value = excluded.value;
      end if;
    end if;

    if p_submit and q.is_required and not exists (
         select 1 from public.customer_onboarding_answers a where a.onboarding_id = co.id and a.question_id = q.id) then
      missing := missing || q.label;
    end if;
  end loop;

  if p_submit and cardinality(missing) > 0 then
    raise exception 'Please answer: %', array_to_string(missing, ', ');
  end if;

  update public.customer_onboardings
     set form_id = f.id,
         started_at = coalesce(started_at, now()),
         status = case when p_submit then 'completed' else 'in_progress' end,
         completed_at = case when p_submit then now() end
   where id = co.id;

  if first then
    perform private.emit_event(co.organization_id, 'customer.onboarding_started', 'contact', co.contact_id,
      jsonb_build_object('onboarding_id', co.id, 'program_id', co.program_id, 'user_id', uid,
                         'email', co.email::text, 'contact_id', co.contact_id));
  end if;

  if p_submit then
    who := coalesce((select nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') from public.contacts c where c.id = co.contact_id), co.email::text);
    perform private.log_activity(co.organization_id, 'contact', co.contact_id, 'onboarding_completed',
                                 who || ' completed onboarding for ' || what,
                                 jsonb_build_object('onboarding_id', co.id, 'program_id', p.id));
    perform private.emit_event(co.organization_id, 'customer.onboarding_completed', 'contact', co.contact_id,
      jsonb_build_object(
        'onboarding_id', co.id, 'user_id', uid, 'contact_id', co.contact_id, 'email', co.email::text,
        'program_id', p.id, 'program_title', p.title, 'form_id', f.id, 'form_name', f.name,
        -- flat map for conditions ("answers.monthly_revenue > 10000"), full list for anything richer
        'answers', coalesce((select jsonb_object_agg(qq.key, a.value)
                             from public.customer_onboarding_answers a
                             join public.onboarding_form_questions qq on qq.id = a.question_id
                             where a.onboarding_id = co.id), '{}'),
        'responses', coalesce((select jsonb_agg(jsonb_build_object('question_id', qq.id, 'key', qq.key, 'label', qq.label,
                                                                   'type', qq.question_type, 'value', a.value) order by qq.position)
                               from public.customer_onboarding_answers a
                               join public.onboarding_form_questions qq on qq.id = a.question_id
                               where a.onboarding_id = co.id), '[]')));
    for staff in select t.user_id from public.team_assignments t where t.organization_id = co.organization_id and t.status = 'active' loop
      -- the link used to be /customers/<id>, with no workspace in it, so it 404'd
      perform private.notify(co.organization_id, staff, 'customer.onboarding_completed', who || ' completed onboarding',
                             what, '/w/' || o.slug || '/students/' || co.id);
    end loop;
  end if;

  return jsonb_build_object('onboarding_id', co.id, 'status', case when p_submit then 'completed' else 'in_progress' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Let the team reopen a submitted form so someone can correct an answer
-- ---------------------------------------------------------------------------
create or replace function app.reopen_onboarding(p_onboarding_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  co  public.customer_onboardings;
  who text;
begin
  perform private.require_user();
  select * into co from public.customer_onboardings where id = p_onboarding_id;
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

-- ---------------------------------------------------------------------------
-- 8. Nudge someone who has not finished
-- ---------------------------------------------------------------------------
insert into public.email_templates (organization_id, key, name, subject, body_html, body_text, variables) values
  (null, 'onboarding_reminder', 'Onboarding reminder',
   'A quick reminder from {{organization_name}}',
   '<p>Hi {{first_name}},</p><p>{{organization_name}} is still waiting on your answers to <b>{{form_name}}</b>. It only takes a few minutes and it is what they use to get you started.</p><p><a href="{{app_url}}{{start_path}}">Finish it here</a></p>',
   E'Hi {{first_name}},\n\n{{organization_name}} is still waiting on your answers to {{form_name}}. It only takes a few minutes and it is what they use to get you started.\n\nFinish it here: {{app_url}}{{start_path}}',
   array['organization_name', 'first_name', 'form_name', 'start_path', 'app_url'])
on conflict (organization_id, key) do nothing;

create or replace function app.remind_onboarding(p_onboarding_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  co public.customer_onboardings;
  o  public.organizations;
  f  public.onboarding_forms;
begin
  perform private.require_user();
  select * into co from public.customer_onboardings where id = p_onboarding_id;
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

-- ---------------------------------------------------------------------------
-- 9. Counts: "not finished onboarding" must see the workspace form too
-- ---------------------------------------------------------------------------
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
           -- "not finished onboarding" only counts when there is actually a form to fill in
           count(*) filter (where co.status in ('registered', 'in_progress')
                              and coalesce(p.onboarding_form_id, org.default_onboarding_form_id) is not null
                              and (co.program_id is null or p.deleted_at is null)) as unfinished_with_form
    from public.customer_onboardings co
    join public.organizations org on org.id = co.organization_id
    left join public.programs p on p.id = co.program_id
    where co.organization_id = p_org
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
-- 10. Privileges
-- ---------------------------------------------------------------------------
revoke all on function app.reopen_onboarding(uuid), app.remind_onboarding(uuid) from public, anon;
grant execute on function app.reopen_onboarding(uuid), app.remind_onboarding(uuid) to authenticated, service_role;

revoke all on function private.intake_form_id(uuid, uuid, uuid), private.check_org_intake_form(),
                       private.track_student_membership() from public, anon, authenticated;
grant execute on function private.intake_form_id(uuid, uuid, uuid) to authenticated;
grant execute on function private.intake_form_id(uuid, uuid, uuid), private.check_org_intake_form(),
                          private.track_student_membership() to service_role;
