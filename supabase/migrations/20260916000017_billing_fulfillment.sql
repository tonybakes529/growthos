-- =============================================================================
-- 0017 BILLING FULFILLMENT (service role only)
-- Called by the Stripe webhook handler after signature verification.
-- Idempotent on the Stripe checkout session / invoice ids.
-- =============================================================================

create or replace function app.fulfill_purchase(
  p_organization_id    uuid,
  p_offer_id           uuid,
  p_pricing_option_id  uuid,
  p_email              text,
  p_amount_paid_cents  bigint,
  p_checkout_session   text,
  p_payment_intent     text default null,
  p_stripe_customer    text default null,
  p_stripe_subscription text default null,
  p_coupon_code        text default null,
  p_first_name         text default null,
  p_last_name          text default null,
  p_metadata           jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  po        public.pricing_options;
  existing  uuid;
  cid       uuid;
  bcid      uuid;
  uid       uuid;
  pid       uuid;
  sid       uuid;
  coupon    public.coupons;
  total     bigint;
  discount  bigint := 0;
  prog      uuid;
  enrolled  uuid[] := '{}';
  inv       jsonb;
  entitled  uuid[];
begin
  select id into existing from public.purchases where stripe_checkout_session_id = p_checkout_session;
  if existing is not null then
    return jsonb_build_object('purchase_id', existing, 'duplicate', true);
  end if;

  select * into po from public.pricing_options
  where id = p_pricing_option_id and offer_id = p_offer_id and organization_id = p_organization_id;
  if po.id is null then raise exception 'pricing option does not belong to this offer/workspace'; end if;

  total := case po.pricing_type
             when 'payment_plan' then po.amount_cents * po.installment_count
             else po.amount_cents end + po.setup_fee_cents;

  if p_coupon_code is not null then
    select * into coupon from public.coupons
    where organization_id = p_organization_id and code = p_coupon_code::extensions.citext and is_active
      and (expires_at is null or expires_at > now())
      and (max_redemptions is null or redemption_count < max_redemptions);
    if coupon.id is not null then
      discount := case coupon.discount_type when 'percent' then round(total * coupon.percent_off / 100)
                                            else least(coupon.amount_off_cents, total) end;
    end if;
  end if;

  -- contact + billing customer
  insert into public.contacts (organization_id, email, first_name, last_name, lifecycle_stage, source)
  values (p_organization_id, lower(p_email), p_first_name, p_last_name, 'customer', 'checkout')
  on conflict (organization_id, email) where email is not null and deleted_at is null
  do update set lifecycle_stage = 'customer'
  returning id into cid;

  select id into uid from public.users where email = p_email::extensions.citext;

  insert into public.billing_customers (organization_id, contact_id, user_id, stripe_customer_id, email)
  values (p_organization_id, cid, uid, p_stripe_customer, lower(p_email))
  on conflict (stripe_customer_id) do update set contact_id = excluded.contact_id, user_id = coalesce(excluded.user_id, public.billing_customers.user_id)
  returning id into bcid;

  insert into public.purchases (organization_id, offer_id, pricing_option_id, coupon_id, contact_id, user_id,
                                billing_customer_id, status, currency, list_amount_cents, discount_cents,
                                total_amount_cents, amount_paid_cents, stripe_checkout_session_id,
                                stripe_payment_intent_id, metadata)
  values (p_organization_id, p_offer_id, po.id, coupon.id, cid, uid, bcid,
          case when po.pricing_type in ('one_time', 'free') then 'completed' else 'active' end,
          po.currency, total, discount, total - discount, p_amount_paid_cents, p_checkout_session,
          p_payment_intent, coalesce(p_metadata, '{}'))
  returning id into pid;

  if po.pricing_type in ('subscription', 'payment_plan') then
    insert into public.subscriptions (organization_id, purchase_id, user_id, status, kind, amount_cents, currency,
                                      interval, installments_total, installments_paid,
                                      current_period_start, current_period_end, stripe_subscription_id)
    values (p_organization_id, pid, uid, 'active',
            case po.pricing_type when 'subscription' then 'subscription' else 'payment_plan' end,
            po.amount_cents, po.currency, coalesce(po.billing_interval, po.installment_interval),
            po.installment_count, 1, now(),
            now() + case coalesce(po.billing_interval, po.installment_interval)
                      when 'week' then interval '1 week' when 'quarter' then interval '3 months'
                      when 'year' then interval '1 year' else interval '1 month' end,
            p_stripe_subscription)
    returning id into sid;
  end if;

  insert into public.payment_records (organization_id, purchase_id, subscription_id, user_id, status, amount_cents, currency, paid_at, method)
  values (p_organization_id, pid, sid, uid, 'succeeded', p_amount_paid_cents, po.currency, now(), 'card');

  if coupon.id is not null then
    insert into public.coupon_redemptions (organization_id, coupon_id, purchase_id, discount_cents)
    values (p_organization_id, coupon.id, pid, discount);
    update public.coupons set redemption_count = redemption_count + 1 where id = coupon.id;
  end if;

  -- access: enroll existing members, otherwise invite as a student with the entitled programs
  select coalesce(array_agg(e.program_id), '{}') into entitled
  from public.offer_entitlements e where e.offer_id = p_offer_id and e.program_id is not null;

  if uid is not null and exists (select 1 from public.organization_memberships m
                                 where m.organization_id = p_organization_id and m.user_id = uid and m.status = 'active') then
    foreach prog in array entitled loop
      enrolled := enrolled || private.enroll(p_organization_id, prog, uid, 'purchase',
        (select access_days from public.offer_entitlements where offer_id = p_offer_id and program_id = prog), pid);
    end loop;
  elsif cardinality(entitled) > 0 then
    inv := private.create_invitation(p_organization_id, p_email, (private.role_by_key(null, 'student')).id,
             jsonb_build_object('program_ids', to_jsonb(entitled), 'purchase_id', pid));
  end if;

  perform private.emit_event(p_organization_id, 'payment.succeeded', 'purchase', pid,
                             jsonb_build_object('amount_cents', p_amount_paid_cents, 'offer_id', p_offer_id, 'email', lower(p_email)));
  return jsonb_build_object('purchase_id', pid, 'subscription_id', sid, 'enrollment_ids', to_jsonb(enrolled),
                            'invitation_id', inv->>'invitation_id', 'invitation_token', inv->>'token');
end;
$$;

-- Recurring charges, failures and cancellations for an existing subscription.
create or replace function app.record_subscription_event(
  p_stripe_subscription text,
  p_event               text,          -- 'payment_succeeded' | 'payment_failed' | 'canceled'
  p_amount_cents        bigint default null,
  p_stripe_invoice      text default null,
  p_failure_reason      text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions;
begin
  select * into s from public.subscriptions where stripe_subscription_id = p_stripe_subscription for update;
  if s.id is null then raise exception 'unknown subscription %', p_stripe_subscription; end if;
  if p_stripe_invoice is not null and exists (select 1 from public.payment_records where stripe_invoice_id = p_stripe_invoice
                                              and status = case p_event when 'payment_failed' then 'failed' else 'succeeded' end) then
    return;  -- idempotent
  end if;

  case p_event
  when 'payment_succeeded' then
    insert into public.payment_records (organization_id, purchase_id, subscription_id, user_id, status, amount_cents, currency, paid_at, stripe_invoice_id)
    values (s.organization_id, s.purchase_id, s.id, s.user_id, 'succeeded', coalesce(p_amount_cents, s.amount_cents), s.currency, now(), p_stripe_invoice);
    update public.subscriptions
       set status = case when kind = 'payment_plan' and installments_paid + 1 >= installments_total then 'completed' else 'active' end,
           installments_paid = installments_paid + 1,
           current_period_start = now()
     where id = s.id;
    update public.purchases set amount_paid_cents = amount_paid_cents + coalesce(p_amount_cents, s.amount_cents),
           status = case when s.kind = 'payment_plan' and s.installments_paid + 1 >= s.installments_total then 'completed' else 'active' end
     where id = s.purchase_id;
    perform private.emit_event(s.organization_id, 'payment.succeeded', 'purchase', s.purchase_id, jsonb_build_object('subscription_id', s.id));
  when 'payment_failed' then
    insert into public.payment_records (organization_id, purchase_id, subscription_id, user_id, status, amount_cents, currency, failure_reason, stripe_invoice_id)
    values (s.organization_id, s.purchase_id, s.id, s.user_id, 'failed', coalesce(p_amount_cents, s.amount_cents), s.currency, p_failure_reason, p_stripe_invoice);
    update public.subscriptions set status = 'past_due' where id = s.id;
    update public.purchases set status = 'past_due' where id = s.purchase_id;
    perform private.emit_event(s.organization_id, 'payment.failed', 'purchase', s.purchase_id,
                               jsonb_build_object('subscription_id', s.id, 'reason', p_failure_reason, 'user_id', s.user_id));
  when 'canceled' then
    update public.subscriptions set status = 'canceled', canceled_at = now() where id = s.id;
    update public.purchases set status = 'canceled' where id = s.purchase_id;
    perform private.emit_event(s.organization_id, 'subscription.canceled', 'purchase', s.purchase_id,
                               jsonb_build_object('subscription_id', s.id, 'user_id', s.user_id));
  else
    raise exception 'unknown subscription event %', p_event;
  end case;
end;
$$;

revoke all on function app.fulfill_purchase(uuid, uuid, uuid, text, bigint, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app.record_subscription_event(text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function app.fulfill_purchase(uuid, uuid, uuid, text, bigint, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function app.record_subscription_event(text, text, bigint, text, text) to service_role;
