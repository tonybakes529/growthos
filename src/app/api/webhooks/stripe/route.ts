import { NextResponse } from 'next/server';
import { getStripe } from '@/modules/billing/stripe';
import { handleStripeEvent } from '@/modules/billing/webhook';
import { requireEnv } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  let event;
  try {
    event = getStripe().webhooks.constructEvent(await req.text(), signature, requireEnv('STRIPE_WEBHOOK_SECRET'));
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }
  try {
    const outcome = await handleStripeEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error('[stripe webhook]', event.type, e);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
