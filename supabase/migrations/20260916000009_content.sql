-- =============================================================================
-- 0009 CONTENT SYSTEM
-- idea → content item (script, tasks) → publishing dates per platform
--      → published links → metrics snapshots
-- =============================================================================

create table public.content_platforms (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  platform         text not null check (platform in ('youtube', 'youtube_shorts', 'instagram', 'tiktok', 'linkedin', 'x', 'facebook', 'podcast', 'newsletter', 'blog', 'other')),
  handle           text,
  profile_url      text,
  is_active        boolean not null default true,
  connection_id    text,           -- integration reference (e.g. Metricool, YouTube API)
  unique (organization_id, platform, handle)
);
select private.standardize('content_platforms', 'content');

create table public.content_statuses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  position         int not null default 0,
  category         text not null default 'in_progress' check (category in ('backlog', 'in_progress', 'review', 'scheduled', 'published', 'archived')),
  color            text,
  unique (organization_id, name)
);
select private.standardize('content_statuses', 'content');

create table public.calls_to_action (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  label            text not null,
  cta_type         text not null default 'link' check (cta_type in ('link', 'lead_magnet', 'book_call', 'comment_keyword', 'dm_keyword', 'purchase')),
  url              text,
  keyword          text,
  offer_id         uuid,
  lead_magnet_id   uuid,
  is_active        boolean not null default true,
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete set null (offer_id)
);
select private.standardize('calls_to_action', 'content');

create table public.lead_magnets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  magnet_type      text not null default 'pdf' check (magnet_type in ('pdf', 'video', 'checklist', 'template', 'quiz', 'webinar', 'mini_course', 'other')),
  description      text,
  file_id          uuid,
  landing_url      text,
  offer_id         uuid,
  is_active        boolean not null default true,
  foreign key (organization_id, file_id) references public.files(organization_id, id) on delete set null (file_id),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete set null (offer_id)
);
select private.standardize('lead_magnets', 'content', true);

alter table public.calls_to_action add constraint cta_lead_magnet_fk
  foreign key (organization_id, lead_magnet_id) references public.lead_magnets(organization_id, id) on delete set null (lead_magnet_id);
alter table public.leads add constraint leads_lead_magnet_fk
  foreign key (organization_id, lead_magnet_id) references public.lead_magnets(organization_id, id) on delete set null (lead_magnet_id);

create table public.content_ideas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  angle            text,
  hook             text,
  pillar           text,
  source           text,
  target_platforms text[] not null default '{}',
  score            int check (score between 1 and 10),
  status           text not null default 'new' check (status in ('new', 'approved', 'rejected', 'converted')),
  submitted_by     uuid references public.users(id) on delete set null
);
select private.standardize('content_ideas', 'content', true);

create table public.content_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  idea_id            uuid,
  title              text not null,
  format             text not null default 'long_form_video' check (format in ('long_form_video', 'short_video', 'carousel', 'image', 'text_post', 'article', 'newsletter', 'podcast_episode', 'live', 'other')),
  status_id          uuid,
  pillar             text,
  owner_id           uuid references public.users(id) on delete set null,
  editor_id          uuid references public.users(id) on delete set null,
  cta_id             uuid,
  lead_magnet_id     uuid,
  due_on             date,
  published_at       timestamptz,
  asset_file_ids     uuid[] not null default '{}',
  thumbnail_file_id  uuid,
  description        text,
  tags               text[] not null default '{}',
  foreign key (organization_id, idea_id) references public.content_ideas(organization_id, id) on delete set null (idea_id),
  foreign key (organization_id, status_id) references public.content_statuses(organization_id, id) on delete set null (status_id),
  foreign key (organization_id, cta_id) references public.calls_to_action(organization_id, id) on delete set null (cta_id),
  foreign key (organization_id, lead_magnet_id) references public.lead_magnets(organization_id, id) on delete set null (lead_magnet_id)
);
create index content_items_org_due_idx on public.content_items (organization_id, due_on);
select private.standardize('content_items', 'content', true);

create table public.scripts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  content_item_id  uuid not null,
  version          int not null default 1,
  title            text,
  hook             text,
  body             text not null,
  status           text not null default 'draft' check (status in ('draft', 'in_review', 'approved')),
  word_count       int,
  approved_by      uuid references public.users(id) on delete set null,
  approved_at      timestamptz,
  unique (content_item_id, version),
  foreign key (organization_id, content_item_id) references public.content_items(organization_id, id) on delete cascade
);
select private.standardize('scripts', 'content', true);

create table public.content_tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  content_item_id  uuid not null,
  task_id          uuid not null,
  stage            text not null check (stage in ('research', 'script', 'film', 'edit', 'thumbnail', 'review', 'publish', 'repurpose', 'other')),
  unique (content_item_id, task_id),
  foreign key (organization_id, content_item_id) references public.content_items(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete cascade
);
select private.standardize('content_tasks', 'content');

create table public.publishing_dates (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  content_item_id      uuid not null,
  content_platform_id  uuid not null,
  scheduled_for        timestamptz not null,
  status               text not null default 'scheduled' check (status in ('scheduled', 'published', 'failed', 'canceled')),
  external_post_id     text,
  foreign key (organization_id, content_item_id) references public.content_items(organization_id, id) on delete cascade,
  foreign key (organization_id, content_platform_id) references public.content_platforms(organization_id, id) on delete cascade
);
create index publishing_dates_org_sched_idx on public.publishing_dates (organization_id, scheduled_for);
select private.standardize('publishing_dates', 'content');

create table public.published_links (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  content_item_id      uuid not null,
  content_platform_id  uuid not null,
  url                  text not null,
  external_id          text,
  published_at         timestamptz not null,
  tracking_url         text,
  unique (content_platform_id, url),
  foreign key (organization_id, content_item_id) references public.content_items(organization_id, id) on delete cascade,
  foreign key (organization_id, content_platform_id) references public.content_platforms(organization_id, id) on delete cascade
);
create index published_links_org_pub_idx on public.published_links (organization_id, published_at desc);
select private.standardize('published_links', 'content');

-- Time series snapshots (append-only; latest per link = current numbers)
create table public.content_metrics (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  published_link_id    uuid not null,
  captured_at          timestamptz not null default now(),
  views                bigint,
  impressions          bigint,
  reach                bigint,
  likes                bigint,
  comments             bigint,
  shares               bigint,
  saves                bigint,
  link_clicks          bigint,
  watch_time_minutes   numeric,
  avg_view_duration_s  numeric,
  ctr_percent          numeric(6,3),
  subscribers_gained   bigint,
  inbound_conversations bigint,
  leads_generated      bigint,
  source               text not null default 'manual',
  raw                  jsonb not null default '{}'::jsonb,
  foreign key (organization_id, published_link_id) references public.published_links(organization_id, id) on delete cascade
);
create index content_metrics_link_idx on public.content_metrics (published_link_id, captured_at desc);
select private.standardize('content_metrics', 'content', false, false, 'standard', false);
