import { requireOrgPage, can } from '@/lib/auth/context';
import { getWeeklyScorecard, submitWeeklyScorecard } from '@/modules/kpis/actions';
import { done } from '@/components/flash';
import { SubNav, growthTabs } from '@/components/subnav';
import { Flash, PageHead, Pill, day } from '@/components/ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function Scorecard({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ week?: string; msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/scorecard`;
  if (!can(ctx, 'kpis.read')) {
    return (<><PageHead sub={ctx.name} title="Growth · Weekly Scorecard" /><div className="card muted">You don&apos;t have access to the scorecard.</div></>);
  }
  const cards = (await ctx.sb.from('scorecards').select('id, name').eq('organization_id', ctx.organizationId).is('deleted_at', null).limit(1)).data ?? [];
  const card = cards[0];
  if (!card) return (<><PageHead sub={ctx.name} title="Growth · Weekly Scorecard" /><div className="card muted">No scorecard set up for this workspace yet. Your Growth OS team adds one from a template.</div></>);

  const lastWeek = new Date(); lastWeek.setDate(lastWeek.getDate() - 7);
  const week = sp.week ?? iso(lastWeek);
  const res = await getWeeklyScorecard({ orgSlug, scorecardId: card.id, weekOf: week });
  if (!res.ok) return <Flash err={res.error.message} />;
  const { rows, weekStart, submission } = res.data;
  const shift = (days: number) => { const d = new Date(`${weekStart}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
  const editable = can(ctx, 'kpis.create');

  async function submit(form: FormData) {
    'use server';
    const values: Record<string, number> = {};
    for (const [k, v] of form.entries()) if (k.startsWith('k_') && String(v) !== '') values[k.slice(2)] = Number(v);
    const lines = (k: string) => String(form.get(k) || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const ws = String(form.get('week'));
    done(`${path}`, await submitWeeklyScorecard({ scorecardId: card!.id, weekOf: ws, values, wins: lines('wins'), blockers: lines('blockers'),
      summary: String(form.get('summary') || '') || undefined }), `Scorecard for week of ${ws} submitted`);
  }

  return (
    <>
      <PageHead sub={ctx.name} title={`${card.name} · Week of ${day(weekStart)}`}>
        <a className="btn" href={`${path}?week=${shift(-7)}`}>← Previous week</a>
        <a className="btn" href={`${path}?week=${shift(7)}`}>Next week →</a>
      </PageHead>
      <SubNav items={growthTabs(orgSlug, true, can(ctx, 'sales.read'))} current="scorecard" />
      <Flash msg={sp.msg} err={sp.err} />
      {submission && <div className="muted">Submitted {day(submission.submitted_at)} · status <Pill value={submission.status === 'submitted' ? 'on_track' : submission.status} label={submission.status} /></div>}
      <form action={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <input type="hidden" name="week" value={weekStart} />
        <div className="card">
          <table>
            <thead><tr><th>KPI</th><th>Unit</th><th>This week</th><th>Last week</th><th>Target</th><th>Change</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b>{r.is_financial && <div className="muted">financial</div>}</td>
                  <td>{r.unit}</td>
                  <td>
                    {r.entry_method === 'calculated' ? <span className="muted">calculated</span> : (
                      <input name={`k_${r.id}`} type="number" step="any" defaultValue={r.entry?.value ?? ''} aria-label={`${r.name} this week`}
                             required={r.isRequired} disabled={!editable} style={{ width: 110 }} />
                    )}
                  </td>
                  <td>{r.entry?.previous_value ?? '—'}</td>
                  <td>{r.entry?.target_value ?? r.goal_value ?? '—'}</td>
                  <td>{r.entry?.change_percent != null ? `${r.entry.change_percent > 0 ? '+' : ''}${r.entry.change_percent}%` : '—'}</td>
                  <td>{r.entry ? <Pill value={r.entry.status} /> : <Pill value="none" label="not entered" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid g3">
          <label className="card f">Wins (one per line)<textarea name="wins" /></label>
          <label className="card f">Blockers (one per line)<textarea name="blockers" /></label>
          <label className="card f">Notes for your coach<textarea name="summary" defaultValue={submission?.summary ?? ''} /></label>
        </div>
        {editable && <div><button className="btn primary" type="submit">Submit scorecard</button></div>}
      </form>
    </>
  );
}
