-- =============================================================================
-- SEED DATA (local/dev only)
-- Builds the template library directly, then creates the three client
-- workspaces THROUGH THE REAL WORKFLOWS (app.* functions) acting as the
-- seeded users, so the seed doubles as an end-to-end smoke test.
--
-- Every seeded login uses the password:  GrowthOS-demo-2026!
-- Emails use the reserved .test domain. To make your own account the super
-- admin after signing up, see the bottom of this file.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
                        email_change_token_new, email_change, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('GrowthOS-demo-2026!', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('first_name', u.fn, 'last_name', u.ln, 'display_name', u.fn || ' ' || u.ln),
       '', '', '', '', now(), now()
from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'owner@growthos.test',        'Platform', 'Owner'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'devon@growthos.test',        'Devon',    'Reyes'),     -- account manager
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'maria@growthos.test',        'Maria',    'Chen'),      -- coach
  ('b0000000-0000-0000-0000-000000000001'::uuid, 'jake@apexroofing.test',      'Jake',     'Morales'),
  ('b0000000-0000-0000-0000-000000000002'::uuid, 'sam@apexroofing.test',       'Sam',      'Patel'),
  ('b0000000-0000-0000-0000-000000000003'::uuid, 'lena@northstarfit.test',     'Lena',     'Brooks'),
  ('b0000000-0000-0000-0000-000000000004'::uuid, 'ari@northstarfit.test',      'Ari',      'Kim'),       -- student
  ('b0000000-0000-0000-0000-000000000005'::uuid, 'omar@clearpath.test',        'Omar',     'Haddad')
) as u(id, email, fn, ln);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now()
from auth.users where email like '%.test';

insert into public.platform_staff (user_id, role_id, title)
select 'a0000000-0000-0000-0000-000000000001', id, 'Founder' from public.roles where key = 'super_admin';
insert into public.platform_staff (user_id, role_id, title)
select u, (select id from public.roles where key = 'internal_team'), t
from (values ('a0000000-0000-0000-0000-000000000002'::uuid, 'Account Manager'),
             ('a0000000-0000-0000-0000-000000000003'::uuid, 'Growth Coach')) v(u, t);

-- ---------------------------------------------------------------------------
-- Platform + template library organizations
-- ---------------------------------------------------------------------------
insert into public.organizations (id, kind, name, slug, status) values
  ('c0000000-0000-0000-0000-000000000001', 'platform', 'Growth OS HQ', 'growth-os-hq', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'template_library', 'Template Library', 'template-library', 'active');

-- Library shorthand
do $$
declare
  lib constant uuid := 'c0000000-0000-0000-0000-000000000002';
  prog uuid; prog2 uuid; s1 uuid; s2 uuid; m1 uuid; m2 uuid; m3 uuid; m4 uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; l7 uuid; l8 uuid;
  qz uuid; q1 uuid; q2 uuid;
  sc uuid; dash uuid; pipe uuid; sop uuid; sopv uuid; offer uuid; ov uuid; tt uuid; qn uuid; ot uuid; hm uuid;
  k record;
  kpi_ids jsonb := '{}';
