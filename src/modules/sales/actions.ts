import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { AppError, unwrap, unwrapRequired } from '@/lib/errors';
import type { OrgContext } from '@/lib/auth/context';
import { cleanPresets, type CalculatorPresets } from './calculator';
import { DISCOVERY_TEMPLATE } from './discovery-template';

/** Move a deal to another stage; won/lost stages close it. */
export const moveOpportunity = action(z.object({ orgSlug: zSlug, opportunityId: zId, stageId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sales.update');
  const stage = unwrapRequired(await ctx.sb.from('pipeline_stages').select('id, stage_type, pipeline_id')
    .eq('id', i.stageId).eq('organization_id', ctx.organizationId).maybeSingle(), 'Stage');
  const status = stage.stage_type === 'won' ? 'won' : stage.stage_type === 'lost' ? 'lost' : 'open';
  return unwrap(await ctx.sb.from('opportunities').update({
    stage_id: stage.id, status, stage_entered_at: new Date().toISOString(),
    closed_at: status === 'open' ? null : new Date().toISOString(),
  }).eq('id', i.opportunityId).eq('pipeline_id', stage.pipeline_id).select('id').single());
});

/** Quick-add: creates the contact and a deal in the pipeline's first stage. */
export const createOpportunity = action(
  z.object({
    orgSlug: zSlug,
    pipelineId: zId,
    firstName: z.string().min(1).max(80),
    lastName: z.string().max(80).optional(),
    email: z.string().email().optional(),
    title: z.string().min(1).max(160),
    valueCents: z.number().int().nonnegative().default(0),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'sales.create', 'contacts.create');
    const first = unwrap(await ctx.sb.from('pipeline_stages').select('id').eq('pipeline_id', i.pipelineId)
      .eq('organization_id', ctx.organizationId).order('position').limit(1))[0];
    if (!first) throw new AppError('validation', 'Pipeline has no stages');
    const contact = unwrap(await ctx.sb.from('contacts').insert({
      organization_id: ctx.organizationId, first_name: i.firstName, last_name: i.lastName, email: i.email,
      lifecycle_stage: 'prospect', source: 'manual',
    }).select('id').single());
    return unwrap(await ctx.sb.from('opportunities').insert({
      organization_id: ctx.organizationId, pipeline_id: i.pipelineId, stage_id: first.id,
      contact_id: contact.id, title: i.title, value_cents: i.valueCents, owner_id: ctx.ctx.effective_user_id,
    }).select('id').single());
  },
);

// ---------------------------------------------------------------------------------------------
// Deal page: editable card, call sheet, call log
// ---------------------------------------------------------------------------------------------

export const CALL_OUTCOMES = ['closed', 'deposit', 'follow_up', 'not_qualified', 'lost', 'no_show'] as const;
export const CALL_OUTCOME_LABEL: Record<(typeof CALL_OUTCOMES)[number], string> = {
  closed: 'Closed', deposit: 'Took a deposit', follow_up: 'Follow-up needed', not_qualified: 'Not qualified', lost: 'Lost', no_show: 'No show',
};
export const NOTE_TYPES = ['pain', 'budget', 'decision_maker', 'objection', 'next_step', 'general'] as const;

/** The call sheet: what a rep must find out and type in on every deal. One set per workspace, stored as custom fields on deals. */
export const SHEET_FIELD_TYPES = ['text', 'long_text', 'number', 'currency', 'date', 'boolean', 'select', 'multi_select', 'url', 'email', 'phone'] as const;
export type SheetField = { id: string; key: string; label: string; field_type: (typeof SHEET_FIELD_TYPES)[number]; options: string[]; is_required: boolean; position: number };

const DEAL_COLUMNS = 'id, pipeline_id, stage_id, contact_id, offer_id, title, status, value_cents, cash_collected_cents, expected_close_on, lost_notes, closed_at, created_at';
type DealRow = {
  id: string; pipeline_id: string; stage_id: string; contact_id: string; offer_id: string | null; title: string; status: string;
  value_cents: number; cash_collected_cents: number; expected_close_on: string | null; lost_notes: string | null;
  closed_at: string | null; created_at: string;
};
type DealContact = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; company: string | null };

