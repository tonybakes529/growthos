import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { AppError, unwrap, unwrapRequired } from '@/lib/errors';
import { QUESTION_TYPES, hasOptions, safeColor, type FormQuestion } from './types';

const zOptions = z.array(z.string().trim().min(1).max(200)).max(50);
const zQuestion = z.object({
  label: z.string().trim().min(1).max(500),
  helpText: z.string().trim().max(1000).optional(),
  type: z.enum(QUESTION_TYPES),
  required: z.boolean().default(false),
  options: zOptions.default([]),
});

function checkOptions(type: string, options: string[]): string[] {
  if (!hasOptions(type)) return [];
  const unique = [...new Set(options)];
  if (unique.length < 2) throw new AppError('validation', 'Add at least two options, one per line');
  return unique;
}

/** Stable handle automations can rely on ("monthly_revenue"), derived once from the label and never changed by a later rename. */
function keyFrom(label: string, taken: Set<string>): string {
  const base = (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '') || 'question').slice(0, 50);
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

export const listForms = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'programs.read');
  const [forms, questions, programs] = await Promise.all([
    ctx.sb.from('onboarding_forms').select('id, name, description, status, published_at, updated_at')
      .eq('organization_id', ctx.organizationId).is('deleted_at', null).order('created_at'),
    ctx.sb.from('onboarding_form_questions').select('form_id').eq('organization_id', ctx.organizationId).is('deleted_at', null),
    ctx.sb.from('programs').select('id, title, onboarding_form_id').eq('organization_id', ctx.organizationId)
      .is('deleted_at', null).not('onboarding_form_id', 'is', null),
  ]);
  const qs = unwrap(questions), ps = unwrap(programs);
  return unwrap(forms).map((f) => ({
    ...f,
    questionCount: qs.filter((q) => q.form_id === f.id).length,
    courses: ps.filter((p) => p.onboarding_form_id === f.id).map((p) => ({ id: p.id, title: p.title })),
  }));
});

export const getForm = action(z.object({ orgSlug: zSlug, formId: zId }), async ({ orgSlug, formId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'programs.read');
  const [form, questions, programs, org] = await Promise.all([
    ctx.sb.from('onboarding_forms').select('id, name, description, welcome_heading, welcome_message, completion_message, status, published_at')
      .eq('id', formId).eq('organization_id', ctx.organizationId).is('deleted_at', null).maybeSingle(),
    ctx.sb.from('onboarding_form_questions').select('id, key, label, help_text, question_type, options, is_required, position')
      .eq('form_id', formId).eq('organization_id', ctx.organizationId).is('deleted_at', null).order('position').order('created_at'),
    ctx.sb.from('programs').select('id, title, status, onboarding_form_id').eq('organization_id', ctx.organizationId).is('deleted_at', null).order('title'),
    ctx.sb.from('organizations').select('name, slug, logo_url, settings').eq('id', ctx.organizationId).single(),
  ]);
  const o = unwrap(org);
  return {
    form: unwrapRequired(form, 'Onboarding form'),
    questions: unwrap(questions) as unknown as (FormQuestion & { position: number })[],
    programs: unwrap(programs),
    branding: { name: o.name, slug: o.slug, logo_url: o.logo_url, brand_color: safeColor((o.settings as { brand_color?: string } | null)?.brand_color) },
  };
});

export const createForm = action(
  z.object({ orgSlug: zSlug, name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional() }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'programs.create');
    return unwrap(await ctx.sb.from('onboarding_forms')
      .insert({ organization_id: ctx.organizationId, name: i.name, description: i.description || null }).select('id').single());
  },
);

export const updateForm = action(
  z.object({
    orgSlug: zSlug, formId: zId,
    patch: z.object({
      name: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2000).nullable(),
      welcome_heading: z.string().trim().max(200).nullable(),
      welcome_message: z.string().trim().max(2000).nullable(),
      completion_message: z.string().trim().max(2000).nullable(),
    }).partial(),
  }),
  async ({ orgSlug, formId, patch }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'programs.update');
    unwrap(await ctx.sb.from('onboarding_forms').update(patch).eq('id', formId).eq('organization_id', ctx.organizationId).select('id').single());
    return null;
  },
);

