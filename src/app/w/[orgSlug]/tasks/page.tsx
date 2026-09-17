import { requireOrgPage, can } from '@/lib/auth/context';
import { createTask, listTasks, setTaskStatus } from '@/modules/tasks/actions';
import { listMembers } from '@/modules/memberships/actions';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, day } from '@/components/ui';

const STATUSES = ['todo', 'in_progress', 'blocked', 'in_review', 'done', 'canceled'] as const;

export default async function Tasks({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ view?: string; msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/tasks`;
  const view = sp.view ?? 'open';
  const [tasks, members] = await Promise.all([
    listTasks({ orgSlug, mine: view === 'mine', overdueOnly: view === 'overdue',
      statuses: view === 'done' ? ['done'] : ['todo', 'in_progress', 'blocked', 'in_review'] }),
    can(ctx, 'members.read') ? listMembers({ orgSlug }) : null,
  ]);
  const people = members?.ok ? [...members.data.members, ...members.data.staff] : [];
  const name = (id: string) => people.find((p) => p.userId === id)?.profile?.display_name ?? (id === ctx.ctx.effective_user_id ? 'Me' : 'Someone');
  const isStaff = ctx.ctx.is_platform_staff || ctx.ctx.is_super_admin;

  async function create(form: FormData) {
    'use server';
    const due = String(form.get('due') || '');
    const who = String(form.get('assignee') || '');
    done(path, await createTask({ orgSlug, title: String(form.get('title')), priority: String(form.get('priority')) as 'medium',
      dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : undefined, assigneeIds: who ? [who] : [],
      visibility: String(form.get('visibility') || 'organization') as 'organization' }), 'Task created');
  }
  async function move(form: FormData) {
    'use server';
    done(path, await setTaskStatus({ taskId: String(form.get('id')), status: String(form.get('status')) as 'done' }), 'Task updated');
  }

  const list = tasks.ok ? tasks.data : [];
  const now = Date.now();
  return (
    <>
      <PageHead sub={ctx.name} title="Tasks" />
      <Flash msg={sp.msg} err={sp.err ?? (tasks.ok ? undefined : tasks.error.message)} />
      <div className="row">
        {[['open', 'Open'], ['mine', 'Mine'], ['overdue', 'Overdue'], ['done', 'Done']].map(([k, l]) => (
          <a key={k} className={`btn${view === k ? ' primary' : ''}`} href={`${path}?view=${k}`}>{l}</a>
        ))}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((t) => {
              const overdue = t.due_at && Date.parse(t.due_at) < now && !['done', 'canceled'].includes(t.status);
              return (
                <tr key={t.id}>
                  <td><b>{t.title}</b>{t.visibility === 'staff' && <> <Pill value="none" label="staff only" /></>}</td>
                  <td>{t.assigneeIds.map(name).join(', ') || '—'}</td>
                  <td>{overdue ? <Pill value="overdue" label={`${day(t.due_at)} · overdue`} /> : day(t.due_at)}</td>
                  <td><Pill value={t.priority} /></td>
                  <td>
                    <form action={move} className="row">
                      <input type="hidden" name="id" value={t.id} />
                      <select name="status" defaultValue={t.status} aria-label={`Status of ${t.title}`}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                      <button className="btn small" type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={5} className="muted">No tasks here.</td></tr>}
          </tbody>
        </table>
      </div>
      {can(ctx, 'tasks.create') && (
        <form className="card" action={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ flex: 2, minWidth: 220 }}>New task<input name="title" required /></label>
          <label className="f">Assignee
            <select name="assignee"><option value="">Unassigned</option>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.profile?.display_name ?? p.email}</option>)}
            </select>
          </label>
          <label className="f">Due<input name="due" type="date" /></label>
          <label className="f">Priority
            <select name="priority" defaultValue="medium">{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          {isStaff && (
            <label className="f">Visible to
              <select name="visibility"><option value="organization">Everyone</option><option value="assignees">Assignees</option><option value="staff">Staff only</option></select>
            </label>
          )}
          <button className="btn primary" type="submit">Add task</button>
        </form>
      )}
    </>
  );
}
