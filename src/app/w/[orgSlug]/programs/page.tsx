import Link from 'next/link';
import { requireOrgPage, can } from '@/lib/auth/context';
import { createProgram, listPrograms } from '@/modules/programs/actions';
import { listMyEnrollments } from '@/modules/enrollments/actions';
import { done } from '@/components/flash';
import { Bar, Flash, PageHead, Pill } from '@/components/ui';
import { SubNav, coursesTabs } from '@/components/subnav';

export default async function Programs({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/programs`;
  const [programs, mine] = await Promise.all([listPrograms({ orgSlug }), listMyEnrollments({ orgSlug })]);
  const progress = new Map(mine.ok ? mine.data.map((e) => [e.program_id, e]) : []);

  async function create(form: FormData) {
    'use server';
    done(path, await createProgram({ orgSlug, title: String(form.get('title')), description: String(form.get('description') || '') || undefined }), 'Course created');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="Courses" />
      <SubNav items={coursesTabs(orgSlug, can(ctx, 'programs.update'))} current="courses" />
      {can(ctx, 'sops.read') && (
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>Courses are what your customers (students) learn. Procedures for your own team live in <Link href={`/w/${orgSlug}/sops`}>SOPs</Link>.</p>
      )}
      <Flash msg={sp.msg} err={sp.err ?? (programs.ok ? undefined : programs.error.message)} />
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
      {can(ctx, 'programs.create') && (
        <form className="card" action={create} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <label className="f">New course name<input name="title" required /></label>
          <label className="f" style={{ flex: 1 }}>Description<input name="description" /></label>
          <button className="btn" type="submit">Create course</button>
        </form>
      )}
    </>
  );
}
