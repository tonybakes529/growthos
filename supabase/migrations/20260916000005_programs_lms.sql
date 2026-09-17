-- =============================================================================
-- 0005 COACHING PROGRAMS (Kajabi-style LMS)
-- programs → program_sections → modules → lessons → lesson_blocks
-- Each level carries organization_id AND program_id so RLS never needs joins.
-- =============================================================================

create table public.programs (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  title                text not null,
  slug                 text not null,
  subtitle             text,
  description          text,
  cover_file_id        uuid,
  status               text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  visibility           text not null default 'enrolled' check (visibility in ('enrolled', 'organization')),
  is_sequential        boolean not null default false,   -- every lesson requires the previous one
  default_access_days  int,
  certificate_enabled  boolean not null default false,
  certificate_settings jsonb not null default '{}'::jsonb,
  community_enabled    boolean not null default true,
  estimated_hours      numeric(6,2),
  published_at         timestamptz,
  source_template_id   uuid,
  copied_from_id       uuid,
  unique (organization_id, slug),
  foreign key (organization_id, cover_file_id) references public.files(organization_id, id) on delete set null (cover_file_id)
);
select private.standardize('programs', 'programs', true, true, 'custom');

alter table public.offer_entitlements add constraint offer_entitlements_program_fk
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade;

create table public.program_sections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid not null,
  title            text not null,
  description      text,
  position         int not null default 0,
  copied_from_id   uuid,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade
);
create index program_sections_program_idx on public.program_sections (program_id, position);
select private.standardize('program_sections', 'programs', true, false, 'custom');

create table public.modules (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  program_id        uuid not null,
  section_id        uuid not null,
  title             text not null,
  description       text,
  position          int not null default 0,
  drip_type         text not null default 'immediate' check (drip_type in ('immediate', 'days_after_enrollment', 'fixed_date')),
  drip_days         int,
  drip_date         timestamptz,
  copied_from_id    uuid,
  check (drip_type <> 'days_after_enrollment' or drip_days is not null),
  check (drip_type <> 'fixed_date' or drip_date is not null),
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, section_id) references public.program_sections(organization_id, id) on delete cascade
);
create index modules_section_idx on public.modules (section_id, position);
select private.standardize('modules', 'programs', true, false, 'custom');

create table public.lessons (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organizations(id) on delete cascade,
  program_id                    uuid not null,
  module_id                     uuid not null,
  title                         text not null,
  summary                       text,
  position                      int not null default 0,
  status                        text not null default 'published' check (status in ('draft', 'published')),
  drip_type                     text not null default 'immediate' check (drip_type in ('immediate', 'days_after_enrollment', 'fixed_date')),
  drip_days                     int,
  drip_date                     timestamptz,
  requires_previous_completion  boolean not null default false,
  is_preview                    boolean not null default false,
  estimated_minutes             int,
  completion_rule               text not null default 'manual' check (completion_rule in ('manual', 'video_watched', 'quiz_passed', 'assignment_submitted')),
  source_template_id            uuid,
  copied_from_id                uuid,
  check (drip_type <> 'days_after_enrollment' or drip_days is not null),
  check (drip_type <> 'fixed_date' or drip_date is not null),
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, module_id) references public.modules(organization_id, id) on delete cascade
);
create index lessons_module_idx on public.lessons (module_id, position);
create index lessons_program_idx on public.lessons (program_id);
select private.standardize('lessons', 'programs', true, true, 'custom');

create table public.lesson_blocks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid not null,
  lesson_id        uuid not null,
  block_type       text not null check (block_type in ('video', 'text', 'audio', 'document', 'download', 'embed', 'image', 'quiz', 'assignment', 'callout')),
  position         int not null default 0,
  content          jsonb not null default '{}'::jsonb,   -- {html}, {embed_url}, {provider, playback_id}, ...
  file_id          uuid,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, lesson_id) references public.lessons(organization_id, id) on delete cascade,
  foreign key (organization_id, file_id) references public.files(organization_id, id) on delete set null (file_id)
);
create index lesson_blocks_lesson_idx on public.lesson_blocks (lesson_id, position);
select private.standardize('lesson_blocks', 'programs', false, false, 'custom');

