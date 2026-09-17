-- =============================================================================
-- 0007 GROWTH OPERATING SYSTEM
-- Goals cascade: goals → quarterly_goals → monthly_targets (→ kpi_definitions)
-- KPIs are fully custom per org; nothing assumes a fixed metric list.
-- =============================================================================

create table public.goals (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  parent_goal_id    uuid,
  title             text not null,
  description       text,
  level             text not null default 'company' check (level in ('company', 'team', 'individual')),
  timeframe         text not null default 'annual' check (timeframe in ('annual', 'multi_year', 'custom')),
  starts_on         date,
  ends_on           date,
  owner_id          uuid references public.users(id) on delete set null,
  kpi_definition_id uuid,                     -- FK below
  target_value      numeric,
  current_value     numeric,
  unit              text,
  status            text not null default 'on_track' check (status in ('not_started', 'on_track', 'at_risk', 'off_track', 'achieved', 'abandoned')),
  progress_percent  numeric(5,2) not null default 0,
  achieved_at       timestamptz
);
select private.standardize('goals', 'goals', true, true);
alter table public.goals add constraint goals_parent_fk
  foreign key (organization_id, parent_goal_id) references public.goals(organization_id, id) on delete set null (parent_goal_id);

create table public.kpi_definitions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  key                    text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  name                   text not null,
  description            text,
  category               text not null default 'general'
                         check (category in ('revenue', 'sales', 'marketing', 'content', 'fulfillment', 'team', 'finance', 'engagement', 'general')),
  unit                   text not null default 'count' check (unit in ('count', 'currency', 'percent', 'ratio', 'duration', 'number')),
  currency               char(3),
  frequency              text not null default 'weekly' check (frequency in ('daily', 'weekly', 'monthly', 'quarterly')),
  aggregation            text not null default 'sum' check (aggregation in ('sum', 'average', 'last', 'max', 'min')),
  direction              text not null default 'higher_is_better' check (direction in ('higher_is_better', 'lower_is_better')),
  goal_value             numeric,                -- default target per period
  at_risk_threshold_pct  numeric(5,2) not null default 90,   -- ≥ this % of goal = on track
  off_track_threshold_pct numeric(5,2) not null default 75,  -- < this % = off track
  data_source            text not null default 'manual',     -- manual, stripe, meta_ads, youtube, crm, calculated
  entry_method           text not null default 'manual' check (entry_method in ('manual', 'automated', 'calculated')),
  formula                jsonb,                  -- {"op":"divide","numerator":"closes","denominator":"shows","multiply":100}
  owner_id               uuid references public.users(id) on delete set null,
  is_financial           boolean not null default false,
  is_active              boolean not null default true,
  position               int not null default 0,
  source_template_id     uuid,
  copied_from_id         uuid,
  unique (organization_id, key)
);
select private.standardize('kpi_definitions', 'kpis', true, true, 'custom');

alter table public.goals add constraint goals_kpi_fk
  foreign key (organization_id, kpi_definition_id) references public.kpi_definitions(organization_id, id) on delete set null (kpi_definition_id);

create table public.quarterly_goals (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  goal_id           uuid,
  year              int not null check (year between 2000 and 2100),
  quarter           int not null check (quarter between 1 and 4),
  title             text not null,
  description       text,
  owner_id          uuid references public.users(id) on delete set null,
  kpi_definition_id uuid,
  target_value      numeric,
  current_value     numeric,
  status            text not null default 'on_track' check (status in ('not_started', 'on_track', 'at_risk', 'off_track', 'achieved', 'missed')),
  progress_percent  numeric(5,2) not null default 0,
  foreign key (organization_id, goal_id) references public.goals(organization_id, id) on delete set null (goal_id),
  foreign key (organization_id, kpi_definition_id) references public.kpi_definitions(organization_id, id) on delete set null (kpi_definition_id)
);
create index quarterly_goals_period_idx on public.quarterly_goals (organization_id, year, quarter);
select private.standardize('quarterly_goals', 'goals', true, true);

