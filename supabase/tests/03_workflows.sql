-- Core workflows end to end.
begin;
set local role authenticated;

-- Template duplication produced full, independent copies ------------------------------
select tests.login('owner@growthos.test');
do $$
declare
  apex uuid := tests.org('apex-roofing');
  lib  uuid := tests.org('template-library');
  src  uuid; dst uuid;
begin
  select id into src from programs where organization_id = lib and slug = 'revenue-accelerator';
  select id into dst from programs where organization_id = apex and slug = 'revenue-accelerator';
  perform tests.ok(dst is not null and dst <> src, 'program copied into apex');
  perform tests.eq((select copied_from_id from programs where id = dst), src, 'copy remembers its source');
  perform tests.eq((select count(*) from lessons where program_id = dst), (select count(*) from lessons where program_id = src), 'lesson count matches');
  perform tests.eq((select count(*) from lesson_blocks where program_id = dst), (select count(*) from lesson_blocks where program_id = src), 'block count matches');
  perform tests.eq((select count(*) from quiz_answer_keys k join quiz_questions q on q.id = k.question_id where q.program_id = dst), 2::bigint, 'answer keys copied');
  perform tests.eq((select count(*) from modules m where m.program_id = dst and m.section_id not in (select id from program_sections where program_id = dst)),
                   0::bigint, 'modules re-parented to copied sections');
  perform tests.eq((select count(*) from scorecard_kpis sk join scorecards s on s.id = sk.scorecard_id where s.organization_id = apex), 8::bigint, 'scorecard KPIs copied');
  perform tests.eq((select count(*) from pipeline_stages where organization_id = apex), 7::bigint, 'pipeline stages copied');
  perform tests.eq((select count(*) from dashboard_widgets where organization_id = apex and kpi_definition_id is not null
                    and kpi_definition_id not in (select id from kpi_definitions where organization_id = apex)), 0::bigint, 'widgets point at local KPIs');
  perform tests.eq((select count(*) from template_applications where organization_id = apex), 7::bigint, 'all onboarding items logged');
  -- editing the copy never touches the library
  update lessons set title = 'Edited in Apex' where program_id = dst and position = 0;
  perform tests.eq((select count(*) from lessons where program_id = src and title = 'Edited in Apex'), 0::bigint, 'copies are independent');

  -- offer template maps entitlements onto the client's copy of the program
  dst := app.apply_template('offer', (select id from offer_templates limit 1), apex);
  perform tests.eq((select count(*) from pricing_options where offer_id = dst), 3::bigint, 'pricing copied');
  perform tests.eq((select program_id from offer_entitlements where offer_id = dst),
                   (select id from programs where organization_id = apex and slug = 'revenue-accelerator'), 'entitlement remapped');
  perform tests.ok((select current_version_id from offers where id = dst) is not null, 'offer current version remapped');

  -- bulk apply
  perform tests.eq(app.apply_templates_bulk(jsonb_build_array(jsonb_build_object('type', 'sop', 'id', (select id from sop_templates limit 1))),
                                            array[tests.org('northstar-fitness'), tests.org('clearpath-consulting')]), 2, 'bulk apply count');
  perform tests.throws(format($q$select app.apply_template('program', (select id from program_templates limit 1), %L)$q$, lib),
                       'client workspaces', 'cannot apply into the library');
end $$;

