import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg, can } from '@/lib/auth/context';
import { getDownloadUrl } from '@/modules/files/actions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new NextResponse('Not found', { status: 404 });

/**
 * Opens a setter asset's file (or downloads it, with ?download=1) through a fresh one-minute signed link.
 * Signing on click, not when the page renders, means the button still works on a page left open all day.
 * Access is checked twice: RLS on the asset and the file, then the storage policy on the object.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orgSlug: string; assetId: string }> }) {
  const { orgSlug, assetId } = await params;
  if (!UUID.test(assetId)) return notFound();
  const ctx = await requireOrg(orgSlug).catch(() => null);
  if (!ctx || !can(ctx, 'sales.read')) return notFound();
  const { data } = await ctx.sb.from('setter_assets').select('file_id')
    .eq('id', assetId).eq('organization_id', ctx.organizationId).is('deleted_at', null).maybeSingle();
  if (!data?.file_id) return notFound();
  const r = await getDownloadUrl({ fileId: data.file_id, expiresIn: 60, download: req.nextUrl.searchParams.has('download') });
  if (!r.ok) return notFound();
  const res = NextResponse.redirect(r.data.url, 302);
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
