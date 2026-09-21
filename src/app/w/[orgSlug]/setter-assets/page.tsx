import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgPage, can } from '@/lib/auth/context';
import { ASSET_FILE_ACCEPT, listSetterAssets, prepareAssetUpload, removeSetterAsset, saveSetterAsset } from '@/modules/sales/assets';
import { SubNav, growthTabs } from '@/components/subnav';
import { Flash, PageHead } from '@/components/ui';
import { Modal } from '@/components/modal';
import { AssetForm, SetterAssets } from '@/components/setter-assets';

type SP = { asset?: string; edit?: string; add?: string; msg?: string; err?: string };

// module scope on purpose: server actions may only capture plain values, not local functions
const to = (path: string, q: SP) => {
  const p = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
  return p.size ? `${path}?${p}` : path;
};

/** Growth · Setter assets: PDFs, case studies and links setters send or show on calls, one click from the pipeline. */
export default async function SetterAssetsPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/setter-assets`;
  if (!can(ctx, 'sales.read')) {
    return (<><PageHead sub={ctx.name} title="Growth · Setter assets" /><div className="card muted">You don&apos;t have access to setter assets.</div></>);
  }
  const res = await listSetterAssets({ orgSlug });
  const assets = res.ok ? res.data : [];
  const categories = [...new Set(assets.map((a) => a.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  const canCreate = can(ctx, 'sales.create');

  async function save(form: FormData) {
    'use server';
    const id = String(form.get('id') ?? '') || undefined;
    const r = await saveSetterAsset({
      orgSlug, id, title: String(form.get('title') ?? ''), category: String(form.get('category') ?? ''),
      description: String(form.get('description') ?? ''), links: String(form.get('links') ?? ''),
      fileId: String(form.get('fileId') ?? '') || undefined, removeFile: form.get('removeFile') === '1',
    });
    revalidatePath(path);
    // an error reopens the form it came from; a save reopens the asset so the result is right there
    if (!r.ok) redirect(to(path, id ? { asset: id, edit: '1', err: r.error.message } : { add: '1', err: r.error.message }));
    redirect(to(path, { asset: r.data.id, msg: id ? 'Saved' : 'Asset added' }));
  }
  async function remove(form: FormData) {
    'use server';
    const r = await removeSetterAsset({ orgSlug, id: String(form.get('id')) });
    revalidatePath(path);
    redirect(to(path, r.ok ? { msg: 'Asset removed' } : { err: r.error.message }));
  }
  async function prepareUpload(f: { name: string; type: string; size: number }) {
    'use server';
    return prepareAssetUpload({ orgSlug, fileName: f.name, mimeType: f.type || undefined, sizeBytes: f.size });
  }

  // a server redirect lands back on this page: remount the interactive parts so they pick up the new state
  const view = JSON.stringify([sp.asset, sp.edit, sp.add, sp.msg, sp.err]);
  return (
    <>
      <PageHead sub={ctx.name} title="Growth · Setter assets">
        {canCreate && (
          <Modal key={view} label="+ Add asset" title="Add a setter asset" primary open={!!sp.add}>
            <AssetForm categories={categories} accept={ASSET_FILE_ACCEPT} save={save} prepareUpload={prepareUpload} err={sp.add ? sp.err : undefined} />
          </Modal>
        )}
      </PageHead>
      <SubNav items={growthTabs(orgSlug, can(ctx, 'kpis.read'), true)} current="assets" />
      <Flash msg={sp.msg} err={sp.add || sp.edit ? undefined : sp.err ?? (res.ok ? undefined : res.error.message)} />
      <SetterAssets key={view} assets={assets} base={path} accept={ASSET_FILE_ACCEPT}
                    canCreate={canCreate} canEdit={can(ctx, 'sales.update')} canDelete={can(ctx, 'sales.delete')}
                    save={save} remove={remove} prepareUpload={prepareUpload}
                    openId={sp.asset} editOpen={!!sp.edit} err={sp.err} />
    </>
  );
}
