import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getCustomer } from '@/modules/customers/actions';
import { formatAnswer } from '@/modules/onboarding-forms/types';
import { Bar, PageHead, Pill, day, dayTime } from '@/components/ui';

/** The one page a client opens to understand a customer: journey, details, courses, tasks and answers. */
export default async function Customer({ params }: { params: Promise<{ orgSlug: string; customerId: string }> }) {
  const { orgSlug, customerId } = await params;
  const ctx = await requireOrgPage(orgSlug);
  const back = `/w/${orgSlug}/customers`;
  if (!can(ctx, 'enrollments.read')) notFound();
  const res = await getCustomer({ orgSlug, onboardingId: customerId });
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
  const answered = c.responses.filter((q) => q.answer).length;
  const openTasks = c.tasks.filter((t) => !['done', 'canceled'].includes(t.status));
  const now = Date.now();

  return (
    <>
      <Link href={back}>← Customers</Link>
      <PageHead sub={`${ctx.name} · ${c.course}`} title={c.name}>
        <Pill value={r.status === 'invited' ? 'pending' : 'active'} label={c.account} />
        <Pill value={r.status === 'completed' ? 'completed' : r.status === 'in_progress' ? 'in_progress' : 'none'} label={`Onboarding: ${c.onboarding.toLowerCase()}`} />
      </PageHead>

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
            <li><span className="muted">Bought</span><span>{c.course}</span></li>
            <li><span className="muted">Onboarding form</span><span>{c.form?.name ?? <span className="muted">none on this course</span>}</span></li>
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

      <div className="card">
        <h2>Onboarding answers {c.responses.length > 0 && <span className="muted" style={{ fontWeight: 400 }}>({answered} of {c.responses.length} answered)</span>}</h2>
        {!c.form ? <p className="empty">This course has no onboarding form, so there is nothing for them to fill in.</p>
          : !answered ? <p className="empty">{r.status === 'invited' ? 'They haven’t created their login yet.' : 'Nothing answered yet.'}</p>
          : c.responses.map((q) => (
            <div className="answer" key={q.id}>
              <b>{q.label}</b>{q.deleted_at && <span className="muted"> (question since removed)</span>}
              <div className="a">{q.answer ? formatAnswer(q.answer.value) : <span className="muted">No answer</span>}</div>
            </div>
          ))}
        {r.status === 'in_progress' && answered > 0 && <p className="muted" style={{ marginBottom: 0 }}>Still in progress. These are saved drafts and may change.</p>}
      </div>
    </>
  );
}
