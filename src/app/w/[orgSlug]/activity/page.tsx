import { requireOrgPage, can } from '@/lib/auth/context';
import { PageHead, Stat, dayTime } from '@/components/ui';

export default async function Activity({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);
  if (!can(ctx, 'organization.read')) {
    return (<><PageHead sub={ctx.name} title="Activity" /><div className="card muted">You don&apos;t have access to activity.</div></>);
  }
  const showCustomers = can(ctx, 'enrollments.read');
  const [feed, countRes] = await Promise.all([
    ctx.sb.from('activity_history').select('id, verb, summary, created_at').eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: false }).limit(100),
    // counted in the database (30-day windows included); this used to download every customer record
    showCustomers ? ctx.sb.schema('app').rpc('workspace_counts', { p_org: ctx.organizationId }) : null,
  ]);
  const c = (countRes?.data ?? {}) as Record<string, number>;
  const n = (k: string) => Number(c[k] ?? 0);
  const done = n('completed');
  const joined = n('joined');

  return (
    <>
      <PageHead sub={ctx.name} title="Activity" />
      {showCustomers && (
        <div className="grid g4">
          <Stat k="Customers" v={n('customers')} s="all time" />
          <Stat k="New in 30 days" v={n('new_30d')} />
          <Stat k="Onboarding completed" v={done} s={joined ? `${Math.round((done / joined) * 100)}% of those with a login` : undefined} />
          <Stat k="Completed in 30 days" v={n('completed_30d')} />
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
