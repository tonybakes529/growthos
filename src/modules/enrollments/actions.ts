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

export const listMyEnrollments = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  const enrollments = unwrap(
    await ctx.sb.from('program_enrollments')
      .select('id, program_id, status, progress_percent, lessons_completed, lessons_total, enrolled_at, completed_at, last_activity_at, access_expires_at')
      .eq('organization_id', ctx.organizationId).eq('user_id', ctx.ctx.effective_user_id),
  );
  const programIds = enrollments.map((e) => e.program_id);
  const programs = programIds.length
    ? unwrap(await ctx.sb.from('programs').select('id, title, slug, subtitle').in('id', programIds))
    : [];
  const byId = new Map(programs.map((p) => [p.id, p]));
  return enrollments.map((e) => ({ ...e, program: byId.get(e.program_id) ?? null }));
});

/** Coach / admin view: per-student progress for one program + roll-up. */
export const getProgressReport = action(z.object({ orgSlug: zSlug, programId: zId }), async ({ orgSlug, programId }) => {
  const ctx = await requireOrg(orgSlug);
  assertCan(ctx, 'enrollments.read');
  const [summary, rows] = await Promise.all([
    ctx.sb.from('program_completion_v').select('*').eq('program_id', programId).maybeSingle(),
    ctx.sb.from('program_enrollments')
      .select('id, user_id, status, progress_percent, lessons_completed, lessons_total, enrolled_at, completed_at, last_activity_at')
      .eq('program_id', programId).neq('status', 'revoked').order('progress_percent', { ascending: false }),
  ]);
  const students = unwrap(rows);
  const profiles = students.length
    ? unwrap(await ctx.sb.from('user_profiles').select('user_id, display_name, avatar_url').in('user_id', students.map((s) => s.user_id)))
    : [];
  const byId = new Map(profiles.map((p) => [p.user_id, p]));
  const stalled = students.filter((s) => s.status === 'active' && (!s.last_activity_at || Date.now() - Date.parse(s.last_activity_at) > 14 * 864e5));
  return {
    summary: unwrap(summary),
    students: students.map((s) => ({ ...s, profile: byId.get(s.user_id) ?? null })),
    stalledCount: stalled.length,
  };
});
