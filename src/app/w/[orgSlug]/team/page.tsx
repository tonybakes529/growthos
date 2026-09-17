import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgPage, can } from '@/lib/auth/context';
import { changeMemberRole, listMembers, removeMember } from '@/modules/memberships/actions';
import { inviteMember, listInvitations, revokeInvitation } from '@/modules/invitations/actions';
import { startImpersonation } from '@/modules/impersonation/actions';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, day } from '@/components/ui';

export default async function Team({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/team`;
  const [members, invites, roles] = await Promise.all([
    listMembers({ orgSlug }),
    can(ctx, 'members.read') ? listInvitations({ orgSlug }) : null,
    ctx.sb.from('roles').select('id, key, name, audience, organization_id').eq('audience', 'member'),
  ]);
  const memberRoles = (roles.data ?? []).filter((r) => r.organization_id === null || r.organization_id === ctx.organizationId);
  const pending = invites?.ok ? invites.data.filter((i) => i.status === 'pending') : [];
  const canViewAs = ctx.ctx.is_real_super_admin && !ctx.ctx.impersonation;

  async function invite(form: FormData) {
    'use server';
    done(path, await inviteMember({ orgSlug, email: String(form.get('email')), roleKey: String(form.get('role')) }),
      (d) => `Invitation created. Send them this link: ${d.inviteUrl}`);
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

  const data = members.ok ? members.data : { members: [], staff: [] };
  const manage = can(ctx, 'roles.manage');
  return (
    <>
      <PageHead sub={ctx.name} title="Team" />
      <Flash msg={sp.msg} err={sp.err ?? (members.ok ? undefined : members.error.message)} />
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
