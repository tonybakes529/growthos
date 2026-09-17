import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordLogin } from '@/modules/organizations/actions';
import { Flash } from '@/components/ui';

const safe = (t: string) => (t.startsWith('/') && !t.startsWith('//') ? t : '/');

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; err?: string; msg?: string }> }) {
  const { next, err, msg } = await searchParams;
  async function signIn(form: FormData) {
    'use server';
    const sb = await createClient();
    const target = safe(String(form.get('next') || '/'));
    const { error } = await sb.auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) });
    if (error) redirect(`/login?err=${encodeURIComponent(error.message)}&next=${encodeURIComponent(target)}`);
    await recordLogin({});
    redirect(target);
  }
  return (
    <main className="center">
      <div className="card">
        <h1 style={{ marginBottom: 16 }}>Sign in to Growth OS</h1>
        <Flash msg={msg} err={err} />
        <form action={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <input type="hidden" name="next" value={next ?? '/'} />
          <label className="f">Email<input name="email" type="email" autoComplete="email" required /></label>
          <label className="f">Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="btn primary" type="submit">Sign in</button>
        </form>
        <p className="muted">Invited? <Link href={`/signup?next=${encodeURIComponent(next ?? '/')}`}>Create your account</Link></p>
      </div>
    </main>
  );
}
