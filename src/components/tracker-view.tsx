import Link from 'next/link';
import { formatKpi, type Tracker, type TrackerLead, type TrackerRow } from '@/modules/tracker/actions';
import { Menu } from '@/components/menu';
import { Modal } from '@/components/modal';
import { Flash, PageHead, Pill, day } from '@/components/ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** The date is a plain YYYY-MM-DD, so read it as UTC and never let a timezone shift the column. */
const dayName = (d: string) => DAY_NAMES[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7];
const shift = (weekStart: string, days: number) => {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

/** How a row was filled, in the student's words rather than the database's. */
const HOW: Record<string, string> = {
  manual: 'typed in',
  counted: 'counted from the leads',
  calculated: 'worked out',
  automated: 'synced',
};

function LeadFields({ lead, objections }: { lead?: TrackerLead; objections: Tracker['objections'] }) {
  const flags = [
    ['answered', 'Answered'], ['qualified', 'Qualified'], ['booked', 'Booked'],
    ['taken', 'Taken'], ['converted', 'Converted'],
  ] as const;
  return (
    <>
      <label className="f">Date<input name="captured_on" type="date" defaultValue={lead?.captured_on ?? iso(new Date())} required /></label>
      <label className="f">Name<input name="name" maxLength={200} defaultValue={lead?.name ?? ''} /></label>
      <label className="f">Phone<input name="phone" maxLength={50} defaultValue={lead?.phone ?? ''} /></label>
      <label className="f">Email<input name="email" type="email" maxLength={320} defaultValue={lead?.email ?? ''} /></label>
      <div className="row" style={{ gap: 14 }}>
        {flags.map(([k, label]) => (
          <label key={k} className="row" style={{ gap: 5 }}>
            <input type="checkbox" name={k} defaultChecked={!!lead?.[k]} /> {label}
          </label>
        ))}
      </div>
      <label className="f">Objection
        <select name="objection_id" defaultValue={lead?.objection_id ?? ''}>
          <option value="">None</option>
          {objections.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <div className="row">
        <label className="f" style={{ flex: 1 }}>Cash collected<input name="cash_collected" type="number" step="0.01" min="0" defaultValue={lead?.cash_collected ?? 0} /></label>
        <label className="f" style={{ flex: 1 }}>Revenue or LTV<input name="revenue" type="number" step="0.01" min="0" defaultValue={lead?.revenue ?? 0} /></label>
        <label className="f" style={{ flex: 1 }}>Follow ups<input name="follow_up_attempts" type="number" step="1" min="0" defaultValue={lead?.follow_up_attempts ?? 0} /></label>
      </div>
      <label className="f">Notes<textarea name="notes" rows={2} maxLength={5000} defaultValue={lead?.notes ?? ''} /></label>
    </>
  );
}


/** A plain SVG bar chart of one metric across the week. No library, no client JavaScript. */
function WeekChart({ data, metric }: { data: Tracker; metric: TrackerRow }) {
  const points = data.days.map((d) => ({
    date: d.date,
    value: Number(d.rows.find((r) => r.kpi_id === metric.kpi_id)?.value ?? 0),
  }));
  const peak = Math.max(...points.map((p) => p.value), 0);
  const W = 560, H = 160, pad = 24, gap = 10;
  const barW = (W - pad * 2 - gap * 6) / 7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
         aria-label={`${metric.name} for each day of the week beginning ${data.week_start}`}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--line)" />
      {points.map((p, i) => {
        const h = peak > 0 ? Math.round((p.value / peak) * (H - pad * 2)) : 0;
        const x = pad + i * (barW + gap);
        const y = H - pad - h;
        return (
          <g key={p.date}>
            {h > 0 && <rect x={x} y={y} width={barW} height={h} rx="3"
                            fill={p.date === data.today ? 'var(--accent-2)' : 'var(--accent)'} />}
            <text x={x + barW / 2} y={h > 16 ? y + 14 : y - 4} textAnchor="middle"
                  fontSize="11" fill={h > 16 ? '#fff' : 'var(--muted)'}>
              {p.value ? formatKpi(p.value, metric.unit) : ''}
            </text>
            <text x={x + barW / 2} y={H - pad + 14} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {dayName(p.date)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * One student's week. The same view whether they are looking at their own or a coach is looking at theirs,
 * so there is only one thing to keep right. Server actions arrive already bound to the right student.
 */
export function TrackerView({ data, path, title, sub, back, mine, chartKey, canEdit, canInstall, flash, actions }: {
  data: Tracker;
  path: string;
  title: string;
  sub: string;
  back?: { href: string; label: string };
  /** Whose tracker this is, so the page does not tell a coach these are "your" numbers. */
  mine: boolean;
  /** Which row the graph plots, from ?chart= on the URL. */
  chartKey?: string;
  canEdit: boolean;
  canInstall: boolean;
  flash: { msg?: string; err?: string };
  actions: {
    saveValues: (form: FormData) => Promise<void>;
    logDay: (form: FormData) => Promise<void>;
    saveLead: (form: FormData) => Promise<void>;
    removeLead: (form: FormData) => Promise<void>;
    install?: () => Promise<void>;
  };
}) {
  const week = data.week_start;
  const manual = data.week.filter((r) => r.entry_method === 'manual');
  const totalObjections = data.objections.reduce((n, o) => n + Number(o.count), 0);
  const chartRow = data.week.find((r) => r.key === chartKey)
    ?? data.week.find((r) => r.key === 'tracker_new_leads') ?? data.week[0] ?? null;

  if (!data.scorecard) {
    return (
      <>
        {back && <Link href={back.href}>← {back.label}</Link>}
        <PageHead sub={sub} title={title} />
        <Flash msg={flash.msg} err={flash.err} />
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No tracker yet</h2>
          <p className="muted" style={{ marginBottom: canInstall ? 12 : 0 }}>
            {canInstall
              ? 'Set up the standard sales tracker: ad spend typed in, the funnel counted from the leads logged, and the cost, conversion and ROAS figures worked out.'
              : mine ? 'Your coach has not set up the tracker for this workspace yet.'
                     : 'This workspace has no student tracker yet.'}
          </p>
          {canInstall && actions.install && (
            <form action={actions.install}><button className="btn primary" type="submit">Set up the sales tracker</button></form>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {back && <Link href={back.href}>← {back.label}</Link>}
      <PageHead sub={sub} title={title}>
        <a className="btn" href={`${path}?week=${shift(week, -7)}`}>← Previous week</a>
        <a className="btn" href={`${path}?week=${shift(week, 7)}`}>Next week →</a>
      </PageHead>
      <Flash msg={flash.msg} err={flash.err} />
      <p className="muted" style={{ margin: 0 }}>
        Week of {day(week)} to {day(data.week_end)}.{' '}
        {mine ? 'Log the day once and these numbers look after themselves.'
              : 'Everything except Ad Spend is counted from the leads below.'}
      </p>

      {canEdit && (
        <form action={actions.logDay} className="card next" key={`${data.today}-${data.leads.length}`}>
          <h2 style={{ marginTop: 0 }}>Log the day</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            One go, at the end of the day: what you spent, and who came in. Everything else works itself out.
          </p>
          <div className="row" style={{ alignItems: 'end' }}>
            <label className="f">Day<input name="day" type="date" defaultValue={data.today}
                                           min={data.week_start} max={data.week_end} required /></label>
            {manual.map((r) => (
              <label className="f" key={r.kpi_id}>
                {r.name}
                <input name={`spend_${r.kpi_id}`} type="number" step="any" style={{ width: 130 }}
                       placeholder="0" aria-label={`${r.name} for that day`} />
              </label>
            ))}
          </div>
          <label className="f">Leads that came in <span className="muted" style={{ fontWeight: 400 }}>(one per line)</span>
            <textarea name="leads" rows={5} placeholder={'Dana Example, dana@example.com, 07700 900123\nsam@example.com\nPat Riley, pat@example.com'} />
            <span className="qhelp">Name, email and phone in any order. An email on its own is fine. Mark who booked and converted in the table below as it happens.</span>
          </label>
          <div><button className="btn primary" type="submit">Log the day</button></div>
        </form>
      )}

      {!!chartRow && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0 }}>{chartRow.name} this week</h2>
            <form action={path} className="row">
              <input type="hidden" name="week" value={week} />
              <select name="chart" defaultValue={chartRow.key} aria-label="Metric to graph">
                {data.week.map((r) => <option key={r.kpi_id} value={r.key}>{r.name}</option>)}
              </select>
              <button className="btn small" type="submit">Show</button>
            </form>
          </div>
          <WeekChart data={data} metric={chartRow} />
        </div>
      )}

      <form action={actions.saveValues} className="card">
        <input type="hidden" name="week" value={week} />
        <h2 style={{ marginTop: 0 }}>{mine ? 'Your numbers' : 'Their numbers'}</h2>
        <div className="tablewrap">
          <table className="tracker">
            <thead>
              <tr>
                <th>Metric</th>
                {data.days.map((d) => (
                  <th key={d.date} className={d.date === data.today ? 'today' : undefined}>
                    {dayName(d.date)}<div className="muted">{d.date.slice(8)}</div>
                  </th>
                ))}
                <th className="total">Week</th>
              </tr>
            </thead>
            <tbody>
              {data.week.map((r) => (
                <tr key={r.kpi_id}>
                  <td><b>{r.name}</b><div className="muted" style={{ fontSize: 12 }}>{HOW[r.entry_method]}</div></td>
                  {data.days.map((d) => {
                    const cell = d.rows.find((x) => x.kpi_id === r.kpi_id);
                    return (
                      <td key={d.date} className={d.date === data.today ? 'today' : undefined}>
                        {r.entry_method === 'manual' && canEdit ? (
                          <input name={`v_${r.kpi_id}_${d.date}`} type="number" step="any" style={{ width: 84 }}
                                 defaultValue={cell?.value ?? ''} aria-label={`${r.name} on ${d.date}`} />
                        ) : formatKpi(cell?.value ?? null, r.unit)}
                      </td>
                    );
                  })}
                  <td className="total"><b>{formatKpi(r.value, r.unit)}</b>
                    {r.status && <div><Pill value={r.status} /></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && !!manual.length && (
          <div style={{ marginTop: 10 }}>
            <button className="btn primary" type="submit">Save</button>
            <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
              Only the typed rows need saving. Everything else follows the leads below.
            </span>
          </div>
        )}
      </form>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Why they said no <span className="muted" style={{ fontWeight: 400 }}>· this week</span></h2>
        {!totalObjections && <p className="empty">No objections recorded this week.</p>}
        <ul className="plain">
          {data.objections.map((o) => (
            <li key={o.id}><span>{o.label}</span><span><b>{o.count}</b></span></li>
          ))}
        </ul>
        {!data.objections.length && <p className="muted" style={{ marginBottom: 0 }}>Your coach sets the objection list for this workspace.</p>}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Leads this week ({data.leads.length})</h2>
          {canEdit && (
            <Modal label="+ One more lead" title="Add a lead" small>
              <form action={actions.saveLead}>
                <LeadFields objections={data.objections} />
                <div><button className="btn primary" type="submit">Add lead</button></div>
              </form>
            </Modal>
          )}
        </div>
        {!data.leads.length && <p className="empty">Nothing logged this week yet. Use &ldquo;Log the day&rdquo; above.</p>}
        <div className="tablewrap">
          {!!data.leads.length && (
            <table>
              <thead><tr>
                <th>Date</th><th>Name</th><th>Answered</th><th>Qualified</th><th>Booked</th><th>Taken</th>
                <th>Converted</th><th>Objection</th><th>Cash</th><th>Revenue</th><th>Follow ups</th><th />
              </tr></thead>
              <tbody>
                {data.leads.map((l) => {
                  const tick = (on: boolean) => on ? '✓' : <span className="muted">—</span>;
                  return (
                    <tr key={l.id}>
                      <td>{day(l.captured_on)}</td>
                      <td><b>{l.name || <span className="muted">no name</span>}</b>{l.email && <div className="muted">{l.email}</div>}</td>
                      <td>{tick(l.answered)}</td><td>{tick(l.qualified)}</td><td>{tick(l.booked)}</td>
                      <td>{tick(l.taken)}</td><td>{tick(l.converted)}</td>
                      <td>{data.objections.find((o) => o.id === l.objection_id)?.label ?? <span className="muted">—</span>}</td>
                      <td>{l.cash_collected ? formatKpi(l.cash_collected, 'currency') : <span className="muted">—</span>}</td>
                      <td>{l.revenue ? formatKpi(l.revenue, 'currency') : <span className="muted">—</span>}</td>
                      <td>{l.follow_up_attempts || <span className="muted">—</span>}</td>
                      <td>
                        {canEdit && (
                          <Menu label={`Manage ${l.name || 'this lead'}`}>
                            <Modal small label="Edit lead" title={`Edit ${l.name || 'lead'}`}>
                              <form action={actions.saveLead}>
                                <input type="hidden" name="id" value={l.id} />
                                <LeadFields lead={l} objections={data.objections} />
                                <div><button className="btn primary" type="submit">Save lead</button></div>
                              </form>
                            </Modal>
                            <hr />
                            <form action={actions.removeLead}>
                              <input type="hidden" name="id" value={l.id} />
                              <button className="menu-item danger" type="submit">Remove lead</button>
                            </form>
                          </Menu>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {!!data.leads.length && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Notes are on each lead: open the menu and choose Edit.
          </p>
        )}
      </div>
    </>
  );
}

/** Turns the posted lead form into what saveLead expects. Shared by both pages. */
export function leadFromForm(form: FormData) {
  const num = (k: string) => Number(String(form.get(k) ?? '0') || 0);
  const str = (k: string) => String(form.get(k) ?? '').trim() || undefined;
  return {
    id: str('id'),
    captured_on: str('captured_on'),
    name: str('name'), phone: str('phone'), email: str('email'),
    answered: form.get('answered') === 'on',
    qualified: form.get('qualified') === 'on',
    booked: form.get('booked') === 'on',
    taken: form.get('taken') === 'on',
    converted: form.get('converted') === 'on',
    objection_id: str('objection_id') ?? null,
    cash_collected: num('cash_collected'),
    revenue: num('revenue'),
    follow_up_attempts: num('follow_up_attempts'),
    notes: str('notes'),
  };
}