-- Onboarding tasks landed on the right people -------------------------------------------
do $$
declare apex uuid := tests.org('apex-roofing');
begin
  perform tests.eq((select count(*) from tasks t join task_assignments a on a.task_id = t.id
                    where t.organization_id = apex and t.assignee_role_key = 'client_admin'
                      and a.user_id = tests.uid('jake@apexroofing.test')), 3::bigint, 'client admin tasks assigned on accept');
  perform tests.eq((select a.user_id from tasks t join task_assignments a on a.task_id = t.id
                    where t.organization_id = apex and t.assignee_role_key = 'account_manager'),
                   tests.uid('devon@growthos.test'), 'account manager task assigned at creation');
  perform tests.eq((select count(*) from tasks where organization_id = tests.org('clearpath-consulting')
                    and assignee_role_key = 'coach' and id not in (select task_id from task_assignments)), 1::bigint,
                   'unfilled coach task waits for a coach');
  perform tests.eq((select status from organizations where id = apex), 'active', 'questionnaire activated apex');
  perform tests.eq((select industry from client_profiles where organization_id = apex), 'Roofing', 'questionnaire populated profile');
  perform tests.eq((select team_size from client_profiles where organization_id = apex), 14, 'questionnaire populated team size');
  -- baseline landed in the prior period (later overwritten by real scorecards for Apex) and in the profile snapshot
  perform tests.eq((select baseline->'questionnaire'->>'weekly_leads' from client_profiles where organization_id = apex), '35', 'baseline snapshot stored');

  perform tests.ok(exists (select 1 from goals where organization_id = apex and target_value = 1800000), 'goal created from questionnaire');
end $$;

-- Questionnaire on a fresh workspace: baseline KPI + activation
select tests.login('omar@clearpath.test');
select tests.throws(format($q$select app.submit_onboarding_questionnaire(%L, '{"industry":"x"}')$q$, tests.org('clearpath-consulting')),
                    'answer required', 'required answers enforced');
select app.submit_onboarding_questionnaire(tests.org('clearpath-consulting'),
  '{"legal_name":"Clearpath LLC","industry":"Consulting","current_monthly_revenue":21000000,"revenue_target":25000000,"weekly_leads":12}');
select tests.ok(exists (select 1 from kpi_entries e join kpi_definitions k on k.id = e.kpi_definition_id
                        where k.key = 'leads_generated' and e.source = 'onboarding_baseline' and e.value = 12), 'baseline KPI entry created');
select tests.eq((select status from organizations where slug = 'clearpath-consulting'), 'active', 'questionnaire activates workspace');

-- Invitations ------------------------------------------------------------------------------
select tests.login('lena@northstarfit.test');
create temp table t_inv on commit drop as
  select app.invite_member(tests.org('northstar-fitness'), 'omar@clearpath.test', 'client_team_member') as inv;
grant select on t_inv to authenticated;
select tests.login('ari@northstarfit.test');
select tests.throws(format($q$select app.accept_invitation(%L)$q$, (select inv->>'token' from t_inv)), 'different email', 'wrong account accepts');
select tests.login('omar@clearpath.test');
select app.accept_invitation((select inv->>'token' from t_inv));
select tests.throws(format($q$select app.accept_invitation(%L)$q$, (select inv->>'token' from t_inv)), 'accepted', 'token reuse');
select tests.eq((select count(*) from organizations where kind = 'client'), 2::bigint, 'omar now belongs to two workspaces');
select tests.eq((select count(*) from app.get_my_workspaces()), 2::bigint, 'workspace switcher lists both');
select tests.throws($q$select app.accept_invitation('not-a-token')$q$, 'not found', 'bogus token');
select tests.eq((app.get_invitation((select inv->>'token' from t_inv))->>'status'), 'accepted', 'public invitation preview');

-- LMS: drip, sequential locks, assignments, quizzes, completion, certificates --------------
select tests.login('lena@northstarfit.test');
select app.enroll_user(tests.org('northstar-fitness'),
                       (select id from programs where organization_id = tests.org('northstar-fitness') and slug = 'revenue-accelerator'),
                       tests.uid('ari@northstarfit.test'));
select tests.throws(format($q$select app.enroll_user(%L, (select id from programs where organization_id = %L limit 1), %L)$q$,
                    tests.org('northstar-fitness'), tests.org('northstar-fitness'), tests.uid('jake@apexroofing.test')),
                    'not a member', 'enroll a non-member');

select tests.login('ari@northstarfit.test');
do $$
declare
  prog uuid := (select id from programs where slug = 'revenue-accelerator');
  l_welcome uuid; l_offer uuid; l_quiz uuid; l_pipeline uuid;
  qz uuid; q1 uuid; q2 uuid; r jsonb;
