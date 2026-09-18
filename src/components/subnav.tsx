import Link from 'next/link';

/** Local tabs for a destination that groups a few related pages, e.g. Courses and their onboarding forms. */
export function SubNav({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  if (items.length < 2) return null;
  return (
    <nav className="subnav" aria-label="Section">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={`tab${i.key === current ? ' on' : ''}`} aria-current={i.key === current ? 'page' : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}

/** The Courses area: courses for everyone, onboarding forms for people who can edit courses. */
export function coursesTabs(orgSlug: string, canEdit: boolean) {
  const base = `/w/${orgSlug}`;
  return [
    { key: 'courses', href: `${base}/programs`, label: 'Courses' },
    ...(canEdit ? [{ key: 'onboarding', href: `${base}/onboarding`, label: 'Onboarding forms' }] : []),
  ];
}
