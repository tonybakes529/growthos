-- =============================================================================
-- 0114 STUDENT KPI TRACKER: SCHEMA
--
-- Students track their outreach in a spreadsheet: a dashboard of funnel numbers
-- and, on a second sheet, every lead with its outcome and objection. The same
-- fact gets typed twice and the two halves can disagree.
--
-- Here the lead log is the source of truth. Ad Spend is typed, because it is
-- read out of Meta Business Suite; everything else is counted from the leads or
-- calculated from other rows, so the dashboard cannot drift from the log.
--
-- This migration is the shape only. The evaluator and the app functions are
-- 0115, so that a failure in either lands on its own.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A KPI entry can belong to one student
--    null user_id is the workspace number, which is exactly today's behaviour,
--    so the existing weekly scorecard is untouched.
-- ---------------------------------------------------------------------------
alter table public.kpi_entries add column user_id uuid references public.users(id) on delete cascade;
alter table public.kpi_entries drop constraint kpi_entries_kpi_definition_id_period_start_key;
create unique index kpi_entries_workspace_key on public.kpi_entries (kpi_definition_id, period_start)
  where user_id is null;
create unique index kpi_entries_student_key on public.kpi_entries (kpi_definition_id, user_id, period_start)
  where user_id is not null;
create index kpi_entries_student_idx on public.kpi_entries (organization_id, user_id, period_start desc)
  where user_id is not null;

-- The workspace views must never see a student's row, or one client's numbers would be the sum of
-- everyone's. Same columns, same types, same security_invoker: only the filter is new.
create or replace view public.kpi_entry_status_v with (security_invoker = true) as
select
  e.id, e.organization_id, e.kpi_definition_id, k.key as kpi_key, k.name as kpi_name, k.category, k.unit,
  k.frequency, k.direction, k.is_financial, k.owner_id,
  e.period_start, e.period_end, e.value, e.target_value, e.source, e.note,
  lag(e.value) over w as previous_value,
  case when lag(e.value) over w is not null and lag(e.value) over w <> 0
       then round(100 * (e.value - lag(e.value) over w) / abs(lag(e.value) over w), 2) end as change_percent,
  case when e.target_value > 0 then round(100 * e.value / e.target_value, 2) end as percent_of_target,
  private.kpi_status(e.value, e.target_value, k.direction, k.at_risk_threshold_pct, k.off_track_threshold_pct) as status
from public.kpi_entries e
join public.kpi_definitions k on k.id = e.kpi_definition_id
where e.user_id is null
window w as (partition by e.organization_id, e.kpi_definition_id order by e.period_start);

-- ---------------------------------------------------------------------------
-- 2. A tracker is a scorecard whose numbers belong to each student
-- ---------------------------------------------------------------------------
alter table public.scorecards add column scope text not null default 'workspace'
  check (scope in ('workspace', 'student'));
comment on column public.scorecards.scope is
  'workspace: one set of numbers for the client. student: every student fills in their own.';

-- ---------------------------------------------------------------------------
-- 3. A KPI row can count itself from the lead log
--    source_spec says what to count; the existing formula jsonb, unused until
--    now, says how to calculate a row from other rows.
-- ---------------------------------------------------------------------------
alter table public.kpi_definitions drop constraint kpi_definitions_entry_method_check;
alter table public.kpi_definitions add constraint kpi_definitions_entry_method_check
  check (entry_method in ('manual', 'automated', 'calculated', 'counted'));
alter table public.kpi_definitions add column source_spec jsonb;
comment on column public.kpi_definitions.source_spec is
  'For entry_method = counted. {"count":"leads"} or {"count":"leads","where":{"booked":true}} or {"sum":"cash_collected_cents"} or {"count":"leads","where":{"objection":"<lost_reason id>"}}.';

-- ---------------------------------------------------------------------------
-- 4. The lead log: one row per lead, the columns from the spreadsheet
--    The five outcome flags stay independent, exactly as the sheet has them, so
--    the funnel order is not enforced and each column counts on its own.
-- ---------------------------------------------------------------------------
create table public.student_leads (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  user_id              uuid not null references public.users(id) on delete cascade,
  captured_on          date not null default current_date,
  name                 text check (name is null or length(btrim(name)) <= 200),
  phone                text check (phone is null or length(btrim(phone)) <= 50),
  email                extensions.citext,
  answered             boolean not null default false,
  qualified            boolean not null default false,   -- new: the sheet has no such column, so the
  booked               boolean not null default false,   -- dashboard's Qualified Leads was unverifiable
  taken                boolean not null default false,
  converted            boolean not null default false,
  objection_id         uuid,
  cash_collected_cents bigint not null default 0 check (cash_collected_cents >= 0),
  revenue_cents        bigint not null default 0 check (revenue_cents >= 0),
  follow_up_attempts   int not null default 0 check (follow_up_attempts between 0 and 1000),
  notes                text check (notes is null or length(notes) <= 5000),
  -- the objection list is the workspace's existing lost reasons, so it stays editable in one place
  foreign key (organization_id, objection_id) references public.lost_reasons(organization_id, id)
    on delete set null (objection_id)
);
select private.standardize('student_leads', 'kpis', true, false, 'custom');
create index student_leads_owner_idx on public.student_leads (organization_id, user_id, captured_on desc)
  where deleted_at is null;
create index student_leads_objection_idx on public.student_leads (organization_id, objection_id)
  where objection_id is not null and deleted_at is null;

-- Read your own, or anyone's if you run the workspace. Every write goes through the functions in 0115,
-- the same posture as customer_onboardings.
create policy student_leads_select on public.student_leads for select to authenticated using (
  user_id = (select private.effective_user_id())
  or organization_id in (select private.orgs_with_permission('kpis.read')));

-- A student holds no kpis.* permission, and must not: isLearner in src/lib/auth/context.ts treats
-- anyone holding only community.* and messages.* as a student, so granting one would hand every
-- student the full team navigation. Their own rows are reachable through the user_id branch above.
