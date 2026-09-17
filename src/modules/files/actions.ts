import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { AppError, unwrap } from '@/lib/errors';

const BUCKET = 'org-files';
const MAX_BYTES = 5 * 1024 ** 3;

const safeName = (name: string) => name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';

/**
 * Step 1 of an upload: create the files row (RLS-checked), then hand back a
 * signed upload URL for exactly that path. The storage policy only accepts an
 * object whose path matches a pending files row created by this user.
 */
export const createUploadUrl = action(
  z.object({
    orgSlug: zSlug,
    fileName: z.string().min(1).max(255),
    mimeType: z.string().max(120).optional(),
    sizeBytes: z.number().int().positive().max(MAX_BYTES),
    kind: z.enum(['video', 'audio', 'document', 'worksheet', 'pdf', 'image', 'call_recording', 'lesson_attachment', 'assignment_upload', 'avatar', 'other']),
    visibility: z.enum(['organization', 'managers', 'private', 'linked']).default('organization'),
    entity: z.object({ type: z.string(), id: zId }).optional(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    const fileId = crypto.randomUUID();
    const path = `${ctx.organizationId}/${fileId}/${safeName(i.fileName)}`;
    unwrap(await ctx.sb.from('files').insert({
      id: fileId, organization_id: ctx.organizationId, bucket: BUCKET, storage_path: path, file_name: i.fileName,
      mime_type: i.mimeType, size_bytes: i.sizeBytes, kind: i.kind, visibility: i.visibility,
      entity_type: i.entity?.type, entity_id: i.entity?.id,
    }));
    const { data, error } = await ctx.sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new AppError('internal', 'Could not create upload URL', error);
    return { fileId, path, token: data.token, signedUrl: data.signedUrl };
  },
);

/** Step 2: mark the upload complete (also done by a storage trigger when permitted). */
export const confirmUpload = action(z.object({ fileId: zId, sizeBytes: z.number().int().positive().optional(), mimeType: z.string().optional() }), async (i) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('confirm_file_upload', { p_file_id: i.fileId, p_size_bytes: i.sizeBytes, p_mime_type: i.mimeType }));
  return null;
});

/** Short-lived signed URL. The files lookup is RLS-checked, and the storage policy re-checks it. */
export const getDownloadUrl = action(z.object({ fileId: zId, expiresIn: z.number().int().min(30).max(3600).default(300), download: z.boolean().default(false) }), async (i) => {
  const { sb } = await requireSession();
  const file = unwrap(await sb.from('files').select('id, bucket, storage_path, file_name, upload_status').eq('id', i.fileId).single());
  if (file.upload_status === 'pending') throw new AppError('validation', 'Upload not finished');
  const { data, error } = await sb.storage.from(file.bucket).createSignedUrl(file.storage_path, i.expiresIn, i.download ? { download: file.file_name } : undefined);
  if (error || !data) throw new AppError('forbidden', 'File not available');
  return { url: data.signedUrl, expiresIn: i.expiresIn };
});
