import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { addSopTab, createSop, listSops, listSopTabs, listSopTemplates, removeSopTab, renameSopTab } from '@/modules/sops/actions';
import { applyTemplate } from '@/modules/templates/actions';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, day } from '@/components/ui';
import { Menu, MenuNote } from '@/components/menu';
import { Modal } from '@/components/modal';

const GENERAL = 'General';
const tabHref = (path: string, tab: string | null) => (tab ? `${path}?tab=${encodeURIComponent(tab)}` : path);

/** The team's playbook, organised in tabs. Clients write their own; the operator can also drop in SOPs from the Growth OS library. */
export default async function Sops({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ tab?: string; q?: string; msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/sops`;
  if (!can(ctx, 'sops.read')) {
    return (<><PageHead sub={ctx.name} title="SOPs" /><div className="card muted">You don&apos;t have access to the SOP library.</div></>);
  }
  const [res, templates, saved] = await Promise.all([listSops({ orgSlug }), listSopTemplates({ orgSlug }), listSopTabs({ orgSlug })]);
  const all = res.ok ? res.data : [];
  const live = all.filter((s) => s.status !== 'archived');
  const archived = all.filter((s) => s.status === 'archived');
  const library = templates.ok ? templates.data : [];
  const alreadyIn = new Set(all.map((s) => s.source_template_id).filter(Boolean));

  // Tabs = the saved order, then any department an SOP already uses, then General when something has no department.
  const tabs: string[] = [...(saved.ok ? saved.data : [])];
  for (const s of live) if (s.department && !tabs.some((t) => t.toLowerCase() === s.department!.toLowerCase())) tabs.push(s.department);
  if (live.some((s) => !s.department)) tabs.push(GENERAL);
  const active = sp.tab && tabs.find((t) => t.toLowerCase() === sp.tab!.toLowerCase()) || null;   // null = All
  const inTab = (s: (typeof live)[number], tab: string) => (tab === GENERAL ? !s.department : (s.department ?? '').toLowerCase() === tab.toLowerCase());
  const q = (sp.q ?? '').trim().toLowerCase();
  const shown = live.filter((s) => (!active || inTab(s, active)) && (!q || `${s.title} ${s.department ?? ''} ${s.summary ?? ''}`.toLowerCase().includes(q)));
  const manageTabs = can(ctx, 'sops.update') && can(ctx, 'organization.update');
  const here = tabHref(path, active);

  async function create(form: FormData) {
    'use server';
    const dept = String(form.get('department') ?? '');
    const r = await createSop({ orgSlug, title: String(form.get('title') ?? ''), department: dept === GENERAL ? '' : dept,
      summary: String(form.get('summary') ?? ''), videoUrl: String(form.get('video') ?? '') || undefined, body: String(form.get('body') ?? '') });
    if (!r.ok) redirect(`${here}${here.includes('?') ? '&' : '?'}err=${encodeURIComponent(r.error.message)}`);
    redirect(`${path}/${r.data.sopId}?msg=${encodeURIComponent('SOP created')}`);
  }
  async function addFromLibrary(form: FormData) {
    'use server';
    done(path, await applyTemplate({ orgSlug, templateType: 'sop', templateId: String(form.get('template')) }), 'Added from the Growth OS library');
  }
  async function newTab(form: FormData) {
    'use server';
    const r = await addSopTab({ orgSlug, name: String(form.get('name') ?? '') });
    if (!r.ok) redirect(`${path}?err=${encodeURIComponent(r.error.message)}`);
    redirect(`${tabHref(path, r.data.name)}&msg=${encodeURIComponent(`"${r.data.name}" tab added. Add its first SOP.`)}`);
  }
  async function rename(form: FormData) {
    'use server';
    const r = await renameSopTab({ orgSlug, from: String(form.get('from')), to: String(form.get('to') ?? '') });
    if (!r.ok) redirect(`${path}?err=${encodeURIComponent(r.error.message)}`);
    redirect(`${tabHref(path, r.data.name)}&msg=${encodeURIComponent('Tab renamed')}`);
  }
  async function dropTab(form: FormData) {
    'use server';
    done(path, await removeSopTab({ orgSlug, name: String(form.get('name')) }), (d) => d.moved ? `Tab removed. ${d.moved} SOP${d.moved === 1 ? '' : 's'} moved to General.` : 'Tab removed');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="SOPs">
        {library.length > 0 && can(ctx, 'sops.create') && (
          <Modal label="Add from Growth OS library" title="Add from the Growth OS library">
            <form action={addFromLibrary}>
              <p className="muted" style={{ margin: 0 }}>Copies the SOP into this workspace. The client can then edit their copy freely.</p>
              <label className="f">Library SOP
                <select name="template" required>
                  {library.map((t) => <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}{alreadyIn.has(t.id) ? ' · already added' : ''}</option>)}
                </select></label>
              <div><button className="btn primary" type="submit">Add to workspace</button></div>
            </form>
          </Modal>
        )}
        {can(ctx, 'sops.create') && (
          <Modal label="+ New SOP" title={active ? `New SOP in ${active}` : 'New SOP'} primary open={!!sp.err}>
            <form action={create} key={active ?? '_all'} autoComplete="off">
              <label className="f">Title<input name="title" required maxLength={200} placeholder="How we onboard a new customer" autoFocus /></label>
              <label className="f">Tab
                {/* keyed on the tab and autofill off: otherwise the browser restores whatever was typed here on an earlier visit */}
                <input key={active ?? '_all'} name="department" maxLength={80} defaultValue={active ?? ''} placeholder="Sales, Delivery, Marketing…" list="sop-tabs" autoComplete="off" />
                <datalist id="sop-tabs">{tabs.map((t) => <option key={t} value={t} />)}</datalist>
                <span className="qhelp">Pick a tab or type a new name to create one.</span></label>
              <label className="f">Loom video <span className="muted" style={{ fontWeight: 400 }}>(optional, YouTube and Tella work too)</span>
                <input name="video" type="url" placeholder="https://www.loom.com/share/…" /></label>
              <label className="f">Written steps <span className="muted" style={{ fontWeight: 400 }}>(optional if there is a video)</span>
                <textarea name="body" rows={6} maxLength={100000} placeholder={'1. First step\n2. Second step'} />
                <span className="qhelp">Lines starting with # become headings, 1. or - become lists.</span></label>
              <label className="f">One-line summary <span className="muted" style={{ fontWeight: 400 }}>(optional)</span><input name="summary" maxLength={1000} /></label>
              <div><button className="btn primary" type="submit">Create SOP</button></div>
            </form>
          </Modal>
        )}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (res.ok ? undefined : `Could not load SOPs: ${res.error.message}`)} />
      <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
        Standard operating procedures for your team: how this business runs. Customers never see these. What customers learn lives in <Link href={`/w/${orgSlug}/programs`}>Courses</Link>.
      </p>

      <nav className="subnav tabs" aria-label="SOP tabs">
        <Link href={path} className={`tab${!active ? ' on' : ''}`} aria-current={!active ? 'page' : undefined}>All <span className="count">{live.length}</span></Link>
        {tabs.map((t) => (
          <Link key={t} href={tabHref(path, t)} className={`tab${active === t ? ' on' : ''}`} aria-current={active === t ? 'page' : undefined}>
            {t} <span className="count">{live.filter((s) => inTab(s, t)).length}</span>
          </Link>
        ))}
        {manageTabs && (
          <span className="tabadd">
            <Modal label="+ Tab" title="New tab" small>
              <form action={newTab}>
                <label className="f">Tab name<input name="name" required maxLength={80} placeholder="Sales, Delivery, Marketing…" autoFocus /></label>
                <div><button className="btn primary" type="submit">Add tab</button></div>
              </form>
            </Modal>
          </span>
        )}
        {manageTabs && active && active !== GENERAL && (
          <span className="tabadd">
            <Menu label={`Manage the ${active} tab`}>
              <form action={rename}>
                <input type="hidden" name="from" value={active} />
                <label className="f">Rename this tab<input name="to" required maxLength={80} defaultValue={active} /></label>
                <button className="menu-item" type="submit">Save name</button>
              </form>
              <hr />
              <form action={dropTab}>
                <input type="hidden" name="name" value={active} />
                <button className="menu-item danger" type="submit">Remove tab</button>
              </form>
              <MenuNote>Removing a tab keeps its SOPs. They move to General.</MenuNote>
            </Menu>
          </span>
        )}
      </nav>

      {live.length > 6 && (
        <form className="row" action={path}>
          {active && <input type="hidden" name="tab" value={active} />}
          <input name="q" placeholder={active ? `Search ${active}` : 'Search SOPs'} defaultValue={sp.q} aria-label="Search SOPs" />
          <button className="btn small" type="submit">Search</button>{q && <Link className="btn small" href={here}>Clear</Link>}
        </form>
      )}

      <div className="card">
        {res.ok && !shown.length && (
          <p className="empty" style={{ margin: 0 }}>
            {q ? 'No SOPs match your search.' : active ? `Nothing in ${active} yet. Use "New SOP" to add the first one.` : 'No SOPs yet. Use "New SOP" to write the first one, or add one from the Growth OS library.'}
          </p>
        )}
        <ul className="attn">
          {shown.map((s) => (
            <li key={s.id}>
              <span><Link href={`${path}/${s.id}`}><b>{s.title}</b></Link>
                {s.summary && <div className="muted wrap">{s.summary}</div>}
                <div className="muted" style={{ fontSize: 12 }}>
                  {!active && <>{s.department ?? GENERAL} · </>}
                  {s.source_template_id ? 'From Growth OS' : s.owner ? `Owner: ${s.owner}` : 'Written here'} · updated {day(s.updated_at)}
                  {s.last_reviewed_at && ` · reviewed ${day(s.last_reviewed_at)}`}
                </div></span>
              <Pill value={s.status === 'active' ? 'active' : 'pending'} label={s.status} />
            </li>
          ))}
        </ul>
      </div>

      {archived.length > 0 && (
        <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Archived ({archived.length})</summary>
          <ul className="attn" style={{ marginTop: 8 }}>{archived.map((s) => <li key={s.id}><Link href={`${path}/${s.id}`}>{s.title}</Link><span className="muted">{day(s.updated_at)}</span></li>)}</ul>
        </details>
      )}
    </>
  );
}
