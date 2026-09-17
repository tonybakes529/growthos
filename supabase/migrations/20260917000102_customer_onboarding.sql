-- =============================================================================
-- 0102 CUSTOMER ONBOARDING
-- Operator -> Client (organization) -> Course (program) -> Customer -> custom form.
--
-- Reuses: organizations, programs, contacts, invitations (hashed single-use
-- tokens), organization_memberships (role `student`), program_enrollments,
-- app.fulfill_purchase, domain_events, automation_trigger_types, email_outbox.
--
-- Not reused: onboarding_questionnaires. That one is platform-level, written
-- by super admin only, holds one JSON response per ORGANIZATION and onboards a
-- client business onto Growth OS. This migration is about a client's buyers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Forms and questions (owned by a client workspace)
-- ---------------------------------------------------------------------------
create table public.onboarding_forms (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 200),
  description         text,
  welcome_heading     text,
  welcome_message     text,
  completion_message  text,
  status              text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at        timestamptz
);
select private.standardize('onboarding_forms', 'programs', true, true, 'custom');

create table public.onboarding_form_questions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  form_id          uuid not null,
  key              text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),   -- stable handle for automations
  label            text not null check (length(btrim(label)) between 1 and 500),
  help_text        text,
  question_type    text not null check (question_type in
                     ('short_text', 'long_text', 'email', 'number', 'url', 'single_select', 'multi_select', 'checkbox')),
  options          jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  is_required      boolean not null default false,
  position         int not null default 0,
  foreign key (organization_id, form_id) references public.onboarding_forms(organization_id, id) on delete cascade
);
-- soft delete: removing a question must not destroy answers customers already gave
select private.standardize('onboarding_form_questions', 'programs', true, false, 'custom');
create unique index onboarding_form_questions_key on public.onboarding_form_questions (form_id, key) where deleted_at is null;
create index onboarding_form_questions_form_idx on public.onboarding_form_questions (organization_id, form_id, position);

-- ---------------------------------------------------------------------------
-- 2. A course points at its onboarding form. The composite FK makes it
--    impossible to attach another workspace's form.
-- ---------------------------------------------------------------------------
alter table public.programs
  add column onboarding_form_id  uuid,
  add column external_product_id text check (external_product_id is null or length(external_product_id) between 1 and 200);
alter table public.programs add constraint programs_onboarding_form_fk
  foreign key (organization_id, onboarding_form_id)
  references public.onboarding_forms(organization_id, id) on delete set null (onboarding_form_id);
create index programs_onboarding_form_idx on public.programs (organization_id, onboarding_form_id) where onboarding_form_id is not null;
-- lets a non-Stripe checkout (Kajabi, ThriveCart, Zapier) name the course it sold
create unique index programs_external_product_key on public.programs (organization_id, external_product_id)
  where external_product_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. One record per customer per course, from "invited" to "completed".
--    Exists before the customer has a login, which program_enrollments cannot.
-- ---------------------------------------------------------------------------
create table public.customer_onboardings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid not null,
  form_id          uuid,                       -- set when the customer starts: the form they actually answered
  contact_id       uuid,
  email            extensions.citext not null,
  user_id          uuid references public.users(id) on delete set null,
  invitation_id    uuid references public.invitations(id) on delete set null,
  purchase_id      uuid,
  status           text not null default 'invited' check (status in ('invited', 'registered', 'in_progress', 'completed')),
  invited_at       timestamptz not null default now(),
  registered_at    timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  unique (organization_id, program_id, email),
  foreign key (organization_id, program_id)  references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, form_id)     references public.onboarding_forms(organization_id, id) on delete set null (form_id),
  foreign key (organization_id, contact_id)  references public.contacts(organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, purchase_id) references public.purchases(organization_id, id) on delete set null (purchase_id)
);
select private.standardize('customer_onboardings', 'enrollments', false, true, 'custom');
create index customer_onboardings_user_idx       on public.customer_onboardings (user_id) where user_id is not null;
create index customer_onboardings_contact_idx    on public.customer_onboardings (organization_id, contact_id);
create index customer_onboardings_form_idx       on public.customer_onboardings (organization_id, form_id) where form_id is not null;
create index customer_onboardings_invitation_idx on public.customer_onboardings (invitation_id) where invitation_id is not null;
create index customer_onboardings_purchase_idx   on public.customer_onboardings (organization_id, purchase_id) where purchase_id is not null;

-- One row per question answered: structured, queryable, usable by automations.
create table public.customer_onboarding_answers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  onboarding_id    uuid not null,
  question_id      uuid not null,
  value            jsonb not null,             -- string | number | boolean | string[]
  unique (onboarding_id, question_id),
  foreign key (organization_id, onboarding_id) references public.customer_onboardings(organization_id, id) on delete cascade,
  foreign key (organization_id, question_id)   references public.onboarding_form_questions(organization_id, id) on delete cascade
);
select private.standardize('customer_onboarding_answers', 'enrollments', false, false, 'custom');
create index customer_onboarding_answers_question_idx on public.customer_onboarding_answers (organization_id, question_id);

