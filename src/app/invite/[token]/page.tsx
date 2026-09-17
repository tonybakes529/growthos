import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { acceptInvitation, getInvitationPreview } from '@/modules/invitations/actions';
import { Flash } from '@/components/ui';

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string }> }) {
  const [{ token }, { err }] = await Promise.all([params, searchParams]);
  const [preview, session] = await Promise.all([getInvitationPreview({ token }), getSession()]);
  const inv = preview.ok ? preview.data : null;
  if (inv?.is_customer) redirect(`/join/${inv.organization_slug}/${token}`);

  async function accept() {
    'use server';
    const r = await acceptInvitation({ token });
    if (!r.ok) redirect(`/invite/${token}?err=${encodeURIComponent(r.error.message)}`);
    redirect(`/w/${r.data.slug}`);
  }

  const here = `/invite/${token}`;
  return (
    <main className="center">
      <div className="card">
        {!inv ? <p>This invitation link is not valid.</p>
          : inv.status !== 'pending' ? <p>This invitation is {inv.status}.</p>
          : (
            <>
              <h1>Join {inv.organization_name}</h1>
              <p>You were invited as <b>{inv.role_name}</b> ({inv.email}).</p>
              <Flash err={err} />
              {session ? (
                <form action={accept} style={{ marginTop: 12 }}><button className="btn primary" type="submit">Accept invitation</button></form>
              ) : (
                <div className="row">
                  <Link className="btn primary" href={`/signup?email=${encodeURIComponent(inv.email)}&next=${encodeURIComponent(here)}`}>Create account</Link>
                  <Link className="btn" href={`/login?next=${encodeURIComponent(here)}`}>I have an account</Link>
                </div>
              )}
            </>
          )}
      </div>
    </main>
  );
}
