import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { createSop, listSops, listSopTemplates } from '@/modules/sops/actions';
import { applyTemplate } from '@/modules/templates/actions';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, day } from '@/components/ui';

/** The team's playbook. Clients write their own; the operator can also drop in SOPs from the Growth OS library. */
export default async function Sops({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ q?: string; msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/sops`;
  if (!can(ctx, 'sops.read')) {
    return (<><PageHead sub={ctx.name} title="SOPs" /><div className="card muted">You don&apos;t have access to the SOP library.</div></>);
  }
  const [res, templates] = await Promise.all([listSops({ orgSlug }), listSopTemplates({ orgSlug })]);
  const all = res.ok ? res.data : [];
  const q = (sp.q ?? '').trim().toLowerCase();
  const sops = all.filter((s) => !q || `${s.title} ${s.department ?? ''} ${s.summary ?? ''}`.toLowerCase().includes(q));
  const live = sops.filter((s) => s.status !== 'archived');
  const archived = sops.filter((s) => s.status === 'archived');
  const departments = [...new Set(live.map((s) => s.department ?? 'General'))].sort();
  const library = templates.ok ? templates.data : [];
  const alreadyIn = new Set(all.map((s) => s.source_template_id).filter(Boolean));

  async function create(form: FormData) {
    'use server';
    const r = await createSop({ orgSlug, title: String(form.get('title') ?? ''), department: String(form.get('department') ?? ''),
      summary: String(form.get('summary') ?? ''), body: String(form.get('body') ?? '') });
    if (!r.ok) redirect(`${path}?err=${encodeURIComponent(r.error.message)}`);
    redirect(`${path}/${r.data.sopId}?msg=${encodeURIComponent('SOP created')}`);
  }
  async function addFromLibrary(form: FormData) {
    'use server';
    done(path, await applyTemplate({ orgSlug, templateType: 'sop', templateId: String(form.get('template')) }), 'Added from the Growth OS library');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="SOPs">
        {can(ctx, 'sops.create') && <a className="btn primary" href="#new">+ New SOP</a>}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : `Could not load SOPs: ${res.error.message}`)} />
      <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
        Standard operating procedures for your team: how this business runs. Customers never see these. What customers learn lives in <Link href={`/w/${orgSlug}/programs`}>Courses</Link>.
      </p>

      {all.length > 6 && (
        <form className="row"><input name="q" placeholder="Search SOPs" defaultValue={sp.q} aria-label="Search SOPs" /><button className="btn small" type="submit">Search</button>{q && <Link className="btn small" href={path}>Clear</Link>}</form>
      )}

      {res.ok && !live.length && (
        <div className="card empty">{q ? 'No SOPs match your search.' : 'No SOPs yet. Write the first one below, or add one from the Growth OS library.'}</div>
      )}
      {departments.map((dept) => (
        <div className="card" key={dept}>
          <h2>{dept}</h2>
          <ul className="attn">
            {live.filter((s) => (s.department ?? 'General') === dept).map((s) => (
              <li key={s.id}>
                <span><Link href={`${path}/${s.id}`}><b>{s.title}</b></Link>
                  {s.summary && <div className="muted wrap">{s.summary}</div>}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.source_template_id ? 'From Growth OS' : s.owner ? `Owner: ${s.owner}` : 'Written here'} · updated {day(s.updated_at)}
                    {s.last_reviewed_at && ` · reviewed ${day(s.last_reviewed_at)}`}
                  </div></span>
                <Pill value={s.status === 'active' ? 'active' : 'pending'} label={s.status} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {archived.length > 0 && (
        <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Archived ({archived.length})</summary>
          <ul className="attn" style={{ marginTop: 8 }}>{archived.map((s) => <li key={s.id}><Link href={`${path}/${s.id}`}>{s.title}</Link><span className="muted">{day(s.updated_at)}</span></li>)}</ul>
        </details>
      )}

      {library.length > 0 && can(ctx, 'sops.create') && (
        <form className="card" action={addFromLibrary} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ flexBasis: '100%' }}><h2 style={{ marginBottom: 2 }}>Add from the Growth OS library</h2>
            <p className="muted" style={{ margin: 0 }}>Copies the SOP into this workspace. The client can then edit their copy freely.</p></div>
          <label className="f" style={{ flex: 1, minWidth: 260 }}>Library SOP
            <select name="template" required>
              {library.map((t) => <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}{alreadyIn.has(t.id) ? ' · already added' : ''}</option>)}
            </select></label>
          <button className="btn" type="submit">Add to workspace</button>
        </form>
      )}

      {can(ctx, 'sops.create') && (
        <form id="new" className="card" action={create} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0 }}>New SOP</h2>
          <div className="row" style={{ alignItems: 'end' }}>
            <label className="f" style={{ flex: 2, minWidth: 240 }}>Title<input name="title" required maxLength={200} placeholder="How we onboard a new customer" /></label>
            <label className="f" style={{ flex: 1, minWidth: 160 }}>Department <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
              <input name="department" maxLength={80} placeholder="Sales, Delivery, Marketing…" list="departments" />
              <datalist id="departments">{departments.filter((d) => d !== 'General').map((d) => <option key={d} value={d} />)}</datalist></label>
          </div>
          <label className="f">One-line summary <span className="muted" style={{ fontWeight: 400 }}>(optional)</span><input name="summary" maxLength={1000} /></label>
          <label className="f">Procedure
            <textarea name="body" required rows={10} maxLength={100000} placeholder={'# Purpose\nWhy this exists.\n\n# Steps\n1. First step\n2. Second step\n\n# Notes\n- Anything the team should know'} />
            <span className="qhelp">Plain text. Lines starting with # become headings, 1. or - become lists.</span></label>
          <div><button className="btn primary" type="submit">Create SOP</button></div>
        </form>
      )}
    </>
  );
}
