import type { ReactNode } from 'react';
import type { SheetField, SheetSection } from './actions';

export const SHEET_TYPE_LABEL: Record<SheetField['field_type'], string> = {
  text: 'Short text', long_text: 'Long text', number: 'Number', currency: 'Money ($)', date: 'Date', boolean: 'Yes / no',
  select: 'Pick one', multi_select: 'Pick several', url: 'Link', email: 'Email', phone: 'Phone',
};

/** Reads the posted call sheet into {fieldId: value}. Blank means "clear this answer". */
export function sheetValuesFromForm(form: FormData, fields: Pick<SheetField, 'id' | 'field_type'>[]) {
  const out: Record<string, string | number | boolean | string[] | null> = {};
  for (const f of fields) {
    const name = `f_${f.id}`;
    if (f.field_type === 'multi_select') { const v = form.getAll(name).map(String).filter(Boolean); out[f.id] = v.length ? v : null; continue; }
    if (f.field_type === 'boolean') { out[f.id] = form.get(name) === 'on' ? true : null; continue; }
    const raw = String(form.get(name) ?? '').trim();
    if (raw === '') { out[f.id] = null; continue; }
    out[f.id] = f.field_type === 'number' ? Number(raw) : f.field_type === 'currency' ? Math.round(Number(raw) * 100) : raw;
  }
  return out;
}

/** The inputs for a call sheet. Used on the deal page and in the builder's preview, so they always match. */
export function SheetInputs({ fields, values = {}, disabled }: { fields: SheetField[]; values?: Record<string, unknown>; disabled?: boolean }) {
  return (
    <div className="qlist" style={{ gap: 14 }}>
      {fields.map((f) => {
        const name = `f_${f.id}`;
        const v = values[f.id];
        const label = <span className="qlabel">{f.label}{f.is_required && <span className="req" aria-hidden> *</span>}</span>;
        if (f.field_type === 'boolean') {
          return <label className="choice" key={f.id}><input type="checkbox" name={name} defaultChecked={v === true} disabled={disabled} /><span>{f.label}</span></label>;
        }
        if (f.field_type === 'select') {
          return (<label className="f" key={f.id}>{label}
            <select name={name} defaultValue={typeof v === 'string' ? v : ''} disabled={disabled}><option value="">Not answered</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select></label>);
        }
        if (f.field_type === 'multi_select') {
          const picked = Array.isArray(v) ? v : [];
          return (<fieldset className="q" key={f.id} disabled={disabled}><legend>{label}</legend>
            <div className="row">{f.options.map((o) => <label key={o} className="row" style={{ gap: 4 }}><input type="checkbox" name={name} value={o} defaultChecked={picked.includes(o)} />{o}</label>)}</div></fieldset>);
        }
        if (f.field_type === 'long_text') {
          return <label className="f" key={f.id}>{label}<textarea name={name} rows={3} defaultValue={typeof v === 'string' ? v : ''} disabled={disabled} maxLength={20000} /></label>;
        }
        const type = f.field_type === 'number' || f.field_type === 'currency' ? 'number' : f.field_type === 'date' ? 'date'
          : f.field_type === 'url' ? 'url' : f.field_type === 'email' ? 'email' : f.field_type === 'phone' ? 'tel' : 'text';
        const shown = f.field_type === 'currency' && typeof v === 'number' ? String(v / 100) : v == null ? '' : String(v);
        return <label className="f" key={f.id}>{label}<input name={name} type={type} step={type === 'number' ? 'any' : undefined} defaultValue={shown} disabled={disabled} /></label>;
      })}
    </div>
  );
}

/** Splits the flat question list into the workspace's sections, in section order; anything unplaced lands in "Other questions". */
export function groupBySection(fields: SheetField[], sections: SheetSection[]) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const placed = new Set<string>();
  const groups = sections.map((s) => {
    const fs = s.keys.map((k) => byKey.get(k)).filter((f): f is SheetField => !!f);
    fs.forEach((f) => placed.add(f.key));
    return { section: s, fields: fs };
  });
  const loose = fields.filter((f) => !placed.has(f.key));
  if (loose.length) groups.push({ section: { id: '_other', title: sections.length ? 'Other questions' : 'Questions', keys: loose.map((f) => f.key) }, fields: loose });
  return groups;
}

/** The whole call sheet as the rep works through it: talk-track, then the questions, section by section. */
export function SheetSections({ fields, sections, values = {}, disabled, calculator }: {
  fields: SheetField[]; sections: SheetSection[]; values?: Record<string, unknown>; disabled?: boolean; calculator?: ReactNode;
}) {
  return (
    <>
      {groupBySection(fields, sections).map(({ section, fields: fs }, n) => {
        const filled = fs.filter((f) => values[f.id] != null).length;
        return (
          <details className="section" key={section.id} open={n < 2 || filled > 0}>
            <summary><span>{section.title}</span>{fs.length > 0 && <span className="muted" style={{ fontWeight: 400 }}>{filled} of {fs.length}</span>}</summary>
            <div className="inner">
              {section.script && <div className="script"><div className="k">Say</div>{section.script}</div>}
              {fs.length > 0 && <SheetInputs fields={fs} values={values} disabled={disabled} />}
              {section.calculator && calculator}
            </div>
          </details>
        );
      })}
    </>
  );
}
