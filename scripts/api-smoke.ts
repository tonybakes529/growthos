/**
 * API-level smoke test: exercises tenant isolation and the core workflows
 * through PostgREST exactly the way the app's server actions do.
 *
 *   Supabase (local CLI stack or a staging project with seed.sql loaded):
 *     SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx scripts/api-smoke.ts
 *   Without GoTrue (JWTs minted from the project's JWT secret instead of signing in):
 *     SUPABASE_URL=... SUPABASE_ANON_KEY=... JWT_SECRET=... npx tsx scripts/api-smoke.ts
 */
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';

const PASSWORD = 'GrowthOS-demo-2026!';
const ids: Record<string, string> = {
  'owner@growthos.test': 'a0000000-0000-0000-0000-000000000001',
  'devon@growthos.test': 'a0000000-0000-0000-0000-000000000002',
  'maria@growthos.test': 'a0000000-0000-0000-0000-000000000003',
  'jake@apexroofing.test': 'b0000000-0000-0000-0000-000000000001',
  'sam@apexroofing.test': 'b0000000-0000-0000-0000-000000000002',
  'lena@northstarfit.test': 'b0000000-0000-0000-0000-000000000003',
  'ari@northstarfit.test': 'b0000000-0000-0000-0000-000000000004',
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mint(sub: string, secret: string) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 });
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

const client = (headers?: Record<string, string>) =>
  createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY ?? 'anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: headers ? { headers } : undefined,
  });

async function as(email: string) {
  let sb: ReturnType<typeof client>;
  if (process.env.JWT_SECRET) {
    sb = client({ Authorization: `Bearer ${mint(ids[email]!, process.env.JWT_SECRET)}` });
  } else {
    sb = client();
    const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw error;
  }
  return { pub: sb, app: sb.schema('app') };
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function main() {
  const jake = await as('jake@apexroofing.test');
  const orgs = await jake.pub.from('organizations').select('id, slug');
  check('client admin sees only own workspace', orgs.data?.length === 1 && orgs.data[0]!.slug === 'apex-roofing', orgs);
  const apexId = orgs.data![0]!.id;

  const ctx = await jake.app.rpc('get_org_context', { p_slug: 'apex-roofing' });
  check('get_org_context returns permissions', Array.isArray((ctx.data as unknown as { permissions?: unknown[] })?.permissions), ctx.error);
  const foreign = await jake.app.rpc('get_org_context', { p_slug: 'northstar-fitness' });
  check('foreign slug is rejected', foreign.error?.code === 'P0002', foreign.error);

  const task = await jake.app.rpc('create_task', { p_organization_id: apexId, p_title: 'API smoke task', p_priority: 'low' });
  check('create_task via RPC', typeof task.data === 'string', task.error);

  const lena = await as('lena@northstarfit.test');
  const northCtx = await lena.app.rpc('get_org_context', { p_slug: 'northstar-fitness' });
  const northId = (northCtx.data as unknown as { organization_id: string }).organization_id;
  const crossInsert = await jake.pub.from('contacts').insert({ organization_id: northId, first_name: 'x' });
  check('cross-tenant insert blocked (42501)', crossInsert.error?.code === '42501', crossInsert.error);
  const crossRpc = await jake.app.rpc('create_task', { p_organization_id: northId, p_title: 'nope' });
  check('cross-tenant RPC blocked (42501)', crossRpc.error?.code === '42501', crossRpc.error);

  const sam = await as('sam@apexroofing.test');
  const fin = await sam.pub.from('kpi_definitions').select('key').eq('is_financial', true);
  check('team member cannot read financial KPIs', fin.data?.length === 0, fin);
  const view = await sam.pub.from('org_growth_metrics_monthly_v').select('marketing_spend_cents').not('marketing_spend_cents', 'is', null);
  check('spend hidden inside reporting views', view.data?.length === 0, view);

  const ari = await as('ari@northstarfit.test');
  const programs = await ari.pub.from('programs').select('id, slug');
  check('student sees only enrolled programs', programs.data?.length === 1, programs);
  const outline = await ari.app.rpc('get_program_outline', { p_program_id: programs.data![0]!.id });
  check('program outline RPC', (outline.data?.length ?? 0) > 0, outline.error);
  const next = outline.data?.find((l) => l.is_available && l.progress_status !== 'completed');
  if (next?.lesson_id) {
    const done = await ari.app.rpc('complete_lesson', { p_lesson_id: next.lesson_id });
    check('complete_lesson updates progress', ((done.data as unknown as { lessons_completed?: number })?.lessons_completed ?? 0) >= 1, done.error);
  }
  const hacked = await ari.pub.from('lesson_progress').update({ status: 'completed' }).neq('status', 'completed').select('id');
  check('student cannot write progress directly', (hacked.data?.length ?? 0) === 0, hacked);
  const fulfil = await ari.app.rpc('fulfill_purchase', {
    p_organization_id: northId, p_offer_id: northId, p_pricing_option_id: northId, p_email: 'x@y.z', p_amount_paid_cents: 0, p_checkout_session: 'x',
  });
  check('service-only RPC not callable by users', fulfil.error !== null, fulfil);

  const owner = await as('owner@growthos.test');
  const overview = await owner.pub.from('admin_client_overview_v').select('slug, health_band, needs_attention');
  check('super admin overview lists all clients', overview.data?.length === 3, overview);
  const maria = await as('maria@growthos.test');
  const mariaView = await maria.pub.from('admin_client_overview_v').select('slug');
  check('coach overview limited to assignments', mariaView.data?.length === 2, mariaView);
  const health = await maria.app.rpc('calculate_health_score', { p_organization_id: apexId });
  check('coach recalculates health with explanation', Array.isArray((health.data as unknown as { components?: unknown[] })?.components), health.error);

  const events = await owner.pub.from('domain_events').select('id').limit(1);
  check('event stream not exposed to API roles', events.error !== null, events);

  // cleanup
  await jake.app.rpc('soft_delete', { p_table: 'tasks', p_id: task.data as string });

  console.log(failures ? `\n${failures} check(s) failed` : '\nall API checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
