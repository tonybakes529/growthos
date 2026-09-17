import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan, type OrgContext } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { AppError, unwrap } from '@/lib/errors';

const zDrip = z.discriminatedUnion('type', [
  z.object({ type: z.literal('immediate') }),
  z.object({ type: z.literal('days_after_enrollment'), days: z.number().int().min(0).max(3650) }),
  z.object({ type: z.literal('fixed_date'), date: z.string().datetime() }),
]);
type Drip = z.infer<typeof zDrip>;
const dripColumns = (d: Drip) => ({
  drip_type: d.type,
  drip_days: d.type === 'days_after_enrollment' ? d.days : null,
  drip_date: d.type === 'fixed_date' ? d.date : null,
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'program';

async function nextPosition(ctx: OrgContext, table: 'program_sections' | 'modules' | 'lessons' | 'lesson_blocks', column: string, parentId: string) {
  const { count } = await ctx.sb.from(table).select('id', { count: 'exact', head: true }).eq(column, parentId);
  return count ?? 0;
}

export const listPrograms = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  // builders see all; learners only get rows RLS allows (enrolled / org-visible)
  return unwrap(
    await ctx.sb.from('programs')
      .select('id, title, slug, subtitle, status, visibility, is_sequential, certificate_enabled, published_at, updated_at')
      .eq('organization_id', ctx.organizationId).is('deleted_at', null).order('title'),
  );
});

export const createProgram = action(
  z.object({
    orgSlug: zSlug,
    title: z.string().min(2).max(160),
    slug: zSlug.optional(),
    subtitle: z.string().max(200).optional(),
    description: z.string().max(5000).optional(),
    isSequential: z.boolean().default(false),
    visibility: z.enum(['enrolled', 'organization']).default('enrolled'),
    defaultAccessDays: z.number().int().positive().optional(),
    certificateEnabled: z.boolean().default(false),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'programs.create');
    return unwrap(
      await ctx.sb.from('programs').insert({
        organization_id: ctx.organizationId,
        title: i.title,
        slug: i.slug ?? slugify(i.title),
        subtitle: i.subtitle,
        description: i.description,
        is_sequential: i.isSequential,
        visibility: i.visibility,
        default_access_days: i.defaultAccessDays,
        certificate_enabled: i.certificateEnabled,
      }).select('id, slug').single(),
    );
  },
);

export const updateProgram = action(
  z.object({
    orgSlug: zSlug,
    programId: zId,
    patch: z.object({
      title: z.string().min(2).max(160),
      subtitle: z.string().max(200).nullable(),
      description: z.string().max(5000).nullable(),
      is_sequential: z.boolean(),
      visibility: z.enum(['enrolled', 'organization']),
      default_access_days: z.number().int().positive().nullable(),
      certificate_enabled: z.boolean(),
      community_enabled: z.boolean(),
    }).partial(),
  }),
  async ({ orgSlug, programId, patch }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'programs.update');
    return unwrap(await ctx.sb.from('programs').update(patch).eq('id', programId).eq('organization_id', ctx.organizationId).select().single());
  },
);

export const setProgramStatus = action(
  z.object({ orgSlug: zSlug, programId: zId, status: z.enum(['draft', 'published', 'archived']) }),
  async ({ orgSlug, programId, status }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'programs.update');
    if (status === 'published') {
      const { count } = await ctx.sb.from('lessons').select('id', { count: 'exact', head: true })
        .eq('program_id', programId).eq('status', 'published').is('deleted_at', null);
      if (!count) throw new AppError('validation', 'Add at least one published lesson before publishing');
    }
    return unwrap(
      await ctx.sb.from('programs')
        .update({ status, published_at: status === 'published' ? new Date().toISOString() : undefined })
        .eq('id', programId).eq('organization_id', ctx.organizationId).select('id, status').single(),
    );
  },
);

export const createSection = action(
  z.object({ orgSlug: zSlug, programId: zId, title: z.string().min(1).max(160), description: z.string().max(2000).optional() }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'programs.create');
    return unwrap(
      await ctx.sb.from('program_sections').insert({
        organization_id: ctx.organizationId, program_id: i.programId, title: i.title, description: i.description,
        position: await nextPosition(ctx, 'program_sections', 'program_id', i.programId),
      }).select('id').single(),
    );
  },
);

export const createModule = action(
  z.object({ orgSlug: zSlug, sectionId: zId, title: z.string().min(1).max(160), description: z.string().max(2000).optional(), drip: zDrip.default({ type: 'immediate' }) }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'programs.create');
    const section = unwrap(await ctx.sb.from('program_sections').select('id, program_id').eq('id', i.sectionId).single());
    return unwrap(
      await ctx.sb.from('modules').insert({
        organization_id: ctx.organizationId, program_id: section.program_id, section_id: section.id,
        title: i.title, description: i.description, ...dripColumns(i.drip),
        position: await nextPosition(ctx, 'modules', 'section_id', section.id),
      }).select('id').single(),
    );
  },
);

