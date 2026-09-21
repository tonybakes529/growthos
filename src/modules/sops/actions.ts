import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan, can, type OrgContext } from '@/lib/auth/context';
import { AppError, unwrap, unwrapRequired } from '@/lib/errors';
import { parseVideoUrl } from '@/modules/programs/embeds';

// SOPs are the client team's playbook: how this business runs. Courses are what their customers learn.
// Tables: standard_operating_procedures (the document) + sop_versions (every published body, newest is current).

export const SOP_STATUSES = ['draft', 'active', 'archived'] as const;

export type SopStep = { title?: string; text?: string; detail?: string };

const zMeta = z.object({
  title: z.string().trim().min(1).max(200),
  department: z.string().trim().max(80).optional(),
  summary: z.string().trim().max(1000).optional(),
});
const zBody = z.object({
  body: z.string().trim().max(100_000).default(''),
  // A Loom, YouTube or Tella share link. Stored as the first line of the body so it is versioned with the
  // procedure and needs no schema change; the renderer turns any such line into an embedded player.
  videoUrl: z.string().trim().max(500).optional(),
  changeNote: z.string().trim().max(500).optional(),
});

function composeBody(i: { body: string; videoUrl?: string }): string {
  let video: string | null = null;
  if (i.videoUrl) {
    const parsed = parseVideoUrl(i.videoUrl);
    if (!parsed) throw new AppError('validation', 'Paste a Loom, YouTube or Tella share link, for example https://www.loom.com/share/...');
    video = parsed.url;
  }
  const body = [video, i.body].filter(Boolean).join('\n\n');
  if (!body) throw new AppError('validation', 'Add a video link or write the procedure, or both');
  return body;
}

export const listSops = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sops.read');
  // the owner's name rides along (this used to be a second round of queries)
  const rows = unwrap(await ctx.sb.from('standard_operating_procedures')
    .select('id, title, department, summary, status, current_version_id, owner_id, source_template_id, last_reviewed_at, updated_at, owner_user:users!standard_operating_procedures_owner_id_fkey(profile:user_profiles!user_profiles_user_id_fkey(display_name))')
    .eq('organization_id', ctx.organizationId).is('deleted_at', null).order('department', { nullsFirst: false }).order('title')
    .overrideTypes<{ id: string; title: string; department: string | null; summary: string | null; status: string; current_version_id: string | null;
      owner_id: string | null; source_template_id: string | null; last_reviewed_at: string | null; updated_at: string;
      owner_user: { profile: { display_name: string | null } | null } | null }[], { merge: false }>());
  return rows.map(({ owner_user, ...r }) => ({ ...r, owner: owner_user?.profile?.display_name ?? null }));
});

const VERSION_FULL = 'id, version, body, steps, change_note, created_at, created_by';
type SopVersion = { id: string; version: number; body: string; steps: unknown; change_note: string | null; created_at: string; created_by: string | null };

/**
 * An SOP with its version history. Only two versions carry their text: the current one and, when `version` is
 * given, the one being viewed. This used to download the full text of every version ever saved.
 */
export const getSop = action(z.object({ orgSlug: zSlug, sopId: zId, version: z.number().int().positive().optional() }), async ({ orgSlug, sopId, version }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sops.read');
  const org = ctx.organizationId;
  const [sop, versions, picked] = await Promise.all([
    ctx.sb.from('standard_operating_procedures')
      .select(`id, title, department, summary, status, current_version_id, owner_id, source_template_id, review_every_days, last_reviewed_at, updated_at, current:sop_versions!sop_current_version_fk(${VERSION_FULL})`)
      .eq('id', sopId).eq('organization_id', org).is('deleted_at', null).maybeSingle()
      .overrideTypes<{ id: string; title: string; department: string | null; summary: string | null; status: string; current_version_id: string | null;
        owner_id: string | null; source_template_id: string | null; review_every_days: number | null; last_reviewed_at: string | null; updated_at: string;
        current: SopVersion | null }, { merge: false }>(),
    ctx.sb.from('sop_versions').select('id, version, change_note, created_at, created_by')
      .eq('sop_id', sopId).eq('organization_id', org).order('version', { ascending: false }),
    version ? ctx.sb.from('sop_versions').select(VERSION_FULL).eq('sop_id', sopId).eq('organization_id', org).eq('version', version).maybeSingle() : null,
  ]);
  const { current: cur, ...s } = unwrapRequired(sop, 'SOP');
  const vs = unwrap(versions);
  // An SOP always points at its current version; if it somehow does not, fall back to the latest, as before.
  const current: SopVersion | null = cur
    ?? (vs[0] ? unwrap(await ctx.sb.from('sop_versions').select(VERSION_FULL).eq('id', vs[0].id).single()) as SopVersion : null);
  return { sop: s, versions: vs, current, shown: (picked ? (unwrap(picked) as SopVersion | null) : null) ?? current };
});