begin
  perform tests.ok(prog is not null, 'student now sees revenue accelerator');
  select lesson_id into l_welcome  from app.get_program_outline(prog) where lesson_title like 'Welcome%';
  select lesson_id into l_offer    from app.get_program_outline(prog) where lesson_title = 'Define your core offer';
  select lesson_id into l_quiz     from app.get_program_outline(prog) where lesson_title = 'Offer clarity check';
  select lesson_id into l_pipeline from app.get_program_outline(prog) where lesson_title = 'Build your pipeline';

  perform tests.eq((select lock_reason from app.get_program_outline(prog) where lesson_id = l_pipeline), 'drip_locked', 'drip lock reported');
  perform tests.ok((select unlocks_at from app.get_program_outline(prog) where lesson_id = l_pipeline) > now() + interval '6 days', 'unlock date reported');
  perform tests.eq((select lock_reason from app.get_program_outline(prog) where lesson_id = l_quiz), 'previous_incomplete', 'sequential lock reported');
  perform tests.eq((select count(*) from lesson_blocks where lesson_id = l_pipeline), 0::bigint, 'locked lesson content hidden by RLS');
  perform tests.ok((select count(*) from lesson_blocks where lesson_id = l_welcome) > 0, 'unlocked lesson content visible');
  perform tests.throws(format($q$select app.complete_lesson(%L)$q$, l_pipeline), 'drip_locked', 'complete drip-locked lesson');

  r := app.complete_lesson(l_welcome);
  perform tests.eq((r->>'lessons_completed')::int, 1, 'first lesson completed');
  perform tests.throws(format($q$select app.complete_lesson(%L)$q$, l_offer), 'assignment first', 'completion rule: assignment');
  perform app.submit_assignment((select id from assignments where lesson_id = l_offer), 'We help roofers double close rates in 90 days');
  perform app.complete_lesson(l_offer);

  select id into qz from quizzes where lesson_id = l_quiz;
  select id into q1 from quiz_questions where quiz_id = qz and position = 0;
  select id into q2 from quiz_questions where quiz_id = qz and position = 1;
  r := app.submit_quiz_attempt(qz, jsonb_build_object(q1, 'b', q2, 'true'));
  perform tests.eq(r->>'passed', 'false', 'wrong answers fail');
  perform tests.throws(format($q$select app.complete_lesson(%L)$q$, l_quiz), 'quiz first', 'completion rule: quiz');
  r := app.submit_quiz_attempt(qz, jsonb_build_object(q1, 'a', q2, 'false'));
  perform tests.eq((r->>'score_percent')::numeric, 100::numeric, 'right answers score 100');
  r := app.complete_lesson(l_quiz);
  perform tests.eq((r->>'lessons_completed')::int, 3, 'three lessons completed');
  perform tests.eq((select progress_percent from module_progress mp join modules m on m.id = mp.module_id
                    where m.title = 'Offer Clarity' and mp.user_id = auth.uid()), 100.00, 'module rollup');
  perform tests.throws($q$select count(*) from domain_events$q$, 'permission denied', 'API roles cannot read the event stream');
end $$;

-- a coach can unlock a drip lesson early
select tests.login('maria@growthos.test');
select app.unlock_lesson((select id from lessons where organization_id = tests.org('northstar-fitness') and title = 'Build your pipeline'),
                         tests.uid('ari@northstarfit.test'), 'Ready early');
select tests.login('ari@northstarfit.test');
select tests.eq((select lock_reason from app.get_program_outline((select id from programs where slug = 'revenue-accelerator'))
                 where lesson_title = 'Build your pipeline'), null::text, 'unlock overrides drip');
select tests.eq((select lock_reason from app.get_program_outline((select id from programs where slug = 'revenue-accelerator'))
                 where lesson_title = 'Content that converts'), 'drip_locked', 'other drip lessons stay locked');
select tests.ok((app.get_onboarding_questionnaire(tests.org('northstar-fitness'))->'questions') is not null, 'members can load the questionnaire');