-- Resources: downloadable/linked assets. Program-bound or org library.
create table public.resources (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid,
  module_id        uuid,
  lesson_id        uuid,
  title            text not null,
  description      text,
  resource_type    text not null default 'file' check (resource_type in ('file', 'link', 'worksheet', 'template', 'replay', 'swipe')),
  file_id          uuid,
  url              text,
  visibility       text not null default 'program' check (visibility in ('program', 'organization', 'managers')),
  category         text,
  position         int not null default 0,
  copied_from_id   uuid,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, module_id) references public.modules(organization_id, id) on delete cascade,
  foreign key (organization_id, lesson_id) references public.lessons(organization_id, id) on delete cascade,
  foreign key (organization_id, file_id) references public.files(organization_id, id) on delete set null (file_id),
  check (visibility <> 'program' or program_id is not null)
);
select private.standardize('resources', 'files', true, false, 'custom');

-- ---------------------------------------------------------------------------
-- Enrollment + progress
-- ---------------------------------------------------------------------------
create table public.program_enrollments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  program_id          uuid not null,
  user_id             uuid not null references public.users(id) on delete cascade,
  status              text not null default 'active' check (status in ('active', 'paused', 'completed', 'revoked', 'expired')),
  source              text not null default 'manual' check (source in ('manual', 'purchase', 'invitation', 'template', 'automation', 'offer_assignment', 'import')),
  source_purchase_id  uuid,
  enrolled_by         uuid references public.users(id) on delete set null,
  enrolled_at         timestamptz not null default now(),
  starts_at           timestamptz not null default now(),   -- drip anchor
  access_expires_at   timestamptz,
  progress_percent    numeric(5,2) not null default 0,
  lessons_completed   int not null default 0,
  lessons_total       int not null default 0,
  completed_at        timestamptz,
  last_activity_at    timestamptz,
  unique (program_id, user_id),
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, source_purchase_id) references public.purchases(organization_id, id) on delete set null (source_purchase_id)
);
create index program_enrollments_user_idx on public.program_enrollments (user_id) where status in ('active', 'completed');
select private.standardize('program_enrollments', 'enrollments', false, true, 'custom');

create table public.lesson_progress (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  enrollment_id     uuid not null,
  lesson_id         uuid not null,
  user_id           uuid not null references public.users(id) on delete cascade,
  status            text not null default 'in_progress' check (status in ('not_started', 'in_progress', 'completed')),
  percent_watched   numeric(5,2),
  last_position_s   int,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  time_spent_s      int not null default 0,
  unique (enrollment_id, lesson_id),
  foreign key (organization_id, enrollment_id) references public.program_enrollments(organization_id, id) on delete cascade,
  foreign key (organization_id, lesson_id) references public.lessons(organization_id, id) on delete cascade
);
create index lesson_progress_user_idx on public.lesson_progress (user_id);
select private.standardize('lesson_progress', 'enrollments', false, false, 'custom', false);

create table public.module_progress (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  enrollment_id      uuid not null,
  module_id          uuid not null,
  user_id            uuid not null references public.users(id) on delete cascade,
  lessons_completed  int not null default 0,
  lessons_total      int not null default 0,
  progress_percent   numeric(5,2) not null default 0,
  completed_at       timestamptz,
  unique (enrollment_id, module_id),
  foreign key (organization_id, enrollment_id) references public.program_enrollments(organization_id, id) on delete cascade,
  foreign key (organization_id, module_id) references public.modules(organization_id, id) on delete cascade
);
select private.standardize('module_progress', 'enrollments', false, false, 'custom', false);

-- Early access granted by a coach or an automation ("unlock lesson" action).
create table public.lesson_unlocks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lesson_id        uuid not null,
  user_id          uuid not null references public.users(id) on delete cascade,
  reason           text,
  source           text not null default 'manual' check (source in ('manual', 'automation')),
  expires_at       timestamptz,
  unique (lesson_id, user_id),
  foreign key (organization_id, lesson_id) references public.lessons(organization_id, id) on delete cascade
);
select private.standardize('lesson_unlocks', 'enrollments', false, true, 'custom');