export const getDeal = action(z.object({ orgSlug: zSlug, dealId: zId }), async ({ orgSlug, dealId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sales.read');
  const org = ctx.organizationId;
  // One round. The contact rides along with the deal, and stages are read by workspace and narrowed to the
  // deal's pipeline below, so nothing has to wait for the deal row first.
  const [dealRes, stages, offers, fields, values, calls, notes, settings] = await Promise.all([
    ctx.sb.from('opportunities')
      .select(`${DEAL_COLUMNS}, contact:contacts!opportunities_organization_id_contact_id_fkey(id, first_name, last_name, email, phone, company)`)
      .eq('id', dealId).eq('organization_id', org).is('deleted_at', null).maybeSingle()
      .overrideTypes<DealRow & { contact: DealContact | null }, { merge: false }>(),
    ctx.sb.from('pipeline_stages').select('id, pipeline_id, name, stage_type, position').eq('organization_id', org).order('position'),
    ctx.sb.from('offers').select('id, name, status').eq('organization_id', org).is('deleted_at', null).neq('status', 'retired').order('name'),
    ctx.sb.from('custom_fields').select('id, key, label, field_type, options, is_required, position')
      .eq('organization_id', org).eq('entity_type', 'opportunity').eq('is_archived', false).order('position'),
    ctx.sb.from('custom_field_values').select('custom_field_id, value').eq('organization_id', org).eq('entity_id', dealId),
    ctx.sb.from('sales_calls').select('id, occurred_at, duration_minutes, outcome, offer_pitched_id, amount_cents, recording_url, call_score')
      .eq('opportunity_id', dealId).eq('organization_id', org).is('deleted_at', null).order('occurred_at', { ascending: false }),
    ctx.sb.from('sales_notes').select('id, note_type, body, sales_call_id, created_at').eq('opportunity_id', dealId).eq('organization_id', org)
      .is('deleted_at', null).order('created_at', { ascending: false }),
    readSettings(ctx),
  ]);
  const { contact, ...deal } = unwrapRequired(dealRes, 'Deal');
  return {
    config: configFrom(settings),
    deal, contact,
    stages: unwrap(stages).filter((st) => st.pipeline_id === deal.pipeline_id).map(({ pipeline_id: _p, ...st }) => st),
    offers: unwrap(offers),
    fields: unwrap(fields) as unknown as SheetField[],
    values: Object.fromEntries(unwrap(values).map((v) => [v.custom_field_id, v.value])) as Record<string, unknown>,
    calls: unwrap(calls), notes: unwrap(notes),
  };
});

export const updateDeal = action(
  z.object({
    orgSlug: zSlug, dealId: zId,
    title: z.string().trim().min(1).max(160),
    valueCents: z.number().int().nonnegative(),
    cashCollectedCents: z.number().int().nonnegative(),
    offerId: zId.nullable(),
    expectedCloseOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    contact: z.object({ firstName: z.string().trim().max(80), lastName: z.string().trim().max(80), email: z.string().trim().email().or(z.literal('')), phone: z.string().trim().max(40), company: z.string().trim().max(160) }),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'sales.update');
    const deal = unwrap(await ctx.sb.from('opportunities').update({
      title: i.title, value_cents: i.valueCents, cash_collected_cents: i.cashCollectedCents, offer_id: i.offerId, expected_close_on: i.expectedCloseOn,
    }).eq('id', i.dealId).eq('organization_id', ctx.organizationId).select('contact_id').single());
    if (ctx.permissions.has('contacts.update') || ctx.ctx.is_super_admin) {
      unwrap(await ctx.sb.from('contacts').update({
        first_name: i.contact.firstName || null, last_name: i.contact.lastName || null, email: i.contact.email || null,
        phone: i.contact.phone || null, company: i.contact.company || null,
      }).eq('id', deal.contact_id).eq('organization_id', ctx.organizationId).select('id').single());
    }
    return null;
  },
);

/** Offers are what a deal is for. Kept to a name here; pricing and Stripe live on the offer itself later. */
export const createOffer = action(z.object({ orgSlug: zSlug, name: z.string().trim().min(1).max(160) }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'offers.create');
  const slug = `${i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'offer'}-${Date.now().toString(36)}`;
  return unwrap(await ctx.sb.from('offers').insert({ organization_id: ctx.organizationId, name: i.name, slug, status: 'active' }).select('id').single());
});

