import Link from 'next/link';
import { requireOrgPage, can } from '@/lib/auth/context';
import { unwrap } from '@/lib/errors';
import { createLesson, createModule, createSection, getProgramOutline, setProgramStatus, updateProgram } from '@/modules/programs/actions';
import { completeLesson, enrollUser, getProgressReport } from '@/modules/enrollments/actions';
import { listMembers } from '@/modules/memberships/actions';
import { setCourseOnboarding } from '@/modules/onboarding-forms/actions';
import { done } from '@/components/flash';
import { Bar, Flash, PageHead, Pill, day } from '@/components/ui';

const LOCK: Record<string, string> = {
  drip_locked: 'Opens', previous_incomplete: 'Finish the previous lesson first', not_enrolled: 'Not enrolled',
  draft: 'Draft', access_expired: 'Access expired',
};

export default async function ProgramPage({ params, searchParams }: { params: Promise<{ orgSlug: string; programId: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug, programId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/programs/${programId}`;
  const builder = can(ctx, 'programs.update');
  const seeCustomers = can(ctx, 'enrollments.read');
  // customer numbers for this course, counted in the database instead of downloading every customer record
  const countCustomers = (statuses?: string[]) => {
    const q = ctx.sb.from('customer_onboardings').select('id', { count: 'exact', head: true })
      .eq('program_id', programId).eq('organization_id', ctx.organizationId);
    return statuses ? q.in('status', statuses) : q;
  };
  // Everything loads in one round: nothing here depends on the course row, only on the id in the URL.
  // Stripe identifiers live on the offer that sells this course and ride along with the entitlement.
  const [programRes, outline, report, members, forms, entitlements, ...customerCounts] = await Promise.all([
    ctx.sb.from('programs').select('id, title, subtitle, description, status, onboarding_form_id, external_product_id').eq('id', programId).maybeSingle(),
    getProgramOutline({ programId }),
    seeCustomers ? getProgressReport({ orgSlug, programId }) : null,
    can(ctx, 'enrollments.create') ? listMembers({ orgSlug }) : null,
    builder ? ctx.sb.from('onboarding_forms').select('id, name, status').eq('organization_id', ctx.organizationId).is('deleted_at', null).order('name') : null,
    builder && can(ctx, 'offers.read')
      ? ctx.sb.from('offer_entitlements')
          .select('offer:offers!offer_entitlements_organization_id_offer_id_fkey(id, name, stripe_product_id, prices:pricing_options!pricing_options_organization_id_offer_id_fkey(stripe_price_id))')
          .eq('program_id', programId).eq('organization_id', ctx.organizationId)
          .overrideTypes<{ offer: { id: string; name: string; stripe_product_id: string | null; prices: { stripe_price_id: string | null }[] } | null }[], { merge: false }>()
      : null,
    ...(seeCustomers ? [countCustomers(), countCustomers(['invited']), countCustomers(['registered', 'in_progress']), countCustomers(['completed'])] : []),
  ]);
  const program = unwrap(programRes);
  const offers = (entitlements?.data ?? []).flatMap((e) => (e.offer ? [e.offer] : []));
  const [customerTotal, customersInvited, customersUnfinished, customersDone] = customerCounts.map((r) => r?.count ?? 0);
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
  async function settings(form: FormData) {
    'use server';
    const text = (k: string) => String(form.get(k) ?? '').trim();
    const saved = await updateProgram({ orgSlug, programId, patch: { title: text('title'), description: text('description') || null } });
    if (!saved.ok) done(path, saved, '');
    done(path, await setCourseOnboarding({ orgSlug, programId, formId: text('form') || null, externalProductId: text('product') || null }), 'Course settings saved');
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
      <p><Link href={`/w/${orgSlug}/programs`}>← Courses</Link></p>
      <PageHead sub={`${ctx.name} · Courses`} title={program?.title ?? 'Course'}>
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
                  <li key={s.id}>
                    <span>{s.onboardingId
                      ? <Link href={`/w/${orgSlug}/students/${s.onboardingId}`}>{s.profile?.display_name ?? 'Student'}</Link>
                      : (s.profile?.display_name ?? 'Student')}</span>
                    <span>{Math.round(Number(s.progress_percent))}%</span>
                  </li>
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

          {seeCustomers && (
            <div className="card">
              <h2>Students ({customerTotal})</h2>
              <ul className="plain">
                <li><span className="muted">Invited, no login yet</span><span>{customersInvited}</span></li>
                <li><span className="muted">Onboarding not finished</span><span>{customersUnfinished}</span></li>
                <li><span className="muted">Onboarding complete</span><span>{customersDone}</span></li>
              </ul>
              <p style={{ marginBottom: 0 }}><Link href={`/w/${orgSlug}/students?course=${programId}`}>View students</Link></p>
            </div>
          )}

          {builder && program && (
            <form className="card" action={settings} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: 0 }}>Course settings</h2>
              <label className="f">Name<input name="title" required minLength={2} maxLength={160} defaultValue={program.title} /></label>
              <label className="f">Description<textarea name="description" maxLength={5000} defaultValue={program.description ?? ''} /></label>
              <label className="f">Onboarding form
                <select name="form" defaultValue={program.onboarding_form_id ?? ''}>
                  <option value="">None</option>
                  {(forms?.data ?? []).filter((f) => f.status === 'published' || f.id === program.onboarding_form_id)
                    .map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <span className="qhelp">Overrides your workspace intake form for buyers of this course. Only published forms are listed. <Link href={`/w/${orgSlug}/onboarding`}>Manage forms</Link></span>
              </label>
              <label className="f">Product ID <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                <input name="product" maxLength={200} defaultValue={program.external_product_id ?? ''} placeholder="The ID your checkout uses for this course" /></label>
              {!!offers.length && (
                <div className="muted" style={{ fontSize: 13 }}>
                  Sold through {offers.map((o) => {
                    const ids = [o.stripe_product_id, ...o.prices.map((x) => x.stripe_price_id)].filter(Boolean);
                    return `${o.name}${ids.length ? ` (Stripe: ${ids.join(', ')})` : ' (no Stripe IDs yet)'}`;
                  }).join('; ')}
                </div>
              )}
              <div><button className="btn" type="submit">Save settings</button></div>
            </form>
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
