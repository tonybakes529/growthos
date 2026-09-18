import Link from 'next/link';
import { createClientOrganization, getPlatformMetrics, listClients, setClientStatus } from '@/modules/organizations/actions';
import { listTemplates } from '@/modules/templates/actions';
import { listInternalTeam } from '@/modules/team/actions';
import { applyTemplatesBulk } from '@/modules/templates/actions';
import { recalculateAllHealth } from '@/modules/health/actions';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, Stat, day, money } from '@/components/ui';

const PATH = '/admin/clients';

export default async function AdminClients({ searchParams }: { searchParams: Promise<{ q?: string; attention?: string; status?: string; msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.ctx.is_platform_staff && !session?.ctx.is_super_admin) redirect('/');
  const isSuper = Boolean(session?.ctx.is_super_admin);
  const [res, metrics, templates, team] = await Promise.all([
    listClients({
      search: sp.q || undefined,
      needsAttention: sp.attention === '1',
      statuses: sp.status ? [sp.status as 'active'] : undefined,
      sort: 'name',
    }),
    isSuper ? getPlatformMetrics({}) : null,
    isSuper ? listTemplates({}) : null,
    isSuper ? listInternalTeam({}) : null,
  ]);
  const m = metrics?.ok ? (metrics.data as Record<string, number | null>) : null;
  const rows = res.ok ? res.data.rows : [];

  async function create(form: FormData) {
    'use server';
    const cents = (k: string) => (form.get(k) ? Math.round(Number(form.get(k)) * 100) : undefined);
    const r = await createClientOrganization({
      name: String(form.get('name')),
      slug: String(form.get('slug')).toLowerCase(),
      adminEmail: String(form.get('adminEmail') || '') || undefined,
      onboardingTemplateId: String(form.get('template') || '') || undefined,
      accountManagerId: String(form.get('am') || '') || undefined,
      coachId: String(form.get('coach') || '') || undefined,
      profile: {
        industry: String(form.get('industry') || '') || undefined,
        mrrCents: cents('mrr'),
        renewalDate: String(form.get('renewal') || '') || undefined,
        revenueTargetCents: cents('target'),
      },
    });
    done(PATH, r, (d) => `Workspace created. Invite link for the client admin: ${d.inviteUrl ?? '(no email given)'}`);
  }

  async function status(form: FormData) {
    'use server';
    const r = await setClientStatus({ orgSlug: String(form.get('slug')), status: String(form.get('status')) as 'active' });
    done(PATH, r, 'Status updated');
  }

  async function bulk(form: FormData) {
    'use server';
    const [type, id] = String(form.get('template')).split(':');
    const orgs = form.getAll('org').map(String);
    const r = await applyTemplatesBulk({ items: [{ type: type as 'program', id: id! }], organizationIds: orgs });
    done(PATH, r, (d) => `Applied to ${d.applied} workspace(s)`);
  }

  async function recalc() {
    'use server';
    const r = await recalculateAllHealth({});
    done(PATH, r, (d) => `Health recalculated for ${d.clients} clients`);
  }

  const t = templates?.ok ? templates.data : null;
  const staff = team?.ok ? team.data : [];
  const templateOptions = t ? [
    ...t.program.map((x) => ({ v: `program:${x.id}`, l: `Program: ${x.name}` })),
    ...t.scorecard.map((x) => ({ v: `scorecard:${x.id}`, l: `Scorecard: ${x.name}` })),
    ...t.dashboard.map((x) => ({ v: `dashboard:${x.id}`, l: `Dashboard: ${x.name}` })),
    ...t.sop.map((x) => ({ v: `sop:${x.id}`, l: `SOP: ${x.name}` })),
    ...t.offer.map((x) => ({ v: `offer:${x.id}`, l: `Offer: ${x.name}` })),
    ...t.task.map((x) => ({ v: `task:${x.id}`, l: `Tasks: ${x.name}` })),
  ] : [];

  return (
    <>
      <PageHead sub="Platform admin" title="Clients">
        {isSuper && <form action={recalc}><button className="btn" type="submit">Recalculate health</button></form>}
        {isSuper && <a className="btn primary" href="#new">+ New client</a>}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : res.error.message)} />

      {m && (
        <div className="grid g4">
          <Stat k="Clients" v={m.clients_total ?? 0} />
          <Stat k="MRR" v={money(m.mrr_cents)} s="what clients pay you" />
          <Stat k="At risk" v={m.at_risk_clients ?? 0} s={`avg health ${m.avg_health_score ?? '—'}`} />
          <Stat k="Renewals next 30 days" v={m.renewals_next_30d ?? 0} />
        </div>
      )}

      <div className="card">
        <form className="row" style={{ marginBottom: 12 }}>
          <input name="q" placeholder="Search clients" defaultValue={sp.q} aria-label="Search clients" />
          <select name="status" defaultValue={sp.status ?? ''} aria-label="Status">
            <option value="">All statuses</option>
            {['onboarding', 'active', 'paused', 'suspended', 'archived'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="row"><input type="checkbox" name="attention" value="1" defaultChecked={sp.attention === '1'} /> Needs attention</label>
          <button className="btn" type="submit">Filter</button>
        </form>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th>Client</th><th>Status</th><th>Health</th><th>MRR</th><th>Revenue / target</th><th>Renewal</th>
              <th>Last login</th><th>Last KPI</th><th>Progress</th><th>Overdue</th><th>Blockers</th><th>Next call</th><th>AM / Coach</th>
              {isSuper && <th>Change status</th>}
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.organization_id} style={{ background: c.needs_attention ? '#fffafa' : undefined }}>
                  <td><Link href={`/w/${c.slug}`}><b>{c.name}</b></Link><div className="muted">{c.industry ?? ''}</div></td>
                  <td><Pill value={c.status} /></td>
                  <td>{c.health_score != null ? <Pill value={c.health_band} label={`${Math.round(c.health_score)} · ${c.health_band?.replace('_', ' ')}`} /> : '—'}</td>
                  <td>{money(c.mrr_cents)}</td>
                  <td>{money(c.current_monthly_revenue_cents)} / {money(c.revenue_target_cents)}</td>
                  <td>{day(c.renewal_date)}{c.days_to_renewal != null && c.days_to_renewal <= 30 && <div><Pill value="at_risk" label={`${c.days_to_renewal}d`} /></div>}</td>
                  <td>{day(c.last_client_login_at)}</td>
                  <td>{day(c.last_kpi_update_at)}</td>
                  <td>{Math.round(c.avg_program_progress ?? 0)}%</td>
                  <td>{c.overdue_tasks ? <Pill value="overdue" label={String(c.overdue_tasks)} /> : 0}</td>
                  <td>{c.open_blockers}</td>
                  <td>{c.next_call_at ? new Date(c.next_call_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                  <td>{c.account_manager_name ?? '—'}<div className="muted">{c.coach_name ?? '—'}</div></td>
                  {isSuper && (
                    <td>
                      <form action={status} className="row">
                        <input type="hidden" name="slug" value={c.slug ?? ''} />
                        <select name="status" defaultValue={c.status ?? ''} aria-label={`Status for ${c.name}`}>
                          {['onboarding', 'active', 'paused', 'suspended', 'archived'].map((s) => <option key={s}>{s}</option>)}
                        </select>
                        <button className="btn small" type="submit">Save</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={14} className="muted">No clients match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isSuper && (
        <div className="grid g2">
          <form id="new" className="card" action={create} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>New client workspace</h2>
            <div className="grid g2" style={{ gap: 10 }}>
              <label className="f">Company name<input name="name" required /></label>
              <label className="f">URL slug<input name="slug" pattern="[a-z0-9][a-z0-9\-]+" placeholder="acme-co" required /></label>
              <label className="f">Client admin email<input name="adminEmail" type="email" /></label>
              <label className="f">Industry<input name="industry" /></label>
              <label className="f">MRR ($)<input name="mrr" type="number" min="0" /></label>
              <label className="f">Revenue target / mo ($)<input name="target" type="number" min="0" /></label>
              <label className="f">Renewal date<input name="renewal" type="date" /></label>
              <label className="f">Onboarding template
                <select name="template">
                  <option value="">Default</option>
                  {t?.onboarding.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="f">Account manager
                <select name="am"><option value="">None</option>
                  {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.profile?.display_name ?? s.user_id}</option>)}
                </select>
              </label>
              <label className="f">Coach
                <select name="coach"><option value="">None</option>
                  {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.profile?.display_name ?? s.user_id}</option>)}
                </select>
              </label>
            </div>
            <div><button className="btn primary" type="submit">Create workspace</button></div>
          </form>

          <form className="card" action={bulk} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>Apply a template to clients</h2>
            <label className="f">Template
              <select name="template" required>{templateOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
            </label>
            <fieldset style={{ border: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <legend className="muted">Workspaces</legend>
              {rows.map((c) => (
                <label key={c.organization_id} className="row"><input type="checkbox" name="org" value={c.organization_id ?? ''} /> {c.name}</label>
              ))}
            </fieldset>
            <div><button className="btn" type="submit">Apply template</button></div>
          </form>
        </div>
      )}
    </>
  );
}

