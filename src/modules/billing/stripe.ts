import 'server-only';
import Stripe from 'stripe';
import { requireEnv } from '@/lib/env';

let client: Stripe | undefined;
export function getStripe(): Stripe {
  client ??= new Stripe(requireEnv('STRIPE_SECRET_KEY'));
  return client;
}

/** Metadata attached to every Checkout Session so the webhook can fulfill without trusting the browser. */
export type CheckoutMetadata = {
  organization_id: string;
  offer_id: string;
  pricing_option_id: string;
  coupon_code?: string;
};
