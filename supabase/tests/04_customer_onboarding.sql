-- Operator -> client -> course -> customer -> custom onboarding, end to end.
begin;

-- Two people who will buy courses. They sign up later; here we only need auth rows to log in as.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
        'jane@buyer.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Jane","last_name":"Smith"}', '', '', '', ''),
       ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated',
        'john@buyer.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"John","last_name":"Smith"}', '', '', '', '');

create temp table t (k text primary key, v text) on commit drop;
grant all on t to authenticated, anon;

set local role authenticated;

-- 1-5. Operator creates the client, the course, the form, and adds two customers -------------------
select tests.login('owner@growthos.test');
do $$
declare
  acme uuid; course uuid; form uuid; res jsonb;
begin
  acme := (app.create_client_organization('Acme Coaching', 'acme-coaching') ->> 'organization_id')::uuid;
  insert into programs (organization_id, title, slug, status) values (acme, '6-Week Business Growth Program', 'six-week-growth', 'published')
    returning id into course;
  insert into onboarding_forms (organization_id, name) values (acme, 'Acme New Client Onboarding') returning id into form;
  insert into onboarding_form_questions (organization_id, form_id, key, label, question_type, is_required, options, position) values
    (acme, form, 'business_name',   'What is your business name?',          'short_text',    true,  '[]', 0),
    (acme, form, 'website',         'What is your website?',                'url',           false, '[]', 1),
    (acme, form, 'monthly_revenue', 'What is your current monthly revenue?', 'number',        true,  '[]', 2),
    (acme, form, 'stage',           'Where are you today?',                 'single_select', true,  '["Starting","Growing","Scaling"]', 3),
    (acme, form, 'channels',        'Which channels do you use?',           'multi_select',  false, '["Email","Ads","Referrals"]', 4),
    (acme, form, 'agree',           'I agree to the program terms',         'checkbox',      true,  '[]', 5);

  -- a draft form cannot be attached to a course
  perform tests.throws(format('update programs set onboarding_form_id = %L where id = %L', form, course), 'publish the onboarding form', 'draft form rejected');
  update onboarding_forms set status = 'published', published_at = now() where id = form;
  update programs set onboarding_form_id = form where id = course;

  -- another workspace's form can never be attached (composite FK), even by the operator
  perform tests.throws(format('update programs set onboarding_form_id = %L where organization_id = %L', form, tests.org('apex-roofing')),
                       null, 'cross-tenant form link rejected');

  res := app.add_customer(acme, course, 'Jane@Buyer.test', 'Jane', 'Smith');
  perform tests.eq(res->>'status', 'invited', 'new buyer is invited');
  perform tests.ok(length(res->>'token') = 64, 'token is 32 random bytes, hex encoded');
  perform tests.eq(res->>'accept_path', '/join/acme-coaching/' || (res->>'token'), 'customer gets a branded join link');
  insert into t values ('acme', acme::text), ('course', course::text), ('form', form::text), ('jane_token', res->>'token'),
                       ('jane_ob', res->>'onboarding_id');

  res := app.add_customer(acme, course, 'john@buyer.test', 'John', 'Smith');
  insert into t values ('john_token', res->>'token'), ('john_ob', res->>'onboarding_id');

  perform tests.eq((select count(*) from customer_onboardings where organization_id = acme), 2::bigint, 'two customer records');
  perform tests.eq((select status from customer_onboardings where id = (res->>'onboarding_id')::uuid), 'invited', 'status starts as invited');
  perform tests.eq((select count(*) from contacts where organization_id = acme and email = 'jane@buyer.test'), 1::bigint, 'contact created once');
  perform tests.eq((select lifecycle_stage from contacts where organization_id = acme and email = 'jane@buyer.test'), 'customer', 'contact is a customer');
end $$;

-- No duplicates: adding the same buyer again reissues the link and revokes the old one --------------
do $$
declare acme uuid := (select v::uuid from t where k = 'acme'); course uuid := (select v::uuid from t where k = 'course');
        old_token text := (select v from t where k = 'jane_token'); res jsonb;
begin
  res := app.add_customer(acme, course, 'jane@buyer.test');
  perform tests.eq(res->>'onboarding_id', (select v from t where k = 'jane_ob'), 'same customer record reused');
  perform tests.eq((select count(*) from customer_onboardings where organization_id = acme and email = 'jane@buyer.test'), 1::bigint, 'no duplicate customer');
  perform tests.eq((select count(*) from contacts where organization_id = acme and email = 'jane@buyer.test'), 1::bigint, 'no duplicate contact');
  perform tests.eq((select first_name from contacts where organization_id = acme and email = 'jane@buyer.test'), 'Jane', 'blank name does not erase a known one');
  perform tests.eq(app.get_invitation(old_token)->>'status', 'revoked', 'old link is dead');
  update t set v = res->>'token' where k = 'jane_token';
