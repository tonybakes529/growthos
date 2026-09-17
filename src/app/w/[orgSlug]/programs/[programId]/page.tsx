import Link from 'next/link';
import { requireOrg, can } from '@/lib/auth/context';
import { unwrap } from '@/lib/errors';
import { createLesson, createModule, createSection, getProgramOutline, setProgramStatus } from '@/modules/programs/actions';
import { completeLesson, enrollUser, getProgressReport } from '@/modules/enrollments/actions';
import { listMembers } from '@/modules/memberships/actions';
import { done } from '@/components/flash';
import { Bar, Flash, PageHead, Pill, day } from '@/components/ui';

const LOCK: Record<string, string> = {
  drip_locked: 'Opens', previous_incomplete: 'Finish the previous lesson first', not_enrolled: 'Not enrolled',
  draft: 'Draft', access_expired: 'Access expired',
};

export default async function ProgramPage({ params, searchParams }: { params: Promise<{ orgSlug: string; programId: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug, programId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrg(orgSlug);
  const path = `/w/${orgSlug}/programs/${programId}`;
  const builder = can(ctx, 'programs.update');
  const program = unwrap(await ctx.sb.from('programs').select('id, title, subtitle, description, status').eq('id', programId).maybeSingle());
  const [outline, report, members] = await Promise.all([
    getProgramOutline({ programId }),
    can(ctx, 'enrollments.read') ? getProgressReport({ orgSlug, programId }) : null,
    can(ctx, 'enrollments.create') ? listMembers({ orgSlug }) : null,
  ]);
  const lessons = outline.ok ? outline.data.sections.flatMap((s) => s.modules.flatMap((m) => m.lessons)) : [];
  const doneCount = lessons.filter((l) => l.progress === 'completed').length;
  const pct = lessons.length ? Math.round((100 * doneCount) / lessons.length) : 0;

  async function complete(form: FormData) {
    'use server';
    done(path, await completeLesson({ lessonId: String(form.get('id')) }),
      (d) => d.program_completed ? 'Program complete. Certificate issued.' : `Lesson complete (${d.progress_percent}%)`);
  }
  async function addSection(form: FormData) {
    'use server';
    done(path, await createSection({ orgSlug, programId, title: String(form.get('title')) }), 'Section added');
  }
  async function addModule(form: FormData) {
    'use server';
    const days = Number(form.get('days') || 0);
    done(path, await createModule({ orgSlug, sectionId: String(form.get('section')), title: String(form.get('title')),
      drip: days > 0 ? { type: 'days_after_enrollment', days } : { type: 'immediate' } }), 'Module added');
  }
  async function addLesson(form: FormData) {
    'use server';
    const days = Number(form.get('days') || 0);
    done(path, await createLesson({ orgSlug, moduleId: String(form.get('module')), title: String(form.get('title')), status: 'published',
      requiresPreviousCompletion: form.get('seq') === 'on',
      drip: days > 0 ? { type: 'days_after_enrollment', days } : { type: 'immediate' } }), 'Lesson added');
  }
  async function publish(form: FormData) {
    'use server';
    done(path, await setProgramStatus({ orgSlug, programId, status: String(form.get('status')) as 'published' }), 'Program status updated');
  }
  async function enroll(form: FormData) {
    'use server';
    done(path, await enrollUser({ orgSlug, programId, userId: String(form.get('user')) }), 'Enrolled');
  }

  const sections = outline.ok ? outline.data.sections : [];
  const enrolledIds = new Set(report?.ok ? report.data.students.map((s) => s.user_id) : []);
  const enrollable = members?.ok ? members.data.members.filter((m) => !enrolledIds.has(m.userId)) : [];

  return (
    <>
      <p><Link href={`/w/${orgSlug}/programs`}>← Programs</Link></p>
      <PageHead sub={`${ctx.name} · Programs`} title={program?.title ?? 'Program'}>
        {builder && program && (
          <form action={publish}>
            <input type="hidden" name="status" value={program.status === 'published' ? 'draft' : 'published'} />
            <button className="btn" type="submit">{program.status === 'published' ? 'Unpublish' : 'Publish'}</button>
          </form>
        )}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (outline.ok ? undefined : outline.error.message)} />

      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          {sections.map((s) => (
            <section key={s.id}>
              <h2 style={{ marginTop: 8, fontSize: 18 }}>{s.title}</h2>
              {s.modules.map((m) => (
                <div key={m.id}>
                  <h3>{m.title}</h3>
                  {m.lessons.map((l) => (
                    <div key={l.id} className="lesson">
                      <div>
                        {l.isAvailable ? <Link href={`/w/${orgSlug}/lessons/${l.id}`}><b>{l.title}</b></Link> : <b>{l.title}</b>}
                        <div className="muted">
                          {l.estimatedMinutes ? `${l.estimatedMinutes} min · ` : ''}
                          {!l.isAvailable && (l.lockReason === 'drip_locked' ? `Opens ${day(l.unlocksAt)}` : LOCK[l.lockReason ?? ''] ?? l.lockReason)}
                        </div>
                      </div>
                      {l.progress === 'completed' ? <Pill value="completed" />
                        : !l.isAvailable ? <Pill value="locked" label="Locked" />
                        : (
                          <form action={complete}><input type="hidden" name="id" value={l.id} />
                            <button className="btn small" type="submit">Mark complete</button></form>
                        )}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
          {!sections.length && <p className="muted">No content yet.</p>}
        </div>

        <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="muted">Your progress</div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{pct}%</div>
            <Bar pct={pct} />
            <div className="muted" style={{ marginTop: 6 }}>{doneCount} of {lessons.length} lessons</div>
          </div>

          {report?.ok && (
            <div className="card">
              <h2>Students ({report.data.students.length})</h2>
              <ul className="plain">
                {report.data.students.map((s) => (
                  <li key={s.id}><span>{s.profile?.display_name ?? 'Student'}</span><span>{Math.round(Number(s.progress_percent))}%</span></li>
                ))}
              </ul>
              {!!enrollable.length && (
                <form action={enroll} className="row" style={{ marginTop: 10 }}>
                  <select name="user" aria-label="Member to enroll">
                    {enrollable.map((m) => <option key={m.userId} value={m.userId}>{m.profile?.display_name ?? m.email}</option>)}
                  </select>
                  <button className="btn small" type="submit">Enroll</button>
                </form>
              )}
            </div>
          )}

          {builder && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2>Build</h2>
              <form action={addSection} className="row"><input name="title" placeholder="New section" required aria-label="Section title" /><button className="btn small">Add</button></form>
              {!!sections.length && (
                <form action={addModule} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <select name="section" aria-label="Section">{sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
                  <input name="title" placeholder="New module" required aria-label="Module title" />
                  <input name="days" type="number" min="0" placeholder="Unlock after N days (optional)" aria-label="Drip days" />
                  <button className="btn small">Add module</button>
                </form>
              )}
              {sections.some((s) => s.modules.length) && (
                <form action={addLesson} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <select name="module" aria-label="Module">{sections.flatMap((s) => s.modules).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
                  <input name="title" placeholder="New lesson" required aria-label="Lesson title" />
                  <input name="days" type="number" min="0" placeholder="Unlock after N days (optional)" aria-label="Lesson drip days" />
                  <label className="row"><input type="checkbox" name="seq" /> Requires previous lesson</label>
                  <button className="btn small">Add lesson</button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
