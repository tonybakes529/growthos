import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getStudent, remindOnboarding, reopenOnboarding } from '@/modules/students/actions';
import { formatAnswer } from '@/modules/onboarding-forms/types';
import { done } from '@/components/flash';
import { Bar, Flash, PageHead, Pill, day, dayTime } from '@/components/ui';

/** The one page the team opens to understand a student: what they answered first, then journey, courses and tasks. */
export default async function Student({ params, searchParams }: {
  params: Promise<{ orgSlug: string; studentId: string }>; searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const [{ orgSlug, studentId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const back = `/w/${orgSlug}/students`;
  const path = `${back}/${studentId}`;
  if (!can(ctx, 'enrollments.read')) notFound();
  const res = await getStudent({ orgSlug, onboardingId: studentId });
  if (!res.ok) notFound();   // another client's id gets the same answer: RLS hides the row
  const c = res.data;
  const r = c.record;
  const inviteState = c.invitation && r.status === 'invited'
    ? (c.invitation.status === 'pending' && Date.parse(c.invitation.expires_at) < Date.now() ? 'link expired' : `link ${c.invitation.status}`) : undefined;
  const steps: [string, string | null, string?][] = [
    ['Invited', r.invited_at, inviteState],
    ['Created their login', r.registered_at],
    ['Started onboarding', r.started_at],
    ['Completed onboarding', r.completed_at],
  ];
  const openTasks = c.tasks.filter((t) => !['done', 'canceled'].includes(t.status));
  const now = Date.now();
  const canReopen = can(ctx, 'enrollments.update');

  async function reopen(form: FormData) {
    'use server';
    done(path, await reopenOnboarding({ orgSlug, onboardingId: String(form.get('id')) }),
      'Form reopened. They can change their answers the next time they sign in.');
  }
  async function remind(form: FormData) {
    'use server';
    done(path, await remindOnboarding({ orgSlug, onboardingId: String(form.get('id')) }),
      (d) => d.emailConfigured
        ? `Reminder sent to ${d.to}.`
        : `Reminder queued for ${d.to}. Email is not set up here, so it will go out once it is.`);
  }

  return (
    <>
      <Link href={back}>← Students</Link>
      <PageHead sub={ctx.name} title={c.name}>
        <Pill value={r.status === 'invited' ? 'pending' : 'active'} label={c.account} />
        <Pill value={r.status === 'completed' ? 'completed' : r.status === 'in_progress' ? 'in_progress' : 'none'} label={`Onboarding: ${c.onboarding.toLowerCase()}`} />
      </PageHead>
      <Flash msg={sp.msg} err={sp.err} />

      {c.forms.map((f) => {
        const answered = f.responses.filter((q) => q.answer).length;
        return (
          <div className="card" key={f.onboardingId}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 style={{ margin: 0 }}>
                {f.formName ?? 'Onboarding'}
                {f.course && <span className="muted" style={{ fontWeight: 400 }}> · {f.course}</span>}
                {!!f.responses.length && <span className="muted" style={{ fontWeight: 400 }}> ({answered} of {f.responses.length} answered)</span>}
              </h2>
              <div className="row">
                {f.completed_at && <span className="muted">submitted {day(f.completed_at)}</span>}
                {canReopen && f.status === 'completed' && (
                  <form action={reopen}><input type="hidden" name="id" value={f.onboardingId} />
                    <button className="btn small" type="submit">Reopen form</button></form>
                )}
                {canReopen && f.status !== 'completed' && !!f.formName && !!r.user_id && (
                  <form action={remind}><input type="hidden" name="id" value={f.onboardingId} />
                    <button className="btn small" type="submit">Send reminder</button></form>
                )}
              </div>
            </div>
            {!f.formName ? (
              <p className="empty">
                There is no onboarding form for them to fill in yet.{' '}
                {can(ctx, 'programs.read') && <Link href={`/w/${orgSlug}/onboarding`}>Set one up</Link>}
              </p>
            ) : !answered ? (
              <p className="empty">{r.status === 'invited' ? 'They haven’t created their login yet.' : 'Nothing answered yet.'}</p>
            ) : f.responses.map((q) => (
              <div className="answer" key={q.id}>
                <b>{q.label}</b>{q.deleted_at && <span className="muted"> (question since removed)</span>}
                <div className="a">{q.answer ? formatAnswer(q.answer.value) : <span className="muted">No answer</span>}</div>
              </div>
            ))}
            {f.status === 'in_progress' && answered > 0 && <p className="muted" style={{ marginBottom: 0 }}>Still in progress. These are saved drafts and may change.</p>}
          </div>
        );
      })}

      <div className="grid g2">
        <div className="card">
          <h2>Journey</h2>
          <ul className="timeline">
            {steps.map(([label, at, note]) => (
              <li key={label} className={at ? '' : 'todo'}>
                <span>{at ? '✓' : '○'} {label}{note && <span className="muted"> ({note})</span>}</span>
                <span className="muted">{at ? dayTime(at) : 'Not yet'}</span>
              </li>
            ))}
          </ul>
          {r.status === 'invited' && can(ctx, 'enrollments.create') && (
            <p className="muted" style={{ marginBottom: 0 }}>
              {inviteState === 'link expired' ? 'Their link has expired.' : 'Waiting for them to create their login.'} To send a fresh link, <Link href={`${back}?add=1`}>add them again</Link> with the same email. The old link stops working.
            </p>
          )}
        </div>
        <div className="card">
          <h2>Details</h2>
          <ul className="plain">
            <li><span className="muted">Email</span><span>{r.email}</span></li>
            {c.contact?.phone && <li><span className="muted">Phone</span><span>{c.contact.phone}</span></li>}
            {c.contact?.company && <li><span className="muted">Company</span><span>{c.contact.company}</span></li>}
            <li><span className="muted">Course on this record</span><span>{c.course ?? <span className="muted">none, workspace onboarding</span>}</span></li>
            <li><span className="muted">Came from</span><span>{r.purchase_id ? 'Purchase' : 'Added by your team'}</span></li>
          </ul>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Courses</h2>
          {!r.user_id && <p className="empty">Course progress appears once they create their login.</p>}
          {r.user_id && !c.enrollments.length && <p className="empty">Not enrolled in any course.</p>}
          {c.enrollments.map((e) => (
            <div key={e.id} style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Link href={`/w/${orgSlug}/programs/${e.program_id}`}><b>{e.title}</b></Link>
                {e.status === 'completed' ? <Pill value="completed" /> : e.status !== 'active' ? <Pill value={e.status} /> : Number(e.lessons_total) ? <span className="muted">{e.lessons_completed} of {e.lessons_total} lessons</span> : <span className="muted">no lessons published yet</span>}
              </div>
              <Bar pct={Number(e.progress_percent)} />
              <div className="muted" style={{ fontSize: 12 }}>
                Enrolled {day(e.enrolled_at)}{e.last_activity_at ? ` · last active ${day(e.last_activity_at)}` : ' · no activity yet'}
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Tasks assigned to them</h2>
          {!can(ctx, 'tasks.read') && <p className="empty">You don&apos;t have access to tasks.</p>}
          {can(ctx, 'tasks.read') && r.user_id && !c.tasks.length && <p className="empty">No tasks assigned. <Link href={`/w/${orgSlug}/tasks`}>Assign one</Link>.</p>}
          {can(ctx, 'tasks.read') && !r.user_id && <p className="empty">Tasks can be assigned once they have a login.</p>}
          <ul className="attn">
            {openTasks.map((t) => {
              const late = t.due_at && Date.parse(t.due_at) < now;
              return <li key={t.id}><span>{t.title}</span>{t.due_at ? <Pill value={late ? 'overdue' : 'none'} label={late ? `overdue · ${day(t.due_at)}` : day(t.due_at)} /> : <Pill value={t.status} />}</li>;
            })}
          </ul>
          {c.tasks.length > openTasks.length && <p className="muted" style={{ marginBottom: 0 }}>{c.tasks.length - openTasks.length} completed.</p>}
        </div>
      </div>
    </>
  );
}
