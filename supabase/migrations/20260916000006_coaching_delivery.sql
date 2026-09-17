-- =============================================================================
-- 0006 COACHING DELIVERY + ACCOUNTABILITY
-- =============================================================================

create table public.recurring_calls (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  title              text not null,
  description        text,
  call_type          text not null default 'group' check (call_type in ('one_on_one', 'group', 'hot_seat', 'office_hours', 'workshop', 'internal')),
  host_id            uuid references public.users(id) on delete set null,
  audience           text not null default 'organization' check (audience in ('organization', 'attendees', 'program')),
  program_id         uuid,
  rrule              text not null,            -- RFC 5545, e.g. FREQ=WEEKLY;BYDAY=TU
  start_time         time not null,
  duration_minutes   int not null default 60,
  timezone           text not null default 'America/New_York',
  meeting_url        text,
  starts_on          date not null default current_date,
  ends_on            date,
  is_active          boolean not null default true,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete set null (program_id)
);
select private.standardize('recurring_calls', 'coaching', true);

create table public.coaching_sessions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  recurring_call_id  uuid,
  title              text not null,
  session_type       text not null default 'one_on_one' check (session_type in ('one_on_one', 'group', 'hot_seat', 'office_hours', 'workshop', 'internal', 'onboarding', 'quarterly_review')),
  audience           text not null default 'attendees' check (audience in ('organization', 'attendees', 'program')),
  program_id         uuid,
  host_id            uuid references public.users(id) on delete set null,
  scheduled_start    timestamptz not null,
  scheduled_end      timestamptz not null,
  status             text not null default 'scheduled' check (status in ('scheduled', 'completed', 'canceled', 'no_show', 'rescheduled')),
  meeting_url        text,
  agenda             text,
  summary            text,
  external_event_id  text,
  completed_at       timestamptz,
  check (scheduled_end > scheduled_start),
  foreign key (organization_id, recurring_call_id) references public.recurring_calls(organization_id, id) on delete set null (recurring_call_id),
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete set null (program_id)
);
create index coaching_sessions_org_start_idx on public.coaching_sessions (organization_id, scheduled_start);
select private.standardize('coaching_sessions', 'coaching', true, false, 'custom');

create table public.session_attendees (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  coaching_session_id uuid not null,
  user_id             uuid references public.users(id) on delete cascade,
  contact_id          uuid,
  role                text not null default 'attendee' check (role in ('host', 'coach', 'attendee', 'guest')),
  rsvp_status         text not null default 'invited' check (rsvp_status in ('invited', 'accepted', 'declined', 'tentative')),
  attended            boolean,
  joined_at           timestamptz,
  left_at             timestamptz,
  check (user_id is not null or contact_id is not null),
  unique (coaching_session_id, user_id),
  foreign key (organization_id, coaching_session_id) references public.coaching_sessions(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade
);
create index session_attendees_user_idx on public.session_attendees (user_id);
select private.standardize('session_attendees', 'coaching', false, false, 'custom');

create table public.session_notes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  coaching_session_id uuid not null,
  author_id           uuid references public.users(id) on delete set null,
  visibility          text not null default 'shared' check (visibility in ('shared', 'internal')),
  body                text not null,
  foreign key (organization_id, coaching_session_id) references public.coaching_sessions(organization_id, id) on delete cascade
);
select private.standardize('session_notes', 'coaching', true, false, 'custom');

-- Replay library = call_recordings where is_replay_published.
create table public.call_recordings (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  coaching_session_id uuid not null,
  file_id             uuid,
  external_url        text,
  provider            text,                   -- zoom, loom, mux, vimeo
  duration_seconds    int,
  transcript          text,
  ai_summary          text,
  is_replay_published boolean not null default false,
  replay_title        text,
  replay_category     text,
  recorded_at         timestamptz,
  foreign key (organization_id, coaching_session_id) references public.coaching_sessions(organization_id, id) on delete cascade,
  foreign key (organization_id, file_id) references public.files(organization_id, id) on delete set null (file_id)
);
select private.standardize('call_recordings', 'coaching', true, false, 'custom');

