import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan, can } from '@/lib/auth/context';
import { AppError, unwrap, unwrapRequired } from '@/lib/errors';

// SOPs are the client team's playbook: how this business runs. Courses are what their customers learn.
// Tables: standard_operating_procedures (the document) + sop_versions (every published body, newest is current).

export const SOP_STATUSES = ['draft', 'active', 'archived'] as const;

export type SopStep = { title?: string; text?: string; detail?: string };

const zMeta = z.object({
  title: z.string().trim().min(1).max(200),
  department: z.string().trim().max(80).optional(),
  summary: z.string().trim().max(1000).optional(),
});
const zBody = z.object({ body: z.string().trim().min(1).max(100_000), changeNote: z.string().trim().max(500).optional() });

export const listSops = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sops.read');
  const rows = unwrap(await ctx.sb.from('standard_operating_procedures')
    .select('id, title, department, summary, status, current_version_id, owner_id, source_template_id, last_reviewed_at, updated_at')
    .eq('organization_id', ctx.organizationId).is('deleted_at', null).order('department', { nullsFirst: false }).order('title'));
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter((v): v is string => !!v))];
  const owners = ownerIds.length ? unwrap(await ctx.sb.from('user_profiles').select('user_id, display_name').in('user_id', ownerIds)) : [];
  return rows.map((r) => ({ ...r, owner: owners.find((o) => o.user_id === r.owner_id)?.display_name ?? null }));
});

export const getSop = action(z.object({ orgSlug: zSlug, sopId: zId }), async ({ orgSlug, sopId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sops.read');
  const [sop, versions] = await Promise.all([
    ctx.sb.from('standard_operating_procedures')
      .select('id, title, department, summary, status, current_version_id, owner_id, source_template_id, review_every_days, last_reviewed_at, updated_at')
      .eq('id', sopId).eq('organization_id', ctx.organizationId).is('deleted_at', null).maybeSingle(),
    ctx.sb.from('sop_versions').select('id, version, body, steps, change_note, created_at, created_by')
      .eq('sop_id', sopId).eq('organization_id', ctx.organizationId).order('version', { ascending: false }),
  ]);
  const s = unwrapRequired(sop, 'SOP');
  const vs = unwrap(versions);
  return { sop: s, versions: vs, current: vs.find((v) => v.id === s.current_version_id) ?? vs[0] ?? null };
});

/** Create the document and its first version together; a document with no body is useless, so undo on failure. */
export const createSop = action(zMeta.merge(zBody).extend({ orgSlug: zSlug }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sops.create');
  const sop = unwrap(await ctx.sb.from('standard_operating_procedures')
    .insert({ organization_id: ctx.organizationId, title: i.title, department: i.department || null, summary: i.summary || null,
      status: 'active', owner_id: ctx.ctx.effective_user_id }).select('id').single());
  const v = await ctx.sb.from('sop_versions').insert({ organization_id: ctx.organizationId, sop_id: sop.id, version: 1, body: i.body, change_note: i.changeNote || null }).select('id').single();
  if (v.error) { await ctx.sb.from('standard_operating_procedures').delete().eq('id', sop.id); unwrap(v); }
  unwrap(await ctx.sb.from('standard_operating_procedures').update({ current_version_id: v.data!.id }).eq('id', sop.id).select('id').single());
  return { sopId: sop.id };
});

export const updateSopMeta = action(zMeta.partial().extend({ orgSlug: zSlug, sopId: zId, status: z.enum(SOP_STATUSES).optional() }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sops.update');
  const patch = {
    ...(i.title !== undefined ? { title: i.title } : {}),
    ...(i.department !== undefined ? { department: i.department || null } : {}),
    ...(i.summary !== undefined ? { summary: i.summary || null } : {}),
    ...(i.status !== undefined ? { status: i.status } : {}),
  };
  unwrap(await ctx.sb.from('standard_operating_procedures').update(patch).eq('id', i.sopId).eq('organization_id', ctx.organizationId).select('id').single());
  return null;
});

/** Editing never overwrites: every save is a new numbered version and the old ones stay readable. */
export const publishSopVersion = action(zBody.extend({ orgSlug: zSlug, sopId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sops.update');
  const latest = unwrap(await ctx.sb.from('sop_versions').select('version').eq('sop_id', i.sopId).eq('organization_id', ctx.organizationId)
    .order('version', { ascending: false }).limit(1).maybeSingle());
  const v = unwrap(await ctx.sb.from('sop_versions').insert({
    organization_id: ctx.organizationId, sop_id: i.sopId, version: (latest?.version ?? 0) + 1, body: i.body, change_note: i.changeNote || null,
  }).select('id, version').single());
  unwrap(await ctx.sb.from('standard_operating_procedures').update({ current_version_id: v.id, last_reviewed_at: new Date().toISOString() })
    .eq('id', i.sopId).eq('organization_id', ctx.organizationId).select('id').single());
  return { version: v.version };
});

export const markSopReviewed = action(z.object({ orgSlug: zSlug, sopId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sops.update');
  unwrap(await ctx.sb.from('standard_operating_procedures').update({ last_reviewed_at: new Date().toISOString() })
    .eq('id', i.sopId).eq('organization_id', ctx.organizationId).select('id').single());
  return null;
});

/** Growth OS library SOPs the operator can drop into this workspace. Staff only; clients write their own. */
export const listSopTemplates = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  if (!can(ctx, 'templates.apply')) return [];
  const res = await ctx.sb.from('sop_templates').select('id, name, description, category').eq('is_active', true).order('name');
  if (res.error) throw new AppError('internal', 'Could not load the SOP library', res.error);
  return res.data;
});
