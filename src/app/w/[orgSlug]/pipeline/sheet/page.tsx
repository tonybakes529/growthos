import Link from 'next/link';
import { requireOrgPage, can } from '@/lib/auth/context';
import { SHEET_FIELD_TYPES, addSheetField, archiveSheetField, listSheetFields, moveSheetField, updateSheetField } from '@/modules/sales/actions';
import { SHEET_TYPE_LABEL, SheetInputs } from '@/modules/sales/sheet';
import { done } from '@/components/flash';
import { Modal } from '@/components/modal';
import { Flash, PageHead, Pill } from '@/components/ui';

const lines = (v: FormDataEntryValue | null) => String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
const field = (f: FormData) => ({ label: String(f.get('label') ?? ''), type: String(f.get('type')) as 'text', required: f.get('required') === 'on', options: lines(f.get('options')) });

function FieldInputs({ f }: { f?: { label: string; field_type: string; options: string[]; is_required: boolean } }) {
  return (<>
    <label className="f">What the rep needs to find out<input name="label" required maxLength={200} defaultValue={f?.label} placeholder="What is their monthly revenue?" /></label>
    <label className="f">Answer type<select name="type" defaultValue={f?.field_type ?? 'text'}>{SHEET_FIELD_TYPES.map((t) => <option key={t} value={t}>{SHEET_TYPE_LABEL[t]}</option>)}</select></label>
    <label className="f">Options <span className="muted" style={{ fontWeight: 400 }}>(pick one / pick several only, one per line)</span><textarea name="options" rows={3} defaultValue={f?.options.join('\n')} /></label>
    <label className="row" style={{ fontWeight: 600, fontSize: 13 }}><input type="checkbox" name="required" defaultChecked={f?.is_required} /> Must be filled in</label>
  </>);
}

/** The call sheet: what every rep must capture on every deal in this workspace. */
export default async function CallSheet({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const board = `/w/${orgSlug}/pipeline`;
  const path = `${board}/sheet`;
  if (!can(ctx, 'sales.read')) return (<><PageHead sub={ctx.name} title="Call sheet" /><div className="card muted">You don&apos;t have access to sales.</div></>);
  const res = await listSheetFields({ orgSlug });
  const fields = res.ok ? res.data : [];
  const edit = can(ctx, 'custom_fields.update');

  async function add(f: FormData) { 'use server'; done(path, await addSheetField({ orgSlug, ...field(f) }), 'Added to the call sheet'); }
  async function save(f: FormData) { 'use server'; done(path, await updateSheetField({ orgSlug, fieldId: String(f.get('id')), ...field(f) }), 'Saved'); }
  async function remove(f: FormData) { 'use server'; done(path, await archiveSheetField({ orgSlug, fieldId: String(f.get('id')) }), 'Removed from the call sheet'); }
  async function move(f: FormData) { 'use server'; done(path, await moveSheetField({ orgSlug, fieldId: String(f.get('id')), direction: String(f.get('dir')) as 'up' }), 'Order updated'); }

  return (
    <>
      <Link href={board}>← Sales pipeline</Link>
      <PageHead sub={`${ctx.name} · Sales pipeline`} title="Call sheet">
        {can(ctx, 'custom_fields.create') && (
          <Modal label="+ Add a question" title="Add to the call sheet" primary open={!!sp.err}>
            <form action={add}><FieldInputs /><div><button className="btn primary" type="submit">Add</button></div></form>
          </Modal>
        )}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : res.error.message)} />
      <p className="muted" style={{ margin: 0, maxWidth: 720 }}>The information a rep has to obtain and type in on every deal. It appears on each deal page, above the call log.</p>

      <div className="grid g2">
        <div className="card">
          <h2>Questions ({fields.length})</h2>
          {!fields.length && <p className="empty">Nothing yet. Add the first question your reps should always ask.</p>}
          {fields.map((f, n) => (
            <div className="qrow" key={f.id}>
              {edit && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(['up', 'down'] as const).map((dir) => (
                    <form action={move} key={dir}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="dir" value={dir} />
                      <button className="btn small" type="submit" disabled={dir === 'up' ? n === 0 : n === fields.length - 1} aria-label={`Move "${f.label}" ${dir}`}>{dir === 'up' ? '↑' : '↓'}</button></form>
                  ))}
                </div>
              )}
              <div className="grow">
                <div><b>{n + 1}. {f.label}</b> {f.is_required && <Pill value="high" label="required" />}</div>
                <div className="muted">{SHEET_TYPE_LABEL[f.field_type]}{f.options.length > 0 && `: ${f.options.join(' · ')}`}</div>
                {edit && (
                  <details className="edit" style={{ marginTop: 6 }}><summary>Edit</summary>
                    <form action={save} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}><input type="hidden" name="id" value={f.id} /><FieldInputs f={f} />
                      <div><button className="btn small primary" type="submit">Save</button></div></form>
                    <form action={remove} style={{ marginTop: 8 }}><input type="hidden" name="id" value={f.id} /><button className="btn small" type="submit">Remove</button>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Answers already captured are kept.</span></form>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>What the rep sees</h2>
          {fields.length ? <SheetInputs fields={fields} disabled /> : <p className="empty">The preview appears once there is a question.</p>}
        </div>
      </div>
    </>
  );
}
