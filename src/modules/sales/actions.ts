import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { AppError, unwrap, unwrapRequired } from '@/lib/errors';

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

export const getDeal = action(z.object({ orgSlug: zSlug, dealId: zId }), async ({ orgSlug, dealId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'sales.read');
  const org = ctx.organizationId;
  const deal = unwrapRequired(await ctx.sb.from('opportunities')
    .select('id, pipeline_id, stage_id, contact_id, offer_id, title, status, value_cents, cash_collected_cents, expected_close_on, lost_notes, closed_at, created_at')
    .eq('id', dealId).eq('organization_id', org).is('deleted_at', null).maybeSingle(), 'Deal');
  const [contact, stages, offers, fields, values, calls, notes] = await Promise.all([
    ctx.sb.from('contacts').select('id, first_name, last_name, email, phone, company').eq('id', deal.contact_id).maybeSingle(),
    ctx.sb.from('pipeline_stages').select('id, name, stage_type, position').eq('pipeline_id', deal.pipeline_id).order('position'),
    ctx.sb.from('offers').select('id, name, status').eq('organization_id', org).is('deleted_at', null).neq('status', 'retired').order('name'),
    ctx.sb.from('custom_fields').select('id, key, label, field_type, options, is_required, position')
      .eq('organization_id', org).eq('entity_type', 'opportunity').eq('is_archived', false).order('position'),
    ctx.sb.from('custom_field_values').select('custom_field_id, value').eq('organization_id', org).eq('entity_id', dealId),
    ctx.sb.from('sales_calls').select('id, occurred_at, duration_minutes, outcome, offer_pitched_id, amount_cents, recording_url, call_score')
      .eq('opportunity_id', dealId).eq('organization_id', org).is('deleted_at', null).order('occurred_at', { ascending: false }),
    ctx.sb.from('sales_notes').select('id, note_type, body, sales_call_id, created_at').eq('opportunity_id', dealId).eq('organization_id', org)
      .is('deleted_at', null).order('created_at', { ascending: false }),
  ]);
  return {
    deal, contact: unwrap(contact), stages: unwrap(stages), offers: unwrap(offers),
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
  unwrapRequired(await ctx.sb.from('opportunities').select('id').eq('id', i.dealId).eq('organization_id', org).maybeSingle(), 'Deal');
  const fields = unwrap(await ctx.sb.from('custom_fields').select('id, label, field_type, options, is_required')
    .eq('organization_id', org).eq('entity_type', 'opportunity').eq('is_archived', false)) as unknown as SheetField[];
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
  if (upserts.length) unwrap(await ctx.sb.from('custom_field_values').upsert(upserts, { onConflict: 'custom_field_id,entity_id' }).select('id'));
  if (clears.length) unwrap(await ctx.sb.from('custom_field_values').delete().eq('entity_id', i.dealId).eq('organization_id', org).in('custom_field_id', clears).select('id'));
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

// ---- call sheet builder -------------------------------------------------------------------------

const zSheetField = z.object({
  label: z.string().trim().min(1).max(200),
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
  return unwrap(await ctx.sb.from('custom_fields').insert({
    organization_id: ctx.organizationId, entity_type: 'opportunity', key, label: i.label, field_type: i.type, is_required: i.required,
    options: optionsFor(i.type, i.options), position: existing.length ? Math.max(...existing.map((f) => f.position)) + 1 : 0,
  }).select('id').single());
});

export const updateSheetField = action(zSheetField.extend({ orgSlug: zSlug, fieldId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'custom_fields.update');
  unwrap(await ctx.sb.from('custom_fields').update({ label: i.label, field_type: i.type, is_required: i.required, options: optionsFor(i.type, i.options) })
    .eq('id', i.fieldId).eq('organization_id', ctx.organizationId).eq('entity_type', 'opportunity').select('id').single());
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
  const fs = unwrap(await ctx.sb.from('custom_fields').select('id, position').eq('organization_id', ctx.organizationId)
    .eq('entity_type', 'opportunity').eq('is_archived', false).order('position'));
  const from = fs.findIndex((f) => f.id === i.fieldId);
  const to = i.direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= fs.length) return null;
  const order = fs.map((f) => f.id);
  [order[from], order[to]] = [order[to]!, order[from]!];
  await Promise.all(order.map((id, position) => ctx.sb.from('custom_fields').update({ position }).eq('id', id).eq('organization_id', ctx.organizationId).then(unwrap)));
  return null;
});
