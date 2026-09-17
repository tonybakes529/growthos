import type { ReactNode } from 'react';
import type { AnswerValue, Branding, FormQuestion } from '@/modules/onboarding-forms/types';

/** The client's identity around anything a customer sees. Deliberately not the Growth OS shell. */
export function BrandFrame({ brand, children, embedded }: {
  brand: Pick<Branding, 'name' | 'logo_url' | 'brand_color'>; children: ReactNode;
  /** true when rendered inside the app shell (the builder preview), which already owns the page's <main> */
  embedded?: boolean;
}) {
  const Tag = embedded ? 'div' : 'main';
  return (
    <Tag className="brandpage" style={brand.brand_color ? ({ '--accent': brand.brand_color, '--accent-2': brand.brand_color } as React.CSSProperties) : undefined}>
      <header className="brandhead">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logo_url ? <img src={brand.logo_url} alt="" className="brandlogo" /> : <span className="brandmark" aria-hidden>{brand.name.slice(0, 1).toUpperCase()}</span>}
        <span className="brandname">{brand.name}</span>
      </header>
      {children}
    </Tag>
  );
}

/** One renderer for the builder preview and the real customer form, so what the operator previews is what the customer gets. */
export function OnboardingFields({ questions, answers = {}, disabled }: {
  questions: FormQuestion[]; answers?: Record<string, AnswerValue>; disabled?: boolean;
}) {
  return (
    <div className="qlist">
      {questions.map((q, n) => {
        const name = `q_${q.id}`;
        const saved = answers[q.id];
        const text = typeof saved === 'string' || typeof saved === 'number' ? String(saved) : '';
        const help = q.help_text ? <span className="qhelp" id={`${name}_help`}>{q.help_text}</span> : null;
        const common = { name, id: name, disabled, required: q.is_required, 'aria-describedby': q.help_text ? `${name}_help` : undefined };
        const title = <span className="qlabel">{n + 1}. {q.label}{q.is_required ? <span className="req" aria-hidden> *</span> : <span className="opt"> (optional)</span>}</span>;

        if (q.question_type === 'checkbox') {
          return (
            <div className="q" key={q.id}>
              <label className="choice">
                <input type="checkbox" {...common} defaultChecked={saved === true} />
                <span>{q.label}{q.is_required && <span className="req" aria-hidden> *</span>}</span>
              </label>
              {help}
            </div>
          );
        }
        if (q.question_type === 'single_select' || q.question_type === 'multi_select') {
          const multi = q.question_type === 'multi_select';
          const picked = Array.isArray(saved) ? saved : typeof saved === 'string' ? [saved] : [];
          return (
            <fieldset className="q" key={q.id} disabled={disabled}>
              <legend>{title}</legend>
              {help}
              <div className="choices">
                {q.options.map((o) => (
                  <label className="choice" key={o}>
                    {/* native "required" on a checkbox group would demand every box, so multi select is enforced on the server */}
                    <input type={multi ? 'checkbox' : 'radio'} name={name} value={o} defaultChecked={picked.includes(o)} required={!multi && q.is_required} />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        return (
          <label className="q" key={q.id} htmlFor={name}>
            {title}
            {help}
            {q.question_type === 'long_text'
              ? <textarea {...common} defaultValue={text} rows={4} maxLength={10000} />
              : <input {...common} defaultValue={text}
                  type={q.question_type === 'email' ? 'email' : q.question_type === 'url' ? 'url' : q.question_type === 'number' ? 'number' : 'text'}
                  inputMode={q.question_type === 'number' ? 'decimal' : undefined} step={q.question_type === 'number' ? 'any' : undefined}
                  placeholder={q.question_type === 'url' ? 'https://' : undefined} maxLength={q.question_type === 'number' ? undefined : 10000} />}
          </label>
        );
      })}
    </div>
  );
}