-- time-travel the enrollment so drip content opens, then finish the program
reset role;
update program_enrollments set starts_at = now() - interval '30 days'
where user_id = tests.uid('ari@northstarfit.test') and program_id in (select id from programs where slug = 'revenue-accelerator' and organization_id = tests.org('northstar-fitness'));
set local role authenticated;
select tests.login('ari@northstarfit.test');
do $$
declare
  prog uuid := (select id from programs where slug = 'revenue-accelerator');
  l record; r jsonb;
begin
  for l in select lesson_id from app.get_program_outline(prog) where progress_status <> 'completed'
           order by section_position, module_position, lesson_position loop
    r := app.complete_lesson(l.lesson_id);
  end loop;
  perform tests.eq(r->>'program_completed', 'true', 'program completed');
  perform tests.ok((r->>'certificate_id') is not null, 'certificate issued');
  perform tests.eq((select status from program_enrollments where program_id = prog), 'completed', 'enrollment completed');
  perform tests.eq((select count(*) from certificates), 1::bigint, 'student sees own certificate');
end $$;

-- Coach grading --------------------------------------------------------------------------
select tests.login('maria@growthos.test');
do $$
declare s uuid;
begin
  select id into s from assignment_submissions where organization_id = tests.org('northstar-fitness') and status = 'submitted' limit 1;
  perform app.review_submission(s, 'approved', 'Sharp offer. Add a guarantee.', 92);
  perform tests.eq((select status from assignment_submissions where id = s), 'approved', 'submission approved');
  perform tests.eq((select count(*) from assignment_feedback where submission_id = s), 1::bigint, 'feedback stored');
end $$;
select tests.login('ari@northstarfit.test');
select tests.ok(exists (select 1 from notifications where notification_type = 'assignment.reviewed'), 'student notified of review');
select tests.eq((select count(*) from assignment_feedback), 1::bigint, 'student reads feedback on own submission');

-- KPIs, comparison, goals ------------------------------------------------------------------
select tests.login('jake@apexroofing.test');
do $$
declare apex uuid := tests.org('apex-roofing'); k uuid; r jsonb;
begin
  select id into k from kpi_definitions where key = 'cost_per_lead';
  r := app.upsert_kpi_entry(k, current_date, 80);
  perform tests.eq(r->>'status', 'off_track', 'lower-is-better KPI above band is off track');
  r := app.upsert_kpi_entry(k, current_date, 45);
  perform tests.eq(r->>'status', 'on_track', 'upsert same period replaces value');
  perform tests.eq((select count(*) from kpi_entries where kpi_definition_id = k and period_start = date_trunc('week', current_date)::date), 1::bigint, 'one row per period');
  perform tests.ok((select previous_value from kpi_entry_status_v where kpi_definition_id = k order by period_start desc limit 1) is not null, 'previous period comparison');
  perform tests.ok((select count(*) from app.kpi_period_comparison(apex, current_date - 27, current_date)) = 8, 'period comparison covers all KPIs');
  perform tests.ok((select count(*) from app.kpi_trend((select id from kpi_definitions where key = 'leads_generated'), current_date - 60, current_date, 'month')) >= 1, 'trend buckets');
  perform tests.throws(format($q$select app.submit_weekly_scorecard((select id from scorecards limit 1), current_date, '{}')$q$),
                       'missing values', 'scorecard requires all KPIs');
  perform tests.ok((select progress_percent from quarterly_goals limit 1) > 0, 'quarterly goal rolled up from KPI entries');
  perform tests.ok((select count(*) from org_growth_metrics_monthly_v where leads > 0) > 0, 'growth metrics view');
  perform tests.ok((select sum(cash_collected_cents) from org_growth_metrics_monthly_v) >= 0, 'cash metric computes');
  perform tests.ok((select max(cost_per_lead_cents) from org_growth_metrics_monthly_v) > 0, 'CPL computed for admin');
end $$;

