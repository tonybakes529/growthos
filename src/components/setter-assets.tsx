'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Menu } from '@/components/menu';
import type { ActionResult } from '@/lib/action';
import type { SetterAsset, SetterAssetFile } from '@/modules/sales/assets';
import { formatAssetLinks, linkText, parseAssetLinks } from '@/modules/sales/asset-links';

type Upload = { fileId: string; path: string; token: string };
type PrepareUpload = (f: { name: string; type: string; size: number }) => Promise<ActionResult<Upload>>;
type FormAction = (form: FormData) => Promise<void>;

const OTHER = 'Other';

const EXT_BADGE: Record<string, string> = {
  pdf: 'PDF', doc: 'DOC', docx: 'DOC', txt: 'DOC', ppt: 'SLIDES', pptx: 'SLIDES', key: 'SLIDES',
  xls: 'SHEET', xlsx: 'SHEET', csv: 'SHEET', mp4: 'VIDEO', mov: 'VIDEO', m4v: 'VIDEO',
};
const fileBadge = (f: SetterAssetFile) => {
  const ext = f.file_name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_BADGE[ext] ?? (f.mime_type?.startsWith('image/') ? 'IMAGE' : 'FILE');
};
const fileSize = (b: number | null) => (!b ? '' : b < 1024 ** 2 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

/**
 * The setter asset shelf: instant search, category buttons, and a card per asset. A card opens a pop-up with the
 * file (open or download) and every link (open or copy), so a setter can find and send something mid-conversation.
 */
export function SetterAssets({ assets, base, accept, canCreate, canEdit, canDelete, save, remove, prepareUpload, openId, editOpen, err }: {
  assets: SetterAsset[]; base: string; accept: string; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  save: FormAction; remove: FormAction; prepareUpload: PrepareUpload; openId?: string; editOpen?: boolean; err?: string;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  // by id, so the pop-up always shows the latest saved version of the asset
  const [openKey, setOpenKey] = useState<string | null>(openId ?? null);
  const openAsset = assets.find((a) => a.id === openKey) ?? null;
  const [editing, setEditing] = useState(!!editOpen);
  const search = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const names = [...new Set(assets.map((a) => a.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
    return assets.some((a) => !a.category) && names.length ? [...names, OTHER] : names;
  }, [assets]);
  const inCat = (a: SetterAsset, c: string) => (c === OTHER ? !a.category : a.category === c);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return assets.filter((a) => {
      if (cat && !inCat(a, cat)) return false;
      if (!words.length) return true;
      const hay = [a.title, a.category, a.description, a.file?.file_name, ...a.links.flatMap((l) => [l.label, l.url])].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [assets, q, cat]);

  // "/" jumps to the search box from anywhere on the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // keep the open asset in the address bar, so the link can be sent to a setter and reopens the same pop-up
  const show = (a: SetterAsset | null) => {
    setOpenKey(a?.id ?? null);
    setEditing(false);
    window.history.replaceState(null, '', a ? `${base}?asset=${a.id}` : base);
  };

  return (
    <>
      <div className="assetbar">
        <input ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, links and files   ( / )" aria-label="Search setter assets" />
        {categories.length > 0 && (
          <div className="chips" role="group" aria-label="Filter by category">
            <button type="button" className={`chip${cat === null ? ' on' : ''}`} aria-pressed={cat === null} onClick={() => setCat(null)}>All <span className="n">{assets.length}</span></button>
            {categories.map((c) => (
              <button key={c} type="button" className={`chip${cat === c ? ' on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
                {c} <span className="n">{assets.filter((a) => inCat(a, c)).length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length > 0 ? (
        <div className="assetgrid">
          {shown.map((a) => (
            <button key={a.id} type="button" className="card assetcard" onClick={() => show(a)}>
              <span className="row" style={{ gap: 6 }}>
                {a.file && <span className="pill gray">{fileBadge(a.file)}</span>}
                {a.links.length > 0 && <span className="pill gray">{a.links.length} link{a.links.length === 1 ? '' : 's'}</span>}
                {a.category && <span className="pill accent">{a.category}</span>}
              </span>
              <span className="t">{a.title}</span>
              {a.description && <span className="d">{a.description}</span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="card muted">
          {assets.length === 0
            ? canCreate ? 'No setter assets yet. Add the first one: a PDF, a case study, or a list of links setters can send.' : 'No setter assets yet.'
            : `Nothing matches${q ? ` "${q}"` : ''}${cat ? ` in ${cat}` : ''}.`}
        </div>
      )}

      <AssetDialog
        asset={openAsset}
        onClose={() => show(null)}
        actions={openAsset && !editing && (canEdit || canDelete) ? (
          <Menu label={`Manage ${openAsset.title}`}>
            {canEdit && <button type="button" className="menu-item" onClick={() => setEditing(true)}>Edit</button>}
            {canDelete && (<>
              {canEdit && <hr />}
              <form action={remove} onSubmit={(e) => { if (!window.confirm(`Remove "${openAsset.title}" from setter assets?`)) e.preventDefault(); }}>
                <input type="hidden" name="id" value={openAsset.id} />
                <button type="submit" className="menu-item danger">Remove</button>
              </form>
            </>)}
          </Menu>
        ) : null}
      >
        {openAsset && (editing ? (
          <AssetForm asset={openAsset} categories={categories.filter((c) => c !== OTHER)} accept={accept} save={save} prepareUpload={prepareUpload}
                     err={editOpen ? err : undefined} onCancel={() => setEditing(false)} />
        ) : (
          <AssetView asset={openAsset} base={base} />
        ))}
      </AssetDialog>
    </>
  );
}

/** Native <dialog>: focus trap, Escape to close, click outside to close. */
function AssetDialog({ asset, onClose, actions, children }: {
  asset: SetterAsset | null; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (asset && !d.open) d.showModal();
    if (!asset && d.open) d.close();
  }, [asset]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} aria-label={asset?.title ?? 'Setter asset'}>
      <div className="modal-body">
        <div className="head" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{asset?.title}</h2>
          <span className="row">
            {actions}
            <button type="button" className="btn small" onClick={() => ref.current?.close()} aria-label="Close">✕</button>
          </span>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function AssetView({ asset, base }: { asset: SetterAsset; base: string }) {
  const f = asset.file;
  const fileHref = `${base}/${asset.id}/file`;
  return (
    <>
      {asset.category && <div><span className="pill accent">{asset.category}</span></div>}
      {asset.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{asset.description}</p>}

      {f && (
        <div className="assetfile">
          <span className="pill gray">{fileBadge(f)}</span>
          <span className="name">{f.file_name} <span className="muted">{fileSize(f.size_bytes)}</span></span>
          {f.upload_status === 'pending' ? <span className="muted">Upload not finished</span> : (
            <span className="row">
              <a className="btn small" href={fileHref} target="_blank" rel="noopener noreferrer">Open</a>
              <a className="btn small primary" href={`${fileHref}?download=1`}>Download</a>
            </span>
          )}
        </div>
      )}

      {asset.links.length > 0 && (
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: '4px 0' }}>Links</h3>
            {asset.links.length > 1 && <CopyButton text={asset.links.map((l) => l.url).join('\n')} label="Copy all" />}
          </div>
          <ul className="assetlinks">
            {asset.links.map((l, n) => (
              <li key={`${n}-${l.url}`}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}>{linkText(l)}</a>
                <CopyButton text={l.url} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!f && !asset.links.length && <p className="muted" style={{ margin: 0 }}>Nothing attached yet.</p>}


    </>
  );
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // older browsers and non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return <button type="button" className="btn small" onClick={copy} aria-live="polite">{copied ? 'Copied' : label}</button>;
}

function SubmitButton({ label, uploading }: { label: string; uploading: boolean }) {
  const { pending } = useFormStatus();
  return <button className="btn primary" type="submit" disabled={pending || uploading}>{uploading ? 'Uploading…' : pending ? 'Saving…' : label}</button>;
}

/**
 * Add or edit an asset. Choosing a file uploads it straight to storage (signed URL from the server), so saving only
 * sends the file's id; the Save button waits for the upload to finish.
 */
export function AssetForm({ asset, categories, accept, save, prepareUpload, err, onCancel }: {
  asset?: SetterAsset; categories: string[]; accept: string; save: FormAction; prepareUpload: PrepareUpload; err?: string; onCancel?: () => void;
}) {
  const listId = useId();
  const [upload, setUpload] = useState<{ state: 'idle' | 'uploading' | 'done' | 'error'; name?: string; fileId?: string; message?: string }>({ state: 'idle' });
  const [removeFile, setRemoveFile] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // the same parser the server uses, so a mistyped link is caught before the page reloads and loses the chosen file
  function check(e: React.FormEvent<HTMLFormElement>) {
    const { error } = parseAssetLinks(String(new FormData(e.currentTarget).get('links') ?? ''));
    setLinkError(error);
    if (error) e.preventDefault();
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) { setUpload({ state: 'idle' }); return; }
    setUpload({ state: 'uploading', name: file.name });
    try {
      const r = await prepareUpload({ name: file.name, type: file.type, size: file.size });
      if (!r.ok) throw new Error(r.error.message);
      // loaded on first upload only; the page itself does not ship the storage client
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await sb.storage.from('org-files').uploadToSignedUrl(r.data.path, r.data.token, file, { contentType: file.type || undefined });
      if (error) throw new Error(error.message);
      setUpload({ state: 'done', name: file.name, fileId: r.data.fileId });
      setRemoveFile(false);
    } catch (x) {
      input.value = '';
      setUpload({ state: 'error', name: file.name, message: x instanceof Error ? x.message : 'Upload failed' });
    }
  }

  const current = asset?.file && !removeFile && upload.state !== 'done' ? asset.file : null;
  return (
    <form action={save} onSubmit={check}>
      {err && <div className="flash err" role="alert">{err}</div>}
      {asset && <input type="hidden" name="id" value={asset.id} />}
      {upload.state === 'done' && upload.fileId && <input type="hidden" name="fileId" value={upload.fileId} />}
      {removeFile && <input type="hidden" name="removeFile" value="1" />}

      <label className="f">Title
        <input name="title" required maxLength={200} defaultValue={asset?.title} placeholder="Case study: Smith family roof replacement" />
      </label>
      <label className="f">Category <span className="muted" style={{ fontWeight: 400 }}>(optional, becomes a filter button)</span>
        <input name="category" list={listId} maxLength={60} defaultValue={asset?.category ?? ''} placeholder="Case studies" />
        <datalist id={listId}>{[...new Set([...categories, 'Case studies', 'Testimonials', 'Pricing', 'Scripts'])].map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label className="f">Description <span className="muted" style={{ fontWeight: 400 }}>(optional: when to send it, what it proves)</span>
        <textarea name="description" maxLength={4000} defaultValue={asset?.description ?? ''} style={{ minHeight: 70 }} />
      </label>

      <div className="f">
        <span>File <span className="muted" style={{ fontWeight: 400 }}>(optional: PDF, doc, slides, image or short video, up to 100 MB)</span></span>
        {current && (
          <span className="row">
            <span>{current.file_name} <span className="muted">{fileSize(current.size_bytes)}</span></span>
            <button type="button" className="btn small" onClick={() => setRemoveFile(true)}>Remove file</button>
          </span>
        )}
        <input type="file" accept={accept} onChange={pick} aria-label={current ? 'Replace the file' : 'Choose a file'} />
        {upload.state === 'uploading' && <span className="muted">Uploading {upload.name}…</span>}
        {upload.state === 'done' && <span className="muted">Uploaded {upload.name}{asset?.file ? '. It replaces the current file when you save.' : ''}</span>}
        {upload.state === 'error' && <span className="flash err" role="alert">{upload.message}</span>}
        {removeFile && <span className="muted">The file will be removed when you save. <button type="button" className="btn small" onClick={() => setRemoveFile(false)}>Keep it</button></span>}
      </div>

      <label className="f">Links <span className="muted" style={{ fontWeight: 400 }}>(one per line; a name before the link is optional)</span>
        <textarea name="links" defaultValue={asset ? formatAssetLinks(asset.links) : ''} spellCheck={false}
                  placeholder={'Smith roof job: https://example.com/case-study\nVideo testimonial: https://youtube.com/watch?v=...\nhttps://calendly.com/your-team/intro'}
                  onChange={() => linkError && setLinkError(null)} />
      </label>
      {linkError && <div className="flash err" role="alert">{linkError}</div>}

      <div className="row">
        <SubmitButton label={asset ? 'Save changes' : 'Add asset'} uploading={upload.state === 'uploading'} />
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
