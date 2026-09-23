import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { createForm, listForms, setWorkspaceIntakeForm } from '@/modules/onboarding-forms/actions';
import { done } from '@/components/flash';
import { Menu, MenuNote } from '@/components/menu';
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
  const forms = res.ok ? res.data.forms : [];
  const intake = forms.find((f) => f.isIntake) ?? null;
  const setIntake = can(ctx, 'organization.update');

  async function create(form: FormData) {
    'use server';
    const r = await createForm({ orgSlug, name: String(form.get('name')) });
    if (!r.ok) redirect(`${path}?err=${encodeURIComponent(r.error.message)}`);
    redirect(`${path}/${r.data.id}`);
  }
  async function useAsIntake(form: FormData) {
    'use server';
    done(path, await setWorkspaceIntakeForm({ orgSlug, formId: String(form.get('id')) }),
      'Done. Every student fills this in the next time they sign in.');
  }
  async function clearIntake() {
    'use server';
    done(path, await setWorkspaceIntakeForm({ orgSlug, formId: null }), 'Intake form turned off.');
  }

  return (
    <>
      <PageHead sub={`${ctx.name} · Courses`} title="Onboarding forms" />
      <SubNav items={coursesTabs(orgSlug, can(ctx, 'programs.update'))} current="onboarding" />
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : res.error.message)} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your intake form</h2>
        {intake ? (
          <>
            <p style={{ margin: 0 }}>
              Every student fills in <b>{intake.name}</b> the first time they sign in, whether or not they bought a course.
            </p>
            {setIntake && (
              <form action={clearIntake} style={{ marginTop: 10 }}>
                <button className="btn small" type="submit">Turn off</button>
              </form>
            )}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Nothing set, so no student is asked anything. Build a form below, publish it, then use it as your intake form.
            {!setIntake && ' Someone with workspace settings access has to do that last step.'}
          </p>
        )}
      </div>

      <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
        A form has to be published before anyone can see it. Set one as your intake form and every student gets it. A course
        can override it with a form of its own, which is what you want if you sell several courses.
      </p>

      <div className="grid g2">
        {forms.map((f) => (
          <div key={f.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}><Link href={`${path}/${f.id}`}>{f.name}</Link></h2>
              <div className="row">
                <Pill value={f.status === 'published' ? 'active' : f.status === 'archived' ? 'none' : 'pending'} label={f.status} />
                {setIntake && (f.isIntake || (f.status === 'published' && !!f.questionCount)) && (
                  <Menu label={`Manage ${f.name}`}>
                    <Link className="menu-item" href={`${path}/${f.id}`}>Edit questions</Link>
                    <hr />
                    {f.isIntake ? (
                      <>
                        <form action={clearIntake}><button className="menu-item" type="submit">Stop using as the intake form</button></form>
                        <MenuNote>Students already part way through keep the form they started.</MenuNote>
                      </>
                    ) : (
                      <form action={useAsIntake}>
                        <input type="hidden" name="id" value={f.id} />
                        <button className="menu-item" type="submit">Use as the intake form</button>
                      </form>
                    )}
                  </Menu>
                )}
              </div>
            </div>
            <div className="muted">{f.questionCount} question{f.questionCount === 1 ? '' : 's'} · updated {day(f.updated_at)}</div>
            <div>
              {f.isIntake ? <b>Your intake form: every student fills this in</b>
                : f.courses.length ? <>Used by <b>{f.courses.map((c) => c.title).join(', ')}</b></>
                : f.status !== 'published' ? <span className="muted">Draft, so nobody can see it yet</span>
                : <span className="muted">Published but reaching nobody</span>}
            </div>
          </div>
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