-- Tasks -------------------------------------------------------------------------------------
do $$
declare t uuid;
begin
  t := app.create_task(tests.org('apex-roofing'), 'Call back storm leads', null, now() + interval '1 day', 'urgent',
                       array[tests.uid('sam@apexroofing.test')], 'assignees');
  perform tests.throws(format($q$select app.create_task(%L, 'x', null, null, 'low', array[%L]::uuid[])$q$,
                       tests.org('apex-roofing'), tests.uid('lena@northstarfit.test')), 'not a member', 'assign outsider');
  perform tests.throws(format($q$select app.create_task(%L, 'x', null, null, 'low', '{}', 'staff')$q$, tests.org('apex-roofing')),
                       'staff', 'client creates staff-only task');
end $$;
select tests.login('sam@apexroofing.test');
select app.set_task_status((select id from tasks where title = 'Call back storm leads'), 'done');
select tests.eq((select status from tasks where title = 'Call back storm leads'), 'done', 'assignee completes task');
select tests.ok(exists (select 1 from notifications where notification_type = 'task.assigned'), 'assignee was notified');

-- Soft delete + audit ------------------------------------------------------------------------
select tests.login('jake@apexroofing.test');
do $$
declare c uuid := (select id from contacts order by created_at limit 1);
begin
  perform app.soft_delete('contacts', c);
  perform tests.eq((select count(*) from contacts where id = c), 0::bigint, 'soft-deleted row hidden');
  perform tests.ok(exists (select 1 from audit_logs where record_id = c and action = 'soft_delete'), 'soft delete audited');
  perform tests.throws($q$select app.soft_delete('kpi_entries', gen_random_uuid())$q$, 'not supported', 'non-soft-delete table');
  perform tests.throws($q$select app.soft_delete('users; drop table users', gen_random_uuid())$q$, 'not supported', 'injection via table name');
end $$;
select tests.login('owner@growthos.test');
select tests.ok((select count(*) from contacts where deleted_at is not null) = 1, 'super admin sees deleted rows');
select app.restore('contacts', (select id from contacts where deleted_at is not null));

-- Impersonation --------------------------------------------------------------------------------
select tests.login('owner@growthos.test');
select app.start_impersonation(tests.uid('sam@apexroofing.test'), tests.org('apex-roofing'), 'Investigating KPI visibility bug');
do $$
begin
  perform tests.eq((app.get_session_context()->>'effective_user_id')::uuid, tests.uid('sam@apexroofing.test'), 'effective user swapped');
  perform tests.eq((app.get_session_context()->>'is_super_admin')::boolean, false, 'super powers off while impersonating');
  perform tests.eq((select count(*) from organizations), 1::bigint, 'sees exactly what sam sees');
  perform tests.eq((select count(*) from kpi_definitions where is_financial), 0::bigint, 'financial gate applies to impersonator');
  perform tests.throws($q$update contacts set first_name = 'x'$q$, 'read-only impersonation', 'writes blocked');
  perform tests.throws($q$select app.create_task(tests.org('apex-roofing'), 'x')$q$, 'read-only impersonation', 'RPC writes blocked');
end $$;
select app.end_impersonation();
select tests.eq((select count(*) from organizations), 5::bigint, 'full access restored');
select tests.eq((select count(*) from audit_logs where action in ('impersonation_start', 'impersonation_end')), 2::bigint, 'impersonation audited');
select tests.throws(format($q$select app.start_impersonation(%L, null, 'nope nope')$q$, tests.uid('owner@growthos.test')), null, 'impersonate self');

-- Suspension ---------------------------------------------------------------------------------------
select app.set_organization_status(tests.org('clearpath-consulting'), 'suspended', 'Payment failed');
select tests.login('omar@clearpath.test');
select tests.eq((select count(*) from organizations where slug = 'clearpath-consulting'), 0::bigint, 'suspended client loses access');
select tests.eq((select count(*) from organizations where slug = 'northstar-fitness'), 1::bigint, 'other membership unaffected');
select tests.login('devon@growthos.test');
select tests.eq((select count(*) from organizations where slug = 'clearpath-consulting'), 1::bigint, 'staff keep access to suspended client');

-- Files + storage ----------------------------------------------------------------------------------
select tests.login('ari@northstarfit.test');
do $$
declare
  north uuid := tests.org('northstar-fitness');
  fid uuid := gen_random_uuid();
