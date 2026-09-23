import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getMyOnboarding, saveOnboardingAnswers } from '@/modules/students/actions';
import { answersFromForm } from '@/modules/onboarding-forms/types';
import { BrandFrame, OnboardingFields } from '@/components/onboarding-form';
import { OnboardingAutosave } from '@/components/onboarding-autosave';
import { Flash } from '@/components/ui';

export const metadata = { title: 'Get started' };

/** A customer's onboarding. Which client, course and form to show comes from their account, never from the request. */
export default async function Start({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const [{ orgSlug }, { err, msg }] = await Promise.all([params, searchParams]);
  const here = `/start/${orgSlug}`;
  if (!(await getSession())) redirect(`/login?next=${encodeURIComponent(here)}`);

  const res = await getMyOnboarding({ orgSlug });
  const ob = res.ok ? res.data : null;
  if (!ob) redirect(`/w/${orgSlug}`);
  const { onboarding, organization, program, form, questions, answers } = ob;
  // program is null when this is the workspace intake form rather than one attached to a course
  const next = program ? `/w/${orgSlug}/programs/${program.id}` : `/w/${orgSlug}`;

  async function submit(data: FormData) {
    'use server';
    const save = data.get('intent') === 'save';
    const r = await saveOnboardingAnswers({ onboardingId: onboarding.id, answers: answersFromForm(data, questions), submit: !save });
    if (!r.ok) redirect(`${here}?err=${encodeURIComponent(r.error.message)}`);
    redirect(save ? `${here}?msg=${encodeURIComponent('Saved. Come back any time to finish.')}` : here);
  }

  async function saveOne(questionId: string, value: string | number | boolean | string[] | null) {
    'use server';
    const r = await saveOnboardingAnswers({ onboardingId: onboarding.id, answers: { [questionId]: value }, submit: false });
    return r.ok ? { ok: true } : { ok: false, message: r.error.message };
  }

  if (onboarding.status === 'completed') {
    return (
      <BrandFrame brand={organization}>
        <div>
          <h1>You&apos;re all set{ob.first_name ? `, ${ob.first_name}` : ''}.</h1>
          <p className="lead">{form.completion_message || `Thanks. ${organization.name} has everything they need to get you started.`}</p>
        </div>
        {program && <div className="enrolled"><div className="k">Your program</div><div className="v">{program.title}</div></div>}
        <Link className="btn primary" href={next}>{program ? `Go to ${program.title}` : `Go to ${organization.name}`}</Link>
      </BrandFrame>
    );
  }

  return (
    <BrandFrame brand={organization}>
      <div>
        <h1>{form.welcome_heading || `Welcome${ob.first_name ? `, ${ob.first_name}` : ''}.`}</h1>
        <p className="lead">{form.welcome_message || (program ? `Let's get you set up for ${program.title}.` : `Let's get you set up with ${organization.name}.`)}</p>
      </div>
      <Flash err={err} msg={msg} />
      <form id="onboarding" action={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <OnboardingFields questions={questions} answers={answers} />
        <OnboardingAutosave formId="onboarding" save={saveOne} />
        <div className="actions">
          <button className="btn primary" type="submit" name="intent" value="submit">Complete onboarding</button>
          <button className="btn" type="submit" name="intent" value="save" formNoValidate>Save and finish later</button>
        </div>
      </form>
    </BrandFrame>
  );
}
