// Shared by the builder, the preview and the customer-facing form. No server-only imports here.

export const QUESTION_TYPES = ['short_text', 'long_text', 'email', 'number', 'url', 'single_select', 'multi_select', 'checkbox'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  short_text: 'Short text', long_text: 'Long text', email: 'Email', number: 'Number', url: 'Website link',
  single_select: 'Single select', multi_select: 'Multi select', checkbox: 'Checkbox',
};

export const hasOptions = (t: string) => t === 'single_select' || t === 'multi_select';

export type AnswerValue = string | number | boolean | string[];

export type FormQuestion = {
  id: string; key: string; label: string; help_text: string | null;
  question_type: QuestionType; options: string[]; is_required: boolean;
};

export type Branding = { name: string; slug: string; logo_url: string | null; brand_color: string | null };

/** Only ever interpolated into a style attribute, so accept nothing but a plain hex colour. */
export const safeColor = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);

/** Turns the posted form into the {questionId: value} map the database validates. Unanswered questions are sent as null so a cleared field clears the saved answer. */
export function answersFromForm(form: FormData, questions: Pick<FormQuestion, 'id' | 'question_type'>[]): Record<string, AnswerValue | null> {
  const out: Record<string, AnswerValue | null> = {};
  for (const q of questions) {
    const name = `q_${q.id}`;
    if (q.question_type === 'multi_select') {
      const picked = form.getAll(name).map(String).filter(Boolean);
      out[q.id] = picked.length ? picked : null;
    } else if (q.question_type === 'checkbox') {
      out[q.id] = form.get(name) === 'on' ? true : null;
    } else {
      const v = String(form.get(name) ?? '').trim();
      out[q.id] = v === '' ? null : v;
    }
  }
  return out;
}

export function formatAnswer(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
