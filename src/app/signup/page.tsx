import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Flash } from '@/components/ui';

export default async function Signup({ searchParams }: { searchParams: Promise<{ next?: string; err?: string; email?: string }> }) {
  const { next, err, email } = await searchParams;
  async function signUp(form: FormData) {
    'use server';
    const sb = await createClient();
    const target = String(form.get('next') || '/');
    const { data, error } = await sb.auth.signUp({
      email: String(form.get('email')),
      password: String(form.get('password')),
      options: { data: { first_name: String(form.get('first') || ''), last_name: String(form.get('last') || '') } },
    });
    if (error) redirect(`/signup?err=${encodeURIComponent(error.message)}&next=${encodeURIComponent(target)}`);
    if (!data.session) redirect(`/login?msg=${encodeURIComponent('Check your email to confirm your account, then sign in.')}&next=${encodeURIComponent(target)}`);
    redirect(target.startsWith('/') && !target.startsWith('//') ? target : '/');
  }
  return (
    <main className="center">
      <div className="card">
        <h1 style={{ marginBottom: 16 }}>Create your account</h1>
        <Flash err={err} />
        <form action={signUp} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <input type="hidden" name="next" value={next ?? '/'} />
          <div className="row">
            <label className="f" style={{ flex: 1 }}>First name<input name="first" /></label>
            <label className="f" style={{ flex: 1 }}>Last name<input name="last" /></label>
          </div>
          <label className="f">Email (the one your invite was sent to)<input name="email" type="email" defaultValue={email} required /></label>
          <label className="f">Password<input name="password" type="password" minLength={10} autoComplete="new-password" required /></label>
          <button className="btn primary" type="submit">Create account</button>
        </form>
        <p className="muted">Have an account? <Link href={`/login?next=${encodeURIComponent(next ?? '/')}`}>Sign in</Link></p>
      </div>
    </main>
  );
}
