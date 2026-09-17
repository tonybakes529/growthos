import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEnv } from '@/lib/env';
import { emitScheduledEvents, processDomainEvents } from '@/modules/automations/worker';
import { drainEmailOutbox } from '@/modules/email/outbox';

export const runtime = 'nodejs';

const authorized = (req: Request) => {
  const expected = Buffer.from(`Bearer ${requireEnv('CRON_SECRET')}`);
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  return got.length === expected.length && timingSafeEqual(got, expected);
};

/**
 * /api/cron/events  – every minute: automations + delayed steps + email outbox
 * /api/cron/daily   – once a day: overdue/inactive checks + health scores
 */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { job } = await params;
  switch (job) {
    case 'events': {
      const events = await processDomainEvents();
      const email = await drainEmailOutbox();
      return NextResponse.json({ events, email });
    }
    case 'daily': {
      const scheduled = await emitScheduledEvents();
      const { data, error } = await createAdminClient().schema('app').rpc('calculate_all_health_scores');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ scheduled, healthScores: data });
    }
    default:
      return NextResponse.json({ error: 'unknown job' }, { status: 404 });
  }
}