/** Create the document and its first version together; a document with no body is useless, so undo on failure. */
export const createSop = action(zMeta.merge(zBody).extend({ orgSlug: zSlug }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sops.create');
  const body = composeBody(i);
  const sop = unwrap(await ctx.sb.from('standard_operating_procedures')
    .insert({ organization_id: ctx.organizationId, title: i.title, department: i.department || null, summary: i.summary || null,
      status: 'active', owner_id: ctx.ctx.effective_user_id }).select('id').single());
  const v = await ctx.sb.from('sop_versions').insert({ organization_id: ctx.organizationId, sop_id: sop.id, version: 1, body, change_note: i.changeNote || null }).select('id').single();
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
  const body = composeBody(i);
  const latest = unwrap(await ctx.sb.from('sop_versions').select('version').eq('sop_id', i.sopId).eq('organization_id', ctx.organizationId)
    .order('version', { ascending: false }).limit(1).maybeSingle());
  const v = unwrap(await ctx.sb.from('sop_versions').insert({
    organization_id: ctx.organizationId, sop_id: i.sopId, version: (latest?.version ?? 0) + 1, body, change_note: i.changeNote || null,
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


// ---- tabs ---------------------------------------------------------------------------------------
// A tab is a department. The ordered list lives on the workspace (organizations.settings.sop_tabs) so an
// empty tab can exist before its first SOP; any department already used by an SOP shows up as a tab too.

const zTab = z.string().trim().min(1).max(80);

async function readTabs(ctx: OrgContext): Promise<{ settings: Record<string, unknown>; tabs: string[] }> {
  const org = unwrap(await ctx.sb.from('organizations').select('settings').eq('id', ctx.organizationId).single());
  const settings = ((org.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const tabs = Array.isArray(settings.sop_tabs) ? (settings.sop_tabs as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return { settings, tabs };
}
async function writeTabs(ctx: OrgContext, settings: Record<string, unknown>, tabs: string[]) {
  unwrap(await ctx.sb.from('organizations').update({ settings: { ...settings, sop_tabs: tabs } as never }).eq('id', ctx.organizationId).select('id').single());
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const listSopTabs = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sops.read');
  return (await readTabs(ctx)).tabs;
});

export const addSopTab = action(z.object({ orgSlug: zSlug, name: zTab }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sops.create', 'organization.update');
  const { settings, tabs } = await readTabs(ctx);
  if (tabs.some((t) => same(t, i.name))) throw new AppError('conflict', `There is already a "${i.name}" tab`);
  await writeTabs(ctx, settings, [...tabs, i.name]);
  return { name: i.name };
});

/** Renaming a tab moves every SOP in it along. */
export const renameSopTab = action(z.object({ orgSlug: zSlug, from: zTab, to: zTab }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sops.update', 'organization.update');
  const { settings, tabs } = await readTabs(ctx);
  if (!same(i.from, i.to) && tabs.some((t) => same(t, i.to))) throw new AppError('conflict', `There is already a "${i.to}" tab`);
  unwrap(await ctx.sb.from('standard_operating_procedures').update({ department: i.to })
    .eq('organization_id', ctx.organizationId).eq('department', i.from).is('deleted_at', null).select('id'));
  await writeTabs(ctx, settings, tabs.some((t) => same(t, i.from)) ? tabs.map((t) => (same(t, i.from) ? i.to : t)) : [...tabs, i.to]);
  return { name: i.to };
});

/** Removing a tab never deletes SOPs: they move to General. */
export const removeSopTab = action(z.object({ orgSlug: zSlug, name: zTab }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sops.update', 'organization.update');
  const { settings, tabs } = await readTabs(ctx);
  const moved = unwrap(await ctx.sb.from('standard_operating_procedures').update({ department: null })
    .eq('organization_id', ctx.organizationId).eq('department', i.name).is('deleted_at', null).select('id'));
  await writeTabs(ctx, settings, tabs.filter((t) => !same(t, i.name)));
  return { moved: moved.length };
});
