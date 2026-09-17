import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getMyWorkspaces } from '@/modules/organizations/actions';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.ctx.is_platform_staff || session.ctx.is_super_admin) redirect('/admin/clients');
  const ws = await getMyWorkspaces({});
  const first = ws.ok ? ws.data.find((w) => w.kind === 'client') : undefined;
  if (first?.slug) redirect(`/w/${first.slug}`);
  return <main className="center card"><h1>No workspace yet</h1><p>Ask your coach for an invitation link.</p></main>;
}
