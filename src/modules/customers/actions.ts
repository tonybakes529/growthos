import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan, can } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap, unwrapRequired } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { safeColor, type AnswerValue, type Branding, type FormQuestion } from '@/modules/onboarding-forms/types';

export const CUSTOMER_STATUSES = ['invited', 'registered', 'in_progress', 'completed'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** What a client reads on the Customers page. "Onboarding" is only meaningful once the person has a login. */
export const lifecycle = (status: string, hasForm: boolean) => ({
  account: status === 'invited' ? 'Invited' : 'Active',
  onboarding: !hasForm && status !== 'completed' ? 'No form'
    : status === 'completed' ? 'Complete' : status === 'in_progress' ? 'In progress' : 'Not started',
});

export const listCustomers = action(
  z.object({ orgSlug: zSlug, programId: zId.optional(), status: z.enum(CUSTOMER_STATUSES).optional() }),
  async ({ orgSlug, programId, status }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'enrollments.read');
    let q = ctx.sb.from('customer_onboardings')
      .select('id, program_id, contact_id, email, user_id, status, invited_at, registered_at, started_at, completed_at, invitation_id')
      .eq('organization_id', ctx.organizationId).order('invited_at', { ascending: false }).limit(500);
    if (programId) q = q.eq('program_id', programId);
    if (status) q = q.eq('status', status);
    const rows = unwrap(await q);
    const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((v): v is string => !!v))];
    const [contacts, programs] = await Promise.all([
      contactIds.length ? ctx.sb.from('contacts').select('id, first_name, last_name').in('id', contactIds) : null,
      ctx.sb.from('programs').select('id, title, onboarding_form_id').eq('organization_id', ctx.organizationId).is('deleted_at', null).order('title'),
    ]);
    const cs = contacts ? unwrap(contacts) : [];
    const ps = unwrap(programs);
    return {
      programs: ps.map((p) => ({ id: p.id, title: p.title, hasForm: !!p.onboarding_form_id })),
      customers: rows.map((r) => {
        const c = cs.find((x) => x.id === r.contact_id);
        const p = ps.find((x) => x.id === r.program_id);
        return {
          ...r,
          name: [c?.first_name, c?.last_name].filter(Boolean).join(' ') || r.email,
          course: p?.title ?? 'Removed course',
          ...lifecycle(r.status, !!p?.onboarding_form_id),
        };
      }),
    };
  },
);

export const getCustomer = action(z.object({ orgSlug: zSlug, onboardingId: zId }), async ({ orgSlug, onboardingId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'enrollments.read');
  const rec = unwrapRequired(await ctx.sb.from('customer_onboardings')
    .select('id, program_id, form_id, contact_id, email, user_id, status, invited_at, registered_at, started_at, completed_at, invitation_id, purchase_id')
    .eq('id', onboardingId).eq('organization_id', ctx.organizationId).maybeSingle(), 'Customer');
  const [contact, program, answers, invitation, enrollments, assigned] = await Promise.all([
    rec.contact_id ? ctx.sb.from('contacts').select('first_name, last_name, phone, company, lifecycle_stage').eq('id', rec.contact_id).maybeSingle() : null,
    ctx.sb.from('programs').select('id, title, onboarding_form_id').eq('id', rec.program_id).maybeSingle(),
    ctx.sb.from('customer_onboarding_answers').select('question_id, value, updated_at').eq('onboarding_id', rec.id),
    rec.invitation_id && can(ctx, 'members.read')
      ? ctx.sb.from('invitations').select('status, expires_at').eq('id', rec.invitation_id).maybeSingle() : null,
    // everything this person is enrolled in here, not only the course on this record
    rec.user_id ? ctx.sb.from('program_enrollments').select('id, program_id, status, progress_percent, lessons_completed, lessons_total, enrolled_at, completed_at, last_activity_at')
      .eq('organization_id', ctx.organizationId).eq('user_id', rec.user_id).neq('status', 'revoked') : null,
    rec.user_id && can(ctx, 'tasks.read') ? ctx.sb.from('task_assignments').select('task_id').eq('organization_id', ctx.organizationId).eq('user_id', rec.user_id) : null,
  ]);
  const enr = enrollments ? unwrap(enrollments) : [];
  const taskIds = assigned ? unwrap(assigned).map((a) => a.task_id) : [];
  const [courseRows, taskRows] = await Promise.all([
    enr.length ? ctx.sb.from('programs').select('id, title').in('id', enr.map((e) => e.program_id)) : null,
    taskIds.length ? ctx.sb.from('tasks').select('id, title, status, due_at, priority').in('id', taskIds).is('deleted_at', null).order('due_at', { nullsFirst: false }).limit(20) : null,
  ]);
  const courseTitles = courseRows ? unwrap(courseRows) : [];
  const prog = unwrap(program);
  const formId = rec.form_id ?? prog?.onboarding_form_id ?? null;
  const [form, questions] = await Promise.all([
    formId ? ctx.sb.from('onboarding_forms').select('id, name').eq('id', formId).maybeSingle() : null,
    // deleted questions included on purpose: an answer should never lose its label
    formId ? ctx.sb.from('onboarding_form_questions').select('id, key, label, question_type, is_required, position, deleted_at')
      .eq('form_id', formId).order('position').order('created_at') : null,
  ]);
  const ans = unwrap(answers);
  const c = contact ? unwrap(contact) : null;
  return {
    record: rec,
    name: [c?.first_name, c?.last_name].filter(Boolean).join(' ') || rec.email,
    contact: c,
    course: prog?.title ?? 'Removed course',
    form: form ? unwrap(form) : null,
    invitation: invitation ? unwrap(invitation) : null,
    ...lifecycle(rec.status, !!formId),
    enrollments: enr.map((e) => ({ ...e, title: courseTitles.find((c) => c.id === e.program_id)?.title ?? 'Course' })),
    tasks: taskRows ? unwrap(taskRows) : [],
    responses: (questions ? unwrap(questions) : [])
      .map((q) => ({ ...q, answer: ans.find((a) => a.question_id === q.id) ?? null }))
      .filter((q) => !q.deleted_at || q.answer),
  };
});