begin
  -- Program 1: Revenue Accelerator ------------------------------------------------
  insert into public.programs (organization_id, title, slug, subtitle, description, status, certificate_enabled, published_at, estimated_hours)
  values (lib, 'Revenue Accelerator', 'revenue-accelerator', '90 days to a predictable revenue engine',
          'Offer, sales system and content engine, installed step by step.', 'published', true, now(), 12)
  returning id into prog;
  insert into public.program_sections (organization_id, program_id, title, position) values (lib, prog, 'Foundation', 0) returning id into s1;
  insert into public.program_sections (organization_id, program_id, title, position) values (lib, prog, 'Scale', 1) returning id into s2;
  insert into public.modules (organization_id, program_id, section_id, title, position) values (lib, prog, s1, 'Offer Clarity', 0) returning id into m1;
  insert into public.modules (organization_id, program_id, section_id, title, position, drip_type, drip_days)
    values (lib, prog, s1, 'Sales System', 1, 'days_after_enrollment', 7) returning id into m2;
  insert into public.modules (organization_id, program_id, section_id, title, position, drip_type, drip_days)
    values (lib, prog, s2, 'Content Engine', 0, 'days_after_enrollment', 14) returning id into m3;

  insert into public.lessons (organization_id, program_id, module_id, title, position, is_preview, estimated_minutes)
    values (lib, prog, m1, 'Welcome + how this works', 0, true, 8) returning id into l1;
  insert into public.lessons (organization_id, program_id, module_id, title, position, estimated_minutes, completion_rule)
    values (lib, prog, m1, 'Define your core offer', 1, 25, 'assignment_submitted') returning id into l2;
  insert into public.lessons (organization_id, program_id, module_id, title, position, estimated_minutes, completion_rule, requires_previous_completion)
    values (lib, prog, m1, 'Offer clarity check', 2, 10, 'quiz_passed', true) returning id into l3;
  insert into public.lessons (organization_id, program_id, module_id, title, position, estimated_minutes)
    values (lib, prog, m2, 'Build your pipeline', 0, 30) returning id into l4;
  insert into public.lessons (organization_id, program_id, module_id, title, position, estimated_minutes, requires_previous_completion)
    values (lib, prog, m2, 'Scripts and objection handling', 1, 35, true) returning id into l5;
  insert into public.lessons (organization_id, program_id, module_id, title, position, estimated_minutes)
    values (lib, prog, m3, 'Content that converts', 0, 30) returning id into l6;

  insert into public.lesson_blocks (organization_id, program_id, lesson_id, block_type, position, content) values
    (lib, prog, l1, 'video', 0, '{"provider":"mux","playback_id":"REPLACE_ME","duration_s":480}'),
    (lib, prog, l1, 'text', 1, '{"html":"<p>Welcome. Each module unlocks on a schedule so you implement before you consume.</p>"}'),
    (lib, prog, l2, 'text', 0, '{"html":"<p>Write your offer in one sentence: who, outcome, timeframe, mechanism.</p>"}'),
    (lib, prog, l2, 'download', 1, '{"label":"Offer worksheet","url":"https://example.com/offer-worksheet.pdf"}'),
    (lib, prog, l2, 'assignment', 2, '{}'),
    (lib, prog, l3, 'quiz', 0, '{}'),
    (lib, prog, l4, 'video', 0, '{"provider":"mux","playback_id":"REPLACE_ME"}'),
    (lib, prog, l5, 'audio', 0, '{"provider":"url","url":"https://example.com/objections.mp3"}'),
    (lib, prog, l6, 'embed', 0, '{"embed_url":"https://www.youtube.com/embed/REPLACE_ME"}');

  insert into public.assignments (organization_id, program_id, lesson_id, title, instructions, submission_types)
    values (lib, prog, l2, 'Your one-sentence offer', 'Submit your offer statement and one proof point.', array['text', 'link']);
  insert into public.quizzes (organization_id, program_id, lesson_id, title, pass_percent)
    values (lib, prog, l3, 'Offer clarity check', 50) returning id into qz;
  insert into public.quiz_questions (organization_id, program_id, quiz_id, position, question_type, prompt, options)
    values (lib, prog, qz, 0, 'single_choice', 'A strong offer names…',
            '[{"id":"a","label":"A specific outcome and timeframe"},{"id":"b","label":"Every feature you provide"}]') returning id into q1;
  insert into public.quiz_questions (organization_id, program_id, quiz_id, position, question_type, prompt, options)
    values (lib, prog, qz, 1, 'true_false', 'Price should be the first thing in the offer statement.',
            '[{"id":"true","label":"True"},{"id":"false","label":"False"}]') returning id into q2;
  insert into public.quiz_answer_keys (question_id, organization_id, correct) values (q1, lib, '["a"]'), (q2, lib, '["false"]');
  insert into public.resources (organization_id, program_id, title, resource_type, url, visibility)
    values (lib, prog, '90-day roadmap template', 'template', 'https://example.com/roadmap', 'program');

  -- Program 2: Client Onboarding Bootcamp -----------------------------------------
  insert into public.programs (organization_id, title, slug, description, status, is_sequential, published_at)
  values (lib, 'Client Onboarding Bootcamp', 'onboarding-bootcamp', 'Get set up in your first week.', 'published', true, now())
  returning id into prog2;
  insert into public.program_sections (organization_id, program_id, title) values (lib, prog2, 'Week 1') returning id into s1;
  insert into public.modules (organization_id, program_id, section_id, title) values (lib, prog2, s1, 'Setup') returning id into m4;
  insert into public.lessons (organization_id, program_id, module_id, title, position) values (lib, prog2, m4, 'Tour your workspace', 0) returning id into l7;
  insert into public.lessons (organization_id, program_id, module_id, title, position) values (lib, prog2, m4, 'Submit your first scorecard', 1) returning id into l8;
  insert into public.lesson_blocks (organization_id, program_id, lesson_id, block_type, content) values
    (lib, prog2, l7, 'text', '{"html":"<p>Here is where everything lives.</p>"}'),
    (lib, prog2, l8, 'text', '{"html":"<p>Scorecards are due every Monday.</p>"}');

  insert into public.program_templates (name, category, source_program_id) values
    ('Revenue Accelerator', 'core', prog), ('Client Onboarding Bootcamp', 'onboarding', prog2);
  insert into public.lesson_templates (name, category, source_lesson_id) values ('Weekly scorecard walkthrough', 'kpis', l8);

  -- KPI library + scorecard ------------------------------------------------------
  for k in select * from (values
      ('cash_collected',      'Cash collected',        'revenue',   'currency', 'weekly',  'sum', 'higher_is_better', 25000::numeric, true,  0),
      ('leads_generated',     'Leads generated',       'marketing', 'count',    'weekly',  'sum', 'higher_is_better', 60,  false, 1),
      ('appointments_booked', 'Appointments booked',   'sales',     'count',    'weekly',  'sum', 'higher_is_better', 20,  false, 2),
      ('show_rate',           'Show rate',             'sales',     'percent',  'weekly',  'average', 'higher_is_better', 75, false, 3),
      ('close_rate',          'Close rate',            'sales',     'percent',  'weekly',  'average', 'higher_is_better', 30, false, 4),
      ('content_published',   'Content published',     'content',   'count',    'weekly',  'sum', 'higher_is_better', 5,   false, 5),
      ('marketing_spend',     'Marketing spend',       'finance',   'currency', 'weekly',  'sum', 'lower_is_better',  3000, true, 6),
      ('cost_per_lead',       'Cost per lead',         'marketing', 'currency', 'weekly',  'average', 'lower_is_better', 50, true, 7),
      ('monthly_revenue',     'Monthly revenue',       'revenue',   'currency', 'monthly', 'sum', 'higher_is_better', 100000, true, 8)
    ) as x(key, name, cat, unit, freq, agg, dir, goal, fin, pos) loop
    insert into public.kpi_definitions (organization_id, key, name, category, unit, currency, frequency, aggregation, direction,
                                        goal_value, is_financial, position)
    values (lib, k.key, k.name, k.cat, k.unit, case when k.unit = 'currency' then 'USD' end, k.freq, k.agg, k.dir, k.goal, k.fin, k.pos)
    returning id into q1;
    kpi_ids := kpi_ids || jsonb_build_object(k.key, q1);
  end loop;

  insert into public.scorecards (organization_id, name, description, frequency, due_weekday)
    values (lib, 'Weekly Growth Scorecard', 'The numbers we review every Monday.', 'weekly', 1) returning id into sc;
  insert into public.scorecard_kpis (organization_id, scorecard_id, kpi_definition_id, position)
  select lib, sc, (kpi_ids->>key)::uuid, ord
  from unnest(array['cash_collected', 'leads_generated', 'appointments_booked', 'show_rate', 'close_rate',
                    'content_published', 'marketing_spend', 'cost_per_lead']) with ordinality as t(key, ord);
  insert into public.scorecard_templates (name, category, source_scorecard_id) values ('Weekly Growth Scorecard', 'core', sc);

  insert into public.dashboards (organization_id, name, visibility, is_default) values (lib, 'Growth Overview', 'organization', true) returning id into dash;
  insert into public.dashboard_widgets (organization_id, dashboard_id, widget_type, title, kpi_definition_id, position) values
    (lib, dash, 'kpi_stat',  'Cash collected',      (kpi_ids->>'cash_collected')::uuid,      '{"x":0,"y":0,"w":3,"h":2}'),
    (lib, dash, 'kpi_stat',  'Leads',               (kpi_ids->>'leads_generated')::uuid,     '{"x":3,"y":0,"w":3,"h":2}'),
    (lib, dash, 'kpi_trend', 'Appointments booked', (kpi_ids->>'appointments_booked')::uuid, '{"x":0,"y":2,"w":6,"h":3}');
  insert into public.dashboard_widgets (organization_id, dashboard_id, widget_type, title, report_key, position) values
    (lib, dash, 'funnel',   'Sales funnel', 'org_growth_metrics_monthly', '{"x":6,"y":0,"w":6,"h":5}'),
    (lib, dash, 'wins_feed', 'Recent wins', 'client_wins',                '{"x":0,"y":5,"w":6,"h":3}'),
    (lib, dash, 'blockers',  'Blockers',    'client_blockers',            '{"x":6,"y":5,"w":6,"h":3}');
  insert into public.dashboard_templates (name, category, source_dashboard_id) values ('Growth Overview', 'core', dash);

  -- Pipeline ------------------------------------------------------------------------
  insert into public.pipelines (organization_id, name, pipeline_type, is_default) values (lib, 'High-Ticket Sales', 'sales', true) returning id into pipe;
  insert into public.pipeline_stages (organization_id, pipeline_id, name, position, stage_type, probability) values
    (lib, pipe, 'New Lead', 0, 'open', 5), (lib, pipe, 'Qualified', 1, 'open', 15), (lib, pipe, 'Call Booked', 2, 'booked', 30),
    (lib, pipe, 'Showed', 3, 'showed', 50), (lib, pipe, 'Proposal Sent', 4, 'open', 65),
    (lib, pipe, 'Won', 5, 'won', 100), (lib, pipe, 'Lost', 6, 'lost', 0);
  insert into public.pipeline_templates (name, category, source_pipeline_id) values ('High-Ticket Sales', 'sales', pipe);

  -- SOP -----------------------------------------------------------------------------
  insert into public.standard_operating_procedures (organization_id, title, department, summary, status)
    values (lib, 'Weekly Scorecard Review', 'Leadership', 'How the team reviews numbers every Monday.', 'active') returning id into sop;
  insert into public.sop_versions (organization_id, sop_id, version, body, steps)
    values (lib, sop, 1, '# Weekly Scorecard Review\n\n1. Submit numbers by 9am Monday.\n2. Flag anything off track.\n3. Assign one owner per issue.',
            '[{"title":"Submit numbers"},{"title":"Flag off-track KPIs"},{"title":"Assign owners"}]') returning id into sopv;
  update public.standard_operating_procedures set current_version_id = sopv where id = sop;
  insert into public.sop_templates (name, category, source_sop_id) values ('Weekly Scorecard Review', 'operations', sop);

  -- Offer ----------------------------------------------------------------------------
  insert into public.offers (organization_id, name, slug, offer_type, status, description)
    values (lib, 'Growth Partnership', 'growth-partnership', 'coaching', 'active', '12-month growth coaching + program access') returning id into offer;
  insert into public.offer_versions (organization_id, offer_id, version, headline, promise, published_at)
    values (lib, offer, 1, 'Double qualified pipeline in 90 days', 'Predictable revenue system installed with weekly accountability', now()) returning id into ov;
  update public.offers set current_version_id = ov where id = offer;
  insert into public.pricing_options (organization_id, offer_id, offer_version_id, name, pricing_type, amount_cents, installment_count, installment_interval, billing_interval) values
    (lib, offer, ov, 'Pay in full',   'one_time',     1200000, null, null, null),
    (lib, offer, ov, '3-pay plan',    'payment_plan',  420000, 3, 'month', null),
    (lib, offer, ov, 'Monthly',       'subscription',  150000, null, null, 'month');
  insert into public.offer_entitlements (organization_id, offer_id, program_id) values (lib, offer, prog);
  insert into public.offer_templates (name, category, source_offer_id) values ('Growth Partnership', 'core', offer);

  -- Task template ------------------------------------------------------------------------
  insert into public.task_templates (name, category) values ('Client Onboarding Checklist', 'onboarding') returning id into tt;
  insert into public.task_template_items (task_template_id, title, task_type, priority, visibility, due_offset_days, assignee_role_key, position) values
    (tt, 'Complete the onboarding questionnaire', 'onboarding', 'high',   'organization', 2,  'client_admin',    0),
    (tt, 'Book your kickoff call',                'onboarding', 'high',   'organization', 3,  'client_admin',    1),
    (tt, 'Submit your first weekly scorecard',    'onboarding', 'medium', 'organization', 7,  'client_admin',    2),
    (tt, 'Review baseline KPIs',                  'internal',   'high',   'staff',        5,  'account_manager', 3),
    (tt, 'Draft the 90-day roadmap',              'internal',   'high',   'staff',        10, 'coach',           4);

  -- Onboarding questionnaire + template ------------------------------------------------
  insert into public.onboarding_questionnaires (name) values ('Growth Intake') returning id into qn;
  insert into public.questionnaire_questions (questionnaire_id, key, label, question_type, is_required, position, maps_to_type, maps_to_key) values
    (qn, 'legal_name',             'Legal business name',                'text',     true,  0, 'client_profile', 'legal_name'),
    (qn, 'industry',               'Industry',                           'text',     true,  1, 'client_profile', 'industry'),
    (qn, 'team_size',              'Team size',                          'number',   false, 2, 'client_profile', 'team_size'),
    (qn, 'current_monthly_revenue','Current monthly revenue (cents)',    'currency', true,  3, 'client_profile', 'current_monthly_revenue_cents'),
    (qn, 'revenue_target',         'Monthly revenue target (cents)',     'currency', true,  4, 'client_profile', 'revenue_target_cents'),
    (qn, 'weekly_leads',           'Leads per week today',               'number',   false, 5, 'kpi_baseline',   'leads_generated'),
    (qn, 'biggest_bottleneck',     'Biggest bottleneck right now',       'long_text',false, 6, null, null),
    (qn, 'twelve_month_goal',      '12-month revenue goal (USD)',        'currency', false, 7, 'goal', null);

  insert into public.onboarding_templates (name, description, questionnaire_id, welcome_message, is_default)
    values ('Standard Growth Onboarding', 'Default for new coaching clients', qn,
            'Welcome aboard. Your workspace is ready. Start with the questionnaire.', true) returning id into ot;
  insert into public.onboarding_template_items (onboarding_template_id, template_type, template_id, position, options)
  select ot, t.type, t.id, t.pos, t.opts from (values
    ('program',   (select id from public.program_templates  where name = 'Revenue Accelerator'), 0, '{"enroll_invited_admin": true}'::jsonb),
    ('program',   (select id from public.program_templates  where name = 'Client Onboarding Bootcamp'), 1, '{"enroll_invited_admin": true}'::jsonb),
    ('scorecard', (select id from public.scorecard_templates where name = 'Weekly Growth Scorecard'), 2, '{}'::jsonb),
    ('dashboard', (select id from public.dashboard_templates where name = 'Growth Overview'), 3, '{}'::jsonb),
    ('pipeline',  (select id from public.pipeline_templates  where name = 'High-Ticket Sales'), 4, '{}'::jsonb),
    ('sop',       (select id from public.sop_templates       where name = 'Weekly Scorecard Review'), 5, '{}'::jsonb),
    ('task',      tt, 7, '{}'::jsonb)
  ) as t(type, id, pos, opts);

  -- Health model ----------------------------------------------------------------------------
  insert into public.health_score_models (name, description, is_default) values ('Default v1', 'Balanced engagement + outcomes', true) returning id into hm;
  insert into public.health_score_factors (model_id, factor_key, weight, lookback_days, worst_value, best_value) values
    (hm, 'login_frequency',             1.0, 30, 0,   12),
    (hm, 'lesson_completion',           1.0, 30, 0,   100),
    (hm, 'kpi_submission_consistency',  2.0, 28, 0,   100),
    (hm, 'attendance',                  1.5, 30, 0,   100),
    (hm, 'task_completion',             1.0, 30, 0,   100),
    (hm, 'goal_progress',               1.5, 90, 0,   100),
    (hm, 'revenue_progress',            2.0, 30, 30,  100),
    (hm, 'days_since_last_interaction', 1.0, 30, 21,  0),
    (hm, 'open_blockers',               1.0, 30, 6,   0),
    (hm, 'coach_rating',                1.5, 30, 3,   10);

  -- Platform email templates ------------------------------------------------------------------
  insert into public.email_templates (organization_id, key, name, subject, body_html, variables) values
    (null, 'invitation',    'Invitation',    'You''re invited to {{organization_name}}',
     '<p>You''ve been invited as {{role_name}}.</p><p><a href="{{app_url}}{{accept_path}}">Accept invitation</a></p>',
     array['organization_name', 'role_name', 'accept_path', 'app_url']),
    (null, 'task_assigned', 'Task assigned', 'New task: {{title}}', '<p>{{title}}</p><p><a href="{{app_url}}{{link_path}}">Open</a></p>',
     array['title', 'link_path', 'app_url']);
