import Link from 'next/link';
import { requireOrgPage, can } from '@/lib/auth/context';
import {
  SHEET_FIELD_TYPES, addSheetField, addSheetSection, archiveSheetField, getSheetConfig, installDiscoveryTemplate, listSheetFields,
  moveSheetField, removeSheetSection, saveCalculatorPresets, saveSheetSection, updateSheetField,
} from '@/modules/sales/actions';
import { DEFAULT_PRESETS, CALCULATOR_KEYS } from '@/modules/sales/calculator';
import { SHEET_TYPE_LABEL, groupBySection } from '@/modules/sales/sheet';
import { done } from '@/components/flash';
import { Modal } from '@/components/modal';
import { Flash, PageHead, Pill } from '@/components/ui';

// Module scope: inline server actions may only close over serializable values.
const lines = (v: FormDataEntryValue | null) => String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
const field = (f: FormData) => ({
  label: String(f.get('label') ?? ''), type: String(f.get('type')) as 'text', required: f.get('required') === 'on',
  options: lines(f.get('options')), section: String(f.get('section') ?? ''),
});
const num = (f: FormData, k: string) => Number(f.get(k) || 0);

function FieldInputs({ f, section, sections }: { f?: { label: string; field_type: string; options: string[]; is_required: boolean }; section?: string; sections: string[] }) {
  return (<>
    <label className="f">What the rep asks or needs to find out<input name="label" required maxLength={400} defaultValue={f?.label} placeholder="What is their monthly revenue?" /></label>
    <div className="row">
      <label className="f" style={{ flex: 1 }}>Answer type<select name="type" defaultValue={f?.field_type ?? 'text'}>{SHEET_FIELD_TYPES.map((t) => <option key={t} value={t}>{SHEET_TYPE_LABEL[t]}</option>)}</select></label>
      <label className="f" style={{ flex: 1 }}>Section<input name="section" defaultValue={section ?? ''} list="sheet-sections" placeholder="Pick one or type a new name" maxLength={120} /></label>
    </div>
    <datalist id="sheet-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
    <label className="f">Options <span className="muted" style={{ fontWeight: 400 }}>(pick one / pick several only, one per line)</span><textarea name="options" rows={3} defaultValue={f?.options.join('\n')} /></label>
    <label className="row" style={{ fontWeight: 600, fontSize: 13 }}><input type="checkbox" name="required" defaultChecked={f?.is_required} /> Must be filled in</label>
  </>);
}

