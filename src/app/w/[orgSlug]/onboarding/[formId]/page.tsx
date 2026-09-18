import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import {
  addQuestion, deleteQuestion, getForm, moveQuestion, setBranding, setCourseOnboarding, setFormStatus, updateForm, updateQuestion,
} from '@/modules/onboarding-forms/actions';
import { QUESTION_TYPES, QUESTION_TYPE_LABEL, hasOptions, type QuestionType } from '@/modules/onboarding-forms/types';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill } from '@/components/ui';

const lines = (v: FormDataEntryValue | null) => String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
const orNull = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null;
// Module scope: inline server actions may only close over serializable values.
const question = (f: FormData) => ({
  label: String(f.get('label') ?? ''), helpText: String(f.get('help') ?? ''), type: String(f.get('type')) as QuestionType,
  required: f.get('required') === 'on', options: lines(f.get('options')),
});

function QuestionFields({ q }: { q?: { label: string; help_text: string | null; question_type: string; options: string[]; is_required: boolean } }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label className="f" style={{ flex: 2, minWidth: 260 }}>Question<input name="label" required maxLength={500} defaultValue={q?.label} placeholder="What is your business name?" /></label>
        <label className="f">Answer type
          <select name="type" defaultValue={q?.question_type ?? 'short_text'}>
            {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
      </div>
      <label className="f">Help text <span className="muted" style={{ fontWeight: 400 }}>(optional, shown under the question)</span>
        <input name="help" maxLength={1000} defaultValue={q?.help_text ?? ''} /></label>
      <label className="f">Options <span className="muted" style={{ fontWeight: 400 }}>(single and multi select only, one per line)</span>
        <textarea name="options" rows={3} defaultValue={q?.options.join('\n')} placeholder={'Just starting\nGrowing\nScaling'} /></label>
      <label className="row" style={{ fontWeight: 600, fontSize: 13 }}><input type="checkbox" name="required" defaultChecked={q?.is_required} /> Required</label>
    </>
  );
}

