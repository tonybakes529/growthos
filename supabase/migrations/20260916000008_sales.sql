-- =============================================================================
-- 0008 SALES SYSTEM
-- =============================================================================

create table public.pipelines (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  name               text not null,
  description        text,
  pipeline_type      text not null default 'sales' check (pipeline_type in ('sales', 'appointment_setting', 'partnership', 'recruiting', 'custom')),
  is_default         boolean not null default false,
  source_template_id uuid,
  copied_from_id     uuid
);
select private.standardize('pipelines', 'sales', true);

create table public.pipeline_stages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  pipeline_id      uuid not null,
  name             text not null,
  position         int not null default 0,
  stage_type       text not null default 'open' check (stage_type in ('open', 'booked', 'showed', 'won', 'lost')),
  probability      numeric(5,2),
  sla_hours        int,
  copied_from_id   uuid,
  foreign key (organization_id, pipeline_id) references public.pipelines(organization_id, id) on delete cascade
);
create index pipeline_stages_pipeline_idx on public.pipeline_stages (pipeline_id, position);
select private.standardize('pipeline_stages', 'sales');

create table public.attribution_sources (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  channel          text not null default 'other' check (channel in ('paid_ads', 'organic_social', 'youtube', 'email', 'referral', 'outbound', 'partner', 'event', 'seo', 'other')),
  platform         text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  is_active        boolean not null default true,
  unique (organization_id, name)
);
select private.standardize('attribution_sources', 'sales');

create table public.lost_reasons (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  label            text not null,
  category         text check (category in ('price', 'timing', 'fit', 'competitor', 'no_show', 'ghosted', 'other')),
  is_active        boolean not null default true,
  unique (organization_id, label)
);
select private.standardize('lost_reasons', 'sales');

create table public.setters (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  user_id                uuid references public.users(id) on delete set null,
  display_name           text not null,
  commission_type        text not null default 'percent' check (commission_type in ('percent', 'flat', 'none')),
  commission_rate        numeric(6,3),        -- percent of cash collected
  commission_flat_cents  bigint,
  is_active              boolean not null default true
);
select private.standardize('setters', 'sales');

create table public.closers (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  user_id                uuid references public.users(id) on delete set null,
  display_name           text not null,
  commission_type        text not null default 'percent' check (commission_type in ('percent', 'flat', 'none')),
  commission_rate        numeric(6,3),
  commission_flat_cents  bigint,
  is_active              boolean not null default true
);
select private.standardize('closers', 'sales');

create table public.leads (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  contact_id             uuid not null,
  attribution_source_id  uuid,
  lead_magnet_id         uuid,                  -- FK in 0009
  status                 text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'nurture')),
  score                  int,
  setter_id              uuid,
  first_touch_at         timestamptz not null default now(),
  qualified_at           timestamptz,
  utm                    jsonb not null default '{}'::jsonb,
  inbound                boolean not null default true,
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade,
  foreign key (organization_id, attribution_source_id) references public.attribution_sources(organization_id, id) on delete set null (attribution_source_id),
  foreign key (organization_id, setter_id) references public.setters(organization_id, id) on delete set null (setter_id)
);
create index leads_org_created_idx on public.leads (organization_id, first_touch_at desc);
select private.standardize('leads', 'sales', true, false);

