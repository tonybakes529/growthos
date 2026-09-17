import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getForm } from '@/modules/onboarding-forms/actions';
import { BrandFrame, OnboardingFields } from '@/components/onboarding-form';

/** Same components the customer gets, so this is a true preview. Nothing here can be submitted. */
export default async function Preview({ params }: { params: Promise<{ orgSlug: string; formId: string }> }) {
  const { orgSlug, formId } = await params;
  const ctx = await requireOrgPage(orgSlug);
  if (!can(ctx, 'programs.read')) notFound();
  const res = await getForm({ orgSlug, formId });
  if (!res.ok) notFound();
  const { form, questions, programs, branding } = res.data;
  const course = programs.find((p) => p.onboarding_form_id === form.id)?.title ?? 'your program';
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link href={`/w/${orgSlug}/onboarding/${formId}`}>← Back to the builder</Link>
        <span className="pill amber">Preview · {form.status} · answers are not saved</span>
      </div>
      <div style={{ border: '1px dashed var(--line)', borderRadius: 8, background: 'var(--bg)' }}>
        <BrandFrame brand={branding} embedded>
          <div>
            <h1>{form.welcome_heading || 'Welcome, Jane.'}</h1>
            <p className="lead">{form.welcome_message || `Let's get you set up for ${course}.`}</p>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {questions.length ? <OnboardingFields questions={questions} /> : <p className="muted" style={{ margin: 0 }}>No questions yet.</p>}
            <div className="actions">
              <button className="btn primary" type="button" disabled>Complete onboarding</button>
              <button className="btn" type="button" disabled>Save and finish later</button>
            </div>
          </div>
        </BrandFrame>
      </div>
    </>
  );
}
