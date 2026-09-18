import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { createForm, listForms } from '@/modules/onboarding-forms/actions';
import { Flash, PageHead, Pill, day } from '@/components/ui';
import { SubNav, coursesTabs } from '@/components/subnav';

export default async function OnboardingForms({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/onboarding`;
  if (!can(ctx, 'programs.read')) {
    return (<><PageHead sub={ctx.name} title="Onboarding" /><div className="card muted">You don&apos;t have access to onboarding forms.</div></>);
  }
  const res = await listForms({ orgSlug });
  const forms = res.ok ? res.data : [];

  async function create(form: FormData) {
    'use server';
    const r = await createForm({ orgSlug, name: String(form.get('name')) });
    if (!r.ok) redirect(`${path}?err=${encodeURIComponent(r.error.message)}`);
    redirect(`${path}/${r.data.id}`);
  }

  return (
    <>
      <PageHead sub={`${ctx.name} · Courses`} title="Onboarding forms" />
      <SubNav items={coursesTabs(orgSlug, can(ctx, 'programs.update'))} current="onboarding" />
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : res.error.message)} />
      <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
        The questions a new customer answers right after creating their login. Build a form, publish it, attach it to a course. From then on every buyer of that course gets it automatically.
      </p>
      <div className="grid g2">
        {forms.map((f) => (
          <Link key={f.id} href={`${path}/${f.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{f.name}</h2>
              <Pill value={f.status === 'published' ? 'active' : f.status === 'archived' ? 'none' : 'pending'} label={f.status} />
            </div>
            <div className="muted">{f.questionCount} question{f.questionCount === 1 ? '' : 's'} · updated {day(f.updated_at)}</div>
            <div>{f.courses.length ? <>Used by <b>{f.courses.map((c) => c.title).join(', ')}</b></> : <span className="muted">Not attached to a course yet</span>}</div>
          </Link>
        ))}
        {!forms.length && <div className="card muted">No onboarding forms yet.</div>}
      </div>
      {can(ctx, 'programs.create') && (
        <form className="card" action={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ flex: 1, minWidth: 260 }}>New form name<input name="name" required maxLength={200} placeholder="New Client Onboarding" /></label>
          <button className="btn primary" type="submit">Create form</button>
        </form>
      )}
    </>
  );
}