-- ---------------------------------------------------------------------------
-- Assignments / submissions / feedback
-- ---------------------------------------------------------------------------
create table public.assignments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  program_id         uuid not null,
  lesson_id          uuid not null,
  title              text not null,
  instructions       text,
  submission_types   text[] not null default array['text'],   -- text, file, link
  requires_review    boolean not null default true,
  due_days_after_enrollment int,
  copied_from_id     uuid,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, lesson_id) references public.lessons(organization_id, id) on delete cascade
);
select private.standardize('assignments', 'programs', true, false, 'custom');

create table public.assignment_submissions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  assignment_id    uuid not null,
  enrollment_id    uuid not null,
  user_id          uuid not null references public.users(id) on delete cascade,
  attempt          int not null default 1,
  body             text,
  links            text[] not null default '{}',
  file_ids         uuid[] not null default '{}',
  status           text not null default 'submitted' check (status in ('draft', 'submitted', 'needs_revision', 'approved', 'rejected')),
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.users(id) on delete set null,
  grade            numeric(5,2),
  unique (assignment_id, user_id, attempt),
  foreign key (organization_id, assignment_id) references public.assignments(organization_id, id) on delete cascade,
  foreign key (organization_id, enrollment_id) references public.program_enrollments(organization_id, id) on delete cascade
);
create index assignment_submissions_review_idx on public.assignment_submissions (organization_id, status) where status = 'submitted';
select private.standardize('assignment_submissions', 'enrollments', false, true, 'custom');

create table public.assignment_feedback (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  submission_id    uuid not null,
  author_id        uuid not null references public.users(id) on delete cascade,
  body             text not null,
  file_id          uuid,
  foreign key (organization_id, submission_id) references public.assignment_submissions(organization_id, id) on delete cascade
);
select private.standardize('assignment_feedback', 'enrollments', false, false, 'custom');

-- ---------------------------------------------------------------------------
-- Quizzes (answer keys live in a separate staff-only table)
-- ---------------------------------------------------------------------------
create table public.quizzes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  program_id         uuid not null,
  lesson_id          uuid not null,
  title              text not null,
  pass_percent       numeric(5,2) not null default 70,
  max_attempts       int,
  shuffle_questions  boolean not null default false,
  copied_from_id     uuid,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, lesson_id) references public.lessons(organization_id, id) on delete cascade
);
select private.standardize('quizzes', 'programs', true, false, 'custom');

create table public.quiz_questions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid not null,
  quiz_id          uuid not null,
  position         int not null default 0,
  question_type    text not null check (question_type in ('single_choice', 'multiple_choice', 'true_false', 'short_answer')),
  prompt           text not null,
  options          jsonb not null default '[]'::jsonb,     -- [{id, label}]
  points           numeric(6,2) not null default 1,
  explanation      text,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, quiz_id) references public.quizzes(organization_id, id) on delete cascade
);
select private.standardize('quiz_questions', 'programs', false, false, 'custom');

create table public.quiz_answer_keys (
  question_id      uuid primary key references public.quiz_questions(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  correct          jsonb not null        -- ["optionId", ...] or {"text": "..."}
);
select private.standardize('quiz_answer_keys', 'programs');

create table public.quiz_attempts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  quiz_id          uuid not null,
  enrollment_id    uuid not null,
  user_id          uuid not null references public.users(id) on delete cascade,
  attempt          int not null,
  answers          jsonb not null default '{}'::jsonb,
  score_points     numeric(8,2),
  max_points       numeric(8,2),
  score_percent    numeric(5,2),
  passed           boolean,
  started_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  unique (quiz_id, user_id, attempt),
  foreign key (organization_id, quiz_id) references public.quizzes(organization_id, id) on delete cascade,
  foreign key (organization_id, enrollment_id) references public.program_enrollments(organization_id, id) on delete cascade
);
select private.standardize('quiz_attempts', 'enrollments', false, false, 'custom', false);