create table public.monthly_targets (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  quarterly_goal_id   uuid,
  kpi_definition_id   uuid not null,
  month_start         date not null check (extract(day from month_start) = 1),
  target_value        numeric not null,
  stretch_value       numeric,
  notes               text,
  unique (kpi_definition_id, month_start),
  foreign key (organization_id, quarterly_goal_id) references public.quarterly_goals(organization_id, id) on delete set null (quarterly_goal_id),
  foreign key (organization_id, kpi_definition_id) references public.kpi_definitions(organization_id, id) on delete cascade
);
select private.standardize('monthly_targets', 'goals', false, true);

create table public.scorecards (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  name               text not null,
  description        text,
  frequency          text not null default 'weekly' check (frequency in ('weekly', 'monthly')),
  due_weekday        int not null default 1 check (due_weekday between 0 and 6),  -- 1 = Monday
  owner_id           uuid references public.users(id) on delete set null,
  is_active          boolean not null default true,
  source_template_id uuid,
  copied_from_id     uuid
);
select private.standardize('scorecards', 'kpis', true);

create table public.scorecard_kpis (
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  scorecard_id       uuid not null,
  kpi_definition_id  uuid not null,
  position           int not null default 0,
  is_required        boolean not null default true,
  primary key (scorecard_id, kpi_definition_id),
  foreign key (organization_id, scorecard_id) references public.scorecards(organization_id, id) on delete cascade,
  foreign key (organization_id, kpi_definition_id) references public.kpi_definitions(organization_id, id) on delete cascade
);
select private.standardize('scorecard_kpis', 'kpis');

create table public.weekly_scorecards (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  scorecard_id      uuid not null,
  period_start      date not null,
  period_end        date not null,
  status            text not null default 'open' check (status in ('open', 'submitted', 'reviewed', 'missed')),
  submitted_by      uuid references public.users(id) on delete set null,
  submitted_at      timestamptz,
  reviewed_by       uuid references public.users(id) on delete set null,
  reviewed_at       timestamptz,
  summary           text,
  coach_feedback    text,
  unique (scorecard_id, period_start),
  foreign key (organization_id, scorecard_id) references public.scorecards(organization_id, id) on delete cascade
);
select private.standardize('weekly_scorecards', 'kpis', false, true);

create table public.kpi_entries (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  kpi_definition_id   uuid not null,
  period_start        date not null,
  period_end          date not null,
  value               numeric not null,
  target_value        numeric,               -- snapshot of the target at entry time
  source              text not null default 'manual',
  weekly_scorecard_id uuid,
  note                text,
  entered_by          uuid references public.users(id) on delete set null,
  unique (kpi_definition_id, period_start),
  check (period_end >= period_start),
  foreign key (organization_id, kpi_definition_id) references public.kpi_definitions(organization_id, id) on delete cascade,
  foreign key (organization_id, weekly_scorecard_id) references public.weekly_scorecards(organization_id, id) on delete set null (weekly_scorecard_id)
);
create index kpi_entries_org_period_idx on public.kpi_entries (organization_id, period_start desc);
select private.standardize('kpi_entries', 'kpis', false, true, 'custom');

create table public.dashboards (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  name               text not null,
  description        text,
  owner_id           uuid references public.users(id) on delete set null,
  visibility         text not null default 'organization' check (visibility in ('organization', 'private', 'shared')),
  shared_with        uuid[] not null default '{}',
  is_default         boolean not null default false,
  layout             jsonb not null default '{}'::jsonb,
  default_range      text not null default 'last_30_days',
  source_template_id uuid,
  copied_from_id     uuid
);
select private.standardize('dashboards', 'dashboards', true, false, 'custom');

create table public.dashboard_widgets (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  dashboard_id       uuid not null,
  widget_type        text not null check (widget_type in ('kpi_stat', 'kpi_trend', 'goal_progress', 'funnel', 'table', 'task_list', 'wins_feed', 'blockers', 'program_progress', 'content_performance', 'sales_leaderboard', 'text')),
  title              text,
  kpi_definition_id  uuid,
  report_key         text,             -- named report for non-KPI widgets
  config             jsonb not null default '{}'::jsonb,
  position           jsonb not null default '{"x":0,"y":0,"w":4,"h":2}'::jsonb,
  foreign key (organization_id, dashboard_id) references public.dashboards(organization_id, id) on delete cascade,
  foreign key (organization_id, kpi_definition_id) references public.kpi_definitions(organization_id, id) on delete cascade
);
select private.standardize('dashboard_widgets', 'dashboards', false, false, 'custom');

