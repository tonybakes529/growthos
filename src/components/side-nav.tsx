'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Ws = { slug: string; name: string; kind: string; role: string };
export type NavItem = { href: string; label: string; exact?: boolean; also?: string[] };
export type NavGroup = { label?: string; items: NavItem[] };

export function SideNav({ email, roleLabel, isStaff, workspaces, currentSlug, groups }: {
  email: string; roleLabel: string; isStaff: boolean; workspaces: Ws[]; currentSlug?: string; groups: NavGroup[];
}) {
  const path = usePathname();
  const current = workspaces.find((w) => w.slug === currentSlug);
  const on = (i: NavItem) => i.exact ? path === i.href : [i.href, ...(i.also ?? [])].some((h) => path === h || path.startsWith(`${h}/`));
  const link = (i: NavItem) => (
    <Link key={i.href} href={i.href} className={`nav${on(i) ? ' on' : ''}`} aria-current={on(i) ? 'page' : undefined}>{i.label}</Link>
  );
  const others = workspaces.filter((w) => w.kind === 'client' && w.slug !== currentSlug);
  return (
    <nav className="side" aria-label="Main">
      <div className="brand">Growth OS</div>
      {isStaff && link({ href: '/admin/clients', label: 'All clients', exact: false })}
      {current && (
        <>
          <div className="label">{current.name}</div>
          {groups.map((g, n) => (
            <div key={n} className="group">
              {g.label && <div className="label sub">{g.label}</div>}
              {g.items.map(link)}
            </div>
          ))}
        </>
      )}
      {others.length > 0 && (
        <div className="group">
          <div className="label">{current ? 'Switch workspace' : 'Your workspaces'}</div>
          {others.map((w) => (
            <Link key={w.slug} href={`/w/${w.slug}`} className="nav ws">
              {w.name}{w.role && <span className="role">{w.role}</span>}
            </Link>
          ))}
        </div>
      )}
      <div className="foot">
        <div className="who">{email}<br />{roleLabel}</div>
        <form action="/logout" method="post"><button className="btn small" type="submit">Sign out</button></form>
      </div>
    </nav>
  );
}