export const createLesson = action(
  z.object({
    orgSlug: zSlug,
    moduleId: zId,
    title: z.string().min(1).max(160),
    summary: z.string().max(2000).optional(),
    drip: zDrip.default({ type: 'immediate' }),
    requiresPreviousCompletion: z.boolean().default(false),
    isPreview: z.boolean().default(false),
    estimatedMinutes: z.number().int().positive().optional(),
    completionRule: z.enum(['manual', 'video_watched', 'quiz_passed', 'assignment_submitted']).default('manual'),
    status: z.enum(['draft', 'published']).default('draft'),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'programs.create');
    const mod = unwrap(await ctx.sb.from('modules').select('id, program_id').eq('id', i.moduleId).single());
    return unwrap(
      await ctx.sb.from('lessons').insert({
        organization_id: ctx.organizationId, program_id: mod.program_id, module_id: mod.id,
        title: i.title, summary: i.summary, ...dripColumns(i.drip),
        requires_previous_completion: i.requiresPreviousCompletion, is_preview: i.isPreview,
        estimated_minutes: i.estimatedMinutes, completion_rule: i.completionRule, status: i.status,
        position: await nextPosition(ctx, 'lessons', 'module_id', mod.id),
      }).select('id').single(),
    );
  },
);

const zBlock = z.discriminatedUnion('blockType', [
  z.object({ blockType: z.literal('text'), content: z.object({ html: z.string().max(200_000) }) }),
  z.object({ blockType: z.literal('video'), content: z.object({ provider: z.enum(['mux', 'vimeo', 'youtube', 'wistia', 'file']), playback_id: z.string().optional(), url: z.string().url().optional(), duration_s: z.number().optional() }) }),
  z.object({ blockType: z.literal('audio'), content: z.object({ provider: z.string(), url: z.string().url().optional() }) }),
  z.object({ blockType: z.literal('document'), content: z.object({ label: z.string() }) }),
  z.object({ blockType: z.literal('download'), content: z.object({ label: z.string(), url: z.string().url().optional() }) }),
  z.object({ blockType: z.literal('embed'), content: z.object({ embed_url: z.string().url() }) }),
  z.object({ blockType: z.literal('image'), content: z.object({ alt: z.string().max(300) }) }),
  z.object({ blockType: z.literal('quiz'), content: z.object({ quiz_id: zId.optional() }) }),
  z.object({ blockType: z.literal('assignment'), content: z.object({ assignment_id: zId.optional() }) }),
  z.object({ blockType: z.literal('callout'), content: z.object({ tone: z.enum(['info', 'warning', 'success']), html: z.string() }) }),
]);

export const upsertLessonBlock = action(
  z.object({ orgSlug: zSlug, lessonId: zId, blockId: zId.optional(), fileId: zId.nullable().optional(), position: z.number().int().min(0).optional() })
    .and(zBlock),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    const lesson = unwrap(await ctx.sb.from('lessons').select('id, program_id').eq('id', i.lessonId).single());
    const row = { block_type: i.blockType, content: i.content, file_id: i.fileId ?? null };
    if (i.blockId) {
      assertCan(ctx, 'programs.update');
      return unwrap(await ctx.sb.from('lesson_blocks').update({ ...row, position: i.position }).eq('id', i.blockId).eq('lesson_id', lesson.id).select('id').single());
    }
    assertCan(ctx, 'programs.create');
    return unwrap(
      await ctx.sb.from('lesson_blocks').insert({
        ...row, organization_id: ctx.organizationId, program_id: lesson.program_id, lesson_id: lesson.id,
        position: i.position ?? (await nextPosition(ctx, 'lesson_blocks', 'lesson_id', lesson.id)),
      }).select('id').single(),
    );
  },
);

/** Drag-and-drop ordering for any level of the tree. */
export const reorder = action(
  z.object({ orgSlug: zSlug, entity: z.enum(['program_sections', 'modules', 'lessons', 'lesson_blocks']), orderedIds: z.array(zId).min(1).max(500) }),
  async ({ orgSlug, entity, orderedIds }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'programs.update');
    await Promise.all(
      orderedIds.map(async (id, position) => unwrap(await ctx.sb.from(entity).update({ position }).eq('id', id).eq('organization_id', ctx.organizationId))),
    );
    return { count: orderedIds.length };
  },
);

export type OutlineLesson = {
  id: string; title: string; position: number; estimatedMinutes: number | null;
  isAvailable: boolean; unlocksAt: string | null; lockReason: string | null; progress: string; completedAt: string | null;
};
export type Outline = { sections: { id: string; title: string; modules: { id: string; title: string; lessons: OutlineLesson[] }[] }[] };

