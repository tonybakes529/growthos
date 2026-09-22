import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgPage, can } from '@/lib/auth/context';
import { addMemberWithLogin, changeMemberRole, listMembers, removeMember, setMemberPassword } from '@/modules/memberships/actions';
import { inviteMember, listInvitations, revokeInvitation } from '@/modules/invitations/actions';
import { startImpersonation } from '@/modules/impersonation/actions';
import { done } from '@/components/flash';
import { Modal } from '@/components/modal';
import { Flash, PageHead, Pill, day } from '@/components/ui';

// The new login is shown once, and only to the admin who just created it: a short-lived httpOnly cookie keeps it
// out of the address bar, browser history and server logs (the same trick the customer invite link uses).
const LOGIN_COOKIE = 'member_login';

/** Shows a new login once. Module scope on purpose: a server action may only capture plain values. */
async function showLogin(path: string, email: string, password: string) {
  (await cookies()).set(LOGIN_COOKIE, JSON.stringify({ email, password }), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path, maxAge: 300,
  });
}

export default async function Team({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ add?: string; msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/team`;
  const [members, invites, roles, jar] = await Promise.all([
    listMembers({ orgSlug }),
    can(ctx, 'members.read') ? listInvitations({ orgSlug, pendingOnly: true }) : null,
    ctx.sb.from('roles').select('id, key, name, audience, organization_id').eq('audience', 'member'),
    cookies(),
  ]);
  const newLogin = (() => {
    try {
      const raw = jar.get(LOGIN_COOKIE)?.value;
      return raw ? (JSON.parse(raw) as { email: string; password: string }) : null;
    } catch { return null; }
  })();
  const memberRoles = (roles.data ?? []).filter((r) => r.organization_id === null || r.organization_id === ctx.organizationId);
  const pending = invites?.ok ? invites.data.filter((i) => i.status === 'pending') : [];
  const canViewAs = ctx.ctx.is_real_super_admin && !ctx.ctx.impersonation;

  async function invite(form: FormData) {
    'use server';
    done(path, await inviteMember({ orgSlug, email: String(form.get('email')), roleKey: String(form.get('role')) }),
      (d) => `Invitation created. Send them this link: ${d.inviteUrl}`);
  }
  async function addPerson(form: FormData) {
    'use server';
    const typed = String(form.get('password') ?? '').trim();
    const r = await addMemberWithLogin({
      orgSlug, email: String(form.get('email') ?? ''), firstName: String(form.get('first') ?? ''),
      lastName: String(form.get('last') ?? ''), roleKey: String(form.get('role') ?? ''),
      password: typed || undefined,
    });
    revalidatePath(path);
    if (!r.ok) redirect(`${path}?add=1&err=${encodeURIComponent(r.error.message)}`);
    if (!r.data.password) redirect(`${path}?msg=${encodeURIComponent('Added to the workspace. They already had a login, so their usual password still works.')}`);
    await showLogin(path, r.data.email, r.data.password);
    redirect(`${path}?msg=${encodeURIComponent('Added. Their login is below, send it to them however you like.')}`);
  }
  async function resetPassword(form: FormData) {
    'use server';
    const typed = String(form.get('password') ?? '').trim();
    const r = await setMemberPassword({ orgSlug, userId: String(form.get('user') ?? ''), password: typed || undefined });
    revalidatePath(path);
    if (!r.ok) redirect(`${path}?err=${encodeURIComponent(r.error.message)}`);
    await showLogin(path, r.data.email, r.data.password);
    redirect(`${path}?msg=${encodeURIComponent('Password set. It is below, send it to them however you like.')}`);
  }
  async function role(form: FormData) {
    'use server';
    done(path, await changeMemberRole({ membershipId: String(form.get('id')), roleKey: String(form.get('role')) }), 'Role updated');
  }
  async function remove(form: FormData) {
    'use server';
    done(path, await removeMember({ membershipId: String(form.get('id')) }), 'Member removed');
  }
  async function revoke(form: FormData) {
    'use server';
    done(path, await revokeInvitation({ invitationId: String(form.get('id')) }), 'Invitation revoked');
  }
  async function viewAs(form: FormData) {
    'use server';
    const r = await startImpersonation({ targetUserId: String(form.get('user')), orgSlug, reason: 'Preview from Team page' });
    if (!r.ok) redirect(`${path}?err=${encodeURIComponent(r.error.message)}`);
    revalidatePath('/', 'layout');
    redirect(`/w/${orgSlug}`);
  }

  if (!can(ctx, 'members.read')) {
    return (<><PageHead sub={ctx.name} title="Team" /><div className="card muted">You don&apos;t have access to the team list.</div></>);
  }
  const data = members.ok ? members.data : { members: [], staff: [] };
  const manage = can(ctx, 'roles.manage');
  return (
    <>
      <PageHead sub={ctx.name} title="Team">
        {can(ctx, 'members.create') && (
          <Modal label="+ Add person" title="Add someone to this workspace" primary open={!!sp.add}>
            <form action={addPerson}>
              <p className="muted" style={{ margin: 0 }}>
                Creates their login straight away, so they can sign in without waiting for an email. You get the password to send them.
              </p>
              <div className="row">
                <label className="f" style={{ flex: 1 }}>First name<input name="first" maxLength={100} /></label>
                <label className="f" style={{ flex: 1 }}>Last name<input name="last" maxLength={100} /></label>
              </div>
              <label className="f">Email<input name="email" type="email" required autoComplete="off" /></label>
              <label className="f">Role
                <select name="role" defaultValue="client_team_member">
                  {memberRoles.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
                </select>
                <span className="qhelp">You can only give roles whose permissions you already have.</span>
              </label>
              <label className="f">Password <span className="muted" style={{ fontWeight: 400 }}>(optional: leave empty and one is generated)</span>
                <input name="password" type="text" minLength={10} maxLength={72} autoComplete="off" placeholder="Leave empty for a strong one" />
              </label>
              <div><button className="btn primary" type="submit">Add person</button></div>
            </form>
          </Modal>
        )}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err ?? (members.ok ? undefined : members.error.message)} />
      {newLogin && (
        <div className="card next">
          <h2 style={{ marginBottom: 4 }}>Their login</h2>
          <p className="muted" style={{ marginTop: 0 }}>Shown once. Send it to them, then it disappears from this page.</p>
          <div className="copy">{newLogin.email}</div>
          <div className="copy" style={{ marginTop: 6 }}>{newLogin.password}</div>
          <p className="muted" style={{ marginBottom: 0 }}>They sign in at {process.env.NEXT_PUBLIC_APP_URL ?? ''}/login</p>
        </div>
      )}
      <div className="card">
        <h2>Members</h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.membershipId}>
                <td><b>{m.profile?.display_name ?? '—'}</b></td>
                <td>{m.email}</td>
                <td>
                  {manage && m.userId !== ctx.ctx.effective_user_id ? (
                    <form action={role} className="row">
                      <input type="hidden" name="id" value={m.membershipId} />
                      <select name="role" defaultValue={m.role?.key} aria-label={`Role for ${m.email}`}>
                        {memberRoles.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
                      </select>
                      <button className="btn small" type="submit">Save</button>
                    </form>
                  ) : m.role?.name}
                </td>
                <td><Pill value={m.status} /></td>
                <td>{day(m.lastLoginAt)}</td>
                <td>
                  <div className="row">
                    {can(ctx, 'members.update') && m.userId !== ctx.ctx.effective_user_id && (
                      <Modal small label="Set password" title={`Set a password for ${m.email}`}>
                        <form action={resetPassword}>
                          <input type="hidden" name="user" value={m.userId} />
                          <p className="muted" style={{ margin: 0 }}>Use this when someone cannot get in. Their old password stops working straight away.</p>
                          <label className="f">Password <span className="muted" style={{ fontWeight: 400 }}>(optional: leave empty and one is generated)</span>
                            <input name="password" type="text" minLength={10} maxLength={72} autoComplete="off" placeholder="Leave empty for a strong one" />
                          </label>
                          <div><button className="btn primary" type="submit">Set password</button></div>
                        </form>
                      </Modal>
                    )}
                    {canViewAs && <form action={viewAs}><input type="hidden" name="user" value={m.userId} /><button className="btn small" type="submit">View as</button></form>}
                    {can(ctx, 'members.delete') && m.userId !== ctx.ctx.effective_user_id && (
                      <form action={remove}><input type="hidden" name="id" value={m.membershipId} /><button className="btn small" type="submit">Remove</button></form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Your Growth OS team</h2>
          <ul className="plain">
            {data.staff.map((s) => <li key={s.assignmentId}><span><b>{s.profile?.display_name ?? s.email}</b></span><span className="muted">{s.role?.name}{s.isPrimary ? ' · primary' : ''}</span></li>)}
            {!data.staff.length && <li className="muted">No one assigned yet.</li>}
          </ul>
        </div>
        {can(ctx, 'members.create') && (
          <div className="card">
            <h2>Invite someone</h2>
            <form action={invite} className="row" style={{ alignItems: 'end' }}>
              <label className="f" style={{ flex: 1 }}>Email<input name="email" type="email" required /></label>
              <label className="f">Role
                <select name="role" defaultValue="client_team_member">
                  {memberRoles.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
                </select>
              </label>
              <button className="btn primary" type="submit">Invite</button>
            </form>
            {!!pending.length && (
              <ul className="plain" style={{ marginTop: 12 }}>
                {pending.map((i) => (
                  <li key={i.id}>
                    <span>{i.email}<div className="muted">expires {day(i.expires_at)}</div></span>
                    <form action={revoke}><input type="hidden" name="id" value={i.id} /><button className="btn small" type="submit">Revoke</button></form>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">You can only give roles whose permissions you already have.</p>
          </div>
        )}
      </div>
    </>
  );
}
