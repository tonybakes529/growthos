-- =============================================================================
-- 0010 COMMUNITY, MESSAGING, NOTIFICATIONS, EMAIL
-- =============================================================================

create table public.announcements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid,                    -- null = whole workspace
  title            text not null,
  body             text not null,
  author_id        uuid references public.users(id) on delete set null,
  is_pinned        boolean not null default false,
  publish_at       timestamptz not null default now(),
  expires_at       timestamptz,
  send_email       boolean not null default false,
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade
);
select private.standardize('announcements', 'community', true, false, 'custom');

create table public.discussions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid,
  lesson_id        uuid,
  channel          text not null default 'general',
  title            text not null,
  body             text not null,
  author_id        uuid not null references public.users(id) on delete cascade,
  is_pinned        boolean not null default false,
  is_locked        boolean not null default false,
  is_hidden        boolean not null default false,
  comment_count    int not null default 0,
  last_activity_at timestamptz not null default now(),
  foreign key (organization_id, program_id) references public.programs(organization_id, id) on delete cascade,
  foreign key (organization_id, lesson_id) references public.lessons(organization_id, id) on delete cascade
);
create index discussions_org_activity_idx on public.discussions (organization_id, last_activity_at desc);
select private.standardize('discussions', 'community', true, false, 'custom');

create table public.discussion_comments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  discussion_id      uuid not null,
  parent_comment_id  uuid,
  author_id          uuid not null references public.users(id) on delete cascade,
  body               text not null,
  is_hidden          boolean not null default false,
  foreign key (organization_id, discussion_id) references public.discussions(organization_id, id) on delete cascade
);
select private.standardize('discussion_comments', 'community', true, false, 'custom');
alter table public.discussion_comments add constraint discussion_comments_parent_fk
  foreign key (organization_id, parent_comment_id) references public.discussion_comments(organization_id, id) on delete cascade;

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  subject          text,
  kind             text not null default 'direct' check (kind in ('direct', 'group', 'support')),
  last_message_at  timestamptz
);
select private.standardize('conversations', 'messages', false, false, 'custom');

create table public.conversation_participants (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  conversation_id  uuid not null,
  user_id          uuid not null references public.users(id) on delete cascade,
  last_read_at     timestamptz,
  is_muted         boolean not null default false,
  primary key (conversation_id, user_id),
  foreign key (organization_id, conversation_id) references public.conversations(organization_id, id) on delete cascade
);
create index conversation_participants_user_idx on public.conversation_participants (user_id);
select private.standardize('conversation_participants', 'messages', false, false, 'custom', false);

create table public.direct_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  conversation_id  uuid not null,
  sender_id        uuid not null references public.users(id) on delete cascade,
  body             text not null,
  file_ids         uuid[] not null default '{}',
  edited_at        timestamptz,
  foreign key (organization_id, conversation_id) references public.conversations(organization_id, id) on delete cascade
);
select private.standardize('direct_messages', 'messages', true, false, 'custom', false);
create index direct_messages_conv_idx on public.direct_messages (conversation_id, created_at);

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  notification_type text not null,           -- 'lesson.unlocked', 'task.assigned', ...
  title            text not null,
  body             text,
  link_path        text,
  entity_type      text,
  entity_id        uuid,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
alter table public.notifications enable row level security;
insert into private.rls_registry (table_name, module, org_scoped, policy_mode) values ('notifications', 'messages', true, 'custom');

create table public.notification_preferences (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  organization_id    uuid references public.organizations(id) on delete cascade,   -- null = global default
  notification_type  text not null,       -- '*' for all
  in_app             boolean not null default true,
  email              boolean not null default true,
  sms                boolean not null default false,
  digest             text not null default 'instant' check (digest in ('instant', 'daily', 'weekly', 'off')),
  unique nulls not distinct (user_id, organization_id, notification_type)
);
select private.standardize('notification_preferences', 'messages', false, false, 'custom', false);

-- organization_id null = platform default template (overridable per org by key)
create table public.email_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete cascade,
  key              text not null,          -- 'invitation', 'lesson_unlocked', 'payment_failed'
  name             text not null,
  subject          text not null,
  body_html        text not null,
  body_text        text,
  variables        text[] not null default '{}',
  is_active        boolean not null default true,
  unique nulls not distinct (organization_id, key)
);
select private.standardize('email_templates', 'organization', false, false, 'custom');

-- Transactional outbox drained by a worker (service role only).
create table public.email_outbox (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations(id) on delete cascade,
  template_key     text not null,
  to_email         extensions.citext not null,
  to_user_id       uuid references public.users(id) on delete set null,
  variables        jsonb not null default '{}'::jsonb,
  status           text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  attempts         int not null default 0,
  provider_message_id text,
  last_error       text,
  send_after       timestamptz not null default now(),
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index email_outbox_queue_idx on public.email_outbox (send_after) where status = 'queued';
alter table public.email_outbox enable row level security;
insert into private.rls_registry (table_name, module, org_scoped, policy_mode) values ('email_outbox', 'messages', true, 'service_only');

create or replace function private.my_conversation_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select conversation_id from public.conversation_participants where user_id = private.effective_user_id();
$$;

-- Notification + email helpers (respect preferences).
create or replace function private.notify(p_org uuid, p_user uuid, p_type text, p_title text,
                                          p_body text default null, p_link text default null,
                                          p_entity_type text default null, p_entity_id uuid default null,
                                          p_email_template text default null, p_vars jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare pref public.notification_preferences;
begin
  select * into pref from public.notification_preferences
  where user_id = p_user
    and (organization_id = p_org or organization_id is null)
    and notification_type in (p_type, '*')
  order by (organization_id is null), (notification_type = '*')
  limit 1;

  if coalesce(pref.in_app, true) then
    insert into public.notifications (organization_id, user_id, notification_type, title, body, link_path, entity_type, entity_id)
    values (p_org, p_user, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id);
  end if;

  if p_email_template is not null and coalesce(pref.email, true) and coalesce(pref.digest, 'instant') = 'instant' then
    insert into public.email_outbox (organization_id, template_key, to_email, to_user_id, variables)
    select p_org, p_email_template, u.email, u.id, coalesce(p_vars, '{}') || jsonb_build_object('title', p_title, 'link_path', p_link)
    from public.users u where u.id = p_user;
  end if;
end;
$$;
