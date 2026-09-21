import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan, assertWritable, can } from '@/lib/auth/context';
import { AppError, unwrap } from '@/lib/errors';
import { createUploadUrl } from '@/modules/files/actions';
import { parseAssetLinks, type AssetLink } from './asset-links';

export type SetterAssetFile = { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; upload_status: string };
export type SetterAsset = {
  id: string; title: string; category: string | null; description: string | null; links: AssetLink[]; updated_at: string;
  file: SetterAssetFile | null;
};

const MAX_BYTES = 100 * 1024 ** 2;
// What a setter would send or show: documents, slides, spreadsheets, images and short videos. No HTML or SVG.
const TYPES: Record<string, { kind: 'pdf' | 'document' | 'image' | 'video'; mime?: RegExp }> = {
  pdf: { kind: 'pdf' }, doc: { kind: 'document' }, docx: { kind: 'document' }, ppt: { kind: 'document' }, pptx: { kind: 'document' },
  key: { kind: 'document' }, xls: { kind: 'document' }, xlsx: { kind: 'document' }, csv: { kind: 'document' }, txt: { kind: 'document' },
  png: { kind: 'image' }, jpg: { kind: 'image' }, jpeg: { kind: 'image' }, gif: { kind: 'image' }, webp: { kind: 'image' },
  mp4: { kind: 'video' }, mov: { kind: 'video' }, m4v: { kind: 'video' },
};
export const ASSET_FILE_ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');

export const listSetterAssets = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sales.read');
  return unwrap(await ctx.sb.from('setter_assets')
    .select('id, title, category, description, links, updated_at, file:files!setter_assets_organization_id_file_id_fkey(id, file_name, mime_type, size_bytes, upload_status)')
    .eq('organization_id', ctx.organizationId).is('deleted_at', null).order('title')
    .overrideTypes<SetterAsset[], { merge: false }>());
});

/**
 * Step 1 of attaching a file: checks the type and size, then creates the files row and a signed upload URL through
 * the shared upload pipeline. The browser uploads straight to storage, then the asset is saved with the file id.
 */
export const prepareAssetUpload = action(
  z.object({ orgSlug: zSlug, fileName: z.string().min(1).max(255), mimeType: z.string().max(120).optional(), sizeBytes: z.number().int().positive() }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertWritable(ctx);
    if (!can(ctx, 'sales.create') && !can(ctx, 'sales.update')) throw new AppError('forbidden', 'You cannot add setter assets');
    const ext = i.fileName.split('.').pop()?.toLowerCase() ?? '';
    const type = TYPES[ext];
    if (!type) throw new AppError('validation', 'Upload a PDF, document, slide deck, spreadsheet, image or short video');
    if (i.sizeBytes > MAX_BYTES) throw new AppError('validation', 'Files can be up to 100 MB. For bigger videos, add a link instead.');
    const r = await createUploadUrl({ orgSlug: i.orgSlug, fileName: i.fileName, mimeType: i.mimeType, sizeBytes: i.sizeBytes, kind: type.kind, visibility: 'organization' });
    if (!r.ok) throw new AppError(r.error.code, r.error.message);
    return { fileId: r.data.fileId, path: r.data.path, token: r.data.token };
  },
);

export const saveSetterAsset = action(
  z.object({
    orgSlug: zSlug,
    id: zId.optional(),
    title: z.string().trim().min(1, 'Give it a title').max(200),
    category: z.string().trim().max(60).optional(),
    description: z.string().trim().max(4000).optional(),
    links: z.string().max(100_000).default(''),
    fileId: zId.optional(),
    removeFile: z.boolean().default(false),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertWritable(ctx);
    assertCan(ctx, i.id ? 'sales.update' : 'sales.create');
    const org = ctx.organizationId;
    const { links, error } = parseAssetLinks(i.links);
    if (error) throw new AppError('validation', error);
    if (i.fileId) {
      // the file must be in this workspace (RLS and the composite foreign key agree) and actually uploaded
      const f = unwrap(await ctx.sb.from('files').select('id, upload_status').eq('id', i.fileId).eq('organization_id', org).maybeSingle());
      if (!f) throw new AppError('validation', 'That upload was not found. Choose the file again.');
      if (f.upload_status === 'pending') {
        const confirmed = await ctx.sb.schema('app').rpc('confirm_file_upload', { p_file_id: i.fileId });
        if (confirmed.error) throw new AppError('validation', 'The upload did not finish. Choose the file again.');
      }
    }
    const row = {
      title: i.title, category: i.category || null, description: i.description || null, links: links as never,
      ...(i.fileId ? { file_id: i.fileId } : i.removeFile ? { file_id: null } : {}),
    };
    const saved = i.id
      ? await ctx.sb.from('setter_assets').update(row).eq('id', i.id).eq('organization_id', org).is('deleted_at', null).select('id').single()
      : await ctx.sb.from('setter_assets').insert({ ...row, organization_id: org }).select('id').single();
    return { id: unwrap(saved).id };
  },
);

export const removeSetterAsset = action(z.object({ orgSlug: zSlug, id: zId }), async ({ orgSlug, id }) => {
  const ctx = await requireOrg(orgSlug);
  assertWritable(ctx);
  assertCan(ctx, 'sales.delete');
  unwrap(await ctx.sb.schema('app').rpc('soft_delete', { p_table: 'setter_assets', p_id: id }));
  return null;
});
