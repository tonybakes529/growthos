import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getSop, markSopReviewed, publishSopVersion, updateSopMeta } from '@/modules/sops/actions';
import { softDelete } from '@/modules/records/actions';
import { SopBody, SopSteps } from '@/modules/sops/render';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, day, dayTime } from '@/components/ui';

export default async function SopPage({ params, searchParams }: { params: Promise<{ orgSlug: string; sopId: string }>; searchParams: Promise<{ v?: string; msg?: string; err?: string }> }) {
  const [{ orgSlug, sopId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  if (!can(ctx, 'sops.read')) notFound();
  const res = await getSop({ orgSlug, sopId });
  if (!res.ok) notFound();
  const { sop, versions, current } = res.data;
  const list = `/w/${orgSlug}/sops`;
  const path = `${list}/${sopId}`;
  const shown = (sp.v && versions.find((x) => String(x.version) === sp.v)) || current;
  const edit = can(ctx, 'sops.update');
  // The editor shows the video link in its own field; the first line of the body holds it when present.
  const rawBody = (current?.body ?? '').replace(/\\n/g, '\n');
  const firstLine = rawBody.split('\n')[0]?.trim() ?? '';
  const videoLine = /^https?:\/\/\S+$/.test(firstLine) ? firstLine : null;
  const bodyText = videoLine ? rawBody.split('\n').slice(1).join('\n').replace(/^\n+/, '') : rawBody;
  const due = sop.review_every_days && sop.last_reviewed_at && Date.now() - Date.parse(sop.last_reviewed_at) > sop.review_every_days * 864e5;

  async function publish(form: FormData) {
    'use server';
    done(path, await publishSopVersion({ orgSlug, sopId, body: String(form.get('body') ?? ''), videoUrl: String(form.get('video') ?? '') || undefined, changeNote: String(form.get('note') ?? '') }), (d) => `Version ${d.version} published`);
  }
  async function meta(form: FormData) {
    'use server';
    done(path, await updateSopMeta({ orgSlug, sopId, title: String(form.get('title') ?? ''), department: String(form.get('department') ?? ''), summary: String(form.get('summary') ?? '') }), 'Details saved');
  }
  async function status(form: FormData) {
    'use server';
    done(path, await updateSopMeta({ orgSlug, sopId, status: String(form.get('status')) as 'active' }), 'Status updated');
  }
  async function reviewed() {
    'use server';
    done(path, await markSopReviewed({ orgSlug, sopId }), 'Marked as reviewed');
  }
  async function remove() {
    'use server';
    const r = await softDelete({ table: 'standard_operating_procedures', id: sopId });
    done(r.ok ? list : path, r, 'SOP deleted');
  }

  return (
    <>
      <Link href={sop.department ? `${list}?tab=${encodeURIComponent(sop.department)}` : list}>← {sop.department ? `${sop.department} SOPs` : 'SOPs'}</Link>
      <PageHead sub={`${ctx.name} · SOPs${sop.department ? ` · ${sop.department}` : ''}`} title={sop.title}>
        <Pill value={sop.status === 'active' ? 'active' : 'pending'} label={sop.status} />
        {due && <Pill value="at_risk" label="review due" />}
        {edit && sop.status !== 'archived' && (
          <form action={status}><input type="hidden" name="status" value={sop.status === 'active' ? 'draft' : 'active'} />
            <button className="btn" type="submit">{sop.status === 'active' ? 'Move to draft' : 'Mark active'}</button></form>
        )}
        {edit && <form action={reviewed}><button className="btn" type="submit">Mark reviewed</button></form>}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err} />
      {sop.summary && <p className="muted" style={{ margin: 0, maxWidth: 760 }}>{sop.summary}</p>}

      <div className="grid builder">
        <div className="card">
          {!shown && <p className="empty">This SOP has no content yet.</p>}
          {shown && (<>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>Version {shown.version}{shown.id !== current?.id && ' (older)'} · {dayTime(shown.created_at)}{shown.change_note && ` · ${shown.change_note}`}</span>
              {shown.id !== current?.id && <Link className="btn small" href={path}>Back to current</Link>}
            </div>
            <SopSteps steps={shown.steps} />
            <SopBody body={shown.body} />
          </>)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h2>About</h2>
            <ul className="plain">
              <li><span className="muted">Source</span><span>{sop.source_template_id ? 'Growth OS library' : 'Written here'}</span></li>
              <li><span className="muted">Last reviewed</span><span>{sop.last_reviewed_at ? day(sop.last_reviewed_at) : 'Never'}</span></li>
              <li><span className="muted">Versions</span><span>{versions.length}</span></li>
            </ul>
            {versions.length > 1 && (
              <details className="edit" style={{ marginTop: 8 }}><summary>Version history</summary>
                <ul className="attn" style={{ marginTop: 6 }}>
                  {versions.map((v) => <li key={v.id}><Link href={`${path}?v=${v.version}`}>v{v.version}{v.id === current?.id ? ' (current)' : ''}</Link><span className="muted">{day(v.created_at)}</span></li>)}
                </ul>
              </details>
            )}
          </div>

          {edit && (<>
            <form className="card" action={publish} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div><h2 style={{ marginBottom: 2 }}>Edit procedure</h2><p className="muted" style={{ margin: 0 }}>Saving publishes a new version. Earlier versions stay in the history.</p></div>
              <label className="f">Loom video <span className="muted" style={{ fontWeight: 400 }}>(optional, YouTube and Tella work too)</span>
                <input name="video" type="url" defaultValue={videoLine ?? ''} placeholder="https://www.loom.com/share/…" /></label>
              <label className="f">Written steps
                <textarea name="body" rows={14} maxLength={100000} defaultValue={bodyText} /></label>
              <label className="f">What changed <span className="muted" style={{ fontWeight: 400 }}>(optional)</span><input name="note" maxLength={500} /></label>
              <div><button className="btn primary" type="submit">Publish new version</button></div>
            </form>
            <form className="card" action={meta} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: 0 }}>Details</h2>
              <label className="f">Title<input name="title" required maxLength={200} defaultValue={sop.title} /></label>
              <label className="f">Tab<input name="department" maxLength={80} defaultValue={sop.department ?? ''} placeholder="General" />
                <span className="qhelp">Type another tab&apos;s name to move this SOP there.</span></label>
              <label className="f">Summary<input name="summary" maxLength={1000} defaultValue={sop.summary ?? ''} /></label>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button className="btn" type="submit">Save details</button>
              </div>
            </form>
            {can(ctx, 'sops.delete') && (
              <details className="card"><summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Archive or delete</summary>
                <div className="row" style={{ marginTop: 10 }}>
                  {sop.status !== 'archived' && <form action={status}><input type="hidden" name="status" value="archived" /><button className="btn small" type="submit">Archive</button></form>}
                  <form action={remove}><button className="btn small" type="submit">Delete</button></form>
                  <span className="muted" style={{ fontSize: 12 }}>Delete hides it; a super admin can restore it.</span>
                </div>
              </details>
            )}
          </>)}
        </div>
      </div>
    </>
  );
}
