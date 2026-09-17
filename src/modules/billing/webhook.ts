import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { fromDbError } from '@/lib/errors';
import type { CheckoutMetadata } from './stripe';
import { getStripe } from './stripe';

type Outcome = 'processed' | 'duplicate' | 'ignored';

/**
 * Idempotent Stripe event processing. The event id is the primary key of
 * stripe_events, so a retried delivery is detected before any side effect.
 * All fulfillment logic lives in app.fulfill_purchase / app.record_subscription_event.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<Outcome> {
  const admin = createAdminClient();
  const orgId = (event.data.object as { metadata?: Record<string, string> }).metadata?.organization_id ?? null;

  const { error: insertError } = await admin.from('stripe_events').insert({
    id: event.id, type: event.type, organization_id: orgId, payload: event as unknown as never,
  });
  if (insertError?.code === '23505') {
    const { data: prior } = await admin.from('stripe_events').select('processed_at').eq('id', event.id).single();
    if (prior?.processed_at) return 'duplicate';
  } else if (insertError) {
    throw fromDbError(insertError);
  }

  try {
    const outcome = await dispatch(admin, event);
    await admin.from('stripe_events').update({ processed_at: new Date().toISOString(), error: null }).eq('id', event.id);
    return outcome;
  } catch (e) {
    await admin.from('stripe_events').update({ error: e instanceof Error ? e.message : String(e) }).eq('id', event.id);
    throw e; // non-2xx → Stripe retries
  }
}

async function dispatch(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event): Promise<Outcome> {
  const rpc = admin.schema('app');
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      const m = s.metadata as unknown as Partial<CheckoutMetadata>;
      if (!m?.organization_id || !m.offer_id || !m.pricing_option_id) return 'ignored';
      if (s.payment_status === 'unpaid') return 'ignored';
      const email = s.customer_details?.email ?? s.customer_email;
      if (!email) throw new Error(`checkout ${s.id} has no email`);
      const [first, ...rest] = (s.customer_details?.name ?? '').split(' ');
      const { error } = await rpc.rpc('fulfill_purchase', {
        p_organization_id: m.organization_id,
        p_offer_id: m.offer_id,
        p_pricing_option_id: m.pricing_option_id,
        p_email: email,
        p_amount_paid_cents: s.amount_total ?? 0,
        p_checkout_session: s.id,
        p_payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id,
        p_stripe_customer: typeof s.customer === 'string' ? s.customer : s.customer?.id,
        p_stripe_subscription: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id,
        p_coupon_code: m.coupon_code,
        p_first_name: first || undefined,
        p_last_name: rest.join(' ') || undefined,
        p_metadata: { stripe_mode: s.mode },
      });
      if (error) throw fromDbError(error);
      return 'processed';
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
      // the first invoice is covered by checkout.session.completed
      if (!subId || inv.billing_reason === 'subscription_create') return 'ignored';
      const { error } = await rpc.rpc('record_subscription_event', {
        p_stripe_subscription: subId,
        p_event: event.type === 'invoice.paid' ? 'payment_succeeded' : 'payment_failed',
        p_amount_cents: event.type === 'invoice.paid' ? inv.amount_paid : inv.amount_due,
        p_stripe_invoice: inv.id,
        p_failure_reason: event.type === 'invoice.payment_failed' ? (inv.last_finalization_error?.message ?? 'payment_failed') : undefined,
      });
      if (error) throw fromDbError(error);
      // Payment plans end themselves after the last installment.
      if (event.type === 'invoice.paid') await maybeEndPaymentPlan(admin, subId);
      return 'processed';
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const { error } = await rpc.rpc('record_subscription_event', { p_stripe_subscription: sub.id, p_event: 'canceled' });
      if (error) throw fromDbError(error);
      return 'processed';
    }
    default:
      return 'ignored';
  }
}

async function maybeEndPaymentPlan(admin: ReturnType<typeof createAdminClient>, stripeSubscriptionId: string) {
  const { data } = await admin.from('subscriptions').select('kind, status').eq('stripe_subscription_id', stripeSubscriptionId).single();
  if (data?.kind === 'payment_plan' && data.status === 'completed') {
    await getStripe().subscriptions.cancel(stripeSubscriptionId);
  }
}