end $$;

-- ---------------------------------------------------------------------------
-- Client workspaces, created through the real workflows
-- ---------------------------------------------------------------------------
create or replace function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  owner   constant uuid := 'a0000000-0000-0000-0000-000000000001';
  devon   constant uuid := 'a0000000-0000-0000-0000-000000000002';
  maria   constant uuid := 'a0000000-0000-0000-0000-000000000003';
  jake    constant uuid := 'b0000000-0000-0000-0000-000000000001';
  sam     constant uuid := 'b0000000-0000-0000-0000-000000000002';
  lena    constant uuid := 'b0000000-0000-0000-0000-000000000003';
  ari     constant uuid := 'b0000000-0000-0000-0000-000000000004';
  omar    constant uuid := 'b0000000-0000-0000-0000-000000000005';
  res jsonb; inv jsonb;
  apex uuid; north uuid; clear uuid;
  prog uuid; sc uuid; pipe uuid; st record; ws uuid;
  c uuid; l uuid; o uuid; src uuid; s uuid; setter uuid; closer uuid;
  i int; wk date;
  kv jsonb;
begin
  -- 1. Super admin creates the three clients -----------------------------------
  perform pg_temp.act_as(owner);

  res := app.create_client_organization('Apex Roofing Co', 'apex-roofing', null, 'jake@apexroofing.test', devon, maria,
    '{"industry":"Home services","renewal_date":"2027-03-01","mrr_cents":400000,"contract_value_cents":4800000,
      "current_monthly_revenue_cents":8500000,"revenue_target_cents":15000000,"tags":["home-services","high-ticket"]}');
  apex := res->>'organization_id';
  perform pg_temp.act_as(jake);
  perform app.accept_invitation(res->>'invitation_token');

  perform pg_temp.act_as(owner);
  res := app.create_client_organization('Northstar Fitness', 'northstar-fitness', null, 'lena@northstarfit.test', devon, maria,
    '{"industry":"Fitness coaching","renewal_date":"2026-10-05","mrr_cents":250000,
      "current_monthly_revenue_cents":3200000,"revenue_target_cents":6000000,"tags":["creator","course"]}');
  north := res->>'organization_id';
  perform pg_temp.act_as(lena);
  perform app.accept_invitation(res->>'invitation_token');

  perform pg_temp.act_as(owner);
  res := app.create_client_organization('Clearpath Consulting', 'clearpath-consulting', null, 'omar@clearpath.test', devon, null,
    '{"industry":"B2B consulting","renewal_date":"2027-06-30","mrr_cents":600000,
      "current_monthly_revenue_cents":21000000,"revenue_target_cents":25000000,"tags":["b2b"]}');
  clear := res->>'organization_id';
  perform pg_temp.act_as(omar);
  perform app.accept_invitation(res->>'invitation_token');

  -- 2. Client admins complete onboarding questionnaires -------------------------
  perform pg_temp.act_as(jake);
  perform app.submit_onboarding_questionnaire(apex, '{"legal_name":"Apex Roofing Company LLC","industry":"Roofing",
    "team_size":14,"current_monthly_revenue":8500000,"revenue_target":15000000,"weekly_leads":35,
    "biggest_bottleneck":"Show rate on estimates","twelve_month_goal":"1800000"}');
  perform pg_temp.act_as(lena);
  perform app.submit_onboarding_questionnaire(north, '{"legal_name":"Northstar Fitness Inc","industry":"Online fitness coaching",
    "team_size":4,"current_monthly_revenue":3200000,"revenue_target":6000000,"weekly_leads":80}');
  -- Clearpath intentionally has NOT completed onboarding (stays in 'onboarding').

  -- 3. Team members and students ------------------------------------------------
  perform pg_temp.act_as(jake);
  inv := app.invite_member(apex, 'sam@apexroofing.test', 'client_team_member');
  perform pg_temp.act_as(sam);
  perform app.accept_invitation(inv->>'token');

  perform pg_temp.act_as(lena);
  select id into prog from public.programs where organization_id = north and slug = 'onboarding-bootcamp';
  inv := app.invite_member(north, 'ari@northstarfit.test', 'student', array[prog]);
  perform pg_temp.act_as(ari);
  perform app.accept_invitation(inv->>'token');
  perform app.complete_lesson((select id from public.lessons where program_id = prog order by position limit 1));

  -- 4. Six weeks of scorecards --------------------------------------------------
  foreach o in array array[apex, north] loop
    select id into sc from public.scorecards where organization_id = o limit 1;
    perform pg_temp.act_as(case when o = apex then jake else lena end);
    for i in reverse 6..1 loop
      wk := date_trunc('week', current_date - (7 * i))::date;
      select jsonb_object_agg(kd.id::text,
        case kd.key
          when 'cash_collected'      then case when o = apex then 18000 + i * -900 + (i % 2) * 2500 else 7000 + (6 - i) * 400 end
          when 'leads_generated'     then case when o = apex then 38 + (6 - i) * 3 else 70 + (i % 3) * 6 end
          when 'appointments_booked' then case when o = apex then 14 + (6 - i) else 11 + (i % 2) end
          when 'show_rate'           then case when o = apex then 62 + (6 - i) * 2 else 71 end
          when 'close_rate'          then case when o = apex then 24 + (6 - i) else 18 + (i % 2) * 3 end
          when 'content_published'   then case when o = apex then 2 + (i % 2) else 6 end
          when 'marketing_spend'     then case when o = apex then 2600 else 1400 end
          when 'cost_per_lead'       then case when o = apex then round(2600.0 / (38 + (6 - i) * 3), 2) else 19 end
        end)
      into kv
      from public.scorecard_kpis sk join public.kpi_definitions kd on kd.id = sk.kpi_definition_id
      where sk.scorecard_id = sc;
      perform app.submit_weekly_scorecard(sc, wk, kv,
        format('Week of %s', wk),
        case when i = 1 then array['Closed two re-roof jobs from the new estimate script'] else '{}' end,
        case when i = 2 and o = apex then array['Estimators are not logging no-shows'] else '{}' end);
    end loop;
  end loop;

  -- 5. Goals: annual → quarterly → monthly targets ------------------------------
  perform pg_temp.act_as(jake);
  insert into public.goals (organization_id, title, level, timeframe, starts_on, ends_on, target_value, unit, owner_id,
                            kpi_definition_id)
  values (apex, 'Collect $1.2M cash this year', 'company', 'annual', '2026-01-01', '2026-12-31', 1200000, 'USD', jake,
          (select id from public.kpi_definitions where organization_id = apex and key = 'cash_collected'))
  returning id into s;
  insert into public.quarterly_goals (organization_id, goal_id, year, quarter, title, owner_id, kpi_definition_id, target_value)
  values (apex, s, 2026, 3, 'Q3: $300k cash collected', jake,
          (select id from public.kpi_definitions where organization_id = apex and key = 'cash_collected'), 300000);
  insert into public.monthly_targets (organization_id, quarterly_goal_id, kpi_definition_id, month_start, target_value)
  select apex, qg.id, qg.kpi_definition_id, d::date, 100000
  from public.quarterly_goals qg, generate_series('2026-07-01'::date, '2026-09-01'::date, interval '1 month') d
  where qg.organization_id = apex;
  -- re-run goal math now that goals exist
  perform app.upsert_kpi_entry((select id from public.kpi_definitions where organization_id = apex and key = 'cash_collected'),
                               date_trunc('week', current_date - 7)::date, 21500, 'Adjusted after refund reversal');

  perform pg_temp.act_as(lena);
  insert into public.goals (organization_id, title, timeframe, starts_on, ends_on, target_value, unit, owner_id)
  values (north, 'Launch the 12-week transformation cohort', 'custom', '2026-09-01', '2026-11-30', 40, 'students', lena);

  -- 6. Tasks ------------------------------------------------------------------------
  perform pg_temp.act_as(jake);
  perform app.create_task(apex, 'Rewrite estimate follow-up script', 'Use the objection doc from module 2',
                          now() + interval '3 days', 'high', array[sam]);
  perform app.create_task(apex, 'Record 3 before/after roof videos', null, now() - interval '2 days', 'medium', array[sam],
                          'organization', 'content');
  perform pg_temp.act_as(maria);
  perform app.create_task(apex, 'Prep Q4 planning session', null, now() + interval '10 days', 'medium', array[maria],
                          'staff', 'internal');
  perform pg_temp.act_as(sam);
  perform app.set_task_status((select id from public.tasks where organization_id = apex and title like 'Complete the onboarding%'), 'in_progress');

  -- 7. Sales pipeline data ------------------------------------------------------------
  perform pg_temp.act_as(jake);
  select id into pipe from public.pipelines where organization_id = apex limit 1;
  insert into public.attribution_sources (organization_id, name, channel, platform) values
    (apex, 'Facebook Ads - Storm Damage', 'paid_ads', 'meta'), (apex, 'Google Business Profile', 'seo', 'google'), (apex, 'Referrals', 'referral', null);
  insert into public.lost_reasons (organization_id, label, category) values
    (apex, 'Went with cheaper bid', 'price'), (apex, 'Insurance denied', 'fit'), (apex, 'No show', 'no_show');
  insert into public.setters (organization_id, user_id, display_name, commission_rate) values (apex, sam, 'Sam Patel', 2.5) returning id into setter;
  insert into public.closers (organization_id, user_id, display_name, commission_rate) values (apex, jake, 'Jake Morales', 8) returning id into closer;
  select id into o from public.offers where organization_id = apex limit 1;

  for i in 1..12 loop
    insert into public.contacts (organization_id, first_name, last_name, email, lifecycle_stage, source)
    values (apex, 'Homeowner', 'No.' || i, 'homeowner' || i || '@example.test',
            case when i <= 4 then 'customer' else 'prospect' end, 'seed')
    returning id into c;
    select id into src from public.attribution_sources where organization_id = apex order by name offset (i % 3) limit 1;
    insert into public.leads (organization_id, contact_id, attribution_source_id, status, setter_id, first_touch_at)
    values (apex, c, src, case when i <= 8 then 'qualified' else 'new' end, setter, now() - make_interval(days => 40 - i * 3))
    returning id into l;
    select * into st from public.pipeline_stages where pipeline_id = pipe and stage_type =
      case when i <= 4 then 'won' when i <= 6 then 'lost' when i <= 9 then 'showed' else 'booked' end limit 1;
    insert into public.opportunities (organization_id, pipeline_id, stage_id, lead_id, contact_id, offer_id, title, status,
                                      value_cents, cash_collected_cents, setter_id, closer_id, attribution_source_id,
                                      lost_reason_id, closed_at)
    values (apex, pipe, st.id, l, c, o, 'Roof replacement #' || i,
            case st.stage_type when 'won' then 'won' when 'lost' then 'lost' else 'open' end,
            1850000 + i * 50000, case when st.stage_type = 'won' then 925000 else 0 end, setter, closer, src,
            case when st.stage_type = 'lost' then (select id from public.lost_reasons where organization_id = apex limit 1) end,
            case when st.stage_type in ('won', 'lost') then now() - make_interval(days => 20 - i) end);
    insert into public.appointments (organization_id, contact_id, scheduled_start, status, setter_id, closer_id)
    values (apex, c, now() - make_interval(days => 30 - i * 2),
            case when i <= 9 then 'showed' when i = 10 then 'no_show' else 'booked' end, setter, closer);
  end loop;
  insert into public.marketing_spend (organization_id, attribution_source_id, spend_date, amount_cents)
  select apex, (select id from public.attribution_sources where organization_id = apex and channel = 'paid_ads'),
         d::date, 37000 from generate_series(current_date - 45, current_date - 1, interval '1 day') d;

  -- 8. Coaching sessions, wins, blockers, check-ins -------------------------------------
  perform pg_temp.act_as(maria);
  insert into public.coaching_sessions (organization_id, title, session_type, audience, host_id, scheduled_start, scheduled_end, status)
  values (apex, 'Kickoff + roadmap', 'onboarding', 'attendees', maria, now() - interval '20 days', now() - interval '20 days' + interval '1 hour', 'scheduled')
  returning id into s;
  insert into public.session_attendees (organization_id, coaching_session_id, user_id, role) values
    (apex, s, maria, 'host'), (apex, s, jake, 'attendee'), (apex, s, sam, 'attendee');
  perform app.complete_coaching_session(s, 'Mapped the 90-day plan. Focus: show rate.',
    jsonb_build_object(jake::text, true, sam::text, false),
    jsonb_build_array(jsonb_build_object('title', 'Add SMS reminders to estimate bookings', 'owner_id', sam)));
  insert into public.call_recordings (organization_id, coaching_session_id, external_url, provider, is_replay_published, replay_title)
  values (apex, s, 'https://example.com/replay/kickoff', 'zoom', true, 'Apex kickoff');

  insert into public.coaching_sessions (organization_id, title, session_type, audience, host_id, scheduled_start, scheduled_end)
  values (apex, 'Weekly accountability', 'one_on_one', 'attendees', maria, now() + interval '2 days', now() + interval '2 days 45 minutes')
  returning id into s;
  insert into public.session_attendees (organization_id, coaching_session_id, user_id, role) values (apex, s, maria, 'host'), (apex, s, jake, 'attendee');

  insert into public.coaching_sessions (organization_id, title, session_type, audience, host_id, scheduled_start, scheduled_end, program_id)
  values (north, 'Group Q&A', 'group', 'program', maria, now() + interval '5 days', now() + interval '5 days 1 hour',
          (select id from public.programs where organization_id = north and slug = 'onboarding-bootcamp'));

  insert into public.coach_ratings (organization_id, rated_by, rating, comment) values
    (apex, maria, 8, 'Highly engaged, executing fast'),
    (north, maria, 6, 'Good intent, inconsistent follow-through');
  insert into public.client_blockers (organization_id, title, severity, reported_by) values
    (north, 'Ad account restricted', 'critical', maria);

  perform pg_temp.act_as(sam);
  insert into public.accountability_checkins (organization_id, user_id, period_start, commitments, confidence, reflection, submitted_at)
  values (apex, sam, date_trunc('week', current_date)::date, '["Call every no-show within 1 hour"]', 7, 'Good week', now());

  -- 9. Content ------------------------------------------------------------------------
  perform pg_temp.act_as(lena);
  insert into public.content_platforms (organization_id, platform, handle) values (north, 'youtube', '@northstarfit'), (north, 'instagram', '@northstarfit');
  insert into public.content_statuses (organization_id, name, position, category) values
    (north, 'Idea', 0, 'backlog'), (north, 'Scripting', 1, 'in_progress'), (north, 'Editing', 2, 'in_progress'), (north, 'Published', 3, 'published');
  insert into public.content_items (organization_id, title, format, status_id, owner_id, published_at)
  values (north, '5 mistakes killing your fat loss', 'long_form_video',
          (select id from public.content_statuses where organization_id = north and name = 'Published'), lena, now() - interval '9 days')
  returning id into c;
  insert into public.published_links (organization_id, content_item_id, content_platform_id, url, published_at)
  values (north, c, (select id from public.content_platforms where organization_id = north and platform = 'youtube'),
          'https://youtube.com/watch?v=REPLACE_ME', now() - interval '9 days')
  returning id into l;
  insert into public.content_metrics (organization_id, published_link_id, captured_at, views, likes, comments, shares, link_clicks, inbound_conversations)
  values (north, l, now() - interval '2 days', 18400, 1210, 164, 88, 420, 23);

  -- 10. Health scores --------------------------------------------------------------------
  perform pg_temp.act_as(owner);
  perform app.calculate_all_health_scores();

  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Make YOUR real account the super admin (run once after you sign up):
--
--   insert into public.platform_staff (user_id, role_id, title)
--   select u.id, r.id, 'Founder' from public.users u, public.roles r
--   where u.email = 'you@yourdomain.com' and r.key = 'super_admin'
--   on conflict (user_id) do update set role_id = excluded.role_id, status = 'active';
-- ---------------------------------------------------------------------------
