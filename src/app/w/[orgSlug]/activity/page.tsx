import { requireOrgPage, can } from '@/lib/auth/context';
import { PageHead, Stat, dayTime } from '@/components/ui';

export default async function Activity({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);
  if (!can(ctx, 'organization.read')) {
    return (<><PageHead sub={ctx.name} title="Activity" /><div className="card muted">You don&apos;t have access to activity.</div></>);
  }
  const showCustomers = can(ctx, 'enrollments.read');
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [feed, customers] = await Promise.all([
    ctx.sb.from('activity_history').select('id, verb, summary, created_at').eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: false }).limit(100),
    showCustomers ? ctx.sb.from('customer_onboardings').select('status, invited_at, completed_at').eq('organization_id', ctx.organizationId) : null,
  ]);
  const cs = customers?.data ?? [];
  const done = cs.filter((c) => c.status === 'completed').length;
  const joined = cs.filter((c) => c.status !== 'invited').length;

  return (
    <>
      <PageHead sub={ctx.name} title="Activity" />
      {showCustomers && (
        <div className="grid g4">
          <Stat k="Customers" v={cs.length} s="all time" />
          <Stat k="New in 30 days" v={cs.filter((c) => c.invited_at >= since).length} />
          <Stat k="Onboarding completed" v={done} s={joined ? `${Math.round((done / joined) * 100)}% of those with a login` : undefined} />
          <Stat k="Completed in 30 days" v={cs.filter((c) => c.completed_at && c.completed_at >= since).length} />
        </div>
      )}
      <div className="card">
        <h2>Recent activity</h2>
        <ul className="plain">
          {(feed.data ?? []).map((a) => <li key={a.id}><span className="wrap">{a.summary}</span><span className="muted" style={{ whiteSpace: 'nowrap' }}>{dayTime(a.created_at)}</span></li>)}
          {!feed.data?.length && <li className="muted">Nothing yet.</li>}
        </ul>
      </div>
    </>
  );
}
