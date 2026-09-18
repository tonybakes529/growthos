import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { createProgram, listPrograms } from '@/modules/programs/actions';
import { listMyEnrollments } from '@/modules/enrollments/actions';
import { done } from '@/components/flash';
import { Bar, Flash, PageHead, Pill } from '@/components/ui';
import { SubNav, coursesTabs } from '@/components/subnav';
import { Modal } from '@/components/modal';

export default async function Programs({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/programs`;
  const [programs, mine] = await Promise.all([listPrograms({ orgSlug }), listMyEnrollments({ orgSlug })]);
  const progress = new Map(mine.ok ? mine.data.map((e) => [e.program_id, e]) : []);

  async function create(form: FormData) {
    'use server';
    const r = await createProgram({ orgSlug, title: String(form.get('title')), description: String(form.get('description') || '') || undefined });
    if (!r.ok) done(path, r, '');
    redirect(`${path}/${r.data.id}?msg=${encodeURIComponent('Course created. Add lessons below.')}`);
  }

  return (
    <>
      <PageHead sub={ctx.name} title="Courses">
        {can(ctx, 'programs.create') && (
          <Modal label="+ New course" title="New course" primary open={!!sp.err}>
            <form action={create}>
              <label className="f">Course name<input name="title" required minLength={2} maxLength={160} autoFocus /></label>
              <label className="f">Description <span className="muted" style={{ fontWeight: 400 }}>(optional)</span><textarea name="description" maxLength={5000} /></label>
              <p className="muted" style={{ margin: 0 }}>You can add lessons, videos and an onboarding form on the next screen.</p>
              <div><button className="btn primary" type="submit">Create course</button></div>
            </form>
          </Modal>
        )}
      </PageHead>
      <SubNav items={coursesTabs(orgSlug, can(ctx, 'programs.update'))} current="courses" />
      {can(ctx, 'sops.read') && (
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>Courses are what your customers (students) learn. Procedures for your own team live in <Link href={`/w/${orgSlug}/sops`}>SOPs</Link>.</p>
      )}
      <Flash msg={sp.msg} err={sp.err ?? (programs.ok ? undefined : programs.error.message)} />
      {programs.ok && !programs.data.length && <div className="card empty">No courses yet. Use &quot;New course&quot; to create the first one.</div>}
      <div className="grid g3">
        {(programs.ok ? programs.data : []).map((p) => {
          const e = progress.get(p.id);
          return (
            <Link key={p.id} href={`${path}/${p.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{p.title}</h2><Pill value={p.status === 'published' ? 'active' : 'paused'} label={p.status} /></div>
              <div className="muted">{p.subtitle ?? ''}{p.source_template_id && can(ctx, 'programs.update') && <> <Pill value="none" label="from Growth OS" /></>}</div>
              {e ? <><Bar pct={Number(e.progress_percent)} /><div className="muted">{e.lessons_completed} of {e.lessons_total} lessons</div></> : <div className="muted">Not enrolled</div>}
            </Link>
          );
        })}
      </div>
    </>
  );
}
