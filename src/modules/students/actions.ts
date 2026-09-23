import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan, can } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap, unwrapRequired } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { sendQueuedNow } from '@/modules/email/outbox';
import { safeColor, type AnswerValue, type Branding, type FormQuestion } from '@/modules/onboarding-forms/types';

export const STUDENT_STATUSES = ['invited', 'registered', 'in_progress', 'completed'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/** What a client reads on the Students page. "Onboarding" is only meaningful once the person has a login. */
export const lifecycle = (status: string, hasForm: boolean) => ({
  account: status === 'invited' ? 'Invited' : 'Active',
  onboarding: !hasForm && status !== 'completed' ? 'No form'
    : status === 'completed' ? 'Complete' : status === 'in_progress' ? 'In progress' : 'Not started',
});

type Row = {
  id: string; program_id: string | null; form_id: string | null; contact_id: string | null; email: string;
  user_id: string | null; status: string; invited_at: string; registered_at: string | null;
  started_at: string | null; completed_at: string | null; invitation_id: string | null;
};
type Named = {
  contact: { first_name: string | null; last_name: string | null } | null;
  user: { profile: { display_name: string | null } | null } | null;
};
type RowWithContact = Row & Named;

const SELECT = 'id, program_id, form_id, contact_id, email, user_id, status, invited_at, registered_at, started_at, completed_at, invitation_id';
// The contact carries the name your team typed; the profile carries the name they signed up with. Either
// beats showing a bare email, which is all the contact created alongside a membership starts with.
const CONTACT = 'contact:contacts!customer_onboardings_organization_id_contact_id_fkey(first_name, last_name), user:users!customer_onboardings_user_id_fkey(profile:user_profiles!user_profiles_user_id_fkey(display_name))';
const nameOf = (email: string, n: Partial<Named>) =>
  [n.contact?.first_name, n.contact?.last_name].filter(Boolean).join(' ')
  || n.user?.profile?.display_name?.trim()
  || email;

/**
 * A person can hold more than one onboarding record: the workspace intake (program_id null) plus one per
 * course that has its own form. The list is one row per person, keyed on the intake record where there is
 * one, so nobody appears twice.
 */
export const listStudents = action(
  z.object({ orgSlug: zSlug, programId: zId.optional(), status: z.enum(STUDENT_STATUSES).optional() }),
  async ({ orgSlug, programId, status }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'enrollments.read');
    // Contact names ride along as an embedded resource and the course list loads beside it: one round trip.
    // Filtering happens after grouping rather than in the query, because a filter that hid one of a person's
    // records would change which record represents them. 500 records is roughly 250 to 500 people; revisit
    // with a grouping RPC if a workspace ever gets near it.
    const [rowRes, programs, org] = await Promise.all([
      ctx.sb.from('customer_onboardings').select(`${SELECT}, ${CONTACT}`)
        .eq('organization_id', ctx.organizationId).is('deleted_at', null)
        .order('invited_at', { ascending: false }).limit(500)
        .overrideTypes<RowWithContact[], { merge: false }>(),
      ctx.sb.from('programs').select('id, title, onboarding_form_id').eq('organization_id', ctx.organizationId).is('deleted_at', null).order('title'),
      ctx.sb.from('organizations').select('default_onboarding_form_id').eq('id', ctx.organizationId).single(),
    ]);
    const rows = unwrap(rowRes);
    const ps = unwrap(programs);
    const intakeFormId = unwrap(org).default_onboarding_form_id;
    const formFor = (r: Row) => r.form_id ?? ps.find((p) => p.id === r.program_id)?.onboarding_form_id ?? intakeFormId;

    const byEmail = new Map<string, { primary: RowWithContact; all: RowWithContact[] }>();
    for (const r of rows) {
      const key = r.email.toLowerCase();
      const g = byEmail.get(key);
      if (!g) byEmail.set(key, { primary: r, all: [r] });
      else {
        g.all.push(r);
        // the workspace intake is the person's own record, so it wins over any course record
        if (r.program_id === null) g.primary = r;
      }
    }

    const everyone = [...byEmail.values()].map(({ primary: p, all }) => {
      const courses = all.filter((r) => r.program_id).map((r) => ps.find((x) => x.id === r.program_id)?.title ?? 'Removed course');
      return {
        id: p.id,
        programIds: all.map((r) => r.program_id).filter((id): id is string => !!id),
        email: p.email,
        userId: p.user_id,
        name: nameOf(p.email, p),
        courses,
        forms: all.length,
        status: p.status,
        invited_at: p.invited_at,
        registered_at: p.registered_at,
        completed_at: p.completed_at,
        // "unfinished" means unfinished on any of their forms, which is what the team chases
        unfinished: all.some((r) => r.status !== 'completed' && !!formFor(r)),
        ...lifecycle(p.status, !!formFor(p)),
      };
    });
    // whoever still owes you answers first, then newest
    everyone.sort((a, b) => Number(b.unfinished) - Number(a.unfinished) || b.invited_at.localeCompare(a.invited_at));
    const students = everyone.filter((s) => (!status || s.status === status) && (!programId || s.programIds.includes(programId)));

    return {
      programs: ps.map((p) => ({ id: p.id, title: p.title, hasForm: !!(p.onboarding_form_id ?? intakeFormId) })),
      hasIntakeForm: !!intakeFormId,
      // the cards count people, not records, so someone with an intake form and a course form counts once
      counts: Object.fromEntries(STUDENT_STATUSES.map((s) => [s, everyone.filter((x) => x.status === s).length])) as Record<StudentStatus, number>,
      students,
    };
  },
);