/** The call sheet: the talk-track and the information every rep must capture on every deal in this workspace. */
export default async function CallSheet({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const board = `/w/${orgSlug}/pipeline`;
  const path = `${board}/sheet`;
  if (!can(ctx, 'sales.read')) return (<><PageHead sub={ctx.name} title="Call sheet" /><div className="card muted">You don&apos;t have access to sales.</div></>);
  const [res, cfg] = await Promise.all([listSheetFields({ orgSlug }), getSheetConfig({ orgSlug })]);
  const fields = res.ok ? res.data : [];
  const config = cfg.ok ? cfg.data : { sections: [], calculator: null };
  // sections and presets live on the workspace settings, so editing the layout needs both permissions
  const edit = can(ctx, 'custom_fields.update') && can(ctx, 'organization.update');
  const groups = groupBySection(fields, config.sections);
  const titles = config.sections.map((s) => s.title);
  const presets = config.calculator ?? { ...DEFAULT_PRESETS, enabled: false };
  const calcKeys = Object.values(CALCULATOR_KEYS);
  const missing = calcKeys.filter((k) => !fields.some((f) => f.key === k));

  async function add(f: FormData) { 'use server'; done(path, await addSheetField({ orgSlug, ...field(f) }), 'Added to the call sheet'); }
  async function save(f: FormData) { 'use server'; done(path, await updateSheetField({ orgSlug, fieldId: String(f.get('id')), ...field(f) }), 'Saved'); }
  async function remove(f: FormData) { 'use server'; done(path, await archiveSheetField({ orgSlug, fieldId: String(f.get('id')) }), 'Removed from the call sheet'); }
  async function move(f: FormData) { 'use server'; done(path, await moveSheetField({ orgSlug, fieldId: String(f.get('id')), direction: String(f.get('dir')) as 'up' }), 'Order updated'); }
  async function install() { 'use server'; done(path, await installDiscoveryTemplate({ orgSlug }), (d) => `Loaded ${d.sections} sections and ${d.questions} questions. Edit anything you like.`); }
  async function section(f: FormData) {
    'use server';
    done(path, await saveSheetSection({ orgSlug, sectionId: String(f.get('id')), title: String(f.get('title') ?? ''), script: String(f.get('script') ?? '') }), 'Section saved');
  }
  async function newSection(f: FormData) { 'use server'; done(path, await addSheetSection({ orgSlug, title: String(f.get('title') ?? ''), script: String(f.get('script') ?? '') }), 'Section added'); }
  async function dropSection(f: FormData) { 'use server'; done(path, await removeSheetSection({ orgSlug, sectionId: String(f.get('id')) }), 'Section removed. Its questions moved to Other questions.'); }
  async function calc(f: FormData) {
    'use server';
    done(path, await saveCalculatorPresets({
      orgSlug, enabled: f.get('enabled') === 'on', label: String(f.get('label') ?? ''), closeRate: num(f, 'closeRate'), avgJob: num(f, 'avgJob'),
      bigJobsPerMonth: num(f, 'bigJobsPerMonth'), bigJobValue: num(f, 'bigJobValue'), daysPerBigJob: num(f, 'daysPerBigJob'),
    }), 'Calculator saved');
  }

  return (
    <>
      <Link href={board}>← Sales pipeline</Link>
      <PageHead sub={`${ctx.name} · Sales pipeline`} title="Call sheet">
        {edit && (
          <Modal label="+ Section" title="New section">
            <form action={newSection}>
              <label className="f">Section name<input name="title" required maxLength={120} placeholder="Current situation" autoFocus /></label>
              <label className="f">What the rep says <span className="muted" style={{ fontWeight: 400 }}>(optional talk-track)</span><textarea name="script" rows={4} maxLength={4000} /></label>
              <div><button className="btn primary" type="submit">Add section</button></div>
            </form>
          </Modal>
        )}
        {can(ctx, 'custom_fields.create') && (
          <Modal label="+ Question" title="Add a question" primary open={!!sp.err}>
            <form action={add}><FieldInputs sections={titles} /><div><button className="btn primary" type="submit">Add</button></div></form>
          </Modal>
        )}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : res.error.message)} />
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>What your reps say and what they must find out on every sales call. It appears on each deal, section by section, and every answer is saved with that deal.</p>

      {!fields.length && edit && (
        <form className="card next" action={install} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Start from the discovery call template</h2>
          <p className="muted" style={{ margin: 0 }}>Nine sections from setting the frame to the close, with the talk-track for each, about 45 typed questions, and the revenue calculator wired to the four numbers it needs. Everything stays editable.</p>
          <div><button className="btn primary" type="submit">Load the discovery call template</button></div>
        </form>
      )}
      {!fields.length && !edit && <div className="card empty">No call sheet yet. A workspace admin sets it up.</div>}

      <div className="grid builder">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map(({ section: s, fields: fs }) => (
            <details className="section" key={s.id} open>
              <summary><span>{s.title}{s.calculator && <> <Pill value="none" label="calculator here" /></>}</span><span className="muted" style={{ fontWeight: 400 }}>{fs.length} question{fs.length === 1 ? '' : 's'}</span></summary>
              <div className="inner">
                {s.script && <div className="script"><div className="k">Say</div>{s.script}</div>}
                {edit && s.id !== '_other' && (
                  <details className="edit"><summary>Edit section name and talk-track</summary>
                    <form action={section} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      <input type="hidden" name="id" value={s.id} />
                      <label className="f">Section name<input name="title" required maxLength={120} defaultValue={s.title} /></label>
                      <label className="f">What the rep says<textarea name="script" rows={4} maxLength={4000} defaultValue={s.script ?? ''} /></label>
                      <div><button className="btn small primary" type="submit">Save section</button></div>
                    </form>
                    <form action={dropSection} style={{ marginTop: 8 }}><input type="hidden" name="id" value={s.id} /><button className="btn small" type="submit">Remove section</button>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Questions are kept and move to Other questions.</span></form>
                  </details>
                )}
                {!fs.length && <p className="empty" style={{ margin: 0 }}>No questions in this section{s.script ? ', just the talk-track' : ''}.</p>}
                {fs.map((f, n) => (
                  <div className="qrow" key={f.id} style={{ padding: '8px 0' }}>
                    {can(ctx, 'custom_fields.update') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(['up', 'down'] as const).map((dir) => (
                          <form action={move} key={dir}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="dir" value={dir} />
                            <button className="btn small" type="submit" disabled={dir === 'up' ? n === 0 : n === fs.length - 1} aria-label={`Move "${f.label}" ${dir}`}>{dir === 'up' ? '↑' : '↓'}</button></form>
                        ))}
                      </div>
                    )}
                    <div className="grow">
                      <div className="wrap"><b>{f.label}</b> {f.is_required && <Pill value="high" label="required" />}{calcKeys.includes(f.key as never) && <> <Pill value="active" label="feeds calculator" /></>}</div>
                      <div className="muted">{SHEET_TYPE_LABEL[f.field_type]}{f.options.length > 0 && `: ${f.options.join(' · ')}`}</div>
                      {can(ctx, 'custom_fields.update') && (
                        <details className="edit" style={{ marginTop: 4 }}><summary>Edit</summary>
                          <form action={save} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}><input type="hidden" name="id" value={f.id} />
                            <FieldInputs f={f} section={s.id === '_other' ? '' : s.title} sections={titles} />
                            <div><button className="btn small primary" type="submit">Save</button></div></form>
                          <form action={remove} style={{ marginTop: 8 }}><input type="hidden" name="id" value={f.id} /><button className="btn small" type="submit">Remove</button>
                            <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Answers already captured on deals are kept.</span></form>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form className="card" action={calc} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div><h2 style={{ marginBottom: 2 }}>Revenue calculator</h2>
              <p className="muted" style={{ margin: 0 }}>Shows the prospect what they leave on the table, live on the call. These are your preset numbers; the rep can nudge them on a call without changing what is saved here.</p></div>
            <fieldset disabled={!edit} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <label className="row" style={{ fontWeight: 600 }}><input type="checkbox" name="enabled" defaultChecked={presets.enabled} /> Show the calculator on deals</label>
              <label className="f">Your short name <span className="muted" style={{ fontWeight: 400 }}>(as in &quot;Revenue with JT&quot;)</span><input name="label" maxLength={40} defaultValue={presets.label} /></label>
              <div className="row"><label className="f" style={{ flex: 1 }}>Your close rate (%)<input name="closeRate" type="number" min="0" max="100" step="any" defaultValue={presets.closeRate} /></label>
                <label className="f" style={{ flex: 1 }}>Your average job ($)<input name="avgJob" type="number" min="0" step="any" defaultValue={presets.avgJob} /></label></div>
              <div className="row"><label className="f" style={{ flex: 1 }}>Big jobs per month<input name="bigJobsPerMonth" type="number" min="0" step="any" defaultValue={presets.bigJobsPerMonth} /></label>
                <label className="f" style={{ flex: 1 }}>Big job value ($)<input name="bigJobValue" type="number" min="0" step="any" defaultValue={presets.bigJobValue} /></label></div>
              <label className="f">Days per big job<input name="daysPerBigJob" type="number" min="0" step="any" defaultValue={presets.daysPerBigJob} /></label>
              {edit && <div><button className="btn primary" type="submit">Save calculator</button></div>}
            </fieldset>
            {presets.enabled && missing.length > 0 && (
              <p className="flash err" style={{ margin: 0, wordBreak: 'normal' }}>The calculator reads four questions by their key and {missing.length === 4 ? 'none exist yet' : `${missing.length} are missing`}: {missing.join(', ')}. Load the template, or add number questions named Leads per month, Close rate, Average job price and Hours per week.</p>
            )}
          </form>
        </div>
      </div>
    </>
  );
}