create table public.growth_projects (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  title             text not null,
  description       text,
  goal_id           uuid,
  quarterly_goal_id uuid,
  owner_id          uuid references public.users(id) on delete set null,
  status            text not null default 'planned' check (status in ('planned', 'active', 'on_hold', 'completed', 'canceled')),
  priority          text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  starts_on         date,
  due_on            date,
  completed_at      timestamptz,
  progress_percent  numeric(5,2) not null default 0,
  foreign key (organization_id, goal_id) references public.goals(organization_id, id) on delete set null (goal_id),
  foreign key (organization_id, quarterly_goal_id) references public.quarterly_goals(organization_id, id) on delete set null (quarterly_goal_id)
);
select private.standardize('growth_projects', 'goals', true);

create table public.experiments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  growth_project_id uuid,
  title             text not null,
  hypothesis        text,
  channel           text,
  kpi_definition_id uuid,
  baseline_value    numeric,
  target_value      numeric,
  result_value      numeric,
  status            text not null default 'idea' check (status in ('idea', 'planned', 'running', 'analyzing', 'won', 'lost', 'inconclusive')),
  ice_impact        int check (ice_impact between 1 and 10),
  ice_confidence    int check (ice_confidence between 1 and 10),
  ice_ease          int check (ice_ease between 1 and 10),
  owner_id          uuid references public.users(id) on delete set null,
  started_on        date,
  ended_on          date,
  learnings         text,
  foreign key (organization_id, growth_project_id) references public.growth_projects(organization_id, id) on delete set null (growth_project_id),
  foreign key (organization_id, kpi_definition_id) references public.kpi_definitions(organization_id, id) on delete set null (kpi_definition_id)
);
select private.standardize('experiments', 'goals', true);

create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  title               text not null,
  description         text,
  status              text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'in_review', 'done', 'canceled')),
  priority            text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  task_type           text not null default 'general' check (task_type in ('general', 'onboarding', 'action_item', 'follow_up', 'content', 'sales', 'coaching', 'internal')),
  visibility          text not null default 'organization' check (visibility in ('organization', 'assignees', 'staff')),
  due_at              timestamptz,
  start_at            timestamptz,
  completed_at        timestamptz,
  completed_by        uuid references public.users(id) on delete set null,
  estimate_minutes    int,
  position            int not null default 0,
  parent_task_id      uuid,
  growth_project_id   uuid,
  related_type        text check (related_type is null or private.valid_entity_type(related_type)),
  related_id          uuid,
  source_template_id  uuid,
  assignee_role_key   text,          -- from templates: auto-assign when someone with this role joins
  recurrence_rule     text,
  foreign key (organization_id, growth_project_id) references public.growth_projects(organization_id, id) on delete set null (growth_project_id)
);
create index tasks_related_idx on public.tasks (related_type, related_id);
select private.standardize('tasks', 'tasks', true, true, 'custom');
create index tasks_org_status_due_idx on public.tasks (organization_id, status, due_at) where deleted_at is null;
alter table public.tasks add constraint tasks_parent_fk
  foreign key (organization_id, parent_task_id) references public.tasks(organization_id, id) on delete cascade;

alter table public.action_items add constraint action_items_task_fk
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete set null (task_id);

create table public.task_assignments (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  task_id          uuid not null,
  user_id          uuid not null references public.users(id) on delete cascade,
  assigned_by      uuid references public.users(id) on delete set null,
  assigned_at      timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete cascade
);
create index task_assignments_user_idx on public.task_assignments (user_id);
select private.standardize('task_assignments', 'tasks', false, false, 'custom');

create table public.task_comments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  task_id          uuid not null,
  author_id        uuid not null references public.users(id) on delete cascade,
  body             text not null,
  file_ids         uuid[] not null default '{}',
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete cascade
);
select private.standardize('task_comments', 'tasks', true, false, 'custom');