begin
  insert into files (id, organization_id, storage_path, file_name, kind, visibility)
  values (fid, north, north || '/' || fid || '/homework.pdf', 'homework.pdf', 'assignment_upload', 'linked');
  insert into storage.objects (bucket_id, name, owner) values ('org-files', north || '/' || fid || '/homework.pdf', auth.uid());
  perform tests.eq((select upload_status from files where id = fid), 'uploaded', 'upload marks file row');
  perform tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('org-files', '%s/%s/x.pdf')$q$, north, gen_random_uuid()),
                       'row-level security', 'upload without a files row');
  perform tests.throws(format($q$insert into files (organization_id, storage_path, file_name) values (%L, '%s/abc/x.pdf', 'x.pdf')$q$,
                       north, north), 'row-level security', 'student uploads non-assignment file');
  perform set_config('tests.fid', fid::text, true);
end $$;
select tests.login('maria@growthos.test');
select tests.eq((select count(*) from storage.objects where name like '%homework.pdf'), 1::bigint, 'coach can read the upload');
select tests.login('jake@apexroofing.test');
select tests.eq((select count(*) from storage.objects), 0::bigint, 'other tenant cannot read storage objects');

-- Stripe fulfillment (service role) ----------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare
  apex uuid := tests.org('apex-roofing');
  off  uuid := (select id from offers where organization_id = apex and source_template_id is not null order by created_at desc limit 1);
  plan uuid := (select id from pricing_options where offer_id = off and pricing_type = 'payment_plan');
  r jsonb; r2 jsonb;
begin
  -- existing member: enrolled immediately
  r := app.fulfill_purchase(apex, off, plan, 'sam@apexroofing.test', 420000, 'cs_test_1', null, 'cus_1', 'sub_1');
  perform tests.eq(jsonb_array_length(r->'enrollment_ids'), 1, 'member enrolled from purchase');
  perform tests.eq((select total_amount_cents from purchases where id = (r->>'purchase_id')::uuid), 1260000::bigint, 'plan total = 3 installments');
  r2 := app.fulfill_purchase(apex, off, plan, 'sam@apexroofing.test', 420000, 'cs_test_1');
  perform tests.eq(r2->>'duplicate', 'true', 'webhook retry is idempotent');
  -- new buyer: invited as student with entitled programs
  r := app.fulfill_purchase(apex, off, plan, 'new.buyer@example.test', 420000, 'cs_test_2', null, 'cus_2', 'sub_2');
  perform tests.ok((r->>'invitation_token') is not null, 'new buyer invited');
  perform app.record_subscription_event('sub_1', 'payment_succeeded', 420000, 'in_2');
  perform app.record_subscription_event('sub_1', 'payment_succeeded', 420000, 'in_2');
  perform tests.eq((select installments_paid from subscriptions where stripe_subscription_id = 'sub_1'), 2, 'installment recorded once');
  perform app.record_subscription_event('sub_1', 'payment_failed', 420000, 'in_3', 'card_declined');
  perform tests.eq((select status from subscriptions where stripe_subscription_id = 'sub_1'), 'past_due', 'failure marks past due');
  perform tests.ok(exists (select 1 from domain_events where event_type = 'payment.failed'), 'payment.failed event emitted');
  perform tests.eq((select sum(p.amount_cents) from payment_records p join subscriptions s on s.id = p.subscription_id
                    where s.stripe_subscription_id = 'sub_1' and p.status = 'succeeded'), 840000::numeric, 'cash collected');
end $$;
set local role authenticated;
select tests.login('jake@apexroofing.test');
select tests.throws($q$select app.fulfill_purchase(null, null, null, 'x', 0, 'x')$q$, 'permission denied', 'clients cannot fulfill purchases');

-- Last super admin cannot be removed ----------------------------------------------------------------
reset role;
select tests.throws($q$update platform_staff set status = 'disabled' where user_id = tests.uid('owner@growthos.test');
                      set constraints all immediate$q$, 'last active super admin', 'disable last super admin');

select 'workflows ok' as result;
rollback;