-- ---------------------------------------------------------------------------
-- 4. Row level security
--    Students hold no programs.* or enrollments.* permission, so a customer
--    reaches nothing here except their own onboarding rows.
-- ---------------------------------------------------------------------------
create or replace function private.my_onboarding_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.customer_onboardings where user_id = private.effective_user_id();
$$;

create policy onboarding_forms_select on public.onboarding_forms for select to authenticated using (
  organization_id in (select private.orgs_with_permission('programs.read')));
create policy onboarding_forms_insert on public.onboarding_forms for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('programs.create')));
create policy onboarding_forms_update on public.onboarding_forms for update to authenticated
  using (organization_id in (select private.orgs_with_permission('programs.update')))
  with check (organization_id in (select private.orgs_with_permission('programs.update')));
create policy onboarding_forms_delete on public.onboarding_forms for delete to authenticated using ((select private.is_super_admin()));

create policy onboarding_form_questions_select on public.onboarding_form_questions for select to authenticated using (
  organization_id in (select private.orgs_with_permission('programs.read')));
create policy onboarding_form_questions_insert on public.onboarding_form_questions for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('programs.update')));
create policy onboarding_form_questions_update on public.onboarding_form_questions for update to authenticated
  using (organization_id in (select private.orgs_with_permission('programs.update')))
  with check (organization_id in (select private.orgs_with_permission('programs.update')));
create policy onboarding_form_questions_delete on public.onboarding_form_questions for delete to authenticated using ((select private.is_super_admin()));

-- Read only. Every write goes through the workflows below.
create policy customer_onboardings_select on public.customer_onboardings for select to authenticated using (
  organization_id in (select private.orgs_with_permission('enrollments.read'))
  or user_id = (select private.effective_user_id()));
create policy customer_onboarding_answers_select on public.customer_onboarding_answers for select to authenticated using (
  organization_id in (select private.orgs_with_permission('enrollments.read'))
  or onboarding_id in (select private.my_onboarding_ids()));

-- A form in use cannot be archived out from under a course, and a course can only use a published form.
create or replace function private.check_program_onboarding_form()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.onboarding_form_id is not null and new.onboarding_form_id is distinct from old.onboarding_form_id
     and not exists (select 1 from public.onboarding_forms f
                     where f.id = new.onboarding_form_id and f.organization_id = new.organization_id
                       and f.status = 'published' and f.deleted_at is null) then
    raise exception 'publish the onboarding form before attaching it to a course';
  end if;
  return new;
end;
$$;
create trigger check_onboarding_form before update of onboarding_form_id on public.programs
  for each row execute function private.check_program_onboarding_form();

-- ---------------------------------------------------------------------------
-- 5. Event types the automation engine can listen for
-- ---------------------------------------------------------------------------
insert into public.automation_trigger_types (key, description) values
  ('customer.invited',              'A customer was invited to a course (purchase or manual add)'),
  ('customer.registered',           'An invited customer created their account'),
  ('customer.onboarding_started',   'A customer saved their first onboarding answer'),
  ('customer.onboarding_completed', 'A customer submitted their onboarding form. Payload carries the answers keyed by question key.')
on conflict (key) do nothing;

insert into public.email_templates (organization_id, key, name, subject, body_html, body_text, variables) values
  (null, 'customer_invitation', 'Customer welcome',
   'Welcome to {{organization_name}}: get started with {{course_names}}',
   '<p>Hi {{first_name}},</p><p>You''re enrolled in <b>{{course_names}}</b> with {{organization_name}}.</p><p><a href="{{app_url}}{{accept_path}}">Create your login and get started</a></p><p>This link is personal to you and expires in 7 days.</p>',
   E'Hi {{first_name}},\n\nYou''re enrolled in {{course_names}} with {{organization_name}}.\n\nCreate your login and get started: {{app_url}}{{accept_path}}\n\nThis link is personal to you and expires in 7 days.',
   array['organization_name', 'course_names', 'first_name', 'accept_path', 'app_url'])