create table public.standard_operating_procedures (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  title               text not null,
  department          text,
  summary             text,
  owner_id            uuid references public.users(id) on delete set null,
  status              text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  current_version_id  uuid,
  review_every_days   int,
  last_reviewed_at    timestamptz,
  source_template_id  uuid,
  copied_from_id      uuid
);
select private.standardize('standard_operating_procedures', 'sops', true, true);

create table public.sop_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  sop_id           uuid not null,
  version          int not null,
  body             text not null,          -- markdown
  steps            jsonb not null default '[]'::jsonb,
  change_note      text,
  unique (sop_id, version),
  foreign key (organization_id, sop_id) references public.standard_operating_procedures(organization_id, id) on delete cascade
);
select private.standardize('sop_versions', 'sops');
alter table public.standard_operating_procedures add constraint sop_current_version_fk
  foreign key (organization_id, current_version_id) references public.sop_versions(organization_id, id)
  on delete set null (current_version_id) deferrable initially deferred;

create table public.meeting_agendas (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  title               text not null,
  meeting_type        text not null default 'weekly' check (meeting_type in ('weekly', 'monthly', 'quarterly', 'annual', 'one_on_one', 'ad_hoc')),
  meeting_at          timestamptz,
  coaching_session_id uuid,
  facilitator_id      uuid references public.users(id) on delete set null,
  items               jsonb not null default '[]'::jsonb,   -- [{title, owner_id, minutes, kind}]
  status              text not null default 'draft' check (status in ('draft', 'ready', 'held', 'canceled')),
  foreign key (organization_id, coaching_session_id) references public.coaching_sessions(organization_id, id) on delete set null (coaching_session_id)
);
select private.standardize('meeting_agendas', 'meetings', true);

create table public.meeting_notes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  meeting_agenda_id   uuid not null,
  author_id           uuid references public.users(id) on delete set null,
  body                text not null,
  attendees           uuid[] not null default '{}',
  foreign key (organization_id, meeting_agenda_id) references public.meeting_agendas(organization_id, id) on delete cascade
);
select private.standardize('meeting_notes', 'meetings', true);

create table public.decisions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  meeting_note_id   uuid,
  title             text not null,
  context           text,
  decision          text not null,
  rationale         text,
  decided_by        uuid references public.users(id) on delete set null,
  decided_at        timestamptz not null default now(),
  status            text not null default 'active' check (status in ('proposed', 'active', 'superseded', 'reversed')),
  review_on         date,
  foreign key (organization_id, meeting_note_id) references public.meeting_notes(organization_id, id) on delete set null (meeting_note_id)
);
select private.standardize('decisions', 'meetings', true);

-- Task visibility helper (assignee-or-creator path)
create or replace function private.my_task_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select task_id from public.task_assignments where user_id = private.effective_user_id();
$$;

-- KPI status math, reused by views and workflows.
create or replace function private.kpi_status(p_value numeric, p_target numeric, p_direction text,
                                              p_ok_pct numeric, p_off_pct numeric)
returns text language sql immutable as $$
  select case
    when p_value is null then 'no_data'
    when p_target is null or p_target = 0 then 'no_target'
    when p_direction = 'lower_is_better' then
      -- mirror of the higher-is-better bands: ok_pct 90 → up to 110% of target is on track
      case when p_value <= p_target * (200 - p_ok_pct) / 100 then 'on_track'
           when p_value <= p_target * (200 - p_off_pct) / 100 then 'at_risk'
           else 'off_track' end
    else
      case when p_value >= p_target * p_ok_pct / 100 then 'on_track'
           when p_value >= p_target * p_off_pct / 100 then 'at_risk'
           else 'off_track' end
  end;
$$;

-- Period normalization per KPI frequency.
create or replace function private.period_bounds(p_frequency text, p_date date)
returns table (period_start date, period_end date) language sql immutable as $$
  select s, (s + case p_frequency when 'daily' then interval '1 day' when 'weekly' then interval '7 days'
                                  when 'monthly' then interval '1 month' else interval '3 months' end)::date - 1
  from (select case p_frequency
                 when 'daily' then p_date
                 when 'weekly' then date_trunc('week', p_date)::date
                 when 'monthly' then date_trunc('month', p_date)::date
                 else date_trunc('quarter', p_date)::date end as s) x;
$$;