end $$;

-- 6. Customer opens the link before having an account ---------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare inv jsonb := app.get_invitation((select v from t where k = 'jane_token'));
begin
  perform tests.eq(inv->>'organization_name', 'Acme Coaching', 'welcome page knows the client');
  perform tests.eq(inv->'courses'->>0, '6-Week Business Growth Program', 'welcome page knows the course');
  perform tests.eq(inv->>'is_customer', 'true', 'flagged as a customer invitation');
  perform tests.eq(inv->>'first_name', 'Jane', 'greets the buyer by name');
  perform tests.ok(app.get_invitation(repeat('0', 64)) is null, 'guessed token returns nothing');
end $$;
do $$
declare n bigint;
begin
  begin select count(*) into n from customer_onboardings; exception when insufficient_privilege then n := 0; end;
  perform tests.eq(n, 0::bigint, 'anon reads no customers');
end $$;

-- 7-9. Jane registers: the right client, course and form are already known ---------------------------
set local role authenticated;
select tests.login('john@buyer.test');
select tests.throws(format($q$select app.accept_invitation(%L)$q$, (select v from t where k = 'jane_token')),
                    'different email', 'John cannot use Jane''s link');

select tests.login('jane@buyer.test');
do $$
declare acme uuid := (select v::uuid from t where k = 'acme'); ob jsonb; pending jsonb;
begin
  perform tests.ok(app.get_pending_onboarding() is null, 'nothing pending before accepting');
  perform tests.eq(app.accept_invitation((select v from t where k = 'jane_token')), acme, 'joined the right client');
  perform tests.throws(format($q$select app.accept_invitation(%L)$q$, (select v from t where k = 'jane_token')), 'accepted', 'link is single use');

  pending := app.get_pending_onboarding();
  perform tests.eq(pending->>'organization_slug', 'acme-coaching', 'sent straight to Acme onboarding');
  perform tests.eq(pending->>'onboarding_id', (select v from t where k = 'jane_ob'), 'the invited record became hers');

  ob := app.get_my_onboarding('acme-coaching');
  perform tests.eq(ob->'onboarding'->>'status', 'registered', 'status is registered');
  perform tests.eq(ob->'program'->>'title', '6-Week Business Growth Program', 'correct course');
  perform tests.eq(ob->'form'->>'name', 'Acme New Client Onboarding', 'correct form');
  perform tests.eq(jsonb_array_length(ob->'questions'), 6, 'all six questions');
  perform tests.eq(ob->'questions'->0->>'key', 'business_name', 'questions in order');
  perform tests.ok(app.get_my_onboarding('apex-roofing') is null, 'no onboarding in a client she never bought from');
  perform tests.eq((select count(*) from program_enrollments where user_id = tests.uid('jane@buyer.test')), 1::bigint, 'enrolled in the course');
end $$;

-- 10-13. Draft, validation, submit, event --------------------------------------------------------------
-- question ids keyed by question key, readable by the customer-facing role
reset role;
create temp view qid as select q.key, q.id::text as id from public.onboarding_form_questions q
  where q.form_id = (select v::uuid from t where k = 'form');
grant select on qid to authenticated;
set local role authenticated;
select tests.login('jane@buyer.test');

do $$
declare
  ob uuid := (select v::uuid from t where k = 'jane_ob');
  id_name text := (select id from qid where key = 'business_name'); id_web text := (select id from qid where key = 'website');
  id_rev  text := (select id from qid where key = 'monthly_revenue'); id_stage text := (select id from qid where key = 'stage');
  id_chan text := (select id from qid where key = 'channels');        id_agree text := (select id from qid where key = 'agree');
