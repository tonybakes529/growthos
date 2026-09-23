import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getEnv } from '@/lib/env';
import { addCustomer, listStudents, nameStudent, removeStudent, remindOnboarding, STUDENT_STATUSES } from '@/modules/students/actions';
import { addMemberWithLogin } from '@/modules/memberships/actions';
import { done } from '@/components/flash';
import { Menu } from '@/components/menu';
import { Flash, PageHead, Pill, Stat, day } from '@/components/ui';
import { Modal } from '@/components/modal';

const LINK_COOKIE = 'customer_link';
const LOGIN_COOKIE = 'student_login';
const STATUS_LABEL: Record<string, string> = { invited: 'Invited', registered: 'Not started', in_progress: 'In progress', completed: 'Complete' };

/** Shows a new login once. Module scope on purpose: a server action may only capture plain values. */
async function showOnce(name: string, path: string, value: string) {
  (await cookies()).set(name, value, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path, maxAge: 300,
  });
}

export default async function Students({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>; searchParams: Promise<{ course?: string; status?: string; add?: string; msg?: string; err?: string }>;
}) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/students`;
  if (!can(ctx, 'enrollments.read')) {
    return (<><PageHead sub={ctx.name} title="Students" /><div className="card muted">You don&apos;t have access to students.</div></>);
  }
  const status = STUDENT_STATUSES.find((s) => s === sp.status);
  const programId = sp.course && /^[0-9a-f-]{36}$/i.test(sp.course) ? sp.course : undefined;
  const [all, jar] = await Promise.all([listStudents({ orgSlug, programId, status }), cookies()]);
  const data = all.ok ? all.data : { programs: [], students: [], hasIntakeForm: false, counts: { invited: 0, registered: 0, in_progress: 0, completed: 0 } };
  const rows = sp.course && !programId ? [] : data.students;
  const link = jar.get(LINK_COOKIE)?.value;
  const newLogin = (() => {
    try {
      const raw = jar.get(LOGIN_COOKIE)?.value;
      return raw ? (JSON.parse(raw) as { email: string; password: string }) : null;
    } catch { return null; }
  })();
  const emailOn = !!getEnv().RESEND_API_KEY;
  const canAddLogin = can(ctx, 'enrollments.create') && can(ctx, 'members.create');
  const canRemove = can(ctx, 'enrollments.delete');
  const canRemind = can(ctx, 'enrollments.update');
  const canTracker = can(ctx, 'kpis.read');

  async function add(form: FormData) {
    'use server';
    const email = String(form.get('email') ?? '').trim();
    const first = String(form.get('first') ?? '').trim();
    const last = String(form.get('last') ?? '').trim();
    const course = String(form.get('course') ?? '');
    const courseIds = /^[0-9a-f-]{36}$/i.test(course) ? [course] : [];

    if (String(form.get('how')) === 'link') {
      if (!courseIds.length) redirect(`${path}?add=1&err=${encodeURIComponent('Pick a course. A join link has to say what they are joining.')}`);
      const r = await addCustomer({ orgSlug, programId: courseIds[0]!, email, firstName: first, lastName: last });
      revalidatePath(path);
      if (!r.ok) redirect(`${path}?add=1&err=${encodeURIComponent(r.error.message)}`);
      if (!r.data.inviteUrl) redirect(`${path}?msg=${encodeURIComponent('They already had a login here, so they were given access straight away.')}`);
      // Only the hash of the token is stored, so this is the one chance to show the link.
      await showOnce(LINK_COOKIE, path, r.data.inviteUrl);
      redirect(`${path}?msg=${encodeURIComponent('Student added. Their personal link is below.')}`);
    }

    const typed = String(form.get('password') ?? '').trim();
    const r = await addMemberWithLogin({
      orgSlug, email, firstName: first, lastName: last, roleKey: 'student',
      password: typed || undefined, programIds: courseIds,
    });
    if (!r.ok) {
      revalidatePath(path);
      redirect(`${path}?add=1&err=${encodeURIComponent(r.error.message)}`);
    }
    // best effort: someone who can add a student may not be allowed to edit contacts
    await nameStudent({ orgSlug, email, firstName: first, lastName: last });
    revalidatePath(path);
    if (!r.data.password) redirect(`${path}?msg=${encodeURIComponent('Added as a student. They already had a login, so their usual password still works.')}`);
    await showOnce(LOGIN_COOKIE, path, JSON.stringify({ email: r.data.email, password: r.data.password }));
    redirect(`${path}?msg=${encodeURIComponent('Added. Their login is below, send it to them however you like.')}`);
  }

  async function remove(form: FormData) {
    'use server';
    // the page knows their display name; the database only has whatever is on their contact record
    const name = String(form.get('name') ?? '').trim();
    done(path, await removeStudent({ orgSlug, onboardingId: String(form.get('id')) }),
      (d) => `${name || d.name} removed${d.lost_access ? '. They can no longer sign in to this workspace.' : ' from students.'}`);
  }
  async function remind(form: FormData) {
    'use server';
    done(path, await remindOnboarding({ orgSlug, onboardingId: String(form.get('id')) }),
      (d) => d.emailConfigured
        ? `Reminder sent to ${d.to}.`
        : `Reminder queued for ${d.to}. Email is not set up here, so it will go out once it is.`);
  }

  const qs = (o: { course?: string; status?: string }) => {
    const p = new URLSearchParams();
    const course = 'course' in o ? o.course : sp.course, st = 'status' in o ? o.status : sp.status;
    if (course) p.set('course', course); if (st) p.set('status', st);
    const s = p.toString(); return s ? `${path}?${s}` : path;
  };

  return (
    <>
      <PageHead sub={ctx.name} title="Students">
        {canAddLogin && (
          <Modal label="+ Add student" title="Add a student" primary open={!!sp.add || !!sp.err}>
            <form action={add}>
              <p className="muted" style={{ margin: 0 }}>
                They sign in and the onboarding form is the first thing they see. A course is optional.
              </p>
              <div className="row">
                <label className="f" style={{ flex: 1 }}>First name<input name="first" maxLength={100} autoComplete="off" /></label>
                <label className="f" style={{ flex: 1 }}>Last name<input name="last" maxLength={100} autoComplete="off" /></label>
              </div>
              <label className="f">Email<input name="email" type="email" required autoComplete="off" /></label>
              <label className="f">Course <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                <select name="course" defaultValue={sp.course ?? ''}>
                  <option value="">No course, onboarding only</option>
                  {data.programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
              <label className="f">How they get in
                <select name="how" defaultValue="login">
                  <option value="login">Create their login now and give me the password</option>
                  <option value="link">Send them a link to set their own password (needs a course)</option>
                </select>
              </label>
              <label className="f">Password <span className="muted" style={{ fontWeight: 400 }}>(optional: leave empty and one is generated)</span>
                <input name="password" type="text" minLength={10} maxLength={72} autoComplete="off" placeholder="Leave empty for a strong one" />
              </label>
              <div><button className="btn primary" type="submit">Add student</button></div>
            </form>
          </Modal>
        )}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (all.ok ? undefined : all.error.message)} />

      {newLogin && (
        <div className="card next">
          <h2 style={{ marginBottom: 4 }}>Their login</h2>
          <p className="muted" style={{ marginTop: 0 }}>Shown once. Send it to them, then it disappears from this page.</p>
          <div className="copy">{newLogin.email}</div>
          <div className="copy" style={{ marginTop: 6 }}>{newLogin.password}</div>
          <p className="muted" style={{ marginBottom: 0 }}>They sign in at {getEnv().NEXT_PUBLIC_APP_URL}/login</p>
        </div>
      )}
      {link && sp.msg && (
        <div className="card">
          <h2>Personal link</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {emailOn ? 'It has also been emailed to them.' : 'Email sending is not switched on yet, so send this to them yourself.'} It works once, for them only, and expires in 7 days. It won&apos;t be shown again.
          </p>
          <div className="copy">{link}</div>
        </div>
      )}

      {all.ok && !data.hasIntakeForm && can(ctx, 'programs.read') && (
        <div className="card">
          <b>No onboarding form yet.</b>
          <p className="muted" style={{ marginBottom: 0 }}>
            Students can sign in, but there is nothing for them to fill in.{' '}
            <Link href={`/w/${orgSlug}/onboarding`}>Build one and set it as your intake form</Link>, and everyone here gets it the next time they sign in.
          </p>
        </div>
      )}

      <div className="grid g4">
        <Stat k="Invited" v={data.counts.invited} s="Link sent, no login yet" />
        <Stat k="Not started" v={data.counts.registered} s="Has a login" />
        <Stat k="In progress" v={data.counts.in_progress} s="Started onboarding" />
        <Stat k="Complete" v={data.counts.completed} s="Onboarding done" />
      </div>

      <div className="row">
        <a className={`btn${!status ? ' primary' : ''}`} href={qs({ status: undefined })}>All</a>
        {STUDENT_STATUSES.map((s) => <a key={s} className={`btn${status === s ? ' primary' : ''}`} href={qs({ status: s })}>{STATUS_LABEL[s]}</a>)}
        {data.programs.length > 1 && (
          <form action={path} className="row" style={{ marginLeft: 'auto' }}>
            {status && <input type="hidden" name="status" value={status} />}
            <select name="course" defaultValue={sp.course ?? ''} aria-label="Filter by course">
              <option value="">All courses</option>
              {data.programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <button className="btn small" type="submit">Filter</button>
          </form>
        )}
      </div>

      <div className="card tablewrap">
        <table>
          <thead><tr><th>Student</th><th>Courses</th><th>Account</th><th>Onboarding</th><th>Added</th><th>Completed</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td><Link href={`${path}/${s.id}`}><b>{s.name}</b></Link>{s.name !== s.email && <div className="muted">{s.email}</div>}</td>
                <td className="wrap">{s.courses.length ? s.courses.join(', ') : <span className="muted">No course</span>}</td>
                <td><Pill value={s.status === 'invited' ? 'pending' : 'active'} label={s.account} /></td>
                <td>
                  <Pill value={s.status === 'completed' ? 'completed' : s.status === 'in_progress' ? 'in_progress' : 'none'} label={s.onboarding} />
                  {s.forms > 1 && <div className="muted" style={{ fontSize: 12 }}>{s.forms} forms</div>}
                </td>
                <td>{day(s.invited_at)}</td>
                <td>{day(s.completed_at)}</td>
                <td>
                  {(canRemind || canRemove || canTracker) && (
                    <Menu label={`Manage ${s.name}`}>
                      {canTracker && !!s.userId && (
                        <Link className="menu-item" href={`${path}/${s.id}/tracker`}>Open their tracker</Link>
                      )}
                      {canRemind && !!s.userId && s.unfinished && (
                        <form action={remind}><input type="hidden" name="id" value={s.id} />
                          <button className="menu-item" type="submit">Send reminder</button></form>
                      )}
                      {canRemove && (<>
                        {canRemind && !!s.userId && s.unfinished && <hr />}
                        <Modal small label="Remove student" title={`Remove ${s.name}?`}>
                          <form action={remove}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="name" value={s.name} />
                            <p style={{ margin: 0 }}>
                              They come off this list{s.userId ? ' and can no longer sign in to this workspace' : ''}
                              {s.courses.length ? ', and their course access is revoked' : ''}.
                            </p>
                            <p className="muted" style={{ margin: 0 }}>
                              Anything they already answered is kept, so this can be undone by a super admin.
                            </p>
                            <div><button className="btn primary" type="submit">Remove {s.name}</button></div>
                          </form>
                        </Modal>
                      </>)}
                    </Menu>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={7} className="muted">
                {data.students.length || Object.values(data.counts).some((n) => n > 0)
                  ? 'No students match this filter.'
                  : 'No students yet. Use "Add student", or they appear here automatically when someone buys a course.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
