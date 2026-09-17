-- =============================================================================
-- 0004 OFFERS, PRICING, PURCHASES, SUBSCRIPTIONS, PAYMENTS (Stripe-ready)
-- Money is integer cents + ISO currency.
-- =============================================================================

create table public.offers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  slug                text not null,
  description         text,
  offer_type          text not null default 'program'
                      check (offer_type in ('program', 'coaching', 'mastermind', 'done_for_you', 'community', 'bundle', 'lead_magnet', 'other')),
  status              text not null default 'draft' check (status in ('draft', 'active', 'paused', 'retired')),
  current_version_id  uuid,                       -- FK added below
  stripe_product_id   text,
  source_template_id  uuid,
  copied_from_id      uuid,
  unique (organization_id, slug)
);
select private.standardize('offers', 'offers', true, true);

create table public.offer_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  offer_id         uuid not null,
  version          int not null,
  headline         text,
  promise          text,
  deliverables     jsonb not null default '[]'::jsonb,
  guarantee        text,
  terms            text,
  published_at     timestamptz,
  unique (offer_id, version),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade
);
select private.standardize('offer_versions', 'offers');
alter table public.offers add constraint offers_current_version_fk
  foreign key (organization_id, current_version_id) references public.offer_versions(organization_id, id)
  on delete set null (current_version_id) deferrable initially deferred;

create table public.pricing_options (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  offer_id              uuid not null,
  offer_version_id      uuid,
  name                  text not null,
  pricing_type          text not null check (pricing_type in ('one_time', 'payment_plan', 'subscription', 'free')),
  currency              char(3) not null default 'USD',
  amount_cents          bigint not null default 0 check (amount_cents >= 0),   -- per charge
  installment_count     int check (installment_count is null or installment_count > 1),
  installment_interval  text check (installment_interval in ('week', 'month')),
  billing_interval      text check (billing_interval in ('week', 'month', 'quarter', 'year')),
  trial_days            int not null default 0,
  setup_fee_cents       bigint not null default 0,
  available_from        timestamptz,
  available_until       timestamptz,          -- limited-time offers
  max_purchases         int,
  is_active             boolean not null default true,
  stripe_price_id       text,
  check (pricing_type <> 'payment_plan' or (installment_count is not null and installment_interval is not null)),
  check (pricing_type <> 'subscription' or billing_interval is not null),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade,
  foreign key (organization_id, offer_version_id) references public.offer_versions(organization_id, id) on delete set null (offer_version_id)
);
select private.standardize('pricing_options', 'offers', true, true);

-- Offer → program unlocks (many-to-many). Program FK is added in 0005.
create table public.offer_entitlements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  offer_id          uuid not null,
  entitlement_type  text not null default 'program' check (entitlement_type in ('program', 'community', 'coaching', 'resource')),
  program_id        uuid,
  access_days       int,          -- null = lifetime
  unique (offer_id, program_id),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade
);
select private.standardize('offer_entitlements', 'offers');

create table public.coupons (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  code                extensions.citext not null,
  discount_type       text not null check (discount_type in ('percent', 'amount')),
  percent_off         numeric(5,2) check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  amount_off_cents    bigint,
  currency            char(3),
  duration            text not null default 'once' check (duration in ('once', 'repeating', 'forever')),
  duration_months     int,
  applies_to_offer_ids uuid[],
  max_redemptions     int,
  redemption_count    int not null default 0,
  starts_at           timestamptz,
  expires_at          timestamptz,
  is_active           boolean not null default true,
  stripe_coupon_id    text,
  unique (organization_id, code),
  check ((discount_type = 'percent' and percent_off is not null) or (discount_type = 'amount' and amount_off_cents is not null))
);
select private.standardize('coupons', 'billing', true, true);

create table public.order_forms (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  offer_id            uuid not null,
  slug                text not null,
  title               text not null,
  pricing_option_ids  uuid[] not null default '{}',
  bump_offer_id       uuid,
  fields              jsonb not null default '[]'::jsonb,
  success_url         text,
  status              text not null default 'draft' check (status in ('draft', 'live', 'closed')),
  unique (organization_id, slug),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade
);
select private.standardize('order_forms', 'offers', true);

create table public.billing_customers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  contact_id          uuid,
  user_id             uuid references public.users(id) on delete set null,
  stripe_customer_id  text unique,
  email               extensions.citext,
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete set null (contact_id)
);
select private.standardize('billing_customers', 'billing');