const zSheetValue = z.union([z.string().max(20_000), z.number(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()]);

/** Saves the call sheet for one deal. Only live fields of this workspace are accepted; empty answers clear the stored value. */
export const saveCallSheet = action(z.object({ orgSlug: zSlug, dealId: zId, values: z.record(zId, zSheetValue) }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'sales.update');
  const org = ctx.organizationId;
  // the deal check and the sheet's fields are independent, and so are the upsert and the clear below: two rounds, not four
  const [deal, fieldRes] = await Promise.all([
    ctx.sb.from('opportunities').select('id').eq('id', i.dealId).eq('organization_id', org).maybeSingle(),
    ctx.sb.from('custom_fields').select('id, label, field_type, options, is_required')
      .eq('organization_id', org).eq('entity_type', 'opportunity').eq('is_archived', false),
  ]);
  unwrapRequired(deal, 'Deal');
  const fields = unwrap(fieldRes) as unknown as SheetField[];
  const upserts: { organization_id: string; custom_field_id: string; entity_id: string; value: never }[] = [];
  const clears: string[] = [];
  for (const f of fields) {
    if (!(f.id in i.values)) continue;
    const v = i.values[f.id];
    const empty = v === null || v === '' || (Array.isArray(v) && !v.length) || v === false;
    if (empty) { clears.push(f.id); continue; }
    if ((f.field_type === 'number' || f.field_type === 'currency') && typeof v !== 'number') throw new AppError('validation', `"${f.label}" needs a number`);
    if (f.field_type === 'select' && (typeof v !== 'string' || !f.options.includes(v))) throw new AppError('validation', `"${f.label}" has an option that is not on the sheet`);
    if (f.field_type === 'multi_select' && (!Array.isArray(v) || v.some((x) => !f.options.includes(x)))) throw new AppError('validation', `"${f.label}" has an option that is not on the sheet`);
    upserts.push({ organization_id: org, custom_field_id: f.id, entity_id: i.dealId, value: v as never });
  }
  // a field is either saved or cleared, never both, so the two writes can go out together
  const [up, cl] = await Promise.all([
    upserts.length ? ctx.sb.from('custom_field_values').upsert(upserts, { onConflict: 'custom_field_id,entity_id' }).select('id') : null,
    clears.length ? ctx.sb.from('custom_field_values').delete().eq('entity_id', i.dealId).eq('organization_id', org).in('custom_field_id', clears).select('id') : null,
  ]);
  if (up) unwrap(up);
  if (cl) unwrap(cl);
  return { saved: upserts.length };
});

