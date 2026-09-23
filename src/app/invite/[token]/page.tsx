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
  // The invitation belongs to one address. Someone already signed in as somebody else (an admin checking the
  // link, or a second account) would otherwise press Accept and be turned away with a confusing message.
  const signedInAs = session?.email ?? null;
  const wrongAccount = !!signedInAs && !!inv && signedInAs.toLowerCase() !== inv.email.toLowerCase();
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
              {wrongAccount ? (
                <>
                  <p className="muted">
                    You are signed in as <b>{signedInAs}</b>, and this invitation is for <b>{inv.email}</b>.
                    Sign out to accept it, or open the link in a private window.
                  </p>
                  <form method="post" action="/logout" style={{ marginTop: 12 }}>
                    <input type="hidden" name="next" value={here} />
                    <button className="btn primary" type="submit">Sign out and continue</button>
                  </form>
                </>
              ) : session ? (
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