create table public.opportunities (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  pipeline_id            uuid not null,
  stage_id               uuid not null,
  lead_id                uuid,
  contact_id             uuid not null,
  offer_id               uuid,
  title                  text not null,
  status                 text not null default 'open' check (status in ('open', 'won', 'lost')),
  value_cents            bigint not null default 0,
  cash_collected_cents   bigint not null default 0,
  currency               char(3) not null default 'USD',
  setter_id              uuid,
  closer_id              uuid,
  owner_id               uuid references public.users(id) on delete set null,
  attribution_source_id  uuid,
  lost_reason_id         uuid,
  lost_notes             text,
  expected_close_on      date,
  stage_entered_at       timestamptz not null default now(),
  closed_at              timestamptz,
  purchase_id            uuid,
  foreign key (organization_id, pipeline_id) references public.pipelines(organization_id, id) on delete cascade,
  foreign key (organization_id, stage_id) references public.pipeline_stages(organization_id, id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete set null (lead_id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade,
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete set null (offer_id),
  foreign key (organization_id, setter_id) references public.setters(organization_id, id) on delete set null (setter_id),
  foreign key (organization_id, closer_id) references public.closers(organization_id, id) on delete set null (closer_id),
  foreign key (organization_id, attribution_source_id) references public.attribution_sources(organization_id, id) on delete set null (attribution_source_id),
  foreign key (organization_id, lost_reason_id) references public.lost_reasons(organization_id, id) on delete set null (lost_reason_id),
  foreign key (organization_id, purchase_id) references public.purchases(organization_id, id) on delete set null (purchase_id),
  check (status <> 'lost' or closed_at is not null),
  check (status <> 'won' or closed_at is not null)
);
create index opportunities_org_status_idx on public.opportunities (organization_id, status, closed_at);
select private.standardize('opportunities', 'sales', true, true);

-- purchases ↔ sales attribution (declared here because sales tables now exist)
alter table public.purchases
  add constraint purchases_setter_fk foreign key (organization_id, setter_id) references public.setters(organization_id, id) on delete set null (setter_id),
  add constraint purchases_closer_fk foreign key (organization_id, closer_id) references public.closers(organization_id, id) on delete set null (closer_id),
  add constraint purchases_opportunity_fk foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete set null (opportunity_id),
  add constraint purchases_attribution_fk foreign key (organization_id, attribution_source_id) references public.attribution_sources(organization_id, id) on delete set null (attribution_source_id);

create table public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  opportunity_id      uuid,
  contact_id          uuid not null,
  appointment_type    text not null default 'sales_call' check (appointment_type in ('discovery', 'sales_call', 'follow_up', 'onboarding', 'other')),
  scheduled_start     timestamptz not null,
  scheduled_end       timestamptz,
  status              text not null default 'booked' check (status in ('booked', 'confirmed', 'showed', 'no_show', 'canceled', 'rescheduled')),
  setter_id           uuid,
  closer_id           uuid,
  booked_at           timestamptz not null default now(),
  booking_source      text,               -- calendly, ghl, manual
  external_event_id   text,
  foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete set null (opportunity_id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade,
  foreign key (organization_id, setter_id) references public.setters(organization_id, id) on delete set null (setter_id),
  foreign key (organization_id, closer_id) references public.closers(organization_id, id) on delete set null (closer_id)
);
create index appointments_org_start_idx on public.appointments (organization_id, scheduled_start);
select private.standardize('appointments', 'sales', true);

create table public.sales_calls (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  appointment_id      uuid,
  opportunity_id      uuid,
  closer_id           uuid,
  occurred_at         timestamptz not null,
  duration_minutes    int,
  outcome             text not null check (outcome in ('closed', 'follow_up', 'not_qualified', 'lost', 'no_show', 'deposit')),
  offer_pitched_id    uuid,
  amount_cents        bigint,
  recording_file_id   uuid,
  recording_url       text,
  call_score          int check (call_score between 1 and 10),
  foreign key (organization_id, appointment_id) references public.appointments(organization_id, id) on delete set null (appointment_id),
  foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete set null (opportunity_id),
  foreign key (organization_id, closer_id) references public.closers(organization_id, id) on delete set null (closer_id),
  foreign key (organization_id, offer_pitched_id) references public.offers(organization_id, id) on delete set null (offer_pitched_id),
  foreign key (organization_id, recording_file_id) references public.files(organization_id, id) on delete set null (recording_file_id)
);
select private.standardize('sales_calls', 'sales', true);

create table public.sales_notes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  opportunity_id      uuid,
  sales_call_id       uuid,
  author_id           uuid references public.users(id) on delete set null,
  note_type           text not null default 'general' check (note_type in ('general', 'objection', 'pain', 'budget', 'decision_maker', 'next_step')),
  body                text not null,
  foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete cascade,
  foreign key (organization_id, sales_call_id) references public.sales_calls(organization_id, id) on delete cascade
);
select private.standardize('sales_notes', 'sales', true);

create table public.follow_up_tasks (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  opportunity_id      uuid,
  contact_id          uuid,
  task_id             uuid,                -- mirrored into the org task system
  channel             text not null default 'call' check (channel in ('call', 'sms', 'email', 'dm', 'other')),
  due_at              timestamptz not null,
  status              text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  assigned_to         uuid references public.users(id) on delete set null,
  outcome             text,
  completed_at        timestamptz,
  foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id) references public.tasks(organization_id, id) on delete set null (task_id)
);
create index follow_up_tasks_due_idx on public.follow_up_tasks (organization_id, due_at) where status = 'pending';
select private.standardize('follow_up_tasks', 'sales');

create table public.commissions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  opportunity_id      uuid,
  payment_record_id   uuid,
  setter_id           uuid,
  closer_id           uuid,
  basis_cents         bigint not null,
  rate                numeric(6,3),
  amount_cents        bigint not null,
  status              text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'clawed_back', 'void')),
  earned_on           date not null default current_date,
  paid_at             timestamptz,
  check ((setter_id is null) <> (closer_id is null)),
  foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete set null (opportunity_id),
  foreign key (organization_id, payment_record_id) references public.payment_records(organization_id, id) on delete set null (payment_record_id),
  foreign key (organization_id, setter_id) references public.setters(organization_id, id) on delete cascade,
  foreign key (organization_id, closer_id) references public.closers(organization_id, id) on delete cascade
);
select private.standardize('commissions', 'billing', false, true);

-- Needed for CPL, cost per appointment, CAC and ROAS.
create table public.marketing_spend (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  attribution_source_id  uuid,
  spend_date             date not null,
  channel                text not null default 'paid_ads',
  campaign               text,
  amount_cents           bigint not null check (amount_cents >= 0),
  currency               char(3) not null default 'USD',
  impressions            bigint,
  clicks                 bigint,
  source                 text not null default 'manual',
  foreign key (organization_id, attribution_source_id) references public.attribution_sources(organization_id, id) on delete set null (attribution_source_id)
);
create index marketing_spend_org_date_idx on public.marketing_spend (organization_id, spend_date);
-- spend is financial data: readable only with financials.read (custom policy in 0013)
select private.standardize('marketing_spend', 'sales', false, true, 'custom');
