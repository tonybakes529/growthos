-- =============================================================================
-- 0012 AUTOMATIONS + CLIENT HEALTH SCORING
-- =============================================================================

-- Trigger/action catalog (platform-level reference data)
create table public.automation_trigger_types (
  key          text primary key,
  description  text not null,
  payload_schema jsonb not null default '{}'::jsonb
);
create table public.automation_action_types (
  key          text primary key,
  description  text not null,
  config_schema jsonb not null default '{}'::jsonb
);
alter table public.automation_trigger_types enable row level security;
alter table public.automation_action_types enable row level security;
insert into private.rls_registry (table_name, module, org_scoped, policy_mode) values
  ('automation_trigger_types', 'automations', false, 'custom'),
  ('automation_action_types', 'automations', false, 'custom');

insert into public.automation_trigger_types (key, description) values
  ('client.invited', 'A client admin was invited'),
  ('client.created', 'A client workspace was created'),
  ('client.inactive', 'No client logins for N days (scheduled check)'),
  ('client.at_risk', 'Health score dropped into at_risk/critical'),
  ('member.joined', 'An invitation was accepted'),
  ('enrollment.created', 'A user was enrolled in a program'),
  ('lesson.completed', 'A lesson was completed'),
  ('program.completed', 'A program reached 100%'),
  ('assignment.submitted', 'An assignment was submitted'),
  ('assignment.reviewed', 'An assignment was reviewed'),
  ('kpi.submitted', 'A KPI entry was recorded'),
  ('kpi.missed', 'A KPI entry was off track, or a scorecard was not submitted'),
  ('task.created', 'A task was created'),
  ('task.overdue', 'A task passed its due date (scheduled check)'),
  ('task.completed', 'A task was completed'),
  ('call.completed', 'A coaching session was marked completed'),
  ('goal.achieved', 'A goal reached its target'),
  ('payment.succeeded', 'A payment succeeded'),
  ('payment.failed', 'A payment failed'),
  ('subscription.canceled', 'A subscription was canceled'),
  ('questionnaire.submitted', 'Onboarding questionnaire submitted');

insert into public.automation_action_types (key, description) values
  ('send_email', 'Queue an email from a template'),
  ('send_notification', 'In-app notification'),
  ('create_task', 'Create a task (optionally from a task template)'),
  ('assign_program', 'Enroll the subject user in a program'),
  ('unlock_lesson', 'Grant early access to a lesson'),
  ('notify_coach', 'Notify the assigned coach / account manager'),
  ('update_client_status', 'Change organization status'),
  ('add_tag', 'Add a tag to a contact or client'),
  ('remove_tag', 'Remove a tag'),
  ('create_follow_up', 'Create a sales follow-up'),
  ('trigger_webhook', 'POST the event to a webhook endpoint'),
  ('wait', 'Delay before the next step');

create table public.automations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  description         text,
  trigger_type        text not null references public.automation_trigger_types(key),
  trigger_config      jsonb not null default '{}'::jsonb,   -- e.g. {"program_id": "...", "inactive_days": 7}
  is_active           boolean not null default false,
  run_limit_per_subject int,                                 -- e.g. 1 = once per user
  last_run_at         timestamptz,
  source_template_id  uuid,
  copied_from_id      uuid
);
create index automations_trigger_idx on public.automations (organization_id, trigger_type) where is_active;
select private.standardize('automations', 'automations', true, true);

create table public.automation_conditions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  automation_id    uuid not null,
  field            text not null,       -- JSON path into event payload / subject, e.g. 'payload.score_percent'
  operator         text not null check (operator in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'exists')),
  value            jsonb,
  group_key        int not null default 0,     -- conditions in the same group are AND'ed, groups OR'ed
  foreign key (organization_id, automation_id) references public.automations(organization_id, id) on delete cascade
);
select private.standardize('automation_conditions', 'automations');

create table public.automation_actions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  automation_id    uuid not null,
  action_type      text not null references public.automation_action_types(key),
  config           jsonb not null default '{}'::jsonb,
  position         int not null default 0,
  delay_minutes    int not null default 0,
  foreign key (organization_id, automation_id) references public.automations(organization_id, id) on delete cascade
);
select private.standardize('automation_actions', 'automations');

