/** Event names emitted by the database (public.domain_events.event_type). */
export const TRIGGER_TYPES = [
  'client.invited', 'client.created', 'client.inactive', 'client.at_risk', 'client.status_changed', 'member.joined',
  'enrollment.created', 'lesson.completed', 'program.completed', 'assignment.submitted', 'assignment.reviewed',
  'kpi.submitted', 'kpi.missed', 'task.created', 'task.overdue', 'task.completed', 'call.completed',
  'goal.achieved', 'payment.succeeded', 'payment.failed', 'subscription.canceled', 'questionnaire.submitted',
  'customer.invited', 'customer.registered', 'customer.onboarding_started', 'customer.onboarding_completed',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const ACTION_TYPES = [
  'send_email', 'send_notification', 'create_task', 'assign_program', 'unlock_lesson', 'notify_coach',
  'update_client_status', 'add_tag', 'remove_tag', 'create_follow_up', 'trigger_webhook', 'wait',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type DomainEvent = {
  id: number;
  organization_id: string | null;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type Condition = { field: string; operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'contains' | 'exists'; value: unknown; group_key: number };

/** Recipient selectors usable in action config: {"recipient": "subject_user" | "coach" | ...} */
export type Recipient = 'subject_user' | 'actor' | 'coach' | 'account_manager' | 'client_admins' | 'assigned_staff' | { user_id: string };
