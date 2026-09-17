'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Ws = { slug: string; name: string; kind: string };

export function SideNav({ email, roleLabel, isStaff, workspaces, currentSlug }: {
  email: string; roleLabel: string; isStaff: boolean; workspaces: Ws[]; currentSlug?: string;
}) {
  const path = usePathname();
  const current = workspaces.find((w) => w.slug === currentSlug);
  const link = (href: string, label: string, exact = false) => {
    const on = exact ? path === href : path === href || path.startsWith(`${href}/`);
    return <Link key={href} href={href} className={`nav${on ? ' on' : ''}`}>{label}</Link>;
  };
  const clients = workspaces.filter((w) => w.kind === 'client' && w.slug !== currentSlug);
  return (
    <nav className="side" aria-label="Main">
      <div className="brand">Growth OS</div>
      {isStaff && link('/admin/clients', 'Clients (admin)')}
      {current && (
        <>
          <div className="label">{current.name}</div>
          {link(`/w/${current.slug}`, 'Home', true)}
          {link(`/w/${current.slug}/programs`, 'Programs')}
          {link(`/w/${current.slug}/scorecard`, 'Weekly Scorecard')}
          {link(`/w/${current.slug}/tasks`, 'Tasks')}
          {link(`/w/${current.slug}/pipeline`, 'Sales Pipeline')}
          {link(`/w/${current.slug}/team`, 'Team')}
        </>
      )}
      {clients.length > 0 && (
        <>
          <div className="label">{current ? 'Other workspaces' : 'Workspaces'}</div>
          {clients.map((w) => link(`/w/${w.slug}`, w.name, true))}
        </>
      )}
      <div className="foot">
        {email}<br />{roleLabel}
        <form action="/logout" method="post" style={{ marginTop: 8 }}>
          <button className="btn small" type="submit">Sign out</button>
        </form>
      </div>
    </nav>
  );
}
