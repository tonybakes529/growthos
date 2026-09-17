-- =============================================================================
-- 0011 TEMPLATES + ONBOARDING
-- Templates are REAL rows living in an organization of kind 'template_library'.
-- The *_templates tables below are platform-level registries that point at
-- those source rows. Applying a template deep-copies the source tree into a
-- client org (see app.apply_template in 0014).
-- =============================================================================

create or replace function private.assert_library_source()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  src_table text := tg_argv[0];
  src_col   text := tg_argv[1];
  src_id    uuid := (to_jsonb(new)->>src_col)::uuid;
  kind      text;
begin
  if src_id is null then return new; end if;
  execute format('select o.kind from public.%I s join public.organizations o on o.id = s.organization_id where s.id = $1', src_table)
    into kind using src_id;
  if kind is distinct from 'template_library' then
    raise exception '% must reference a row in a template_library organization', src_col;
  end if;
  return new;
end;
$$;

create table public.program_templates (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  category           text,
  source_program_id  uuid not null references public.programs(id) on delete cascade,
  version            int not null default 1,
  is_active          boolean not null default true
);
create trigger assert_source before insert or update on public.program_templates
  for each row execute function private.assert_library_source('programs', 'source_program_id');
select private.standardize('program_templates', 'templates', false, true, 'custom');

create table public.lesson_templates (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  category           text,
  source_lesson_id   uuid not null references public.lessons(id) on delete cascade,
  is_active          boolean not null default true
);
create trigger assert_source before insert or update on public.lesson_templates
  for each row execute function private.assert_library_source('lessons', 'source_lesson_id');
select private.standardize('lesson_templates', 'templates', false, false, 'custom');

create table public.scorecard_templates (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  category             text,
  source_scorecard_id  uuid not null references public.scorecards(id) on delete cascade,
  is_active            boolean not null default true
);
create trigger assert_source before insert or update on public.scorecard_templates
  for each row execute function private.assert_library_source('scorecards', 'source_scorecard_id');
select private.standardize('scorecard_templates', 'templates', false, false, 'custom');

create table public.dashboard_templates (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  category             text,
  source_dashboard_id  uuid not null references public.dashboards(id) on delete cascade,
  is_active            boolean not null default true
);
create trigger assert_source before insert or update on public.dashboard_templates
  for each row execute function private.assert_library_source('dashboards', 'source_dashboard_id');
select private.standardize('dashboard_templates', 'templates', false, false, 'custom');

create table public.sop_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  category        text,
  source_sop_id   uuid not null references public.standard_operating_procedures(id) on delete cascade,
  is_active       boolean not null default true
);
create trigger assert_source before insert or update on public.sop_templates
  for each row execute function private.assert_library_source('standard_operating_procedures', 'source_sop_id');
select private.standardize('sop_templates', 'templates', false, false, 'custom');

create table public.offer_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  category         text,
  source_offer_id  uuid not null references public.offers(id) on delete cascade,
  is_active        boolean not null default true
);
create trigger assert_source before insert or update on public.offer_templates
  for each row execute function private.assert_library_source('offers', 'source_offer_id');
select private.standardize('offer_templates', 'templates', false, false, 'custom');

create table public.pipeline_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  category            text,
  source_pipeline_id  uuid not null references public.pipelines(id) on delete cascade,
  is_active           boolean not null default true
);
create trigger assert_source before insert or update on public.pipeline_templates
  for each row execute function private.assert_library_source('pipelines', 'source_pipeline_id');
select private.standardize('pipeline_templates', 'templates', false, false, 'custom');

-- Task lists are not a single source row, so they are defined inline.
create table public.task_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  category     text,
  is_active    boolean not null default true
);
select private.standardize('task_templates', 'templates', false, false, 'custom');

create table public.task_template_items (
  id                 uuid primary key default gen_random_uuid(),
  task_template_id   uuid not null references public.task_templates(id) on delete cascade,
  title              text not null,
  description        text,
  task_type          text not null default 'onboarding',
  priority           text not null default 'medium',
  visibility         text not null default 'organization',
  due_offset_days    int,                       -- relative to application date
  assignee_role_key  text,                      -- 'client_admin', 'account_manager', 'coach', ...
  position           int not null default 0
);
select private.standardize('task_template_items', 'templates', false, false, 'custom');

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------
create table public.onboarding_questionnaires (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  is_active    boolean not null default true
);
select private.standardize('onboarding_questionnaires', 'templates', false, false, 'custom');

create table public.questionnaire_questions (
  id                uuid primary key default gen_random_uuid(),
  questionnaire_id  uuid not null references public.onboarding_questionnaires(id) on delete cascade,
  key               text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label             text not null,
  help_text         text,
  question_type     text not null check (question_type in ('text', 'long_text', 'number', 'currency', 'percent', 'select', 'multi_select', 'date', 'boolean', 'url')),
  options           jsonb not null default '[]'::jsonb,
  is_required       boolean not null default false,
  position          int not null default 0,
  -- where the answer lands
  maps_to_type      text check (maps_to_type in ('client_profile', 'kpi_baseline', 'custom_field', 'goal')),
  maps_to_key       text,           -- client_profiles column / kpi key / custom field key
  unique (questionnaire_id, key)
);
select private.standardize('questionnaire_questions', 'templates', false, false, 'custom');

create table public.onboarding_templates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  questionnaire_id  uuid references public.onboarding_questionnaires(id) on delete set null,
  welcome_message   text,
  default_status    text not null default 'onboarding',
  is_default        boolean not null default false,
  is_active         boolean not null default true
);
create unique index onboarding_templates_one_default on public.onboarding_templates (is_default) where is_default;
select private.standardize('onboarding_templates', 'templates', false, true, 'custom');

alter table public.client_profiles add constraint client_profiles_onboarding_template_fk
  foreign key (onboarding_template_id) references public.onboarding_templates(id) on delete set null;

create table public.onboarding_template_items (
  id                      uuid primary key default gen_random_uuid(),
  onboarding_template_id  uuid not null references public.onboarding_templates(id) on delete cascade,
  template_type           text not null check (template_type in ('program', 'lesson', 'scorecard', 'dashboard', 'task', 'sop', 'offer', 'pipeline')),
  template_id             uuid not null,
  options                 jsonb not null default '{}'::jsonb,  -- {"enroll_invited_admin": true}
  position                int not null default 0,
  unique (onboarding_template_id, template_type, template_id)
);
select private.standardize('onboarding_template_items', 'templates', false, false, 'custom');

create table public.questionnaire_responses (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  questionnaire_id  uuid not null references public.onboarding_questionnaires(id),
  user_id           uuid references public.users(id) on delete set null,
  answers           jsonb not null default '{}'::jsonb,
  status            text not null default 'submitted' check (status in ('draft', 'submitted')),
  submitted_at      timestamptz,
  unique (organization_id, questionnaire_id)
);
select private.standardize('questionnaire_responses', 'organization', false, true, 'custom');

create table public.template_applications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  template_type     text not null,
  template_id       uuid not null,
  created_root_id   uuid,
  status            text not null default 'applied' check (status in ('applied', 'failed', 'skipped')),
  detail            jsonb not null default '{}'::jsonb,
  applied_at        timestamptz not null default now()
);
create index template_applications_org_idx on public.template_applications (organization_id, applied_at desc);
select private.standardize('template_applications', 'templates', false, false, 'custom');