export const logSalesCall = action(
  z.object({
    orgSlug: zSlug, dealId: zId,
    occurredAt: z.string().datetime(),
    durationMinutes: z.number().int().min(0).max(600).nullable(),
    outcome: z.enum(CALL_OUTCOMES),
    offerPitchedId: zId.nullable(),
    amountCents: z.number().int().nonnegative().nullable(),
    recordingUrl: z.string().trim().url().max(500).nullable(),
    callScore: z.number().int().min(1).max(10).nullable(),
    notes: z.array(z.object({ type: z.enum(NOTE_TYPES), body: z.string().trim().min(1).max(10_000) })).max(10).default([]),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'sales.create');
    const org = ctx.organizationId;
    unwrapRequired(await ctx.sb.from('opportunities').select('id').eq('id', i.dealId).eq('organization_id', org).maybeSingle(), 'Deal');
    const call = unwrap(await ctx.sb.from('sales_calls').insert({
      organization_id: org, opportunity_id: i.dealId, occurred_at: i.occurredAt, duration_minutes: i.durationMinutes, outcome: i.outcome,
      offer_pitched_id: i.offerPitchedId, amount_cents: i.amountCents, recording_url: i.recordingUrl, call_score: i.callScore,
    }).select('id').single());
    if (i.notes.length) {
      unwrap(await ctx.sb.from('sales_notes').insert(i.notes.map((n) => ({
        organization_id: org, opportunity_id: i.dealId, sales_call_id: call.id, author_id: ctx.ctx.effective_user_id, note_type: n.type, body: n.body,
      }))).select('id'));
    }
    return { callId: call.id };
  },
);


// ---- call sheet layout + calculator presets (organizations.settings, no schema change) ---------

/** A block of the call sheet: a heading, an optional talk-track, and the questions under it (by field key, in order). */
export type SheetSection = { id: string; title: string; script?: string; calculator?: boolean; keys: string[] };
export type SheetConfig = { sections: SheetSection[]; calculator: (CalculatorPresets & { enabled: boolean }) | null };

async function readSettings(ctx: OrgContext) {
  const org = unwrap(await ctx.sb.from('organizations').select('settings').eq('id', ctx.organizationId).single());
  return ((org.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
}
function configFrom(settings: Record<string, unknown>): SheetConfig {
  const raw = settings.call_sheet as { sections?: SheetSection[] } | undefined;
  const calc = settings.sales_calculator as (Partial<CalculatorPresets> & { enabled?: boolean }) | undefined;
  return {
    sections: Array.isArray(raw?.sections) ? raw!.sections.map((s) => ({ ...s, keys: Array.isArray(s.keys) ? s.keys : [] })) : [],
    calculator: calc ? { ...cleanPresets(calc), enabled: calc.enabled !== false } : null,
  };
}
/** Merges `patch` into the workspace settings. Pass the settings you already read to skip reading them again. */
async function writeSettings(ctx: OrgContext, patch: Record<string, unknown>, current?: Record<string, unknown>) {
  const settings = { ...(current ?? await readSettings(ctx)), ...patch };
  unwrap(await ctx.sb.from('organizations').update({ settings: settings as never }).eq('id', ctx.organizationId).select('id').single());
}

export const getSheetConfig = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sales.read');
  return configFrom(await readSettings(ctx));
});

const sectionId = (title: string, taken: string[]) => {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'section';
  let id = base; for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
};

/** Puts a field key into a section (creating the section when `sectionTitle` is new) and removes it from any other. */
function placeKey(sections: SheetSection[], key: string, sectionTitle: string | undefined): SheetSection[] {
  const next = sections.map((s) => ({ ...s, keys: s.keys.filter((k) => k !== key) }));
  const title = (sectionTitle ?? '').trim();
  if (!title) return next;
  const found = next.find((s) => s.title.toLowerCase() === title.toLowerCase());
  if (found) found.keys.push(key);
  else next.push({ id: sectionId(title, next.map((s) => s.id)), title, keys: [key] });
  return next;
}

export const saveSheetSection = action(
  z.object({ orgSlug: zSlug, sectionId: z.string().max(60), title: z.string().trim().min(1).max(120), script: z.string().trim().max(4000).optional() }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'custom_fields.update', 'organization.update');
    const settings = await readSettings(ctx);
    const cfg = configFrom(settings);
    const s = cfg.sections.find((x) => x.id === i.sectionId);
    if (!s) throw new AppError('not_found', 'Section not found');
    s.title = i.title; s.script = i.script || undefined;
    await writeSettings(ctx, { call_sheet: { sections: cfg.sections } }, settings);
    return null;
  },
);

