import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { getEnv } from '@/lib/env';
import { acceptInvitation, getInvitationPreview } from '@/modules/invitations/actions';
import { recordLogin } from '@/modules/organizations/actions';
import { safeColor } from '@/modules/onboarding-forms/types';
import { BrandFrame } from '@/components/onboarding-form';
import { Flash } from '@/components/ui';

export const metadata = { title: 'Welcome' };

// Module scope on purpose: inline server actions may only close over serializable values.
const fail = (here: string, m: string): never => redirect(`${here}?err=${encodeURIComponent(m)}`);

async function acceptAndStart(token: string, here: string): Promise<never> {
  const r = await acceptInvitation({ token });
  if (!r.ok) return fail(here, r.error.message);
  await recordLogin({});
  redirect(`/start/${r.data.slug}`);
}

/**
 * The link a buyer receives. The token is the only credential: the slug in the URL is cosmetic and is
 * checked against the invitation, never trusted. Email always comes from the invitation, not the form.
 */
export default async function Join({ params, searchParams }: { params: Promise<{ orgSlug: string; token: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const [{ orgSlug, token }, { err, msg }] = await Promise.all([params, searchParams]);
  const [preview, session] = await Promise.all([getInvitationPreview({ token }), getSession().catch(() => null)]);
  const inv = preview.ok && preview.data && preview.data.organization_slug === orgSlug ? preview.data : null;
  const here = `/join/${orgSlug}/${token}`;

  async function finish() {
    'use server';
    await acceptAndStart(token, here);
  }

  async function signUp(form: FormData) {
    'use server';
    const fresh = await getInvitationPreview({ token });
    if (!fresh.ok || !fresh.data || fresh.data.status !== 'pending') return fail(here, 'This link is no longer valid.');
    const [first, ...rest] = String(form.get('name') ?? '').trim().split(/\s+/);
    const sb = await createClient();
    const { data, error } = await sb.auth.signUp({
      email: fresh.data.email,
      password: String(form.get('password')),
      // If the project requires email confirmation, the confirm link brings them straight back here to sign in.
      options: { data: { first_name: first ?? '', last_name: rest.join(' ') }, emailRedirectTo: `${getEnv().NEXT_PUBLIC_APP_URL}${here}` },
    });
    if (error) return fail(here, error.message);
    if (!data.session) redirect(`${here}?msg=${encodeURIComponent(`Almost there. We sent a confirmation email to ${fresh.data.email}. Confirm it, then sign in below to continue.`)}`);
    await acceptAndStart(token, here);
  }

  async function signIn(form: FormData) {
    'use server';
    const fresh = await getInvitationPreview({ token });
    if (!fresh.ok || !fresh.data) return fail(here, 'This link is no longer valid.');
    const sb = await createClient();
    const { error } = await sb.auth.signInWithPassword({ email: fresh.data.email, password: String(form.get('password')) });
    if (error) return fail(here, /not confirmed/i.test(error.message) ? 'Please confirm your email first. Check your inbox for the confirmation link, then sign in here.' : error.message);
    await acceptAndStart(token, here);
  }

  if (!inv) {
    return (
      <main className="center"><div className="card">
        <h1>This link isn&apos;t valid</h1>
        <p className="muted">It may have been replaced by a newer one. Check your most recent email, or ask whoever sent it for a fresh link.</p>
      </div></main>
    );
  }

  const brand = { name: inv.organization_name, logo_url: inv.logo_url, brand_color: safeColor(inv.brand_color) };
  const courses = inv.courses.length ? inv.courses : ['your program'];
  const wrongAccount = session && session.email?.toLowerCase() !== inv.email.toLowerCase();

  return (
    <BrandFrame brand={brand}>
      <div>
        <h1>Welcome to {inv.organization_name}</h1>
        {inv.first_name && <p className="lead">Good to have you here, {inv.first_name}.</p>}
      </div>
      <div className="enrolled">
        <div className="k">You&apos;re enrolled in</div>
        {courses.map((c) => <div className="v" key={c}>{c}</div>)}
      </div>
      <Flash err={err} msg={msg} />

      {inv.status === 'accepted' ? (
        <div className="card"><p style={{ marginTop: 0 }}>You&apos;ve already used this link. Sign in to carry on.</p>
          <Link className="btn primary" href={`/login?next=${encodeURIComponent(`/start/${orgSlug}`)}`}>Sign in</Link></div>
      ) : inv.status !== 'pending' ? (
        <div className="card"><p style={{ margin: 0 }}>This link has {inv.status === 'expired' ? 'expired' : 'been replaced'}. Ask {inv.organization_name} to send you a new one.</p></div>
      ) : wrongAccount ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>You&apos;re signed in as <b>{session.email}</b>, but this link was sent to <b>{inv.email}</b>.</p>
          <form action="/logout" method="post"><button className="btn" type="submit">Sign out and try again</button></form>
        </div>
      ) : session ? (
        <form action={finish} className="card"><p style={{ marginTop: 0 }}>You&apos;re signed in as {session.email}.</p>
          <button className="btn primary" type="submit" style={{ width: '100%' }}>Continue</button></form>
      ) : inv.account_exists ? (
        <form action={signIn} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0 }}>Sign in to get started</h2>
          <label className="f">Email<input value={inv.email} readOnly disabled /></label>
          <label className="f">Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="btn primary" type="submit">Sign in and continue</button>
        </form>
      ) : (
        <form action={signUp} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0 }}>Create your account to get started</h2>
          <label className="f">Your name<input name="name" autoComplete="name" defaultValue={inv.first_name ?? ''} required maxLength={120} /></label>
          <label className="f">Email<input value={inv.email} readOnly disabled /></label>
          <label className="f">Choose a password<input name="password" type="password" minLength={10} autoComplete="new-password" required aria-describedby="pwhelp" />
            <span id="pwhelp" className="qhelp">At least 10 characters</span></label>
          <button className="btn primary" type="submit">Create account</button>
        </form>
      )}
    </BrandFrame>
  );
}