begin
  -- save progress
  perform app.save_onboarding_answers(ob, jsonb_build_object(id_name, '  Jane Co  ', id_rev, '12500'));
  perform tests.eq((select status from customer_onboardings where id = ob), 'in_progress', 'status is in progress after a draft save');
  perform tests.eq((app.get_my_onboarding('acme-coaching')->'answers'->>id_name), 'Jane Co', 'draft answer comes back trimmed');
  perform tests.eq((select value from customer_onboarding_answers where onboarding_id = ob and question_id = id_rev::uuid), '12500'::jsonb, 'number stored as a number');

  -- validation happens in the database, not the browser
  perform tests.throws(format($q$select app.save_onboarding_answers(%L, %L)$q$, ob, jsonb_build_object(id_web, 'not a link')), 'full link', 'bad url rejected');
  perform tests.throws(format($q$select app.save_onboarding_answers(%L, %L)$q$, ob, jsonb_build_object(id_rev, 'lots')), 'needs a number', 'bad number rejected');
  perform tests.throws(format($q$select app.save_onboarding_answers(%L, %L)$q$, ob, jsonb_build_object(id_stage, 'Made up')), 'not on the form', 'unknown option rejected');
  perform tests.throws(format($q$select app.save_onboarding_answers(%L, %L, true)$q$, ob, '{}'::jsonb), 'Please answer', 'required questions enforced on submit');
  perform tests.eq((select status from customer_onboardings where id = ob), 'in_progress', 'failed submit leaves it in progress');

  -- an answer aimed at a question that is not on her form is ignored
  perform app.save_onboarding_answers(ob, jsonb_build_object(gen_random_uuid()::text, 'smuggled'));
  perform tests.eq((select count(*) from customer_onboarding_answers where onboarding_id = ob), 2::bigint, 'foreign question id ignored');

  perform app.save_onboarding_answers(ob, jsonb_build_object(id_web, 'https://janeco.com', id_stage, 'Growing',
                                                             id_chan, jsonb_build_array('Email', 'Referrals'), id_agree, true), true);
  perform tests.eq((select status from customer_onboardings where id = ob), 'completed', 'onboarding complete');
  perform tests.ok((select completed_at is not null and form_id = (select v::uuid from t where k = 'form') from customer_onboardings where id = ob), 'completion stamped with the form answered');
  perform tests.eq((select count(*) from customer_onboarding_answers where onboarding_id = ob), 6::bigint, 'one row per answered question');
  perform tests.throws(format($q$select app.save_onboarding_answers(%L, '{}'::jsonb)$q$, ob), 'already complete', 'completed onboarding is locked');
  perform tests.ok(app.get_pending_onboarding() is null, 'nothing pending once complete');
end $$;

reset role;
do $$
declare ev public.domain_events;
begin
  select * into ev from domain_events where event_type = 'customer.onboarding_completed' order by id desc limit 1;
  perform tests.ok(ev.id is not null, 'completion event emitted');
  perform tests.eq(ev.organization_id, (select v::uuid from t where k = 'acme'), 'event belongs to the client');
  perform tests.eq(ev.payload->'answers'->>'business_name', 'Jane Co', 'event carries answers by question key');
  perform tests.eq(ev.payload->'answers'->'monthly_revenue', '12500'::jsonb, 'numeric answer stays numeric for conditions');
  perform tests.eq(ev.payload->>'program_id', (select v from t where k = 'course'), 'event names the course');
  perform tests.eq(ev.payload->>'user_id', tests.uid('jane@buyer.test')::text, 'event names the customer');
  perform tests.eq(jsonb_array_length(ev.payload->'responses'), 6, 'full structured responses included');
  perform tests.eq((select count(*) from domain_events where organization_id = ev.organization_id
                    and event_type in ('customer.invited', 'customer.registered', 'customer.onboarding_started')), 5::bigint,
                   'lifecycle events: 3 invites (one reissued), 1 registered, 1 started');
  perform tests.ok(exists (select 1 from automation_trigger_types where key = 'customer.onboarding_completed'), 'automations can listen for it');
end $$;

-- 18. Another customer cannot touch or see Jane's onboarding ---------------------------------------------
set local role authenticated;
select tests.login('john@buyer.test');
do $$
declare jane_ob uuid := (select v::uuid from t where k = 'jane_ob');
begin
  perform app.accept_invitation((select v from t where k = 'john_token'));
  perform tests.eq((select count(*) from customer_onboardings), 1::bigint, 'John sees only his own record');
  perform tests.eq((select count(*) from customer_onboarding_answers), 0::bigint, 'John sees none of Jane''s answers');
  perform tests.throws(format($q$select app.save_onboarding_answers(%L, '{}'::jsonb)$q$, jane_ob), 'not found', 'John cannot write to Jane''s onboarding');
  perform tests.eq((select count(*) from onboarding_forms), 0::bigint, 'customers cannot read form definitions directly');
  perform tests.throws(format($q$insert into customer_onboardings (organization_id, program_id, email) values (%L, %L, 'x@y.test')$q$,
                              (select v from t where k = 'acme'), (select v from t where k = 'course')), 'row-level security', 'no direct inserts');
  -- trying to re-point himself at another client or mark himself complete changes nothing
  update customer_onboardings set status = 'completed', organization_id = tests.org('apex-roofing');
  perform tests.eq((select status from customer_onboardings), 'registered', 'customers cannot edit their own record');
  perform tests.throws(format($q$select app.add_customer(%L, %L, 'friend@buyer.test')$q$,
                              (select v from t where k = 'acme'), (select v from t where k = 'course')), 'permission', 'customers cannot add customers');