export default async function FormBuilder({ params, searchParams }: { params: Promise<{ orgSlug: string; formId: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug, formId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  if (!can(ctx, 'programs.read')) notFound();
  const res = await getForm({ orgSlug, formId });
  if (!res.ok) notFound();
  const { form, questions, programs, branding } = res.data;
  const path = `/w/${orgSlug}/onboarding/${formId}`;
  const edit = can(ctx, 'programs.update');
  const attached = programs.filter((p) => p.onboarding_form_id === form.id);

  async function add(f: FormData) { 'use server'; done(path, await addQuestion({ orgSlug, formId, ...question(f) }), 'Question added'); }
  async function save(f: FormData) { 'use server'; done(path, await updateQuestion({ orgSlug, questionId: String(f.get('id')), ...question(f) }), 'Question saved'); }
  async function remove(f: FormData) { 'use server'; done(path, await deleteQuestion({ orgSlug, questionId: String(f.get('id')) }), 'Question removed'); }
  async function move(f: FormData) {
    'use server';
    done(path, await moveQuestion({ orgSlug, formId, questionId: String(f.get('id')), direction: String(f.get('dir')) as 'up' }), 'Order updated');
  }
  async function details(f: FormData) {
    'use server';
    done(path, await updateForm({ orgSlug, formId, patch: {
      name: String(f.get('name') ?? ''), description: orNull(f.get('description')), welcome_heading: orNull(f.get('welcome_heading')),
      welcome_message: orNull(f.get('welcome_message')), completion_message: orNull(f.get('completion_message')),
    } }), 'Form saved');
  }
  async function status(f: FormData) {
    'use server';
    const to = String(f.get('status')) as 'published';
    done(path, await setFormStatus({ orgSlug, formId, status: to }), to === 'published' ? 'Published. Attach it to a course and buyers will get it automatically.' : 'Moved back to draft');
  }
  async function attach(f: FormData) {
    'use server';
    const on = f.get('attach') === 'on';
    done(path, await setCourseOnboarding({ orgSlug, programId: String(f.get('program')), formId: on ? formId : null }), on ? 'Attached to the course' : 'Detached from the course');
  }
  async function brand(f: FormData) {
    'use server';
    done(path, await setBranding({ orgSlug, brandColor: orNull(f.get('color')), logoUrl: orNull(f.get('logo')) }), 'Branding saved');
  }

  return (
    <>
      <Link href={`/w/${orgSlug}/onboarding`}>← Onboarding forms</Link>
      <PageHead sub={`${ctx.name} · Onboarding`} title={form.name}>
        <Pill value={form.status === 'published' ? 'active' : 'pending'} label={form.status} />
        <Link className="btn" href={`${path}/preview`}>Preview</Link>
        {edit && (
          <form action={status}>
            <input type="hidden" name="status" value={form.status === 'published' ? 'draft' : 'published'} />
            <button className={`btn${form.status === 'published' ? '' : ' primary'}`} type="submit">{form.status === 'published' ? 'Unpublish' : 'Publish'}</button>
          </form>
        )}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err} />

      <div className="grid builder">
        <div className="card">
          <h2>Questions ({questions.length})</h2>
          {!questions.length && <p className="muted">No questions yet. Add the first one below.</p>}
          {questions.map((q, n) => (
            <div className="qrow" key={q.id}>
              {edit && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(['up', 'down'] as const).map((dir) => (
                    <form action={move} key={dir}>
                      <input type="hidden" name="id" value={q.id} /><input type="hidden" name="dir" value={dir} />
                      <button className="btn small" type="submit" disabled={dir === 'up' ? n === 0 : n === questions.length - 1}
                              aria-label={`Move "${q.label}" ${dir}`}>{dir === 'up' ? '↑' : '↓'}</button>
                    </form>
                  ))}
                </div>
              )}
              <div className="grow">
                <div><b>{n + 1}. {q.label}</b> {q.is_required ? <Pill value="high" label="required" /> : <Pill value="none" label="optional" />}</div>
                <div className="muted">{QUESTION_TYPE_LABEL[q.question_type]}{hasOptions(q.question_type) && `: ${q.options.join(' · ')}`}</div>
                {q.help_text && <div className="muted">{q.help_text}</div>}
                <div className="muted" style={{ fontSize: 12 }}>Automation key: <code>{q.key}</code></div>
                {edit && (
                  <details className="edit" style={{ marginTop: 8 }}>
                    <summary>Edit</summary>
                    <form action={save} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                      <input type="hidden" name="id" value={q.id} />
                      <QuestionFields q={q} />
                      <div className="row"><button className="btn small primary" type="submit">Save question</button></div>
                    </form>
                    <form action={remove} style={{ marginTop: 8 }}>
                      <input type="hidden" name="id" value={q.id} />
                      <button className="btn small" type="submit">Delete question</button>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Answers already given stay on each customer&apos;s record.</span>
                    </form>
                  </details>
                )}
              </div>
            </div>
          ))}
          {edit && (
            <form action={add} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              <h3 style={{ margin: 0 }}>Add a question</h3>
              <QuestionFields />
              <div><button className="btn primary" type="submit">Add question</button></div>
            </form>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h2>Courses using this form</h2>
            {!programs.length && <p className="muted" style={{ margin: 0 }}>No courses yet. <Link href={`/w/${orgSlug}/programs`}>Create one</Link>.</p>}
            {programs.map((p) => {
              const mine = p.onboarding_form_id === form.id;
              const other = !!p.onboarding_form_id && !mine;
              return (
                <form action={attach} key={p.id} className="lesson">
                  <input type="hidden" name="program" value={p.id} />
                  {!mine && <input type="hidden" name="attach" value="on" />}
                  <span><Link href={`/w/${orgSlug}/programs/${p.id}`}>{p.title}</Link>{other && <span className="muted"> (uses another form)</span>}</span>
                  {edit && <button className="btn small" type="submit" disabled={!mine && form.status !== 'published'}>{mine ? 'Detach' : other ? 'Switch to this' : 'Attach'}</button>}
                </form>
              );
            })}
            {form.status !== 'published' && programs.length > 0 && <p className="muted" style={{ marginBottom: 0 }}>Publish the form to attach it.</p>}
            {form.status === 'published' && !attached.length && programs.length > 0 && <p className="muted" style={{ marginBottom: 0 }}>Not attached yet, so no customer will see it.</p>}
          </div>

          {edit && (
            <form className="card" action={details} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: 0 }}>Wording</h2>
              <label className="f">Form name<input name="name" required maxLength={200} defaultValue={form.name} /></label>
              <label className="f">Internal note<input name="description" maxLength={2000} defaultValue={form.description ?? ''} /></label>
              <label className="f">Heading the customer sees<input name="welcome_heading" maxLength={200} defaultValue={form.welcome_heading ?? ''} placeholder="Welcome, {their first name}." /></label>
              <label className="f">Intro<textarea name="welcome_message" maxLength={2000} defaultValue={form.welcome_message ?? ''} placeholder="Let's get you set up." /></label>
              <label className="f">Message after they finish<textarea name="completion_message" maxLength={2000} defaultValue={form.completion_message ?? ''} /></label>
              <div><button className="btn" type="submit">Save wording</button></div>
            </form>
          )}

          {can(ctx, 'organization.update') && (
            <form className="card" action={brand} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: 0 }}>{branding.name} branding</h2>
              <p className="muted" style={{ margin: 0 }}>Shown on the sign-up link and onboarding form for every course in this workspace.</p>
              <label className="f">Brand colour<input name="color" defaultValue={branding.brand_color ?? ''} placeholder="#2f5d8a" pattern="#[0-9a-fA-F]{6}" /></label>
              <label className="f">Logo link<input name="logo" type="url" defaultValue={branding.logo_url ?? ''} placeholder="https://" /></label>
              <div><button className="btn" type="submit">Save branding</button></div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
