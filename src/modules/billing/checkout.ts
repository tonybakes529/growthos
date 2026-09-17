import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession } from '@/lib/auth/session';
import { AppError, unwrap, unwrapRequired } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { getStripe, type CheckoutMetadata } from './stripe';

/**
 * Public checkout for a client's offer. Buyers are often not signed in, so the
 * lookup uses the service role, but everything is validated server-side: the
 * org must be an active client, the offer active, the price active and inside
 * its limited-time window. Amounts always come from Stripe prices, never input.
 */
export const createCheckoutSession = action(
  z.object({
    orgSlug: zSlug,
    offerSlug: z.string().min(1).max(80),
    pricingOptionId: zId,
    email: z.string().email().optional(),
    couponCode: z.string().max(40).optional(),
  }),
  async (i) => {
    const admin = createAdminClient();
    const org = unwrapRequired(await admin.from('organizations').select('id, status, kind').eq('slug', i.orgSlug).maybeSingle(), 'Workspace');
    if (org.kind !== 'client' || !['active', 'onboarding'].includes(org.status)) throw new AppError('not_found', 'Offer not available');
    const offer = unwrapRequired(await admin.from('offers').select('id, name, status, stripe_product_id')
      .eq('organization_id', org.id).eq('slug', i.offerSlug).is('deleted_at', null).maybeSingle(), 'Offer');
    if (offer.status !== 'active') throw new AppError('not_found', 'Offer not available');
    const price = unwrapRequired(await admin.from('pricing_options').select('*')
      .eq('id', i.pricingOptionId).eq('offer_id', offer.id).is('deleted_at', null).maybeSingle(), 'Price');
    const now = Date.now();
    if (!price.is_active || (price.available_from && Date.parse(price.available_from) > now) || (price.available_until && Date.parse(price.available_until) < now)) {
      throw new AppError('validation', 'This price is not currently available');
    }
    if (!price.stripe_price_id) throw new AppError('validation', 'This price is not connected to Stripe yet');

    let discounts: { coupon: string }[] | undefined;
    if (i.couponCode) {
      const coupon = unwrap(await admin.from('coupons').select('stripe_coupon_id, is_active, expires_at, applies_to_offer_ids')
        .eq('organization_id', org.id).eq('code', i.couponCode).is('deleted_at', null).maybeSingle());
      const valid = coupon?.is_active && coupon.stripe_coupon_id
        && (!coupon.expires_at || Date.parse(coupon.expires_at) > now)
        && (!coupon.applies_to_offer_ids?.length || coupon.applies_to_offer_ids.includes(offer.id));
      if (!valid) throw new AppError('validation', 'Coupon is not valid for this offer');
      discounts = [{ coupon: coupon!.stripe_coupon_id! }];
    }

    const session = await getSession();
    const metadata: CheckoutMetadata = { organization_id: org.id, offer_id: offer.id, pricing_option_id: price.id, coupon_code: i.couponCode };
    const recurring = price.pricing_type === 'subscription' || price.pricing_type === 'payment_plan';
    const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
    const checkout = await getStripe().checkout.sessions.create({
      mode: recurring ? 'subscription' : 'payment',
      line_items: [{ price: price.stripe_price_id, quantity: 1 }],
      customer_email: i.email ?? session?.email,
      discounts,
      metadata,
      ...(recurring
        ? { subscription_data: { metadata: { ...metadata, installments_total: String(price.installment_count ?? '') } } }
        : { payment_intent_data: { metadata } }),
      success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/checkout/${i.orgSlug}/${i.offerSlug}`,
    });
    return { url: checkout.url };
  },
);