export const addSheetSection = action(z.object({ orgSlug: zSlug, title: z.string().trim().min(1).max(120), script: z.string().trim().max(4000).optional() }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'custom_fields.update', 'organization.update');
  const settings = await readSettings(ctx);
  const cfg = configFrom(settings);
  cfg.sections.push({ id: sectionId(i.title, cfg.sections.map((s) => s.id)), title: i.title, script: i.script || undefined, keys: [] });
  await writeSettings(ctx, { call_sheet: { sections: cfg.sections } }, settings);
  return null;
});

export const removeSheetSection = action(z.object({ orgSlug: zSlug, sectionId: z.string().max(60) }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'custom_fields.update', 'organization.update');
  const settings = await readSettings(ctx);
  const cfg = configFrom(settings);
  // its questions are not deleted; they fall back to "Other questions"
  await writeSettings(ctx, { call_sheet: { sections: cfg.sections.filter((s) => s.id !== i.sectionId) } }, settings);
  return null;
});

export const saveCalculatorPresets = action(
  z.object({ orgSlug: zSlug, enabled: z.boolean(), label: z.string().trim().max(40), closeRate: z.number(), avgJob: z.number(), bigJobsPerMonth: z.number(), bigJobValue: z.number(), daysPerBigJob: z.number() }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'custom_fields.update', 'organization.update');
    await writeSettings(ctx, { sales_calculator: { ...cleanPresets(i), enabled: i.enabled } });
    return null;
  },
);

/** One click: the full discovery call (sections, scripts, typed questions) plus the revenue calculator. Only onto an empty sheet. */
export const installDiscoveryTemplate = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'custom_fields.create', 'organization.update');
  const org = ctx.organizationId;
  const existing = unwrap(await ctx.sb.from('custom_fields').select('key, is_archived').eq('organization_id', org).eq('entity_type', 'opportunity'));
  if (existing.some((f) => !f.is_archived)) throw new AppError('conflict', 'This call sheet already has questions. Remove them first, or add to it by hand.');
  let position = 0;
  const rows = DISCOVERY_TEMPLATE.flatMap((s) => s.fields.map((f) => ({
    organization_id: org, entity_type: 'opportunity', key: f.key, label: f.label, field_type: f.type,
    options: f.options ?? [], is_required: !!f.required, position: position++, is_archived: false,
  })));
  // One write: new questions are inserted, and archived ones with the same key (still reserved by the unique key)
  // are brought back with the template's wording. This used to update the archived ones one request at a time.
  const [saved, settings] = await Promise.all([
    ctx.sb.from('custom_fields').upsert(rows, { onConflict: 'organization_id,entity_type,key' }).select('id'),
    readSettings(ctx),
  ]);
  unwrap(saved);
  await writeSettings(ctx, {
    call_sheet: { sections: DISCOVERY_TEMPLATE.map((s) => ({ id: s.id, title: s.title, script: s.script, calculator: s.calculator, keys: s.fields.map((f) => f.key) })) },
    sales_calculator: settings.sales_calculator ?? { ...cleanPresets(null), enabled: true },
  }, settings);
  return { questions: rows.length, sections: DISCOVERY_TEMPLATE.length };
});

// ---- call sheet builder -------------------------------------------------------------------------

const zSheetField = z.object({
  section: z.string().trim().max(120).optional(),
  label: z.string().trim().min(1).max(400),
  type: z.enum(SHEET_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});

export const listSheetFields = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sales.read');
  return unwrap(await ctx.sb.from('custom_fields').select('id, key, label, field_type, options, is_required, position')
    .eq('organization_id', ctx.organizationId).eq('entity_type', 'opportunity').eq('is_archived', false).order('position')) as unknown as SheetField[];
});

const optionsFor = (type: string, options: string[]) => {
  if (type !== 'select' && type !== 'multi_select') return [];
  const unique = [...new Set(options)];
  if (unique.length < 2) throw new AppError('validation', 'Add at least two options, one per line');
  return unique;
};

