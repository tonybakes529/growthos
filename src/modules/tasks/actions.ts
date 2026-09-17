import 'server-only';

import { z } from 'zod';
import { action, zId, zSlug } from '@/lib/action';
import { requireOrg, assertCan } from '@/lib/auth/context';
import { requireSession } from '@/lib/auth/session';
import { unwrap } from '@/lib/errors';

const zStatus = z.enum(['todo', 'in_progress', 'blocked', 'in_review', 'done', 'canceled']);

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
    let q = ctx.sb.from('tasks')
      .select('id, title, status, priority, task_type, visibility, due_at, completed_at, related_type, related_id, growth_project_id, parent_task_id, created_at')
      .eq('organization_id', ctx.organizationId).is('deleted_at', null);
    if (i.mine) {
      const mine = unwrap(await ctx.sb.from('task_assignments').select('task_id').eq('user_id', ctx.ctx.effective_user_id));
      q = q.in('id', mine.map((m) => m.task_id));
    }
    if (i.statuses?.length) q = q.in('status', i.statuses);
    if (i.overdueOnly) q = q.lt('due_at', new Date().toISOString()).not('status', 'in', '(done,canceled)');
    const tasks = unwrap(await q.order('due_at', { ascending: true, nullsFirst: false }).limit(i.limit));
    const assignments = tasks.length
      ? unwrap(await ctx.sb.from('task_assignments').select('task_id, user_id').in('task_id', tasks.map((t) => t.id)))
      : [];
    return tasks.map((t) => ({ ...t, assigneeIds: assignments.filter((a) => a.task_id === t.id).map((a) => a.user_id) }));
  },
);
