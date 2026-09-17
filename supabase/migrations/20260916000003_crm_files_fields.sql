-- =============================================================================
-- 0003 CLIENT PROFILES, CONTACTS, NOTES, FILES, CUSTOM FIELDS
-- =============================================================================

-- Entity types that polymorphic tables may point at.
create or replace function private.valid_entity_type(t text)
returns boolean language sql immutable as $$
  select t = any (array[
    'organization', 'user', 'contact', 'lead', 'opportunity', 'program', 'module', 'lesson',
    'assignment', 'assignment_submission', 'coaching_session', 'goal', 'quarterly_goal', 'kpi_definition',
    'task', 'experiment', 'growth_project', 'sop', 'meeting', 'content_item', 'offer', 'purchase',
    'discussion', 'announcement', 'milestone', 'resource', 'call_recording', 'client_win', 'client_blocker'
  ]);
$$;

-- One row per client org: commercial + relationship facts the control plane needs.
create table public.client_profiles (
  organization_id                uuid primary key references public.organizations(id) on delete cascade,
  legal_name                     text,
  industry                       text,
  business_model                 text,
  primary_contact_user_id        uuid references public.users(id) on delete set null,
  account_manager_id             uuid references public.users(id) on delete set null,
  primary_coach_id               uuid references public.users(id) on delete set null,
  start_date                     date,
  renewal_date                   date,
  contract_term_months           int,
  contract_value_cents           bigint,
  mrr_cents                      bigint,                -- what the client pays you
  current_monthly_revenue_cents  bigint,                -- the client's own business revenue
  revenue_target_cents           bigint,
  team_size                      int,
  onboarding_template_id         uuid,                  -- FK added in 0011
  onboarding_completed_at        timestamptz,
  last_client_login_at           timestamptz,
  last_kpi_update_at             timestamptz,
  last_interaction_at            timestamptz,
  tags                           text[] not null default '{}',
  baseline                       jsonb not null default '{}'::jsonb    -- questionnaire snapshot
);
-- Internal account notes live in public.notes (entity_type 'organization', visibility 'staff').
create index client_profiles_renewal_idx on public.client_profiles (renewal_date);
create index client_profiles_tags_idx on public.client_profiles using gin (tags);
select private.standardize('client_profiles', 'organization', false, true, 'custom');

create table public.tags (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  color            text,
  category         text not null default 'contact',
  unique (organization_id, category, name)
);
select private.standardize('tags', 'contacts');

create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid references public.users(id) on delete set null,   -- if the contact has a login
  first_name       text,
  last_name        text,
  email            extensions.citext,
  phone            text,
  company          text,
  lifecycle_stage  text not null default 'lead'
                   check (lifecycle_stage in ('subscriber', 'lead', 'prospect', 'customer', 'student', 'churned', 'other')),
  source           text,
  owner_id         uuid references public.users(id) on delete set null,
  address          jsonb not null default '{}'::jsonb,
  social           jsonb not null default '{}'::jsonb,
  last_contacted_at timestamptz,
  metadata         jsonb not null default '{}'::jsonb
);
select private.standardize('contacts', 'contacts', true, true);
create unique index contacts_org_email_key on public.contacts (organization_id, email) where email is not null and deleted_at is null;

create table public.contact_tags (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  contact_id       uuid not null,
  tag_id           uuid not null,
  primary key (contact_id, tag_id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade,
  foreign key (organization_id, tag_id) references public.tags(organization_id, id) on delete cascade
);
select private.standardize('contact_tags', 'contacts');

create table public.notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  entity_type      text not null check (private.valid_entity_type(entity_type)),
  entity_id        uuid not null,
  body             text not null,
  visibility       text not null default 'organization'
                   check (visibility in ('organization', 'staff', 'private')),
  is_pinned        boolean not null default false
);
create index notes_entity_idx on public.notes (entity_type, entity_id);
select private.standardize('notes', 'notes', true, false, 'custom');

-- Every stored object. Storage path convention: {organization_id}/{file_id}/{file_name}
create table public.files (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  bucket             text not null default 'org-files',
  storage_path       text not null unique,
  file_name          text not null,
  mime_type          text,
  size_bytes         bigint,
  kind               text not null default 'document'
                     check (kind in ('video', 'audio', 'document', 'worksheet', 'pdf', 'image',
                                     'call_recording', 'lesson_attachment', 'assignment_upload', 'avatar', 'other')),
  visibility         text not null default 'organization'
                     check (visibility in ('organization', 'managers', 'private', 'linked')),
  entity_type        text check (entity_type is null or private.valid_entity_type(entity_type)),
  entity_id          uuid,
  upload_status      text not null default 'pending' check (upload_status in ('pending', 'uploaded', 'processing', 'ready', 'failed')),
  checksum_sha256    text,
  duration_seconds   int,
  external_url       text,       -- e.g. Mux / Vimeo / YouTube for hosted video
  metadata           jsonb not null default '{}'::jsonb,
  check (storage_path like organization_id::text || '/%')
);
create index files_entity_idx on public.files (entity_type, entity_id);
select private.standardize('files', 'files', true, true, 'custom');

create table public.custom_fields (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  entity_type      text not null check (private.valid_entity_type(entity_type)),
  key              text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label            text not null,
  field_type       text not null check (field_type in ('text', 'long_text', 'number', 'currency', 'date', 'boolean', 'select', 'multi_select', 'url', 'email', 'phone', 'user')),
  options          jsonb not null default '[]'::jsonb,
  is_required      boolean not null default false,
  position         int not null default 0,
  is_archived      boolean not null default false,
  unique (organization_id, entity_type, key)
);
select private.standardize('custom_fields', 'custom_fields');

create table public.custom_field_values (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  custom_field_id  uuid not null,
  entity_id        uuid not null,
  value            jsonb,
  unique (custom_field_id, entity_id),
  foreign key (organization_id, custom_field_id) references public.custom_fields(organization_id, id) on delete cascade
);
create index custom_field_values_entity_idx on public.custom_field_values (entity_id);
-- values are business data of the underlying entity; contact editors may write them
select private.standardize('custom_field_values', 'contacts');
