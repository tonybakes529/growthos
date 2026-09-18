import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getEnv } from '@/lib/env';
import { addCustomer, listCustomers, CUSTOMER_STATUSES } from '@/modules/customers/actions';
import { Flash, PageHead, Pill, Stat, day } from '@/components/ui';

const LINK_COOKIE = 'customer_link';
const STATUS_LABEL: Record<string, string> = { invited: 'Invited', registered: 'Not started', in_progress: 'In progress', completed: 'Complete' };

export default async function Customers({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>; searchParams: Promise<{ course?: string; status?: string; msg?: string; err?: string }>;
}) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/customers`;
  if (!can(ctx, 'enrollments.read')) {
    return (<><PageHead sub={ctx.name} title="Customers" /><div className="card muted">You don&apos;t have access to customers.</div></>);
  }
  const status = CUSTOMER_STATUSES.find((s) => s === sp.status);
  const [all, jar] = await Promise.all([listCustomers({ orgSlug }), cookies()]);
  const data = all.ok ? all.data : { programs: [], customers: [] };
  const rows = data.customers.filter((c) => (!sp.course || c.program_id === sp.course) && (!status || c.status === status));
  const count = (s: string) => data.customers.filter((c) => c.status === s).length;
  const link = jar.get(LINK_COOKIE)?.value;
  const emailOn = !!getEnv().RESEND_API_KEY;

  async function add(form: FormData) {
    'use server';
    const r = await addCustomer({
      orgSlug, programId: String(form.get('course')), email: String(form.get('email')),
      firstName: String(form.get('first') || ''), lastName: String(form.get('last') || ''),
    });
    revalidatePath(path);
    if (!r.ok) redirect(`${path}?err=${encodeURIComponent(r.error.message)}`);
    if (r.data.inviteUrl) {
      // Only the hash of the token is stored, so this is the one chance to show the link.
      // A short-lived httpOnly cookie keeps it out of the URL, browser history and logs.
      (await cookies()).set(LINK_COOKIE, r.data.inviteUrl, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path, maxAge: 300 });
      redirect(`${path}?msg=${encodeURIComponent('Customer added. Their personal link is below.')}`);
    }
    redirect(`${path}?msg=${encodeURIComponent('They already have a login here, so they were given access straight away.')}`);
  }

  const qs = (o: { course?: string; status?: string }) => {
    const p = new URLSearchParams();
    const course = 'course' in o ? o.course : sp.course, st = 'status' in o ? o.status : sp.status;
    if (course) p.set('course', course); if (st) p.set('status', st);
    const s = p.toString(); return s ? `${path}?${s}` : path;
  };

  return (
    <>
      <PageHead sub={ctx.name} title="Customers" />
      <Flash msg={sp.msg} err={sp.err ?? (all.ok ? undefined : all.error.message)} />
      {link && sp.msg && (
        <div className="card">
          <h2>Personal link</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {emailOn ? 'It has also been emailed to them.' : 'Email sending is not switched on yet, so send this to them yourself.'} It works once, for them only, and expires in 7 days. It won&apos;t be shown again.
          </p>
          <div className="copy">{link}</div>
        </div>
      )}

      <div className="grid g4">
        <Stat k="Invited" v={count('invited')} s="Link sent, no login yet" />
        <Stat k="Not started" v={count('registered')} s="Has a login" />
        <Stat k="In progress" v={count('in_progress')} s="Started onboarding" />
        <Stat k="Complete" v={count('completed')} s="Onboarding done" />
      </div>

      <div className="row">
        <a className={`btn${!status ? ' primary' : ''}`} href={qs({ status: undefined })}>All</a>
        {CUSTOMER_STATUSES.map((s) => <a key={s} className={`btn${status === s ? ' primary' : ''}`} href={qs({ status: s })}>{STATUS_LABEL[s]}</a>)}
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
          <thead><tr><th>Customer</th><th>Course</th><th>Status</th><th>Onboarding</th><th>Invited</th><th>Completed</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link href={`${path}/${c.id}`}><b>{c.name}</b></Link>{c.name !== c.email && <div className="muted">{c.email}</div>}</td>
                <td className="wrap">{c.course}</td>
                <td><Pill value={c.status === 'invited' ? 'pending' : 'active'} label={c.account} /></td>
                <td><Pill value={c.status === 'completed' ? 'completed' : c.status === 'in_progress' ? 'in_progress' : 'none'} label={c.onboarding} /></td>
                <td>{day(c.invited_at)}</td>
                <td>{day(c.completed_at)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="muted">{data.customers.length ? 'No customers match this filter.' : 'No customers yet. They appear here automatically when someone buys a course.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {can(ctx, 'enrollments.create') && (
        <form id="add" className="card" action={add} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Add a customer</h2>
            <p className="muted" style={{ margin: 0 }}>Does exactly what a purchase does: creates the customer, links them to the course, and makes their personal sign-up link. Use it for offline sales or to try the journey yourself.</p>
          </div>
          {data.programs.length ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="f" style={{ minWidth: 220 }}>Course
                <select name="course" required defaultValue={sp.course ?? data.programs[0]!.id}>
                  {data.programs.map((p) => <option key={p.id} value={p.id}>{p.title}{p.hasForm ? '' : ' (no onboarding form)'}</option>)}
                </select>
              </label>
              <label className="f">First name<input name="first" autoComplete="off" /></label>
              <label className="f">Last name<input name="last" autoComplete="off" /></label>
              <label className="f" style={{ flex: 1, minWidth: 220 }}>Email<input name="email" type="email" required autoComplete="off" /></label>
              <button className="btn primary" type="submit">Add customer</button>
            </div>
          ) : <p style={{ margin: 0 }}>Create a <Link href={`/w/${orgSlug}/programs`}>course</Link> first.</p>}
        </form>
      )}
    </>
  );
}