/**
 * Adds a buyer to a course. This is the road a Stripe purchase takes after app.fulfill_purchase,
 * minus the payment. The link is shown once: only its hash is stored.
 */
export const addCustomer = action(
  z.object({
    orgSlug: zSlug, programId: zId, email: z.string().trim().email().max(320),
    firstName: z.string().trim().max(100).optional(), lastName: z.string().trim().max(100).optional(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'enrollments.create');
    const res = unwrap(await ctx.sb.schema('app').rpc('add_customer', {
      p_organization_id: ctx.organizationId, p_program_id: i.programId, p_email: i.email,
      p_first_name: i.firstName, p_last_name: i.lastName,
    })) as { onboarding_id: string; status: 'invited' | 'enrolled'; accept_path?: string };
    return {
      onboardingId: res.onboarding_id,
      status: res.status,
      inviteUrl: res.accept_path ? `${getEnv().NEXT_PUBLIC_APP_URL}${res.accept_path}` : null,
    };
  },
);

// ---- customer-facing -------------------------------------------------------------------------

export type MyOnboarding = {
  onboarding: { id: string; status: CustomerStatus; completed_at: string | null };
  organization: Branding;
  program: { id: string; title: string };
  first_name: string | null;
  form: { id: string; name: string; welcome_heading: string | null; welcome_message: string | null; completion_message: string | null };
  questions: FormQuestion[];
  answers: Record<string, AnswerValue>;
};

/** Resolved from who is signed in plus the URL slug. The customer never names a client, course or form. */
export const getMyOnboarding = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const { sb } = await requireSession();
  const data = unwrap(await sb.schema('app').rpc('get_my_onboarding', { p_slug: orgSlug })) as unknown as MyOnboarding | null;
  if (data) data.organization.brand_color = safeColor(data.organization.brand_color);
  return data;
});

export const getPendingOnboarding = action(z.object({}), async () => {
  const { sb } = await requireSession();
  return unwrap(await sb.schema('app').rpc('get_pending_onboarding')) as unknown as { onboarding_id: string; organization_slug: string } | null;
});

const zAnswer = z.union([z.string().max(10_000), z.number(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()]);

export const saveOnboardingAnswers = action(
  z.object({ onboardingId: zId, answers: z.record(zId, zAnswer), submit: z.boolean().default(false) }),
  async (i) => {
    const { sb } = await requireSession();
    // Draft first, then submit: a failed validation on submit must not throw away what was typed.
    if (i.submit) unwrap(await sb.schema('app').rpc('save_onboarding_answers', { p_onboarding_id: i.onboardingId, p_answers: i.answers, p_submit: false }));
    return unwrap(await sb.schema('app').rpc('save_onboarding_answers', {
      p_onboarding_id: i.onboardingId, p_answers: i.submit ? {} : i.answers, p_submit: i.submit,
    })) as unknown as { onboarding_id: string; status: CustomerStatus };
  },
);
