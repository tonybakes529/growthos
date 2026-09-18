import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClientOrganization, getPlatformMetrics, listClients, setClientStatus } from '@/modules/organizations/actions';
import { applyTemplatesBulk, listTemplates } from '@/modules/templates/actions';
import { listInternalTeam } from '@/modules/team/actions';
import { recalculateAllHealth } from '@/modules/health/actions';
import { listMyTasksEverywhere } from '@/modules/tasks/actions';
import { getSession } from '@/lib/auth/session';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, Stat, day, money } from '@/components/ui';

const PATH = '/admin/clients';
const STATUSES = ['onboarding', 'active', 'paused', 'suspended', 'archived'];

type Row = Awaited<ReturnType<typeof listClients>> extends { ok: true; data: { rows: (infer R)[] } } | { ok: false; error: unknown } ? R : never;

/** Plain-language reasons a client is on the attention list, from the same signals the overview view uses. */
function reasons(c: Row): string[] {
  const out: string[] = [];
  if (c.health_band === 'critical') out.push('health critical');
  else if (c.health_band === 'at_risk') out.push('health at risk');
  if (c.days_to_renewal != null && c.days_to_renewal >= 0 && c.days_to_renewal <= 30) out.push(`renews in ${c.days_to_renewal}d`);
  const stale = (v: string | null) => v && Date.now() - Date.parse(v) > 14 * 864e5;
  if (!c.last_client_login_at) out.push('never logged in'); else if (stale(c.last_client_login_at)) out.push('no login 14d+');
  if (c.last_kpi_update_at && stale(c.last_kpi_update_at)) out.push('no KPIs 14d+');
  if (c.overdue_tasks) out.push(`${c.overdue_tasks} overdue task${c.overdue_tasks === 1 ? '' : 's'}`);
  if (c.open_blockers) out.push(`${c.open_blockers} blocker${c.open_blockers === 1 ? '' : 's'}`);
  return out;
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.ctx.is_platform_staff && !session?.ctx.is_super_admin) redirect('/');
  const isSuper = Boolean(session?.ctx.is_super_admin);
  const [res, metrics, templates, team, myTasks] = await Promise.all([
    listClients({ search: sp.q || undefined, statuses: sp.status ? [sp.status as 'active'] : undefined, sort: 'name' }),
    isSuper ? getPlatformMetrics({}) : null,
    isSuper ? listTemplates({}) : null,
    isSuper ? listInternalTeam({}) : null,
    listMyTasksEverywhere({}),
  ]);
  const m = metrics?.ok ? (metrics.data as Record<string, number | null>) : null;
  const rows = res.ok ? res.data.rows : [];
  const live = rows.filter((c) => c.status !== 'archived');
  const attention = live.map((c) => ({ c, why: reasons(c) })).filter((x) => x.why.length)
    .sort((a, b) => b.why.length - a.why.length);
  const renewals = live.filter((c) => c.days_to_renewal != null && c.days_to_renewal >= 0 && c.days_to_renewal <= 60)
    .sort((a, b) => (a.days_to_renewal ?? 0) - (b.days_to_renewal ?? 0));
  const tasks = myTasks.ok ? myTasks.data : [];
  const now = Date.now();
  const filtered = !!(sp.q || sp.status);

  async function create(form: FormData) {
    'use server';
    const cents = (k: string) => (form.get(k) ? Math.round(Number(form.get(k)) * 100) : undefined);
    const r = await createClientOrganization({
      name: String(form.get('name')), slug: String(form.get('slug')).toLowerCase(),
      adminEmail: String(form.get('adminEmail') || '') || undefined,
      onboardingTemplateId: String(form.get('template') || '') || undefined,
      accountManagerId: String(form.get('am') || '') || undefined,
      coachId: String(form.get('coach') || '') || undefined,
      profile: { industry: String(form.get('industry') || '') || undefined, mrrCents: cents('mrr'),
        renewalDate: String(form.get('renewal') || '') || undefined, revenueTargetCents: cents('target') },
    });
    done(PATH, r, (d) => d.inviteUrl ? `Workspace created. Send the client admin this link: ${d.inviteUrl}` : 'Workspace created. Invite the client admin from its Team page when ready.');
  }
  async function status(form: FormData) {
    'use server';
    done(PATH, await setClientStatus({ orgSlug: String(form.get('slug')), status: String(form.get('status')) as 'active' }), 'Status updated');
  }
  async function bulk(form: FormData) {
    'use server';
    const [type, id] = String(form.get('template')).split(':');
    const r = await applyTemplatesBulk({ items: [{ type: type as 'program', id: id! }], organizationIds: form.getAll('org').map(String) });
    done(PATH, r, (d) => `Applied to ${d.applied} workspace(s)`);
  }
  async function recalc() {
    'use server';
    done(PATH, await recalculateAllHealth({}), (d) => `Health recalculated for ${d.clients} clients`);
  }

  const t = templates?.ok ? templates.data : null;
  const staff = team?.ok ? team.data : [];
  const templateOptions = t ? [
    ...t.program.map((x) => ({ v: `program:${x.id}`, l: `Course: ${x.name}` })),
    ...t.scorecard.map((x) => ({ v: `scorecard:${x.id}`, l: `Scorecard: ${x.name}` })),
    ...t.dashboard.map((x) => ({ v: `dashboard:${x.id}`, l: `Dashboard: ${x.name}` })),
    ...t.sop.map((x) => ({ v: `sop:${x.id}`, l: `SOP: ${x.name}` })),
    ...t.offer.map((x) => ({ v: `offer:${x.id}`, l: `Offer: ${x.name}` })),
    ...t.task.map((x) => ({ v: `task:${x.id}`, l: `Tasks: ${x.name}` })),
  ] : [];

  return (
    <>
      <PageHead sub="Growth OS" title={isSuper ? 'All clients' : 'My clients'}>
        {isSuper && <a className="btn primary" href="#new">+ New client</a>}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : `Could not load clients: ${res.error.message}`)} />

      {m && (
        <div className="grid g4">
          <Stat k="Clients" v={m.clients_total ?? 0} />
          <Stat k="MRR" v={money(m.mrr_cents)} s="what clients pay you" />
          <Stat k="At risk" v={m.at_risk_clients ?? 0} s={m.avg_health_score != null ? `avg health ${m.avg_health_score}` : undefined} />
          <Stat k="Renewals, 30 days" v={m.renewals_next_30d ?? 0} />
        </div>
      )}

      <div className="grid g2">
        <div className="card">
          <h2>Needs attention {attention.length > 0 && <span className="muted" style={{ fontWeight: 400 }}>({attention.length})</span>}</h2>
          {res.ok && !attention.length && <p className="empty">Nothing is flagged. Every client has logged in and reported recently, and no renewals are close.</p>}
          <ul className="attn">
            {attention.slice(0, 8).map(({ c, why }) => (
              <li key={c.organization_id}>
                <span><Link href={`/w/${c.slug}`}><b>{c.name}</b></Link>
                  <div className="why" style={{ marginTop: 4 }}>{why.map((w) => <Pill key={w} value={/critical|overdue/.test(w) ? 'critical' : 'at_risk'} label={w} />)}</div></span>
                <Link className="btn small" href={`/w/${c.slug}`}>Open</Link>
              </li>
            ))}
          </ul>
          {attention.length > 8 && <p className="muted" style={{ marginBottom: 0 }}>{attention.length - 8} more in the table below.</p>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h2>Renewals, next 60 days</h2>
            {res.ok && !renewals.length && <p className="empty">No renewals due in the next 60 days.</p>}
            <ul className="attn">
              {renewals.map((c) => (
                <li key={c.organization_id}>
                  <span><Link href={`/w/${c.slug}`}>{c.name}</Link><div className="muted">{money(c.mrr_cents)} / mo</div></span>
                  <Pill value={(c.days_to_renewal ?? 99) <= 30 ? 'at_risk' : 'none'} label={`${day(c.renewal_date)} · ${c.days_to_renewal}d`} />
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h2>My tasks</h2>
            {myTasks.ok && !tasks.length && <p className="empty">Nothing assigned to you across your clients.</p>}
            {!myTasks.ok && <p className="flash err">Could not load your tasks.</p>}
            <ul className="attn">
              {tasks.slice(0, 8).map((tk) => {
                const overdue = tk.due_at && Date.parse(tk.due_at) < now;
                return (
                  <li key={tk.id}>
                    <span>{tk.workspace ? <Link href={`/w/${tk.workspace.slug}/tasks?view=mine`}>{tk.title}</Link> : tk.title}
                      <div className="muted">{tk.workspace?.name ?? ''}</div></span>
                    {tk.due_at ? <Pill value={overdue ? 'overdue' : 'none'} label={overdue ? `overdue · ${day(tk.due_at)}` : day(tk.due_at)} /> : <span className="muted">No date</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="head" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Clients</h2>
          <form className="row">
            <input name="q" placeholder="Search" defaultValue={sp.q} aria-label="Search clients" />
            <select name="status" defaultValue={sp.status ?? ''} aria-label="Status"><option value="">Any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <button className="btn small" type="submit">Filter</button>
            {filtered && <Link className="btn small" href={PATH}>Clear</Link>}
          </form>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Client</th><th>Status</th><th>Health</th><th>MRR</th><th>Renewal</th><th>Last login</th><th>Team</th>{isSuper && <th>Change status</th>}</tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.organization_id}>
                  <td><Link href={`/w/${c.slug}`}><b>{c.name}</b></Link>{c.industry && <div className="muted">{c.industry}</div>}</td>
                  <td><Pill value={c.status} /></td>
                  <td>{c.health_score != null ? <Pill value={c.health_band} label={`${Math.round(c.health_score)} · ${c.health_band?.replace('_', ' ')}`} /> : <span className="muted">not scored</span>}</td>
                  <td>{money(c.mrr_cents)}</td>
                  <td>{day(c.renewal_date)}</td>
                  <td>{c.last_client_login_at ? day(c.last_client_login_at) : <span className="muted">never</span>}</td>
                  <td className="wrap">{c.account_manager_name ?? <span className="muted">no AM</span>}<div className="muted">{c.coach_name ?? 'no coach'}</div></td>
                  {isSuper && (
                    <td>
                      <form action={status} className="row">
                        <input type="hidden" name="slug" value={c.slug ?? ''} />
                        <select name="status" defaultValue={c.status ?? ''} aria-label={`Status for ${c.name}`}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                        <button className="btn small" type="submit">Save</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {res.ok && !rows.length && <tr><td colSpan={8} className="empty">{filtered ? 'No clients match this filter.' : isSuper ? 'No clients yet. Create the first workspace below.' : 'You are not assigned to any client yet. Ask a super admin to add you from a client’s Team page.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isSuper && (
        <>
          <form id="new" className="card" action={create} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div><h2 style={{ marginBottom: 4 }}>New client workspace</h2>
              <p className="muted" style={{ margin: 0 }}>Creates the workspace, copies the chosen template into it, invites the client admin and assigns your team. Only the name and slug are required.</p></div>
            <div className="grid g2" style={{ gap: 10 }}>
              <label className="f">Company name<input name="name" required /></label>
              <label className="f">URL slug<input name="slug" pattern="[a-z0-9][a-z0-9\-]+" placeholder="acme-co" required /></label>
              <label className="f">Client admin email <span className="muted" style={{ fontWeight: 400 }}>(optional, sends the invite)</span><input name="adminEmail" type="email" /></label>
              <label className="f">Industry<input name="industry" /></label>
              <label className="f">MRR ($)<input name="mrr" type="number" min="0" /></label>
              <label className="f">Revenue target / mo ($)<input name="target" type="number" min="0" /></label>
              <label className="f">Renewal date<input name="renewal" type="date" /></label>
              <label className="f">Onboarding template
                <select name="template"><option value="">Default</option>{t?.onboarding.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <label className="f">Account manager
                <select name="am"><option value="">None</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.profile?.display_name ?? s.user_id}</option>)}</select></label>
              <label className="f">Coach
                <select name="coach"><option value="">None</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.profile?.display_name ?? s.user_id}</option>)}</select></label>
            </div>
            <div><button className="btn primary" type="submit">Create workspace</button></div>
          </form>

          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>More tools: apply templates in bulk, recalculate health</summary>
            <div className="grid g2" style={{ marginTop: 14 }}>
              <form action={bulk} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={{ margin: 0 }}>Apply a template to clients</h3>
                <label className="f">Template<select name="template" required>{templateOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
                <fieldset style={{ border: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <legend className="muted">Workspaces</legend>
                  {live.map((c) => <label key={c.organization_id} className="row"><input type="checkbox" name="org" value={c.organization_id ?? ''} /> {c.name}</label>)}
                </fieldset>
                <div><button className="btn" type="submit">Apply template</button></div>
              </form>
              <form action={recalc} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={{ margin: 0 }}>Health scores</h3>
                <p className="muted" style={{ margin: 0 }}>Scores refresh nightly. Recalculate now after changing a client&apos;s data.</p>
                <div><button className="btn" type="submit">Recalculate health</button></div>
              </form>
            </div>
          </details>
        </>
      )}
    </>
  );
}