/** The learner view: every lesson with lock state computed by the database. */
export const getProgramOutline = action(z.object({ programId: zId }), async ({ programId }) => {
  const { sb } = await requireSession();
  const rows = unwrap(await sb.schema('app').rpc('get_program_outline', { p_program_id: programId }));
  const outline: Outline = { sections: [] };
  for (const r of rows) {
    let section = outline.sections.find((s) => s.id === r.section_id);
    if (!section) outline.sections.push((section = { id: r.section_id!, title: r.section_title!, modules: [] }));
    let mod = section.modules.find((m) => m.id === r.module_id);
    if (!mod) section.modules.push((mod = { id: r.module_id!, title: r.module_title!, lessons: [] }));
    mod.lessons.push({
      id: r.lesson_id!, title: r.lesson_title!, position: r.lesson_position ?? 0, estimatedMinutes: r.estimated_minutes,
      isAvailable: Boolean(r.is_available), unlocksAt: r.unlocks_at, lockReason: r.lock_reason,
      progress: r.progress_status ?? 'not_started', completedAt: r.completed_at,
    });
  }
  return outline;
});

/** Lesson content; RLS returns no blocks when the lesson is locked for this user. */
export const getLesson = action(z.object({ lessonId: zId }), async ({ lessonId }) => {
  const { sb } = await requireSession();
  const lesson = unwrap(await sb.from('lessons').select('id, title, summary, program_id, module_id, completion_rule, estimated_minutes').eq('id', lessonId).single());
  const [blocks, resources, assignments, quizzes] = await Promise.all([
    sb.from('lesson_blocks').select('id, block_type, position, content, file_id').eq('lesson_id', lessonId).order('position'),
    sb.from('resources').select('id, title, resource_type, url, file_id').eq('lesson_id', lessonId).is('deleted_at', null),
    sb.from('assignments').select('id, title, instructions, submission_types').eq('lesson_id', lessonId).is('deleted_at', null),
    sb.from('quizzes').select('id, title, pass_percent, max_attempts').eq('lesson_id', lessonId).is('deleted_at', null),
  ]);
  const b = unwrap(blocks);
  return { lesson, locked: b.length === 0, blocks: b, resources: unwrap(resources), assignments: unwrap(assignments), quizzes: unwrap(quizzes) };
});

export const createAssignment = action(
  z.object({ orgSlug: zSlug, lessonId: zId, title: z.string().min(2).max(160), instructions: z.string().max(10_000).optional(),
             submissionTypes: z.array(z.enum(['text', 'file', 'link'])).min(1).default(['text']), requiresReview: z.boolean().default(true) }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'programs.create');
    const lesson = unwrap(await ctx.sb.from('lessons').select('id, program_id').eq('id', i.lessonId).single());
    return unwrap(await ctx.sb.from('assignments').insert({
      organization_id: ctx.organizationId, program_id: lesson.program_id, lesson_id: lesson.id, title: i.title,
      instructions: i.instructions, submission_types: i.submissionTypes, requires_review: i.requiresReview,
    }).select('id').single());
  },
);

export const createQuiz = action(
  z.object({
    orgSlug: zSlug,
    lessonId: zId,
    title: z.string().min(2).max(160),
    passPercent: z.number().min(0).max(100).default(70),
    maxAttempts: z.number().int().positive().optional(),
    questions: z.array(z.object({
      type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer']),
      prompt: z.string().min(1),
      options: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
      correct: z.union([z.array(z.string()).min(1), z.object({ text: z.string() })]),
      points: z.number().positive().default(1),
      explanation: z.string().optional(),
    })).min(1).max(100),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'programs.create');
    const lesson = unwrap(await ctx.sb.from('lessons').select('id, program_id').eq('id', i.lessonId).single());
    const quiz = unwrap(await ctx.sb.from('quizzes').insert({
      organization_id: ctx.organizationId, program_id: lesson.program_id, lesson_id: lesson.id,
      title: i.title, pass_percent: i.passPercent, max_attempts: i.maxAttempts,
    }).select('id').single());
    for (const [position, q] of i.questions.entries()) {
      const question = unwrap(await ctx.sb.from('quiz_questions').insert({
        organization_id: ctx.organizationId, program_id: lesson.program_id, quiz_id: quiz.id, position,
        question_type: q.type, prompt: q.prompt, options: q.options, points: q.points, explanation: q.explanation,
      }).select('id').single());
      unwrap(await ctx.sb.from('quiz_answer_keys').insert({ question_id: question.id, organization_id: ctx.organizationId, correct: q.correct }));
    }
    return quiz;
  },
);