on conflict (organization_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Invitations: customers get a branded /join link instead of /invite.
--    Same table, same 32-byte token, same SHA-256 hash, same 7-day expiry.
-- ---------------------------------------------------------------------------
create or replace function private.create_invitation(p_org uuid, p_email text, p_role uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  token       text := encode(extensions.gen_random_bytes(32), 'hex');
  inv_id      uuid;
  o           public.organizations;
  r           public.roles;
  final       jsonb;
  is_customer boolean;
  path        text;
  courses     text;
begin
  update public.invitations set status = 'revoked'
  where organization_id = p_org and email = p_email::extensions.citext and status = 'pending';

  insert into public.invitations (organization_id, email, role_id, token_hash, invited_by, payload)
  values (p_org, lower(p_email), p_role, encode(extensions.digest(token, 'sha256'), 'hex'), auth.uid(), coalesce(p_payload, '{}'))
  returning id, payload into inv_id, final;      -- payload may have been merged by the trigger below

  select * into o from public.organizations where id = p_org;
  select * into r from public.roles where id = p_role;
  is_customer := r.key = 'student' and jsonb_array_length(coalesce(final->'program_ids', '[]')) > 0;
  path := case when is_customer then '/join/' || o.slug || '/' || token else '/invite/' || token end;

  if is_customer then
    select string_agg(p.title, ', ' order by p.title) into courses from public.programs p
    where p.organization_id = p_org and p.id in (select (jsonb_array_elements_text(final->'program_ids'))::uuid);
  end if;

  -- worker renders the email; accept link carries the raw token (outbox is service-role only)
  insert into public.email_outbox (organization_id, template_key, to_email, variables)
  values (p_org, case when is_customer then 'customer_invitation' else 'invitation' end, lower(p_email), jsonb_build_object(
    'organization_name', o.name, 'role_name', r.name, 'accept_path', path, 'message', p_payload->>'message',
    'course_names', courses,
    'first_name', coalesce((select c.first_name from public.contacts c
                            where c.organization_id = p_org and c.email = p_email::extensions.citext and c.deleted_at is null), 'there')));

  perform private.log_activity(p_org, 'user', null, 'invited', 'Invited ' || lower(p_email) || ' as ' || r.name,
                               jsonb_build_object('invitation_id', inv_id));
  perform private.emit_event(p_org, 'client.invited', 'invitation', inv_id,
                             jsonb_build_object('email', lower(p_email), 'role', r.name));
  return jsonb_build_object('invitation_id', inv_id, 'token', token, 'accept_path', path);
end;
$$;

-- A second purchase before registering replaces the pending invitation (create_invitation revokes the
-- old one). Carry the earlier courses over so the customer still gets all of them from one link.
create or replace function private.merge_customer_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare merged jsonb;
begin
  select coalesce(jsonb_agg(distinct pid), '[]') into merged from (
    select jsonb_array_elements_text(coalesce(new.payload->'program_ids', '[]')) as pid
    union
    select co.program_id::text from public.customer_onboardings co
    where co.organization_id = new.organization_id and co.email = new.email and co.status = 'invited'
  ) s;
  if jsonb_array_length(merged) > 0 then
    new.payload := coalesce(new.payload, '{}') || jsonb_build_object('program_ids', merged);
  end if;
  return new;
end;
$$;
create trigger merge_customer_programs before insert on public.invitations
  for each row execute function private.merge_customer_invitation();

-- Whatever created the invitation (Stripe fulfilment, app.add_customer, a manual student invite),
-- the customer record appears. app.fulfill_purchase needs no change.
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
    on conflict (organization_id, program_id, email) do update
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
create trigger track_customer after insert on public.invitations
  for each row execute function private.track_customer_invitation();

-- Accepting the invitation enrolls the user; that is the moment "invited" becomes "registered".
-- Also covers an existing customer who buys a second course (enrolled directly, no invitation).
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
  on conflict (organization_id, program_id, email) do update
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
create trigger track_customer after insert on public.program_enrollments
  for each row execute function private.track_customer_enrollment();

-- ---------------------------------------------------------------------------
-- 7. Public invitation preview, now with enough to brand the welcome page.
--    Still the only app function anon may call. Adds keys, removes none.
-- ---------------------------------------------------------------------------
create or replace function app.get_invitation(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'email', i.email, 'organization_name', o.name, 'role_name', r.name,
    'status', case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
    'expires_at', i.expires_at,
    'organization_slug', o.slug,
    'logo_url', o.logo_url,
    'brand_color', o.settings->>'brand_color',
    'is_customer', r.key = 'student' and jsonb_array_length(coalesce(i.payload->'program_ids', '[]')) > 0,
    'first_name', (select c.first_name from public.contacts c
                   where c.organization_id = i.organization_id and c.email = i.email and c.deleted_at is null),
    'account_exists', exists (select 1 from public.users u where u.email = i.email),
    'courses', coalesce((select jsonb_agg(p.title order by p.title) from public.programs p
                         where p.organization_id = i.organization_id and p.deleted_at is null
                           and p.id in (select (jsonb_array_elements_text(coalesce(i.payload->'program_ids', '[]')))::uuid)), '[]'))
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  join public.roles r on r.id = i.role_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- 8. Workflows
-- ---------------------------------------------------------------------------

-- Add a customer to a course by hand. This is the same road a Stripe purchase takes after
-- app.fulfill_purchase, minus the payment, so it doubles as "simulate a purchase".
-- Calling it again for someone still "invited" issues a fresh link and revokes the old one.
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
    on conflict (organization_id, program_id, email) do nothing;
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

-- Where should this customer go right now? Null when nothing is waiting.
create or replace function app.get_pending_onboarding()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('onboarding_id', co.id, 'organization_slug', o.slug)
  from public.customer_onboardings co
  join public.organizations o on o.id = co.organization_id
  join public.programs p on p.id = co.program_id and p.deleted_at is null
  join public.onboarding_forms f on f.id = p.onboarding_form_id and f.status = 'published' and f.deleted_at is null
  where co.user_id = private.effective_user_id() and co.status <> 'completed'
  order by co.invited_at
  limit 1;
$$;

-- Everything the customer-facing page needs, resolved from who is signed in plus the URL slug.
-- The customer never supplies a client, course or form id.
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
  join public.programs pr on pr.id = c.program_id and pr.deleted_at is null
  join public.onboarding_forms fm on fm.id = coalesce(c.form_id, pr.onboarding_form_id) and fm.deleted_at is null
  where c.organization_id = o.id and c.user_id = uid
    and (c.status = 'completed' or fm.status = 'published')
  order by (c.status = 'completed'), case when c.status = 'completed' then c.completed_at end desc nulls last, c.invited_at
  limit 1;
  if co.id is null then return null; end if;

  select * into p from public.programs where id = co.program_id;
  select * into f from public.onboarding_forms where id = coalesce(co.form_id, p.onboarding_form_id);

  return jsonb_build_object(
    'onboarding', jsonb_build_object('id', co.id, 'status', co.status, 'completed_at', co.completed_at),
    'organization', jsonb_build_object('name', o.name, 'slug', o.slug, 'logo_url', o.logo_url, 'brand_color', o.settings->>'brand_color'),
    'program', jsonb_build_object('id', p.id, 'title', p.title),
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

-- Save a draft, or submit. Answers arrive keyed by question id; anything that is not a live
-- question on this customer's own form is ignored, so the browser cannot write outside it.
create or replace function app.save_onboarding_answers(p_onboarding_id uuid, p_answers jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := private.require_user();
  co      public.customer_onboardings;
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
begin
  select * into co from public.customer_onboardings where id = p_onboarding_id for update;
  if co.id is null or co.user_id is distinct from uid then
    raise exception 'onboarding not found' using errcode = 'P0002';   -- same answer for "not yours" and "does not exist"
  end if;
  if co.status = 'completed' then raise exception 'this onboarding is already complete'; end if;
  if jsonb_typeof(coalesce(p_answers, '{}')) <> 'object' then raise exception 'answers must be an object'; end if;

  select * into p from public.programs where id = co.program_id;
  select * into f from public.onboarding_forms
  where id = coalesce(co.form_id, p.onboarding_form_id) and organization_id = co.organization_id and deleted_at is null;
  if f.id is null or f.status <> 'published' then raise exception 'this course has no onboarding form yet'; end if;
  first := co.started_at is null;

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
                                 who || ' completed onboarding for ' || p.title,
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
      perform private.notify(co.organization_id, staff, 'customer.onboarding_completed', who || ' completed onboarding',
                             p.title, '/customers/' || co.id);
    end loop;
  end if;

  return jsonb_build_object('onboarding_id', co.id, 'status', case when p_submit then 'completed' else 'in_progress' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privileges (0099 ran before this file, so be explicit)
-- ---------------------------------------------------------------------------
revoke all on function app.add_customer(uuid, uuid, text, text, text),
                       app.get_pending_onboarding(),
                       app.get_my_onboarding(text),
                       app.save_onboarding_answers(uuid, jsonb, boolean) from public, anon;
grant execute on function app.add_customer(uuid, uuid, text, text, text),
                          app.get_pending_onboarding(),
                          app.get_my_onboarding(text),
                          app.save_onboarding_answers(uuid, jsonb, boolean) to authenticated, service_role;
grant execute on function app.get_invitation(text) to anon, authenticated, service_role;

revoke all on function private.my_onboarding_ids(), private.check_program_onboarding_form(), private.merge_customer_invitation(),
                       private.track_customer_invitation(), private.track_customer_enrollment(),
                       private.create_invitation(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function private.my_onboarding_ids() to authenticated;
grant execute on function private.my_onboarding_ids(), private.check_program_onboarding_form(), private.merge_customer_invitation(),
                          private.track_customer_invitation(), private.track_customer_enrollment(),
                          private.create_invitation(uuid, text, uuid, jsonb) to service_role;