create table public.action_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  coaching_session_id uuid,
  title               text not null,
  description         text,
  owner_id            uuid references public.users(id) on delete set null,
  due_at              timestamptz,
  status              text not null default 'open' check (status in ('open', 'done', 'canceled')),
  completed_at        timestamptz,
  task_id             uuid,                        -- promoted to a task (FK in 0007)
  foreign key (organization_id, coaching_session_id) references public.coaching_sessions(organization_id, id) on delete set null (coaching_session_id)
);
select private.standardize('action_items', 'coaching', true, false, 'custom');

create table public.accountability_checkins (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  period_type      text not null default 'weekly' check (period_type in ('daily', 'weekly', 'monthly')),
  period_start     date not null,
  commitments      jsonb not null default '[]'::jsonb,
  completed        jsonb not null default '[]'::jsonb,
  confidence       int check (confidence between 1 and 10),
  energy           int check (energy between 1 and 10),
  reflection       text,
  needs_help       boolean not null default false,
  submitted_at     timestamptz,
  coach_response   text,
  responded_by     uuid references public.users(id) on delete set null,
  responded_at     timestamptz,
  unique (organization_id, user_id, period_type, period_start)
);
select private.standardize('accountability_checkins', 'accountability', false, false, 'custom');

create table public.client_wins (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  title               text not null,
  description         text,
  category            text check (category in ('revenue', 'sales', 'content', 'team', 'operations', 'personal', 'other')),
  impact_value_cents  bigint,
  occurred_on         date not null default current_date,
  reported_by         uuid references public.users(id) on delete set null,
  is_testimonial_ok   boolean not null default false,
  checkin_id          uuid,
  foreign key (organization_id, checkin_id) references public.accountability_checkins(organization_id, id) on delete set null (checkin_id)
);
create index client_wins_org_date_idx on public.client_wins (organization_id, occurred_on desc);
select private.standardize('client_wins', 'accountability', true);

create table public.client_blockers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  description      text,
  severity         text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status           text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'wont_fix')),
  owner_id         uuid references public.users(id) on delete set null,
  reported_by      uuid references public.users(id) on delete set null,
  resolved_at      timestamptz,
  resolution       text,
  checkin_id       uuid,
  foreign key (organization_id, checkin_id) references public.accountability_checkins(organization_id, id) on delete set null (checkin_id)
);
create index client_blockers_open_idx on public.client_blockers (organization_id) where status in ('open', 'in_progress');
select private.standardize('client_blockers', 'accountability', true);

create table public.milestones (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid,
  title            text not null,
  description      text,
  phase            text,                 -- roadmap phase label
  position         int not null default 0,
  target_date      date,
  criteria         jsonb not null default '{}'::jsonb,   -- e.g. {"kpi_key":"monthly_revenue","gte":20000}
  copied_from_id   uuid,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete set null (program_id)
);
select private.standardize('milestones', 'accountability', true);

create table public.milestone_progress (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  milestone_id     uuid not null,
  user_id          uuid references public.users(id) on delete cascade,   -- null = company-level
  status           text not null default 'not_started' check (status in ('not_started', 'in_progress', 'achieved', 'skipped')),
  progress_percent numeric(5,2) not null default 0,
  achieved_at      timestamptz,
  verified_by      uuid references public.users(id) on delete set null,
  notes            text,
  unique nulls not distinct (milestone_id, user_id),
  foreign key (organization_id, milestone_id) references public.milestones(organization_id, id) on delete cascade
);
select private.standardize('milestone_progress', 'accountability');

-- Coach's subjective rating (feeds client health).
create table public.coach_ratings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  rated_by         uuid not null references public.users(id) on delete cascade,
  rating           int not null check (rating between 1 and 10),
  comment          text,
  rated_on         date not null default current_date
);
create index coach_ratings_org_idx on public.coach_ratings (organization_id, rated_on desc);
select private.standardize('coach_ratings', 'health');

-- Sessions the effective user attends.
create or replace function private.my_session_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select coaching_session_id from public.session_attendees where user_id = private.effective_user_id();
$$;
