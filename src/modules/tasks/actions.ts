import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

const zStatus = z.enum(['todo', 'in_progress', 'blocked', 'in_review', 'done', 'canceled']);

// named so the embedded joins stay unambiguous if another relationship between these tables is ever added
const ASSIGNMENT_FK = 'task_assignments_organization_id_task_id_fkey';
const TASK_COLUMNS = 'id, title, status, priority, task_type, visibility, due_at, completed_at, related_type, related_id, growth_project_id, parent_task_id, created_at';
type TaskRow = {
  id: string; title: string; status: string; priority: string; task_type: string; visibility: string; due_at: string | null;
  completed_at: string | null; related_type: string | null; related_id: string | null; growth_project_id: string | null;
  parent_task_id: string | null; created_at: string;
};
/** Drops the helper join column ("mine") that an inner-joined request carries. */
const pickTask = (t: TaskRow & { mine?: unknown }): TaskRow => { const { mine: _mine, ...rest } = t; return rest; };

export const createTask = action(
  z.object({
    orgSlug: zSlug,
    title: z.string().min(1).max(300),
    description: z.string().max(20_000).optional(),
    dueAt: z.string().datetime().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    assigneeIds: z.array(zId).max(20).default([]),
    visibility: z.enum(['organization', 'assignees', 'staff']).default('organization'),
    taskType: z.enum(['general', 'onboarding', 'action_item', 'follow_up', 'content', 'sales', 'coaching', 'internal']).default('general'),
    related: z.object({ type: z.string(), id: zId }).optional(),
    growthProjectId: zId.optional(),
    parentTaskId: zId.optional(),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    assertCan(ctx, 'tasks.create');
    const id = unwrap(await ctx.sb.schema('app').rpc('create_task', {
      p_organization_id: ctx.organizationId, p_title: i.title, p_description: i.description, p_due_at: i.dueAt,
      p_priority: i.priority, p_assignee_ids: i.assigneeIds, p_visibility: i.visibility, p_task_type: i.taskType,
      p_related_type: i.related?.type, p_related_id: i.related?.id, p_growth_project_id: i.growthProjectId, p_parent_task_id: i.parentTaskId,
    }));
    return { taskId: id as string };
  },
);

export const setTaskStatus = action(z.object({ taskId: zId, status: zStatus }), async (i) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('set_task_status', { p_task_id: i.taskId, p_status: i.status }));
  return null;
});

export const assignTask = action(z.object({ taskId: zId, userIds: z.array(zId).min(1), replace: z.boolean().default(false) }), async (i) => {
  const { sb } = await requireSession();
  unwrap(await sb.schema('app').rpc('assign_task', { p_task_id: i.taskId, p_user_ids: i.userIds, p_replace: i.replace }));
  return null;
});

export const updateTask = action(
  z.object({
    taskId: zId,
    patch: z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(20_000).nullable(),
      due_at: z.string().datetime().nullable(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']),
      position: z.number().int(),
    }).partial(),
  }),
  async ({ taskId, patch }) => {
    const { sb } = await requireSession();
    return unwrap(await sb.from('tasks').update(patch).eq('id', taskId).select('id').single());
  },
);

export const commentOnTask = action(z.object({ taskId: zId, body: z.string().min(1).max(10_000), fileIds: z.array(zId).max(10).default([]) }), async (i) => {
  const { sb, ctx } = await requireSession();
  const task = unwrap(await sb.from('tasks').select('id, organization_id').eq('id', i.taskId).single());
  return unwrap(await sb.from('task_comments').insert({
    organization_id: task.organization_id, task_id: task.id, author_id: ctx.effective_user_id, body: i.body, file_ids: i.fileIds,
  }).select('id').single());
});

export const listTasks = action(
  z.object({
    orgSlug: zSlug,
    mine: z.boolean().default(false),
    statuses: z.array(zStatus).optional(),
    overdueOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);
    // One request: assignees ride along as an embedded resource, and "mine" is an inner join on the same table.
    // (This used to be up to three round trips: my assignment ids, then the tasks, then their assignees.)
    let q = ctx.sb.from('tasks')
      .select(`${TASK_COLUMNS}, assignees:task_assignments!${ASSIGNMENT_FK}(user_id)${i.mine ? `, mine:task_assignments!${ASSIGNMENT_FK}!inner(user_id)` : ''}`)
      .eq('organization_id', ctx.organizationId).is('deleted_at', null);
    if (i.mine) q = q.eq('mine.user_id', ctx.ctx.effective_user_id);
    if (i.statuses?.length) q = q.in('status', i.statuses);
    if (i.overdueOnly) q = q.lt('due_at', new Date().toISOString()).not('status', 'in', '(done,canceled)');
    // the generated types carry no relationships, so the embedded shape is declared here
    const tasks = unwrap(await q.order('due_at', { ascending: true, nullsFirst: false }).limit(i.limit)
      .overrideTypes<(TaskRow & { assignees: { user_id: string }[] })[], { merge: false }>());
    return tasks.map(({ assignees, ...t }) => ({ ...pickTask(t), assigneeIds: assignees.map((a) => a.user_id) }));
  },
);

/**
 * The signed-in person's open tasks across every workspace they can enter. RLS scopes both queries,
 * so an internal team member only sees tasks in the clients they are assigned to.
 */
export const listMyTasksEverywhere = action(z.object({ limit: z.number().int().min(1).max(100).default(20) }), async ({ limit }) => {
  const { sb, ctx } = await requireSession();
  // One request instead of three (my assignment ids, then the tasks, then their workspaces).
  const tasks = unwrap(await sb.from('tasks')
    .select('id, organization_id, title, status, priority, due_at, mine:task_assignments!task_assignments_organization_id_task_id_fkey!inner(user_id), workspace:organizations!tasks_organization_id_fkey(id, name, slug)')
    .eq('mine.user_id', ctx.effective_user_id).is('deleted_at', null).not('status', 'in', '(done,canceled)')
    .order('due_at', { ascending: true, nullsFirst: false }).limit(limit)
    .overrideTypes<{ id: string; organization_id: string; title: string; status: string; priority: string; due_at: string | null;
      mine: unknown; workspace: { id: string; name: string; slug: string } | null }[], { merge: false }>());
  return tasks.map(({ mine: _mine, ...t }) => t);
});
