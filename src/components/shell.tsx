import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getMyWorkspaces } from '@/modules/organizations/actions';
import { SideNav } from './side-nav';

export async function Shell({ children, orgSlug }: { children: ReactNode; orgSlug?: string }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const ws = await getMyWorkspaces({});
  const workspaces = ws.ok ? ws.data.map((w) => ({ slug: w.slug!, name: w.name!, kind: w.kind!, role: w.role_key })) : [];
  const role = workspaces.find((w) => w.slug === orgSlug)?.role;
  const roleLabel = session.ctx.is_super_admin ? 'Super admin'
    : session.ctx.is_platform_staff ? `Internal team${role ? ` · ${role.replace(/_/g, ' ')}` : ''}`
    : (role ?? '').replace(/_/g, ' ');
  return (
    <div className="shell">
      <SideNav email={session.email ?? ''} roleLabel={roleLabel}
               isStaff={session.ctx.is_platform_staff || session.ctx.is_super_admin}
               workspaces={workspaces} currentSlug={orgSlug} />
      <main className="page">{children}</main>
    </div>
  );
}