export const setFormStatus = action(
  z.object({ orgSlug: zSlug, formId: zId, status: z.enum(['draft', 'published', 'archived']) }),
  async ({ orgSlug, formId, status }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'programs.update');
    if (status === 'published') {
      const { count } = await ctx.sb.from('onboarding_form_questions').select('id', { count: 'exact', head: true })
        .eq('form_id', formId).eq('organization_id', ctx.organizationId).is('deleted_at', null);
      if (!count) throw new AppError('validation', 'Add at least one question before publishing');
    } else {
      const { count } = await ctx.sb.from('programs').select('id', { count: 'exact', head: true })
        .eq('onboarding_form_id', formId).eq('organization_id', ctx.organizationId).is('deleted_at', null);
      if (count) throw new AppError('validation', 'A course is using this form. Detach it from the course first, or new customers would have nothing to fill in.');
    }
    unwrap(await ctx.sb.from('onboarding_forms')
      .update({ status, published_at: status === 'published' ? new Date().toISOString() : undefined })
      .eq('id', formId).eq('organization_id', ctx.organizationId).select('id').single());
    return null;
  },
);

export const addQuestion = action(zQuestion.extend({ orgSlug: zSlug, formId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'programs.update');
  // include deleted questions: their keys stay reserved so old answers never get mistaken for a new question's
  const existing = unwrap(await ctx.sb.from('onboarding_form_questions').select('key, position, deleted_at')
    .eq('form_id', i.formId).eq('organization_id', ctx.organizationId));
  const live = existing.filter((q) => !q.deleted_at);
  return unwrap(await ctx.sb.from('onboarding_form_questions').insert({
    organization_id: ctx.organizationId, form_id: i.formId,
    key: keyFrom(i.label, new Set(existing.map((q) => q.key))),
    label: i.label, help_text: i.helpText || null, question_type: i.type, is_required: i.required,
    options: checkOptions(i.type, i.options),
    position: live.length ? Math.max(...live.map((q) => q.position)) + 1 : 0,
  }).select('id').single());
});

export const updateQuestion = action(zQuestion.extend({ orgSlug: zSlug, questionId: zId }), async (i) => {
  const ctx = await requireOrg(i.orgSlug);
  assertCan(ctx, 'programs.update');
  unwrap(await ctx.sb.from('onboarding_form_questions').update({
    label: i.label, help_text: i.helpText || null, question_type: i.type, is_required: i.required, options: checkOptions(i.type, i.options),
  }).eq('id', i.questionId).eq('organization_id', ctx.organizationId).is('deleted_at', null).select('id').single());
  return null;
});

export const deleteQuestion = action(z.object({ orgSlug: zSlug, questionId: zId }), async ({ orgSlug, questionId }) => {
  const ctx = await requireOrg(orgSlug);
  // soft delete: answers customers already gave stay readable on their record
  unwrap(await ctx.sb.schema('app').rpc('soft_delete', { p_table: 'onboarding_form_questions', p_id: questionId }));
  return null;
});

export const moveQuestion = action(
  z.object({ orgSlug: zSlug, formId: zId, questionId: zId, direction: z.enum(['up', 'down']) }),
  async ({ orgSlug, formId, questionId, direction }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'programs.update');
    const qs = unwrap(await ctx.sb.from('onboarding_form_questions').select('id, position')
      .eq('form_id', formId).eq('organization_id', ctx.organizationId).is('deleted_at', null).order('position').order('created_at'));
    const from = qs.findIndex((q) => q.id === questionId);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= qs.length) return null;
    const order = qs.map((q) => q.id);
    [order[from], order[to]] = [order[to]!, order[from]!];
    // renumber everything: positions may have gaps or ties after deletes
    await Promise.all(order.map((id, position) =>
      ctx.sb.from('onboarding_form_questions').update({ position }).eq('id', id).eq('organization_id', ctx.organizationId).then(unwrap)));
    return null;
  },
);

/** Which onboarding form a course uses, plus the id an outside checkout can use to name the course. */
export const setCourseOnboarding = action(
  z.object({ orgSlug: zSlug, programId: zId, formId: zId.nullable(), externalProductId: z.string().trim().max(200).nullable().optional() }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'programs.update');
    unwrap(await ctx.sb.from('programs')
      .update({ onboarding_form_id: i.formId, ...(i.externalProductId !== undefined ? { external_product_id: i.externalProductId || null } : {}) })
      .eq('id', i.programId).eq('organization_id', ctx.organizationId).select('id').single());
    return null;
  },
);

export const setBranding = action(
  z.object({
    orgSlug: zSlug,
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #2f5d8a').nullable(),
    logoUrl: z.string().url().max(500).startsWith('https://', 'Logo link must start with https://').nullable(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'organization.update');
    const org = unwrap(await ctx.sb.from('organizations').select('settings').eq('id', ctx.organizationId).single());
    const settings = { ...((org.settings as Record<string, unknown> | null) ?? {}), brand_color: i.brandColor };
    unwrap(await ctx.sb.from('organizations').update({ settings, logo_url: i.logoUrl }).eq('id', ctx.organizationId).select('id').single());
    return null;
  },
);
