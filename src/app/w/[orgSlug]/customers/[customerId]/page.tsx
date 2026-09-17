import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getCustomer } from '@/modules/customers/actions';
import { formatAnswer } from '@/modules/onboarding-forms/types';
import { PageHead, Pill, dayTime } from '@/components/ui';

export default async function Customer({ params }: { params: Promise<{ orgSlug: string; customerId: string }> }) {
  const { orgSlug, customerId } = await params;
  const ctx = await requireOrgPage(orgSlug);
  const back = `/w/${orgSlug}/customers`;
  if (!can(ctx, 'enrollments.read')) notFound();
  const res = await getCustomer({ orgSlug, onboardingId: customerId });
  if (!res.ok) notFound();   // also what another client's id produces: RLS hides the row
  const c = res.data;
  const r = c.record;
  const steps: [string, string | null, string?][] = [
    ['Invited', r.invited_at, c.invitation && r.status === 'invited' ? `link ${c.invitation.status === 'pending' && Date.parse(c.invitation.expires_at) < Date.now() ? 'expired' : c.invitation.status}` : undefined],
    ['Created their login', r.registered_at],
    ['Started onboarding', r.started_at],
    ['Completed onboarding', r.completed_at],
  ];
  const answered = c.responses.filter((q) => q.answer).length;

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
            <p className="muted" style={{ marginBottom: 0 }}>Link lost or expired? Add them again from <Link href={back}>Customers</Link> with the same email. They get a fresh link and the old one stops working.</p>
          )}
        </div>
        <div className="card">
          <h2>Details</h2>
          <ul className="plain">
            <li><span className="muted">Email</span><span>{r.email}</span></li>
            <li><span className="muted">Course</span><span>{c.course}</span></li>
            <li><span className="muted">Onboarding form</span><span>{c.form?.name ?? 'None attached to this course'}</span></li>
            {c.contact?.company && <li><span className="muted">Company</span><span>{c.contact.company}</span></li>}
            {c.contact?.phone && <li><span className="muted">Phone</span><span>{c.contact.phone}</span></li>}
            <li><span className="muted">Came from</span><span>{r.purchase_id ? 'Purchase' : 'Added by hand'}</span></li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Onboarding answers {c.responses.length > 0 && <span className="muted" style={{ fontWeight: 400 }}>({answered} of {c.responses.length} answered)</span>}</h2>
        {!c.form ? <p className="muted" style={{ margin: 0 }}>This course has no onboarding form, so there is nothing for them to fill in.</p>
          : !answered ? <p className="muted" style={{ margin: 0 }}>{r.status === 'invited' ? 'They haven’t created their login yet.' : 'Nothing answered yet.'}</p>
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