export type StudentForm = {
  onboardingId: string;
  formName: string | null;
  course: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  responses: (FormQuestion & { deleted_at: string | null; answer: { value: AnswerValue; updated_at: string } | null })[];
};

export const getStudent = action(z.object({ orgSlug: zSlug, onboardingId: zId }), async ({ orgSlug, onboardingId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'enrollments.read');
  // Round 1: everything that only needs the ids we already hold.
  const [recRes, orgPrograms, orgRow] = await Promise.all([
    ctx.sb.from('customer_onboardings').select(`${SELECT}, purchase_id, ${CONTACT}`)
      .eq('id', onboardingId).eq('organization_id', ctx.organizationId).is('deleted_at', null).maybeSingle()
      .overrideTypes<(Row & Named & { purchase_id: string | null }) | null, { merge: false }>(),
    ctx.sb.from('programs').select('id, title, onboarding_form_id').eq('organization_id', ctx.organizationId),
    ctx.sb.from('organizations').select('default_onboarding_form_id').eq('id', ctx.organizationId).single(),
  ]);
  const rec = unwrapRequired(recRes, 'Student');
  const courseTitles = unwrap(orgPrograms);
  const intakeFormId = unwrap(orgRow).default_onboarding_form_id;

  // Round 2: everything that hangs off the record, all at once. "siblings" are this person's other
  // onboarding forms: the workspace intake plus any course that has its own.
  const [siblingRes, contact, invitation, enrollments, taskRows] = await Promise.all([
    ctx.sb.from('customer_onboardings').select(SELECT)
      .eq('organization_id', ctx.organizationId).eq('email', rec.email).is('deleted_at', null)
      .order('program_id', { nullsFirst: true })
      .overrideTypes<Row[], { merge: false }>(),
    rec.contact_id ? ctx.sb.from('contacts').select('first_name, last_name, phone, company, lifecycle_stage').eq('id', rec.contact_id).maybeSingle() : null,
    rec.invitation_id && can(ctx, 'members.read')
      ? ctx.sb.from('invitations').select('status, expires_at').eq('id', rec.invitation_id).maybeSingle() : null,
    // everything this person is enrolled in here, not only the course on this record
    rec.user_id ? ctx.sb.from('program_enrollments').select('id, program_id, status, progress_percent, lessons_completed, lessons_total, enrolled_at, completed_at, last_activity_at')
      .eq('organization_id', ctx.organizationId).eq('user_id', rec.user_id).neq('status', 'revoked') : null,
    // their tasks through an inner join on the assignment, so this does not need a round of its own
    rec.user_id && can(ctx, 'tasks.read')
      ? ctx.sb.from('tasks').select('id, title, status, due_at, priority, a:task_assignments!task_assignments_organization_id_task_id_fkey!inner(user_id)')
          .eq('organization_id', ctx.organizationId).eq('a.user_id', rec.user_id).is('deleted_at', null)
          .order('due_at', { nullsFirst: false }).limit(20)
          .overrideTypes<{ id: string; title: string; status: string; due_at: string | null; priority: string; a: unknown }[], { merge: false }>()
      : null,
  ]);
  const siblings = unwrap(siblingRes);
  const formOf = (r: Row) => r.form_id ?? courseTitles.find((p) => p.id === r.program_id)?.onboarding_form_id ?? intakeFormId;
  const formIds = [...new Set(siblings.map(formOf).filter((id): id is string => !!id))];

  // Round 3: the questions of every form they hold, and every answer they have given, in two queries.
  const [formRows, questionRows, answerRows] = await Promise.all([
    formIds.length ? ctx.sb.from('onboarding_forms').select('id, name').in('id', formIds) : null,
    // deleted questions included on purpose: an answer should never lose its label
    formIds.length ? ctx.sb.from('onboarding_form_questions').select('id, form_id, key, label, help_text, question_type, options, is_required, position, deleted_at')
      .in('form_id', formIds).order('position').order('created_at') : null,
    ctx.sb.from('customer_onboarding_answers').select('onboarding_id, question_id, value, updated_at')
      .eq('organization_id', ctx.organizationId).in('onboarding_id', siblings.map((s) => s.id)),
  ]);
  const forms = formRows ? unwrap(formRows) : [];
  const questions = questionRows ? unwrap(questionRows) : [];
  const answers = unwrap(answerRows);

  const c = contact ? unwrap(contact) : null;
  const enr = enrollments ? unwrap(enrollments) : [];
  const studentForms: StudentForm[] = siblings.map((s) => {
    const fid = formOf(s);
    const mine = answers.filter((a) => a.onboarding_id === s.id);
    return {
      onboardingId: s.id,
      formName: forms.find((f) => f.id === fid)?.name ?? null,
      course: s.program_id ? courseTitles.find((p) => p.id === s.program_id)?.title ?? 'Removed course' : null,
      status: s.status,
      started_at: s.started_at,
      completed_at: s.completed_at,
      responses: questions.filter((q) => q.form_id === fid)
        .map((q) => ({ ...q, answer: (mine.find((a) => a.question_id === q.id) ?? null) as StudentForm['responses'][number]['answer'] }))
        .filter((q) => !q.deleted_at || q.answer) as StudentForm['responses'],
    };
  });

  return {
    record: rec,
    name: nameOf(rec.email, rec),
    contact: c,
    course: rec.program_id ? courseTitles.find((p) => p.id === rec.program_id)?.title ?? 'Removed course' : null,
    invitation: invitation ? unwrap(invitation) : null,
    ...lifecycle(rec.status, !!formOf(rec)),
    enrollments: enr.map((e) => ({ ...e, title: courseTitles.find((x) => x.id === e.program_id)?.title ?? 'Course' })),
    tasks: taskRows ? unwrap(taskRows).map(({ a: _a, ...t }) => t) : [],
    forms: studentForms,
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
    // the customer is waiting on their welcome email, so it goes out now rather than on the nightly drain
    await sendQueuedNow(i.email);
    return {
      onboardingId: res.onboarding_id,
      status: res.status,
      inviteUrl: res.accept_path ? `${getEnv().NEXT_PUBLIC_APP_URL}${res.accept_path}` : null,
    };
  },
);

/**
 * Keeps the name your team typed when adding someone. add_member_now creates the contact from the email
 * alone, and an existing login brings its own profile name, so without this what you typed is dropped.
 */
export const nameStudent = action(
  z.object({
    orgSlug: zSlug, email: z.string().trim().toLowerCase().email(),
    firstName: z.string().trim().max(100).optional(), lastName: z.string().trim().max(100).optional(),
  }),
  async ({ orgSlug, email, firstName, lastName }) => {
    const patch: { first_name?: string; last_name?: string } = {};
    if (firstName) patch.first_name = firstName;
    if (lastName) patch.last_name = lastName;
    if (!Object.keys(patch).length) return null;
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'contacts.update');
    unwrap(await ctx.sb.from('contacts').update(patch)
      .eq('organization_id', ctx.organizationId).eq('email', email).is('deleted_at', null).select('id'));
    return null;
  },
);

