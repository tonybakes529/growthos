import 'server-only';

import { z } from 'zod';
import { action, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { unwrap } from '@/lib/errors';

export type Questionnaire = {
  questionnaire_id: string;
  name: string;
  description: string | null;
  submitted_at: string | null;
  answers: Record<string, unknown> | null;
  questions: { key: string; label: string; help_text: string | null; type: string; options: unknown[]; required: boolean }[];
};

export const getQuestionnaire = action(z.object({ orgSlug: zSlug }), async ({ orgSlug }) => {
  const ctx = await requireOrg(orgSlug);
  return unwrap(await ctx.sb.schema('app').rpc('get_onboarding_questionnaire', { p_organization_id: ctx.organizationId })) as Questionnaire | null;
});

/**
 * Answers are keyed by question key. Currency answers are entered in dollars in
 * the UI and converted to integer cents here, because the mapped profile
 * columns are *_cents.
 */
export const submitQuestionnaire = action(
  z.object({ orgSlug: zSlug, answers: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])) }),
  async ({ orgSlug, answers }) => {
    const ctx = await requireOrg(orgSlug);
    assertCan(ctx, 'organization.update');
    const q = unwrap(await ctx.sb.schema('app').rpc('get_onboarding_questionnaire', { p_organization_id: ctx.organizationId })) as Questionnaire | null;
    const normalized: Record<string, unknown> = { ...answers };
    for (const question of q?.questions ?? []) {
      const v = answers[question.key];
      if (question.type === 'currency' && v !== null && v !== undefined && v !== '') {
        const dollars = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
        if (Number.isFinite(dollars)) normalized[question.key] = Math.round(dollars * 100);
      }
    }
    const responseId = unwrap(
      await ctx.sb.schema('app').rpc('submit_onboarding_questionnaire', { p_organization_id: ctx.organizationId, p_answers: normalized as never }),
    );
    return { responseId: responseId as string };
  },
);
