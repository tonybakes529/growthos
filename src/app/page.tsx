import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getMyWorkspaces } from '@/modules/organizations/actions';
import { getPendingOnboarding } from '@/modules/students/actions';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.ctx.is_platform_staff || session.ctx.is_super_admin) redirect('/admin/clients');
  // A customer with unfinished onboarding goes straight back to it, never to an empty dashboard.
  const [ws, pending] = await Promise.all([getMyWorkspaces({}), getPendingOnboarding({})]);
  if (pending.ok && pending.data) redirect(`/start/${pending.data.organization_slug}`);
  const first = ws.ok ? ws.data.find((w) => w.kind === 'client') : undefined;
  if (first?.slug) redirect(`/w/${first.slug}`);
  return <main className="center card"><h1>No workspace yet</h1><p>Ask your coach for an invitation link.</p></main>;
}