/**
 * Takes someone off the students list: their onboarding records are soft-deleted, their enrolments are
 * revoked, any unused invitation stops working, and their student membership here ends. Their answers are
 * kept, so a super admin can still see what they wrote.
 */
export const removeStudent = action(z.object({ orgSlug: zSlug, onboardingId: zId }), async ({ orgSlug, onboardingId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'enrollments.delete');
  return unwrap(await ctx.sb.schema('app').rpc('remove_student', { p_onboarding_id: onboardingId })) as unknown as {
    email: string; name: string; onboardings: number; enrollments: number; lost_access: boolean;
  };
});

/** Nudges a student who has a login and an unfinished form. Goes out now rather than on the nightly drain. */
export const remindOnboarding = action(z.object({ orgSlug: zSlug, onboardingId: zId }), async ({ orgSlug, onboardingId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'enrollments.update');
  const res = unwrap(await ctx.sb.schema('app').rpc('remind_onboarding', { p_onboarding_id: onboardingId })) as { to: string };
  await sendQueuedNow(res.to);
  // without a provider the message simply waits in the outbox for the nightly drain, so say so
  return { to: res.to, emailConfigured: !!getEnv().RESEND_API_KEY };
});

/** Lets someone correct an answer after they have submitted. Their old answers are kept. */
export const reopenOnboarding = action(z.object({ orgSlug: zSlug, onboardingId: zId }), async ({ orgSlug, onboardingId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'enrollments.update');
  unwrap(await ctx.sb.schema('app').rpc('reopen_onboarding', { p_onboarding_id: onboardingId }));
  return null;
});

// ---- student-facing -------------------------------------------------------------------------

export type MyOnboarding = {
  onboarding: { id: string; status: StudentStatus; completed_at: string | null };
  organization: Branding;
  /** Null when this is the workspace intake form rather than one attached to a course. */
  program: { id: string; title: string } | null;
  first_name: string | null;
  form: { id: string; name: string; welcome_heading: string | null; welcome_message: string | null; completion_message: string | null };
  questions: FormQuestion[];
  answers: Record<string, AnswerValue>;
};

/** Resolved from who is signed in plus the URL slug. The student never names a client, course or form. */
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
    })) as unknown as { onboarding_id: string; status: StudentStatus };
  },
);