create table public.automation_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  automation_id     uuid not null,
  domain_event_id   bigint references public.domain_events(id) on delete set null,
  subject_type      text,
  subject_id        uuid,
  status            text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'succeeded', 'failed', 'skipped', 'canceled')),
  started_at        timestamptz,
  finished_at       timestamptz,
  error             text,
  foreign key (organization_id, automation_id) references public.automations(organization_id, id) on delete cascade
);
select private.standardize('automation_runs', 'automations', false, false, 'custom', false);
create index automation_runs_queue_idx on public.automation_runs (status, created_at) where status in ('queued', 'waiting');

create table public.automation_run_steps (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  automation_run_id     uuid not null,
  automation_action_id  uuid,
  status                text not null default 'pending' check (status in ('pending', 'scheduled', 'succeeded', 'failed', 'skipped')),
  run_after             timestamptz not null default now(),
  attempts              int not null default 0,
  result                jsonb,
  error                 text,
  foreign key (organization_id, automation_run_id) references public.automation_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, automation_action_id) references public.automation_actions(organization_id, id) on delete set null (automation_action_id)
);
select private.standardize('automation_run_steps', 'automations', false, false, 'custom', false);

create table public.webhook_endpoints (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  url              text not null check (url ~ '^https://'),
  event_types      text[] not null default '{}',
  secret_ref       text,            -- name of the secret in Supabase Vault; never the raw secret
  is_active        boolean not null default true,
  last_delivery_at timestamptz,
  failure_count    int not null default 0
);
select private.standardize('webhook_endpoints', 'automations', true, true);

-- ---------------------------------------------------------------------------
-- Health scoring (models are platform-level; scores are per client org)
-- ---------------------------------------------------------------------------
create table public.health_score_models (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  is_default         boolean not null default false,
  healthy_min        numeric(5,2) not null default 75,
  watch_min          numeric(5,2) not null default 55,
  at_risk_min        numeric(5,2) not null default 35,    -- below = critical
  is_active          boolean not null default true
);
create unique index health_score_models_one_default on public.health_score_models (is_default) where is_default;
select private.standardize('health_score_models', 'health', false, true, 'custom');

create table public.health_score_factors (
  id                 uuid primary key default gen_random_uuid(),
  model_id           uuid not null references public.health_score_models(id) on delete cascade,
  factor_key         text not null check (factor_key in (
                       'login_frequency', 'lesson_completion', 'kpi_submission_consistency', 'attendance',
                       'task_completion', 'goal_progress', 'revenue_progress', 'days_since_last_interaction',
                       'open_blockers', 'coach_rating')),
  weight             numeric(6,3) not null check (weight >= 0),
  lookback_days      int not null default 30,
  -- normalization: raw value mapped linearly between worst and best → 0..100
  worst_value        numeric not null,
  best_value         numeric not null,
  is_active          boolean not null default true,
  unique (model_id, factor_key)
);
select private.standardize('health_score_factors', 'health', false, true, 'custom');

create table public.client_health_scores (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  model_id           uuid not null references public.health_score_models(id),
  score              numeric(5,2) not null,
  band               text not null check (band in ('healthy', 'watch', 'at_risk', 'critical')),
  previous_score     numeric(5,2),
  is_latest          boolean not null default true,
  calculated_at      timestamptz not null default now(),
  override_band      text check (override_band in ('healthy', 'watch', 'at_risk', 'critical')),
  override_reason    text
);
create unique index client_health_scores_latest on public.client_health_scores (organization_id) where is_latest;
create index client_health_scores_hist on public.client_health_scores (organization_id, calculated_at desc);
select private.standardize('client_health_scores', 'health', false, false, 'standard', false);

create table public.client_health_score_components (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  health_score_id        uuid not null,
  factor_key             text not null,
  raw_value              numeric,
  normalized_score       numeric(5,2) not null,     -- 0..100
  weight                 numeric(6,3) not null,
  weighted_contribution  numeric(6,2) not null,     -- share of the final score
  explanation            text not null,
  foreign key (organization_id, health_score_id) references public.client_health_scores(organization_id, id) on delete cascade
);
select private.standardize('client_health_score_components', 'health', false, false, 'standard', false);