end $$;

-- 14-16. The client sees their customers, statuses and answers -------------------------------------------
select tests.login('owner@growthos.test');
do $$
declare acme uuid := (select v::uuid from t where k = 'acme');
begin
  perform tests.eq((select count(*) from customer_onboardings where organization_id = acme), 2::bigint, 'operator sees both customers');
  perform tests.eq((select string_agg(status, ',' order by email) from customer_onboardings where organization_id = acme), 'completed,registered', 'operator sees each status');
  perform tests.eq((select count(*) from customer_onboarding_answers where organization_id = acme), 6::bigint, 'operator sees the answers');
end $$;

-- give Acme a client admin: Omar, who also runs Clearpath (one login, two workspaces).
-- Memberships are RPC-only for API roles, so the fixture is inserted as the table owner.
reset role;
insert into organization_memberships (organization_id, user_id, role_id, status)
values ((select v::uuid from t where k = 'acme'), tests.uid('omar@clearpath.test'),
        (select id from roles where key = 'client_admin' and organization_id is null), 'active');
set local role authenticated;

select tests.login('omar@clearpath.test');
do $$
declare acme uuid := (select v::uuid from t where k = 'acme');
begin
  perform tests.eq((select count(*) from customer_onboardings where organization_id = acme), 2::bigint, 'client admin sees their customers');
  perform tests.eq((select status from customer_onboardings where email = 'jane@buyer.test'), 'completed', 'client admin sees onboarding status');
  perform tests.eq((select a.value #>> '{}' from customer_onboarding_answers a join onboarding_form_questions q on q.id = a.question_id
                    where q.key = 'business_name'), 'Jane Co', 'client admin can read the answers');
  perform tests.eq((select count(*) from onboarding_forms where organization_id = acme), 1::bigint, 'client admin sees their form');
end $$;

-- 17. Other clients see none of it ---------------------------------------------------------------------------
select tests.login('jake@apexroofing.test');
do $$
declare acme uuid := (select v::uuid from t where k = 'acme');
begin
  perform tests.eq((select count(*) from customer_onboardings), 0::bigint, 'Apex sees no Acme customers');
  perform tests.eq((select count(*) from customer_onboarding_answers), 0::bigint, 'Apex sees no Acme answers');
  perform tests.eq((select count(*) from onboarding_forms), 0::bigint, 'Apex sees no Acme forms');
  perform tests.eq((select count(*) from onboarding_form_questions), 0::bigint, 'Apex sees no Acme questions');
  perform tests.throws(format($q$select app.add_customer(%L, %L, 'spy@apex.test')$q$, acme, (select v from t where k = 'course')), 'permission', 'Apex cannot add customers to Acme');
  perform tests.throws(format($q$insert into onboarding_forms (organization_id, name) values (%L, 'planted')$q$, acme), 'row-level security', 'Apex cannot create forms in Acme');
  perform tests.throws(format($q$select app.add_customer(%L, %L, 'x@apex.test')$q$, tests.org('apex-roofing'), (select v from t where k = 'course')),
                       'does not belong', 'a course cannot be borrowed from another client');
end $$;

-- A team member without enrollments.read sees no customers, even in their own workspace
select tests.login('sam@apexroofing.test');
select tests.eq((select count(*) from customer_onboardings), 0::bigint, 'team member without permission sees no customers');

-- Existing behaviour intact: a normal team invitation still uses /invite and creates no customer record
select tests.login('jake@apexroofing.test');
do $$
declare res jsonb;
begin
  res := app.invite_member(tests.org('apex-roofing'), 'newhire@apexroofing.test', 'client_team_member');
  perform tests.ok(res->>'accept_path' like '/invite/%', 'team invites keep the /invite link');
  perform tests.eq((select count(*) from customer_onboardings where email = 'newhire@apexroofing.test'), 0::bigint, 'team invite is not a customer');
end $$;

select 'customer onboarding ok' as result;
rollback;