create table public.purchases (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  offer_id             uuid not null,
  pricing_option_id    uuid,
  order_form_id        uuid,
  coupon_id            uuid,
  contact_id           uuid,
  user_id              uuid references public.users(id) on delete set null,
  billing_customer_id  uuid,
  status               text not null default 'pending'
                       check (status in ('pending', 'active', 'completed', 'past_due', 'refunded', 'canceled', 'failed')),
  currency             char(3) not null default 'USD',
  list_amount_cents    bigint not null default 0,
  discount_cents       bigint not null default 0,
  total_amount_cents   bigint not null default 0,     -- contract value
  amount_paid_cents    bigint not null default 0,
  setter_id            uuid,                          -- FKs added in 0008
  closer_id            uuid,
  opportunity_id       uuid,
  attribution_source_id uuid,
  purchased_at         timestamptz not null default now(),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  metadata             jsonb not null default '{}'::jsonb,
  foreign key (organization_id, offer_id) references public.offers(organization_id, id),
  foreign key (organization_id, pricing_option_id) references public.pricing_options(organization_id, id),
  foreign key (organization_id, order_form_id) references public.order_forms(organization_id, id) on delete set null (order_form_id),
  foreign key (organization_id, coupon_id) references public.coupons(organization_id, id) on delete set null (coupon_id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, billing_customer_id) references public.billing_customers(organization_id, id) on delete set null (billing_customer_id)
);
create index purchases_org_date_idx on public.purchases (organization_id, purchased_at desc);
create index purchases_user_idx on public.purchases (user_id);
select private.standardize('purchases', 'billing', true, true, 'custom');

create table public.coupon_redemptions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  coupon_id        uuid not null,
  purchase_id      uuid not null,
  discount_cents   bigint not null,
  foreign key (organization_id, coupon_id) references public.coupons(organization_id, id) on delete cascade,
  foreign key (organization_id, purchase_id) references public.purchases(organization_id, id) on delete cascade
);
select private.standardize('coupon_redemptions', 'billing');

create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  purchase_id            uuid not null,
  user_id                uuid references public.users(id) on delete set null,
  status                 text not null check (status in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'incomplete', 'completed')),
  kind                   text not null check (kind in ('subscription', 'payment_plan')),
  amount_cents           bigint not null,
  currency               char(3) not null default 'USD',
  interval               text not null,
  installments_total     int,
  installments_paid      int not null default 0,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  stripe_subscription_id text unique,
  foreign key (organization_id, purchase_id) references public.purchases(organization_id, id) on delete cascade
);
select private.standardize('subscriptions', 'billing', false, true, 'custom');

create table public.payment_records (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  purchase_id            uuid,
  subscription_id        uuid,
  user_id                uuid references public.users(id) on delete set null,
  status                 text not null check (status in ('succeeded', 'pending', 'failed', 'refunded', 'partially_refunded', 'disputed')),
  amount_cents           bigint not null,
  refunded_cents         bigint not null default 0,
  fee_cents              bigint,
  currency               char(3) not null default 'USD',
  paid_at                timestamptz,
  failure_reason         text,
  method                 text,              -- card, ach, wire, cash, manual
  stripe_invoice_id      text,
  stripe_charge_id       text unique,
  foreign key (organization_id, purchase_id) references public.purchases(organization_id, id) on delete set null (purchase_id),
  foreign key (organization_id, subscription_id) references public.subscriptions(organization_id, id) on delete set null (subscription_id)
);
create index payment_records_org_paid_idx on public.payment_records (organization_id, paid_at desc);
select private.standardize('payment_records', 'billing', false, true, 'custom');

-- Manual grant of an offer (comp access, partner deal, migration from another platform).
create table public.offer_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  offer_id         uuid not null,
  user_id          uuid references public.users(id) on delete cascade,
  contact_id       uuid,
  reason           text,
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz,
  status           text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  check (user_id is not null or contact_id is not null),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade
);
select private.standardize('offer_assignments', 'offers', false, true);

-- Stripe webhook idempotency (platform-level; service role only).
create table public.stripe_events (
  id               text primary key,           -- Stripe event id
  type             text not null,
  organization_id  uuid references public.organizations(id) on delete set null,
  payload          jsonb not null,
  processed_at     timestamptz,
  error            text,
  received_at      timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
insert into private.rls_registry (table_name, module, org_scoped, policy_mode) values ('stripe_events', 'billing', false, 'service_only');
