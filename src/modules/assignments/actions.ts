import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

export const submitAssignment = action(
  z.object({
    assignmentId: zId,
    body: z.string().max(50_000).optional(),
    links: z.array(z.string().url()).max(10).default([]),
    fileIds: z.array(zId).max(10).default([]),
  }).refine((v) => v.body || v.links.length || v.fileIds.length, 'Add text, a link or a file'),
  async (i) => {
    const { sb } = await requireSession();
    const id = unwrap(await sb.schema('app').rpc('submit_assignment', {
      p_assignment_id: i.assignmentId, p_body: i.body, p_links: i.links, p_file_ids: i.fileIds,
    }));
    return { submissionId: id as string };
  },
);

export const reviewSubmission = action(
  z.object({
    submissionId: zId,
    status: z.enum(['needs_revision', 'approved', 'rejected']),
    feedback: z.string().max(20_000).optional(),
    grade: z.number().min(0).max(100).optional(),
  }),
  async (i) => {
    const { sb } = await requireSession();
    unwrap(await sb.schema('app').rpc('review_submission', {
      p_submission_id: i.submissionId, p_status: i.status, p_feedback: i.feedback, p_grade: i.grade,
    }));
    return null;
  },
);

/** Coach inbox: everything waiting for review in a workspace. */
export const listSubmissionsForReview = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'programs.grade');
  return unwrap(
    await ctx.sb.from('assignment_submissions')
      .select('id, assignment_id, user_id, attempt, body, links, file_ids, status, submitted_at')
      .eq('organization_id', ctx.organizationId).eq('status', 'submitted').order('submitted_at'),
  );
});

export const submitQuizAttempt = action(
  z.object({ quizId: zId, answers: z.record(zId, z.union([z.string(), z.array(z.string())])) }),
  async (i) => {
    const { sb } = await requireSession();
    return unwrap(await sb.schema('app').rpc('submit_quiz_attempt', { p_quiz_id: i.quizId, p_answers: i.answers })) as {
      attempt: number; score_percent: number | null; passed: boolean;
    };
  },
);

/** Questions without answer keys (learners cannot read quiz_answer_keys). */
export const getQuiz = action(z.object({ quizId: zId }), async ({ quizId }) => {
  const { sb } = await requireSession();
  const quiz = unwrap(await sb.from('quizzes').select('id, title, pass_percent, max_attempts').eq('id', quizId).single());
  const questions = unwrap(await sb.from('quiz_questions').select('id, position, question_type, prompt, options, points').eq('quiz_id', quizId).order('position'));
  const attempts = unwrap(await sb.from('quiz_attempts').select('attempt, score_percent, passed, submitted_at').eq('quiz_id', quizId).order('attempt'));
  return { quiz, questions, attempts };
});
