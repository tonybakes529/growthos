import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getQuestionnaire, submitQuestionnaire } from '@/modules/onboarding/actions';
import { getPendingOnboarding } from '@/modules/customers/actions';
import { setTaskStatus } from '@/modules/tasks/actions';
import { done } from '@/components/flash';
import { Bar, Flash, PageHead, Pill, Stat, day, dayTime } from '@/components/ui';

const fmt = (v: number | null, unit: string | null) =>
  v == null ? '—' : unit === 'currency' ? `$${Math.round(v).toLocaleString('en-US')}` : unit === 'percent' ? `${Math.round(v)}%` : Math.round(v * 100) / 100;

export default async function WorkspaceHome({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const org = ctx.organizationId;
  const me = ctx.ctx.effective_user_id;
  const path = `/w/${orgSlug}`;

  const [kpis, myTaskIds, calls, wins, blockers, enrollments, announcements, q, pending, customers] = await Promise.all([
    ctx.sb.from('kpi_latest_v').select('kpi_definition_id, kpi_name, kpi_key, unit, value, target_value, status, period_start').eq('organization_id', org),
    ctx.sb.from('task_assignments').select('task_id').eq('user_id', me).eq('organization_id', org),
    ctx.sb.from('coaching_sessions').select('id, title, scheduled_start, scheduled_end, status').eq('organization_id', org)
      .eq('status', 'scheduled').gte('scheduled_start', new Date().toISOString()).order('scheduled_start').limit(3),
    ctx.sb.from('client_wins').select('id, title, occurred_on').eq('organization_id', org).is('deleted_at', null).order('occurred_on', { ascending: false }).limit(4),
    ctx.sb.from('client_blockers').select('id, title, severity, status').eq('organization_id', org).is('deleted_at', null).in('status', ['open', 'in_progress']).limit(4),
    ctx.sb.from('program_enrollments').select('program_id, progress_percent, lessons_completed, lessons_total').eq('organization_id', org).eq('user_id', me),
    ctx.sb.from('announcements').select('id, title, body, publish_at').eq('organization_id', org).is('deleted_at', null).order('publish_at', { ascending: false }).limit(2),
    getQuestionnaire({ orgSlug }),
    ctx.roleKey === 'student' ? getPendingOnboarding({}) : null,
    can(ctx, 'enrollments.read') ? ctx.sb.from('customer_onboardings').select('status').eq('organization_id', org) : null,
  ]);
  if (pending?.ok && pending.data?.organization_slug === orgSlug) redirect(`/start/${orgSlug}`);
  const taskIds = (myTaskIds.data ?? []).map((t) => t.task_id);
  const progIds = (enrollments.data ?? []).map((e) => e.program_id);
  const [taskRes, progRes] = await Promise.all([
    taskIds.length
      ? ctx.sb.from('tasks').select('id, title, status, due_at').in('id', taskIds).is('deleted_at', null)
          .not('status', 'in', '(done,canceled)').order('due_at', { nullsFirst: false }).limit(6)
      : null,
    progIds.length ? ctx.sb.from('programs').select('id, title').in('id', progIds) : null,
  ]);
  const tasks = taskRes?.data ?? [];
  const progs = progRes?.data ?? [];
  const questionnaire = q.ok ? q.data : null;
  const showQuestionnaire = questionnaire && !questionnaire.submitted_at && can(ctx, 'organization.update');

  async function complete(form: FormData) {
    'use server';
    done(path, await setTaskStatus({ taskId: String(form.get('id')), status: 'done' }), 'Task completed');
  }
  async function submitQ(form: FormData) {
    'use server';
    const answers: Record<string, string | null> = {};
    for (const [k, v] of form.entries()) if (!k.startsWith('$')) answers[k] = String(v) || null;
    done(path, await submitQuestionnaire({ orgSlug, answers }), 'Onboarding questionnaire submitted. Your workspace is active.');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="Dashboard">
        {can(ctx, 'kpis.create') && <Link className="btn primary" href={`${path}/scorecard`}>Submit scorecard</Link>}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err} />

      {customers?.data && customers.data.length > 0 && (
        <div className="grid g4">
          <Link href={`${path}/customers`} style={{ textDecoration: 'none', color: 'inherit' }}><Stat k="Customers" v={customers.data.length} s="View all" /></Link>
          <Stat k="Invited" v={customers.data.filter((c) => c.status === 'invited').length} s="No login yet" />
          <Stat k="Onboarding in progress" v={customers.data.filter((c) => c.status === 'registered' || c.status === 'in_progress').length} />
          <Stat k="Onboarding complete" v={customers.data.filter((c) => c.status === 'completed').length} />
        </div>
      )}

      {showQuestionnaire && (
        <form className="card" action={submitQ} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Finish onboarding: {questionnaire.name}</h2>
          <div className="grid g2" style={{ gap: 10 }}>
            {questionnaire.questions.map((qq) => (
              <label key={qq.key} className="f">{qq.label}{qq.required ? ' *' : ''}{qq.type === 'currency' ? ' ($)' : ''}
                {qq.type === 'long_text'
                  ? <textarea name={qq.key} required={qq.required} />
                  : <input name={qq.key} required={qq.required} type={['number', 'currency', 'percent'].includes(qq.type) ? 'number' : 'text'} />}
              </label>
            ))}
          </div>
          <div><button className="btn primary" type="submit">Submit</button></div>
        </form>
      )}

      <div className="grid g4">
        {(kpis.data ?? []).slice(0, 8).map((k) => (
          <div key={k.kpi_definition_id} className="card stat">
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="k">{k.kpi_name}</span><Pill value={k.status} /></div>
            <div className="v">{fmt(k.value, k.unit)}</div>
            <div className="s">Target {fmt(k.target_value, k.unit)} · week of {day(k.period_start)}</div>
          </div>
        ))}
        {!kpis.data?.length && <Stat k="KPIs" v="—" s="No numbers you can see yet" />}
      </div>

      <div className="grid g3">
        <div className="card">
          <h2>My tasks</h2>
          <ul className="plain">
            {tasks.map((t) => (
              <li key={t.id}>
                <span>{t.title}<div className="muted">{t.due_at ? `Due ${day(t.due_at)}` : 'No due date'}</div></span>
                <form action={complete}><input type="hidden" name="id" value={t.id} /><button className="btn small" type="submit">Done</button></form>
              </li>
            ))}
            {!tasks.length && <li className="muted">Nothing assigned to you.</li>}
          </ul>
          <p><Link href={`${path}/tasks`}>All tasks</Link></p>
        </div>
        <div className="card">
          <h2>Upcoming calls</h2>
          <ul className="plain">
            {(calls.data ?? []).map((c) => <li key={c.id}><span><b>{c.title}</b><div className="muted">{dayTime(c.scheduled_start)}</div></span></li>)}
            {!calls.data?.length && <li className="muted">No calls scheduled.</li>}
          </ul>
          <h2 style={{ marginTop: 16 }}>My programs</h2>
          {(enrollments.data ?? []).map((e) => (
            <div key={e.program_id} style={{ marginBottom: 10 }}>
              <Link href={`${path}/programs/${e.program_id}`}>{progs.find((p) => p.id === e.program_id)?.title ?? 'Program'}</Link>
              <Bar pct={Number(e.progress_percent)} />
              <div className="muted">{e.lessons_completed} of {e.lessons_total} lessons</div>
            </div>
          ))}
          {!enrollments.data?.length && <p className="muted">Not enrolled in any program.</p>}
        </div>
        <div className="card">
          <h2>Wins</h2>
          <ul className="plain">
            {(wins.data ?? []).map((w) => <li key={w.id}><span>{w.title}</span><span className="muted">{day(w.occurred_on)}</span></li>)}
            {!wins.data?.length && <li className="muted">No wins logged yet.</li>}
          </ul>
          <h2 style={{ marginTop: 16 }}>Blockers</h2>
          <ul className="plain">
            {(blockers.data ?? []).map((b) => <li key={b.id}><span>{b.title}</span><Pill value={b.severity} /></li>)}
            {!blockers.data?.length && <li className="muted">No open blockers.</li>}
          </ul>
        </div>
      </div>

      {!!announcements.data?.length && (
        <div className="card">
          <h2>Announcements</h2>
          {announcements.data.map((a) => <div key={a.id} className="block"><b>{a.title}</b><div>{a.body}</div></div>)}
        </div>
      )}
    </>
  );
}
