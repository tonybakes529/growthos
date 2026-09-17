import { requireOrgPage, can } from '@/lib/auth/context';
import { getEnv } from '@/lib/env';
import { createOnboardingAlert, listAutomations, setAutomationActive } from '@/modules/automations/actions';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, dayTime } from '@/components/ui';

const EVENTS: [string, string][] = [
  ['customer.invited', 'A customer was added to a course, by purchase or by hand'],
  ['customer.registered', 'They created their login'],
  ['customer.onboarding_started', 'They saved their first answer'],
  ['customer.onboarding_completed', 'They submitted the form. Their answers travel with the event, keyed by each question’s automation key'],
];
const WHO: Record<string, string> = { client_admins: 'Workspace admins', coach: 'Coach', account_manager: 'Account manager', assigned_staff: 'Everyone on the Growth OS team for this client' };

export default async function Automations({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/automations`;
  if (!can(ctx, 'automations.read')) {
    return (<><PageHead sub={ctx.name} title="Automations" /><div className="card muted">You don&apos;t have access to automations.</div></>);
  }
  const [res, programs] = await Promise.all([
    listAutomations({ orgSlug }),
    ctx.sb.from('programs').select('id, title').eq('organization_id', ctx.organizationId).is('deleted_at', null).order('title'),
  ]);
  const autos = res.ok ? res.data : [];
  const courses = programs.data ?? [];
  const env = getEnv();
  const workerOn = !!env.SUPABASE_SERVICE_ROLE_KEY && !!env.CRON_SECRET;

  async function create(f: FormData) {
    'use server';
    done(path, await createOnboardingAlert({ orgSlug, programId: String(f.get('course') || '') || undefined, recipient: String(f.get('who')) as 'coach' }), 'Automation created and switched on');
  }
  async function toggle(f: FormData) {
    'use server';
    done(path, await setAutomationActive({ orgSlug, automationId: String(f.get('id')), active: f.get('to') === 'on' }), 'Automation updated');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="Automations" />
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : res.error.message)} />
      {!workerOn && (
        <div className="flash" style={{ wordBreak: 'normal' }}>
          Events are being recorded, but the background worker that runs automations is not switched on for this deployment yet. Nothing below will fire until it is.
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Automation</th><th>When</th><th>Then</th><th>Last ran</th><th>Status</th><th /></tr></thead>
          <tbody>
            {autos.map((a) => (
              <tr key={a.id}>
                <td className="wrap"><b>{a.name}</b></td>
                <td><code>{a.trigger_type}</code></td>
                <td>{a.actions.map((x) => x.action_type.replace(/_/g, ' ')).join(', ') || '—'}</td>
                <td>{dayTime(a.last_run_at)}</td>
                <td><Pill value={a.is_active ? 'active' : 'paused'} label={a.is_active ? 'on' : 'off'} /></td>
                <td>{can(ctx, 'automations.update') && (
                  <form action={toggle}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value={a.is_active ? 'off' : 'on'} />
                    <button className="btn small" type="submit">Turn {a.is_active ? 'off' : 'on'}</button></form>)}</td>
              </tr>
            ))}
            {!autos.length && <tr><td colSpan={6} className="muted">No automations yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {can(ctx, 'automations.create') && (
        <form className="card" action={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ flexBasis: '100%' }}><h2 style={{ marginBottom: 4 }}>Alert someone when onboarding is completed</h2></div>
          <label className="f" style={{ minWidth: 220 }}>For
            <select name="course"><option value="">Any course</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label className="f" style={{ minWidth: 220 }}>Notify
            <select name="who">{Object.entries(WHO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <button className="btn primary" type="submit">Create automation</button>
        </form>
      )}

      <div className="card">
        <h2>Customer events you can build on</h2>
        <ul className="plain">{EVENTS.map(([k, d]) => <li key={k}><code>{k}</code><span className="muted wrap" style={{ textAlign: 'right' }}>{d}</span></li>)}</ul>
      </div>
    </>
  );
}