export const addSheetField = action(zSheetField.extend({ orgSlug: zSlug }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'custom_fields.create');
  const existing = unwrap(await ctx.sb.from('custom_fields').select('key, position').eq('organization_id', ctx.organizationId).eq('entity_type', 'opportunity'));
  const taken = new Set(existing.map((f) => f.key));
  const base = (i.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '') || 'field').slice(0, 50);
  let key = base; for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  const row = unwrap(await ctx.sb.from('custom_fields').insert({
    organization_id: ctx.organizationId, entity_type: 'opportunity', key, label: i.label, field_type: i.type, is_required: i.required,
    options: optionsFor(i.type, i.options), position: existing.length ? Math.max(...existing.map((f) => f.position)) + 1 : 0,
  }).select('id').single());
  if (i.section && (ctx.permissions.has('organization.update') || ctx.ctx.is_super_admin)) {
    const settings = await readSettings(ctx);
    const cfg = configFrom(settings);
    await writeSettings(ctx, { call_sheet: { sections: placeKey(cfg.sections, key, i.section) } }, settings);
  }
  return row;
});

export const updateSheetField = action(zSheetField.extend({ orgSlug: zSlug, fieldId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'custom_fields.update');
  const row = unwrap(await ctx.sb.from('custom_fields').update({ label: i.label, field_type: i.type, is_required: i.required, options: optionsFor(i.type, i.options) })
    .eq('id', i.fieldId).eq('organization_id', ctx.organizationId).eq('entity_type', 'opportunity').select('key').single());
  if (i.section !== undefined && (ctx.permissions.has('organization.update') || ctx.ctx.is_super_admin)) {
    const settings = await readSettings(ctx);
    const cfg = configFrom(settings);
    const current = cfg.sections.find((s) => s.keys.includes(row.key));
    if ((current?.title ?? '').toLowerCase() !== i.section.toLowerCase()) await writeSettings(ctx, { call_sheet: { sections: placeKey(cfg.sections, row.key, i.section) } }, settings);
  }
  return null;
});

/** Archive, never delete: answers already captured on deals stay in the database. */
export const archiveSheetField = action(z.object({ orgSlug: zSlug, fieldId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'custom_fields.update');
  unwrap(await ctx.sb.from('custom_fields').update({ is_archived: true }).eq('id', i.fieldId).eq('organization_id', ctx.organizationId).select('id').single());
  return null;
});

export const moveSheetField = action(z.object({ orgSlug: zSlug, fieldId: zId, direction: z.enum(['up', 'down']) }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'custom_fields.update');
  const fs = unwrap(await ctx.sb.from('custom_fields').select('id, key, position').eq('organization_id', ctx.organizationId)
    .eq('entity_type', 'opportunity').eq('is_archived', false).order('position'));
  const me = fs.find((f) => f.id === i.fieldId);
  if (!me) return null;
  const settings = await readSettings(ctx);
  const cfg = configFrom(settings);
  const section = cfg.sections.find((s) => s.keys.includes(me.key));
  if (section) {
    // inside a section the order is the order of its keys
    const from = section.keys.indexOf(me.key), to = i.direction === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= section.keys.length) return null;
    [section.keys[from], section.keys[to]] = [section.keys[to]!, section.keys[from]!];
    await writeSettings(ctx, { call_sheet: { sections: cfg.sections } }, settings);
    return null;
  }
  const sectioned = new Set(cfg.sections.flatMap((s) => s.keys));
  const loose = fs.filter((f) => !sectioned.has(f.key));
  const from = loose.findIndex((f) => f.id === i.fieldId), to = i.direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= loose.length) return null;
  const order = loose.map((f) => f.id);
  [order[from], order[to]] = [order[to]!, order[from]!];
  await Promise.all(order.map((id, position) => ctx.sb.from('custom_fields').update({ position }).eq('id', id).eq('organization_id', ctx.organizationId).then(unwrap)));
  return null;
});
