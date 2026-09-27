import Link from 'next/link';
import { requireOrgPage, can } from '@/lib/auth/context';
import { listMembers } from '@/modules/memberships/actions';
import { listStudents } from '@/modules/students/actions';
import { Flash, PageHead, Pill } from '@/components/ui';

export const metadata = { title: 'Coaches' };

/** Who looks after whom. Every coach with their students under them, and whoever has nobody yet. */
export default async function Coaches({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}`;
  if (!can(ctx, 'enrollments.read')) {
    return (<><PageHead sub={ctx.name} title="Coaches" /><div className="card muted">You don&apos;t have access to students.</div></>);
  }
  const [members, students] = await Promise.all([listMembers({ orgSlug }), listStudents({ orgSlug })]);
  const all = students.ok ? students.data.students : [];
  const team = members.ok ? members.data : { members: [], staff: [] };

  // a coach is anyone on the team who is not themselves a student
  const coaches = [
    ...team.members.filter((m) => m.role?.key !== 'student')
      .map((m) => ({ userId: m.userId, name: m.profile?.display_name ?? m.email, sub: m.role?.name ?? 'Member' })),
    ...team.staff.filter((s) => !team.members.some((m) => m.userId === s.userId))
      .map((s) => ({ userId: s.userId, name: s.profile?.display_name ?? s.email, sub: `${s.role?.name ?? 'Growth OS'}${s.isPrimary ? ' · primary' : ''}` })),
  ];
  const mine = (userId: string) => all.filter((s) => s.coachId === userId);
  const unassigned = all.filter((s) => !s.coachId);

  return (
    <>
      <PageHead sub={ctx.name} title="Coaches">
        <Link className="btn" href={`${path}/students`}>All students ({all.length})</Link>
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (students.ok ? undefined : students.error.message)} />
      <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
        Who looks after whom. Assign a coach from the menu on any student.
      </p>

      <div className="grid g2">
        {coaches.map((c) => {
          const theirs = mine(c.userId);
          const behind = theirs.filter((s) => s.unfinished).length;
          return (
            <div className="card" key={c.userId}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 style={{ margin: 0 }}>{c.name}</h2>
                <span className="muted">{c.sub}</span>
              </div>
              <div className="muted" style={{ marginBottom: 8 }}>
                {theirs.length ? `${theirs.length} student${theirs.length === 1 ? '' : 's'}` : 'No students yet'}
                {behind > 0 && ` · ${behind} still to finish onboarding`}
              </div>
              <ul className="attn">
                {theirs.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <span><Link href={`${path}/students/${s.id}`}>{s.name}</Link></span>
                    <Pill value={s.status === 'completed' ? 'completed' : s.status === 'in_progress' ? 'in_progress' : 'none'} label={s.onboarding} />
                  </li>
                ))}
              </ul>
              {theirs.length > 6 && (
                <p style={{ marginBottom: 0 }}>
                  <Link href={`${path}/students?coach=${c.userId}`}>See all {theirs.length}</Link>
                </p>
              )}
            </div>
          );
        })}
        {!coaches.length && <div className="card muted">Nobody on the team yet. Add people on the Team page.</div>}
      </div>

      {!!unassigned.length && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No coach yet ({unassigned.length})</h2>
          <ul className="attn">
            {unassigned.slice(0, 10).map((s) => (
              <li key={s.id}>
                <span><Link href={`${path}/students/${s.id}`}>{s.name}</Link><div className="muted">{s.email}</div></span>
                <Pill value={s.status === 'completed' ? 'completed' : s.status === 'in_progress' ? 'in_progress' : 'none'} label={s.onboarding} />
              </li>
            ))}
          </ul>
          <p style={{ marginBottom: 0 }}><Link href={`${path}/students?coach=none`}>Assign them a coach</Link></p>
        </div>
      )}
    </>
  );
}
