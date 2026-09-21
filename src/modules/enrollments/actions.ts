import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

export type LessonCompletion = {
  lesson_id: string; progress_percent: number; lessons_completed: number; lessons_total: number;
  program_completed: boolean; certificate_id: string | null;
};

export const enrollUser = action(
  z.object({ orgSlug: zSlug, programId: zId, userId: zId, accessDays: z.number().int().positive().optional() }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'enrollments.create');
    const id = unwrap(await ctx.sb.schema('app').rpc('enroll_user', {
      p_organization_id: ctx.organizationId, p_program_id: i.programId, p_user_id: i.userId, p_source: 'manual', p_access_days: i.accessDays,
    }));
    return { enrollmentId: id as string };
  },
);

export const revokeEnrollment = action(z.object({ enrollmentId: zId }), async ({ enrollmentId }) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('revoke_enrollment', { p_enrollment_id: enrollmentId }));
  return null;
});

export const completeLesson = action(z.object({ lessonId: zId }), async ({ lessonId }) => {
  const { sb } = await requireSession();
  return unwrap(await sb.schema('app').rpc('complete_lesson', { p_lesson_id: lessonId })) as unknown as LessonCompletion;
});

export const recordLessonView = action(
  z.object({ lessonId: zId, percentWatched: z.number().min(0).max(100).optional(), positionSeconds: z.number().int().min(0).optional() }),
  async (i) => {
    const { sb } = await requireSession();
    unwrap(await sb.schema('app').rpc('record_lesson_view', { p_lesson_id: i.lessonId, p_percent_watched: i.percentWatched, p_position_s: i.positionSeconds }));
    return null;
  },
);

export const unlockLesson = action(
  z.object({ lessonId: zId, userId: zId, reason: z.string().max(300).optional(), expiresAt: z.string().datetime().optional() }),
  async (i) => {
    const { sb } = await requireSession();
    unwrap(await sb.schema('app').rpc('unlock_lesson', { p_lesson_id: i.lessonId, p_user_id: i.userId, p_reason: i.reason, p_expires_at: i.expiresAt }));
    return null;
  },
);

type MyEnrollment = {
  id: string; program_id: string; status: string; progress_percent: number; lessons_completed: number; lessons_total: number;
  enrolled_at: string; completed_at: string | null; last_activity_at: string | null; access_expires_at: string | null;
  program: { id: string; title: string; slug: string; subtitle: string | null } | null;
};

/** The signed-in person's courses here, each with its course row attached in the same request (was two round trips). */
export const listMyEnrollments = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  return unwrap(
    await ctx.sb.from('program_enrollments')
      .select('id, program_id, status, progress_percent, lessons_completed, lessons_total, enrolled_at, completed_at, last_activity_at, access_expires_at, program:programs!program_enrollments_organization_id_program_id_fkey(id, title, slug, subtitle)')
      .eq('organization_id', ctx.organizationId).eq('user_id', ctx.ctx.effective_user_id)
      .overrideTypes<MyEnrollment[], { merge: false }>(),
  );
});

/** Coach / admin view: per-student progress for one program + roll-up. */
export const getProgressReport = action(z.object({ orgSlug: zSlug, programId: zId }), async ({ orgSlug, programId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'enrollments.read');
  const [summary, rows] = await Promise.all([
    ctx.sb.from('program_completion_v').select('*').eq('program_id', programId).maybeSingle(),
    // each student's profile rides along (this used to be a second round)
    ctx.sb.from('program_enrollments')
      .select('id, user_id, status, progress_percent, lessons_completed, lessons_total, enrolled_at, completed_at, last_activity_at, user:users!program_enrollments_user_id_fkey(profile:user_profiles!user_profiles_user_id_fkey(user_id, display_name, avatar_url))')
      .eq('program_id', programId).neq('status', 'revoked').order('progress_percent', { ascending: false })
      .overrideTypes<{ id: string; user_id: string; status: string; progress_percent: number; lessons_completed: number; lessons_total: number;
        enrolled_at: string; completed_at: string | null; last_activity_at: string | null;
        user: { profile: { user_id: string; display_name: string | null; avatar_url: string | null } | null } | null }[], { merge: false }>(),
  ]);
  const students = unwrap(rows).map(({ user, ...s }) => ({ ...s, profile: user?.profile ?? null }));
  const stalled = students.filter((s) => s.status === 'active' && (!s.last_activity_at || Date.now() - Date.parse(s.last_activity_at) > 14 * 864e5));
  return {
    summary: unwrap(summary),
    students,
    stalledCount: stalled.length,
  };
});
