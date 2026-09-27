import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { requireOrg, can, isLearner, type OrgContext } from '@/lib/auth/context';
import type { Permission } from '@/lib/permissions/keys';
import { getMyWorkspaces } from '@/modules/organizations/actions';
import { SideNav, type NavGroup, type NavItem } from './side-nav';

type Def = { path: string; label: string; needs?: Permission; unless?: Permission; also?: string[] };

// Five destinations for people who run the workspace, three for people who learn in it.
// Every entry is gated on a permission key, never on a role name, so custom roles and
// restricted team members get exactly the pages they can use. Pages and the database
// enforce the same permissions again; this only stops people being sent to dead ends.
const MAIN: Def[] = [
  { path: '', label: 'Home' },
  // the students list lives under Coaches rather than beside it, so there is one door to your people
  { path: '/coaches', label: 'Coaches', needs: 'enrollments.read', also: ['/students', '/customers'] },
  { path: '/programs', label: 'Courses', also: ['/lessons', '/onboarding'] },
  { path: '/pipeline', label: 'Sales / Setters', needs: 'sales.read', also: ['/setter-assets'] },
  { path: '/sops', label: 'SOPs', needs: 'sops.read' },
  { path: '/tasks', label: 'Tasks' },
];
// Running the workspace rather than working in it. These sit in a menu by Sign out, because most
// people never need them. The weekly scorecard is no longer in the sidebar either; /scorecard still works.
const MANAGE: Def[] = [
  { path: '/team', label: 'Team', needs: 'members.read' },
  { path: '/connections', label: 'Connections', needs: 'connections.read' },
  { path: '/automations', label: 'Automations', needs: 'automations.read' },
  { path: '/activity', label: 'Activity', needs: 'organization.read' },
  { path: '/scorecard', label: 'Weekly scorecard', needs: 'kpis.read' },
];
const LEARNER: Def[] = [
  { path: '', label: 'Home' },
  { path: '/programs', label: 'My Courses', also: ['/lessons'] },
  // no permission gate: a student holds none, and giving them one would stop them being a learner
  { path: '/tracker', label: 'My Numbers' },
  { path: '/tasks', label: 'My Tasks' },
];

function build(defs: Def[], ctx: OrgContext): NavItem[] {
  return defs.filter((n) => (!n.needs || can(ctx, n.needs)) && !(n.unless && can(ctx, n.unless))).map((n) => ({
    href: `/w/${ctx.slug}${n.path}`, label: n.label, exact: n.path === '',
    also: (n.also ?? []).map((p) => `/w/${ctx.slug}${p}`),
  }));
}

export async function Shell({ children, orgSlug }: { children: ReactNode; orgSlug?: string }) {
  // All three lookups need only the login cookie, so they go out together: one database round trip before the
  // page frame (and its loading state) can paint, where this used to be two back to back.
  const [session, ws, ctx] = await Promise.all([
    getSession(),
    getMyWorkspaces({}),
    orgSlug ? requireOrg(orgSlug).catch(() => null) : null,
  ]);
  if (!session) redirect('/login');
  const learner = ctx ? isLearner(ctx) : false;
  const groups: NavGroup[] = !ctx ? []
    : learner ? [{ items: build(LEARNER, ctx) }]
    : [{ items: build(MAIN, ctx) }];
  const manage = ctx && !learner ? build(MANAGE, ctx) : [];
  const workspaces = ws.ok
    ? ws.data.map((w) => ({ slug: w.slug!, name: w.name!, kind: w.kind!, role: w.access_type === 'super_admin' ? '' : (w.role_key ?? w.access_type ?? '').replace(/_/g, ' ') }))
    : [];
  const role = workspaces.find((w) => w.slug === orgSlug)?.role;
  const roleLabel = session.ctx.is_super_admin ? 'Super admin'
    : session.ctx.is_platform_staff ? `Internal team${role ? ` · ${role}` : ''}`
    : (role ?? '');
  return (
    <div className="shell">
      <SideNav email={session.email ?? ''} roleLabel={roleLabel}
               isStaff={session.ctx.is_platform_staff || session.ctx.is_super_admin}
               workspaces={workspaces} currentSlug={orgSlug} groups={groups} manage={manage} />
      <main className="page">{children}</main>
    </div>
  );
}
