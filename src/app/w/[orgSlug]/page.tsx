import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrgPage, can, isLearner, type OrgContext } from '@/lib/auth/context';
import { getQuestionnaire, submitQuestionnaire } from '@/modules/onboarding/actions';
import { getPendingOnboarding } from '@/modules/customers/actions';
import { listMyEnrollments } from '@/modules/enrollments/actions';
import { getProgramOutline } from '@/modules/programs/actions';
import { listTasks, setTaskStatus } from '@/modules/tasks/actions';
import { done } from '@/components/flash';
import { Bar, Flash, PageHead, Pill, Stat, day, dayTime, money } from '@/components/ui';

const fmt = (v: number | null, unit: string | null) =>
  v == null ? '—' : unit === 'currency' ? `$${Math.round(v).toLocaleString('en-US')}` : unit === 'percent' ? `${Math.round(v)}%` : Math.round(v * 100) / 100;

/** Monday of the week people report on. The scorecard covers the previous week, so that is the one that is "due". */
function reportingWeek(): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 7);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export default async function WorkspaceHome({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  return isLearner(ctx) ? <LearnerHome ctx={ctx} sp={sp} /> : <TeamHome ctx={ctx} sp={sp} />;
}

// ---------------------------------------------------------------------------------------------
// Customer / student: "What do I do next?"
// ---------------------------------------------------------------------------------------------
async function LearnerHome({ ctx, sp }: { ctx: OrgContext; sp: { msg?: string; err?: string } }) {
  const path = `/w/${ctx.slug}`;
  const [pending, enrollments, tasks, calls] = await Promise.all([
    getPendingOnboarding({}),
    listMyEnrollments({ orgSlug: ctx.slug }),
    listTasks({ orgSlug: ctx.slug, mine: true, statuses: ['todo', 'in_progress', 'blocked', 'in_review'], limit: 20 }),
    ctx.sb.from('coaching_sessions').select('id, title, scheduled_start').eq('organization_id', ctx.organizationId)
      .eq('status', 'scheduled').gte('scheduled_start', new Date().toISOString()).order('scheduled_start').limit(3),
  ]);
  // Unfinished onboarding always comes first, and it lives outside the shell.
  if (pending.ok && pending.data?.organization_slug === ctx.slug) redirect(`/start/${ctx.slug}`);

  const active = (enrollments.ok ? enrollments.data : []).filter((e) => e.status === 'active' || e.status === 'completed');
  // The outline RPC applies drip, sequencing and enrolment, so "next lesson" is always one they can actually open.
  const outlines = await Promise.all(active.filter((e) => e.status === 'active').slice(0, 5).map(async (e) => ({ e, outline: await getProgramOutline({ programId: e.program_id }) })));
  let next: { kind: 'lesson' | 'start' | 'locked'; href: string; title: string; sub: string } | null = null;
  let anyLessons = false;
  for (const { e, outline } of outlines) {
    if (!outline.ok) continue;
    const lessons = outline.data.sections.flatMap((s) => s.modules.flatMap((m) => m.lessons));
    if (lessons.length) anyLessons = true;
    const open = lessons.find((l) => l.progress !== 'completed' && l.isAvailable);
    const course = e.program?.title ?? 'your course';
    if (open) { next = { kind: Number(e.lessons_completed) ? 'lesson' : 'start', href: `${path}/lessons/${open.id}`, title: open.title, sub: course }; break; }
    const locked = lessons.find((l) => l.progress !== 'completed');
    if (locked && !next) next = { kind: 'locked', href: `${path}/programs/${e.program_id}`, title: locked.title, sub: `${course}${locked.unlocksAt ? ` · unlocks ${day(locked.unlocksAt)}` : locked.lockReason ? ` · ${locked.lockReason.replace(/_/g, ' ')}` : ''}` };
  }
  const openTasks = tasks.ok ? tasks.data : [];
  const firstTask = openTasks[0];

  async function complete(form: FormData) {
    'use server';
    done(path, await setTaskStatus({ taskId: String(form.get('id')), status: 'done' }), 'Task completed');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="Home" />
      <Flash msg={sp.msg} err={sp.err} />

      <div className="card next">
        {next?.kind === 'lesson' && (<>
          <h2>Continue where you left off</h2>
          <p style={{ margin: '0 0 12px' }}><b>{next.title}</b><br /><span className="muted">{next.sub}</span></p>
          <Link className="btn primary" href={next.href}>Continue lesson</Link>
        </>)}
        {next?.kind === 'start' && (<>
          <h2>Ready to begin</h2>
          <p style={{ margin: '0 0 12px' }}><b>{next.sub}</b><br /><span className="muted">First lesson: {next.title}</span></p>
          <Link className="btn primary" href={next.href}>Start the course</Link>
        </>)}
        {next?.kind === 'locked' && (<>
          <h2>Your next lesson is on its way</h2>
          <p style={{ margin: '0 0 12px' }}><b>{next.title}</b><br /><span className="muted">{next.sub}</span></p>
          <Link className="btn" href={next.href}>View the course</Link>
        </>)}
        {!next && firstTask && (<>
          <h2>Next up: a task for you</h2>
          <p style={{ margin: '0 0 12px' }}><b>{firstTask.title}</b>{firstTask.due_at && <span className="muted"> · due {day(firstTask.due_at)}</span>}</p>
          <Link className="btn primary" href={`${path}/tasks?view=mine`}>Open my tasks</Link>
        </>)}
        {!next && !firstTask && active.length > 0 && anyLessons && (<>
          <h2>You&apos;re all caught up</h2>
          <p className="muted" style={{ margin: 0 }}>Every lesson you can access is complete and nothing is assigned to you.</p>
        </>)}
        {!next && !firstTask && active.length > 0 && !anyLessons && (<>
          <h2>Your course content is on its way</h2>
          <p className="muted" style={{ margin: 0 }}>{ctx.name} hasn&apos;t published lessons yet. You&apos;ll see your first lesson here as soon as they do.</p>
        </>)}
        {!next && !firstTask && !active.length && (<>
          <h2>Nothing here yet</h2>
          <p className="muted" style={{ margin: 0 }}>You&apos;re not enrolled in a course in this workspace. {ctx.name} will add you when your course is ready.</p>
        </>)}
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>My courses</h2>
          {enrollments.ok && !active.length && <p className="empty">No courses yet.</p>}
          {!enrollments.ok && <p className="flash err">Could not load your courses.</p>}
          {active.map((e) => (
            <div key={e.id} style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Link href={`${path}/programs/${e.program_id}`}><b>{e.program?.title ?? 'Course'}</b></Link>
                {e.status === 'completed' ? <Pill value="completed" /> : <span className="muted">{e.lessons_completed} of {e.lessons_total} lessons</span>}
              </div>
              <Bar pct={Number(e.progress_percent)} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h2>My tasks</h2>
            {tasks.ok && !openTasks.length && <p className="empty">Nothing assigned to you.</p>}
            <ul className="attn">
              {openTasks.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <span>{t.title}<div className="muted">{t.due_at ? `Due ${day(t.due_at)}` : 'No due date'}</div></span>
                  <form action={complete}><input type="hidden" name="id" value={t.id} /><button className="btn small" type="submit">Done</button></form>
                </li>
              ))}
            </ul>
            {openTasks.length > 5 && <p style={{ marginBottom: 0 }}><Link href={`${path}/tasks?view=mine`}>All my tasks</Link></p>}
          </div>
          <div className="card">
            <h2>Upcoming calls</h2>
            {!calls.data?.length && <p className="empty">No calls scheduled.</p>}
            <ul className="attn">{(calls.data ?? []).map((c) => <li key={c.id}><span><b>{c.title}</b></span><span className="muted">{dayTime(c.scheduled_start)}</span></li>)}</ul>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Client team and operator inside a workspace: "What needs to happen next in this business?"
// ---------------------------------------------------------------------------------------------
async function TeamHome({ ctx, sp }: { ctx: OrgContext; sp: { msg?: string; err?: string } }) {
  const org = ctx.organizationId;
  const path = `/w/${ctx.slug}`;
  const week = reportingWeek();
  const nowIso = new Date().toISOString();
  const seeCustomers = can(ctx, 'enrollments.read');
  const seeKpis = can(ctx, 'kpis.read');
  const seeSales = can(ctx, 'sales.read');

  const [myTasks, overdue, customers, scorecards, weekly, kpis, enrollments, courses, deals, calls, wins, blockers, q] = await Promise.all([
    listTasks({ orgSlug: ctx.slug, mine: true, statuses: ['todo', 'in_progress', 'blocked', 'in_review'], limit: 50 }),
    listTasks({ orgSlug: ctx.slug, overdueOnly: true, limit: 100 }),
    seeCustomers ? ctx.sb.from('customer_onboardings').select('status, program_id').eq('organization_id', org) : null,
    seeKpis ? ctx.sb.from('scorecards').select('id, name').eq('organization_id', org).is('deleted_at', null).limit(1) : null,
    seeKpis ? ctx.sb.from('weekly_scorecards').select('scorecard_id, status').eq('organization_id', org).eq('period_start', week) : null,
    seeKpis ? ctx.sb.from('kpi_latest_v').select('kpi_definition_id, kpi_name, unit, value, target_value, status, period_start').eq('organization_id', org) : null,
    seeCustomers ? ctx.sb.from('program_enrollments').select('status, progress_percent').eq('organization_id', org).in('status', ['active', 'completed']) : null,
    ctx.sb.from('programs').select('id, status, onboarding_form_id').eq('organization_id', org).is('deleted_at', null),
    seeSales ? ctx.sb.from('opportunities').select('value_cents').eq('organization_id', org).eq('status', 'open').is('deleted_at', null) : null,
    ctx.sb.from('coaching_sessions').select('id, title, scheduled_start').eq('organization_id', org).eq('status', 'scheduled').gte('scheduled_start', nowIso).order('scheduled_start').limit(3),
    ctx.sb.from('client_wins').select('id, title, occurred_on').eq('organization_id', org).is('deleted_at', null).order('occurred_on', { ascending: false }).limit(3),
    ctx.sb.from('client_blockers').select('id, title, severity').eq('organization_id', org).is('deleted_at', null).in('status', ['open', 'in_progress']).limit(5),
    can(ctx, 'organization.update') ? getQuestionnaire({ orgSlug: ctx.slug }) : null,
  ]);

  const mine = myTasks.ok ? myTasks.data : [];
  const overdueCount = overdue.ok ? overdue.data.length : 0;
  const cs = customers?.data ?? [];
  // "Not finished onboarding" only makes sense when their course actually has a form to fill in.
  const withForm = new Set((courses.data ?? []).filter((c) => c.onboarding_form_id).map((c) => c.id));
  const unfinished = cs.filter((c) => (c.status === 'registered' || c.status === 'in_progress') && withForm.has(c.program_id)).length;
  const invited = cs.filter((c) => c.status === 'invited').length;
  const card = scorecards?.data?.[0] ?? null;
  const weekRow = card ? (weekly?.data ?? []).find((w) => w.scorecard_id === card.id) : null;
  const scorecardDue = !!card && (!weekRow || weekRow.status === 'open' || weekRow.status === 'missed');
  const offTrack = (kpis?.data ?? []).filter((k) => k.status === 'off_track').length;
  const enr = enrollments?.data ?? [];
  const avgProgress = enr.length ? Math.round(enr.reduce((s, e) => s + Number(e.progress_percent), 0) / enr.length) : null;
  const published = (courses.data ?? []).filter((c) => c.status === 'published').length;
  const dealCount = deals?.data?.length ?? 0;
  const dealValue = (deals?.data ?? []).reduce((s, d) => s + (d.value_cents ?? 0), 0);
  const questionnaire = q?.ok ? q.data : null;
  const showQuestionnaire = questionnaire && !questionnaire.submitted_at;
  const now = Date.now();

  // The attention list: only real, actionable items, each linking to where it gets fixed.
  const attention: { text: string; href: string; tone: string }[] = [];
  if (overdueCount) attention.push({ text: `${overdueCount} overdue task${overdueCount === 1 ? '' : 's'}`, href: `${path}/tasks?view=overdue`, tone: 'overdue' });
  if (scorecardDue) attention.push({ text: `Weekly scorecard for week of ${day(week)} not submitted`, href: `${path}/scorecard?week=${week}`, tone: 'at_risk' });
  if (unfinished) attention.push({ text: `${unfinished} customer${unfinished === 1 ? ' has' : 's have'} not finished onboarding`, href: `${path}/customers?status=in_progress`, tone: 'at_risk' });
  if (invited) attention.push({ text: `${invited} invited customer${invited === 1 ? '' : 's'} not signed up yet`, href: `${path}/customers?status=invited`, tone: 'none' });
  if (offTrack) attention.push({ text: `${offTrack} KPI${offTrack === 1 ? '' : 's'} off track`, href: `${path}/scorecard`, tone: 'off_track' });
  if (blockers.data?.length) attention.push({ text: `${blockers.data.length} open blocker${blockers.data.length === 1 ? '' : 's'}`, href: `${path}/tasks`, tone: 'at_risk' });

  async function complete(form: FormData) {
    'use server';
    done(path, await setTaskStatus({ taskId: String(form.get('id')), status: 'done' }), 'Task completed');
  }
  async function submitQ(form: FormData) {
    'use server';
    const answers: Record<string, string | null> = {};
    for (const [k, v] of form.entries()) if (!k.startsWith('$')) answers[k] = String(v) || null;
    done(path, await submitQuestionnaire({ orgSlug: ctx.slug, answers }), 'Onboarding questionnaire submitted. Your workspace is active.');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="Home">
        {seeCustomers && can(ctx, 'enrollments.create') && <Link className="btn" href={`${path}/customers?add=1`}>Add customer</Link>}
        {scorecardDue && can(ctx, 'kpis.create') && <Link className="btn primary" href={`${path}/scorecard?week=${week}`}>Submit scorecard</Link>}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err} />

      {showQuestionnaire && (
        <form className="card next" action={submitQ} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div><h2 style={{ marginBottom: 2 }}>Finish setting up: {questionnaire.name}</h2>
            <p className="muted" style={{ margin: 0 }}>A few questions from your Growth OS team so they can tailor your program. This card disappears once submitted.</p></div>
          <div className="grid g2" style={{ gap: 10 }}>
            {questionnaire.questions.map((qq) => (
              <label key={qq.key} className="f">{qq.label}{qq.required ? ' *' : ''}{qq.type === 'currency' ? ' ($)' : ''}
                {qq.type === 'long_text' ? <textarea name={qq.key} required={qq.required} />
                  : <input name={qq.key} required={qq.required} type={['number', 'currency', 'percent'].includes(qq.type) ? 'number' : 'text'} />}
              </label>
            ))}
          </div>
          <div><button className="btn primary" type="submit">Submit</button></div>
        </form>
      )}

      <div className="grid g2">
        <div className="card">
          <h2>Needs attention</h2>
          {!attention.length && <p className="empty">Nothing needs attention right now.</p>}
          <ul className="attn">
            {attention.map((a) => <li key={a.text}><Link href={a.href}>{a.text}</Link><Pill value={a.tone} label={a.tone === 'none' ? 'waiting' : a.tone.replace('_', ' ')} /></li>)}
          </ul>
        </div>
        <div className="card">
          <h2>My tasks</h2>
          {myTasks.ok && !mine.length && <p className="empty">Nothing assigned to you. <Link href={`${path}/tasks`}>See all tasks</Link>.</p>}
          {!myTasks.ok && <p className="flash err">Could not load tasks.</p>}
          <ul className="attn">
            {mine.slice(0, 5).map((t) => {
              const late = t.due_at && Date.parse(t.due_at) < now;
              return (
                <li key={t.id}>
                  <span>{t.title}<div className="muted">{t.due_at ? (late ? <span style={{ color: 'var(--red)' }}>Overdue · {day(t.due_at)}</span> : `Due ${day(t.due_at)}`) : 'No due date'}</div></span>
                  <form action={complete}><input type="hidden" name="id" value={t.id} /><button className="btn small" type="submit">Done</button></form>
                </li>
              );
            })}
          </ul>
          {mine.length > 5 && <p style={{ marginBottom: 0 }}><Link href={`${path}/tasks?view=mine`}>{mine.length - 5} more</Link></p>}
        </div>
      </div>

      <div className="grid g4">
        {seeCustomers && (
          <Link href={`${path}/customers`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Stat k="Customers" v={cs.length} s={cs.length ? `${cs.filter((c) => c.status === 'completed').length} onboarded · ${unfinished + invited} in progress` : 'None yet'} />
          </Link>
        )}
        <Link href={`${path}/programs`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Stat k="Courses" v={published} s={seeCustomers ? (enr.length ? `${enr.length} enrolled · avg ${avgProgress}% complete` : 'No one enrolled yet') : `${(courses.data ?? []).length} total`} />
        </Link>
        {seeKpis && (
          <Link href={`${path}/scorecard`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Stat k="Weekly scorecard" v={!card ? '—' : scorecardDue ? 'Due' : 'Submitted'} s={!card ? 'Not set up yet' : `Week of ${day(week)}${offTrack ? ` · ${offTrack} off track` : ''}`} />
          </Link>
        )}
        {seeSales && <Stat k="Open deals" v={dealCount} s={dealCount ? `${money(dealValue)} in pipeline` : 'Sales tracked off platform'} />}
      </div>

      {seeKpis && !!kpis?.data?.length && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2>Latest KPIs</h2><Link href={`${path}/scorecard`}>Open scorecard</Link></div>
          <div className="grid g4">
            {kpis.data.slice(0, 8).map((k) => (
              <div key={k.kpi_definition_id}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted" style={{ fontSize: 12 }}>{k.kpi_name}</span><Pill value={k.status} /></div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(k.value, k.unit)}</div>
                <div className="muted" style={{ fontSize: 12 }}>Target {fmt(k.target_value, k.unit)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid g3">
        <div className="card">
          <h2>Upcoming calls</h2>
          {!calls.data?.length && <p className="empty">No calls scheduled.</p>}
          <ul className="attn">{(calls.data ?? []).map((c) => <li key={c.id}><span><b>{c.title}</b></span><span className="muted">{dayTime(c.scheduled_start)}</span></li>)}</ul>
        </div>
        <div className="card">
          <h2>Recent wins</h2>
          {!wins.data?.length && <p className="empty">No wins logged yet. Wins are captured with the weekly scorecard.</p>}
          <ul className="attn">{(wins.data ?? []).map((w) => <li key={w.id}><span>{w.title}</span><span className="muted">{day(w.occurred_on)}</span></li>)}</ul>
        </div>
        <div className="card">
          <h2>Open blockers</h2>
          {!blockers.data?.length && <p className="empty">No open blockers.</p>}
          <ul className="attn">{(blockers.data ?? []).map((b) => <li key={b.id}><span>{b.title}</span><Pill value={b.severity} /></li>)}</ul>
        </div>
      </div>
    </>
  );
}
