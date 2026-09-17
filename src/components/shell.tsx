import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { requireOrg, can } from '@/lib/auth/context';
import type { Permission } from '@/lib/permissions/keys';
import { getMyWorkspaces } from '@/modules/organizations/actions';
import { SideNav, type NavItem } from './side-nav';

// A link only appears when the viewer can open the page behind it. The pages and the database
// enforce the same permissions again; this just stops people being sent to a dead end.
const NAV: { path: string; label: string; needs?: Permission }[] = [
  { path: '', label: 'Dashboard' },
  { path: '/programs', label: 'Courses' },
  { path: '/customers', label: 'Customers', needs: 'enrollments.read' },
  { path: '/onboarding', label: 'Onboarding', needs: 'programs.update' },
  { path: '/automations', label: 'Automations', needs: 'automations.read' },
  { path: '/scorecard', label: 'Weekly Scorecard', needs: 'kpis.read' },
  { path: '/tasks', label: 'Tasks' },
  { path: '/pipeline', label: 'Sales Pipeline', needs: 'sales.read' },
  { path: '/team', label: 'Team', needs: 'members.read' },
  { path: '/activity', label: 'Activity', needs: 'organization.read' },
];

export async function Shell({ children, orgSlug }: { children: ReactNode; orgSlug?: string }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const [ws, ctx] = await Promise.all([getMyWorkspaces({}), orgSlug ? requireOrg(orgSlug).catch(() => null) : null]);
  const items: NavItem[] = ctx
    ? NAV.filter((n) => !n.needs || can(ctx, n.needs)).map((n) => ({ href: `/w/${orgSlug}${n.path}`, label: n.label, exact: n.path === '' }))
    : [];
  const workspaces = ws.ok ? ws.data.map((w) => ({ slug: w.slug!, name: w.name!, kind: w.kind!, role: w.role_key })) : [];
  const role = workspaces.find((w) => w.slug === orgSlug)?.role;
  const roleLabel = session.ctx.is_super_admin ? 'Super admin'
    : session.ctx.is_platform_staff ? `Internal team${role ? ` · ${role.replace(/_/g, ' ')}` : ''}`
    : (role ?? '').replace(/_/g, ' ');
  return (
    <div className="shell">
      <SideNav email={session.email ?? ''} roleLabel={roleLabel}
               isStaff={session.ctx.is_platform_staff || session.ctx.is_super_admin}
               workspaces={workspaces} currentSlug={orgSlug} items={items} />
      <main className="page">{children}</main>
    </div>
  );
}