create table public.certificates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  enrollment_id      uuid not null unique,
  program_id         uuid not null,
  user_id            uuid not null references public.users(id) on delete cascade,
  certificate_number text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 12)),
  issued_at          timestamptz not null default now(),
  file_id            uuid,
  revoked_at         timestamptz,
  foreign key (organization_id, enrollment_id) references public.program_enrollments(organization_id, id) on delete cascade,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade
);
select private.standardize('certificates', 'enrollments', false, true, 'custom', false);

-- ---------------------------------------------------------------------------
-- LMS helper functions used by RLS and workflows
-- ---------------------------------------------------------------------------
create or replace function private.my_enrolled_program_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select e.program_id from public.program_enrollments e
  join public.programs p on p.id = e.program_id
  where e.user_id = private.effective_user_id()
    and e.status in ('active', 'completed')
    and (e.access_expires_at is null or e.access_expires_at > now())
    and p.status = 'published' and p.deleted_at is null
    and e.organization_id in (select private.orgs_with_access());
$$;

-- Availability of a lesson for a user: returns (is_available, unlocks_at, lock_reason).
create or replace function private.lesson_availability(p_lesson uuid, p_user uuid)
returns table (is_available boolean, unlocks_at timestamptz, lock_reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  l   public.lessons;
  m   public.modules;
  p   public.programs;
  e   public.program_enrollments;
  anchor timestamptz;
  t_mod timestamptz;
  t_les timestamptz;
  prev_id uuid;
begin
  select * into l from public.lessons where id = p_lesson and deleted_at is null;
  if l.id is null then return query select false, null::timestamptz, 'not_found'; return; end if;
  select * into m from public.modules where id = l.module_id;
  select * into p from public.programs where id = l.program_id;
  select * into e from public.program_enrollments where program_id = l.program_id and user_id = p_user;

  if e.id is null or e.status not in ('active', 'completed') then
    if l.is_preview then return query select true, null::timestamptz, null::text; return; end if;
    return query select false, null::timestamptz, 'not_enrolled'; return;
  end if;
  if e.access_expires_at is not null and e.access_expires_at <= now() then
    return query select false, null::timestamptz, 'access_expired'; return;
  end if;
  if l.status <> 'published' then
    return query select false, null::timestamptz, 'draft'; return;
  end if;

  -- explicit unlock bypasses drip and sequence rules
  if exists (select 1 from public.lesson_unlocks u where u.lesson_id = l.id and u.user_id = p_user
             and (u.expires_at is null or u.expires_at > now())) then
    return query select true, null::timestamptz, null::text; return;
  end if;

  anchor := e.starts_at;
  t_mod := case m.drip_type when 'days_after_enrollment' then anchor + make_interval(days => m.drip_days)
                            when 'fixed_date' then m.drip_date end;
  t_les := case l.drip_type when 'days_after_enrollment' then anchor + make_interval(days => l.drip_days)
                            when 'fixed_date' then l.drip_date end;
  if greatest(t_mod, t_les) > now() then
    return query select false, greatest(t_mod, t_les), 'drip_locked'; return;
  end if;

  if l.requires_previous_completion or p.is_sequential then
    -- previous published lesson in program order (section → module → lesson)
    select x.id into prev_id
    from (
      select ls.id,
             row_number() over (order by s.position, s.id, md.position, md.id, ls.position, ls.id) as rn,
             lead(ls.id) over (order by s.position, s.id, md.position, md.id, ls.position, ls.id) as next_id
      from public.lessons ls
      join public.modules md on md.id = ls.module_id and md.deleted_at is null
      join public.program_sections s on s.id = md.section_id and s.deleted_at is null
      where ls.program_id = l.program_id and ls.deleted_at is null and ls.status = 'published'
    ) x
    where x.next_id = l.id;

    if prev_id is not null and not exists (
      select 1 from public.lesson_progress lp
      where lp.enrollment_id = e.id and lp.lesson_id = prev_id and lp.status = 'completed'
    ) then
      return query select false, null::timestamptz, 'previous_incomplete'; return;
    end if;
  end if;

  return query select true, null::timestamptz, null::text;
end;
$$;

create or replace function private.can_view_lesson_content(p_lesson uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select is_available from private.lesson_availability(p_lesson, private.effective_user_id()));
$$;
