/**
 * The automations offered in the guided setup.
 *
 * Availability is decided by what the data model actually carries, not by what would be nice. A
 * template that cannot be built honestly is listed as unavailable with the reason, so nobody
 * configures something that will quietly do the wrong thing.
 *
 * No server-only imports: the page and the module both read this.
 */

export type FieldSpec = { key: string; label: string; required: boolean; hint?: string };

export type Template = {
  key: string;
  title: string;
  description: string;
  /** A Growth OS event that already exists and is already emitted. */
  eventType: string;
  app: 'slack' | 'google_calendar';
  appLabel: string;
  /** What the Zap needs from the person, once their app account is authorised. */
  setupFields: FieldSpec[];
  /** Event fields available to map into the message or the calendar entry. */
  eventFields: string[];
  available: boolean;
  /** Why not, in plain words. Shown on the card when available is false. */
  unavailableReason?: string;
};

export const TEMPLATES: Template[] = [
  {
    key: 'onboarding_completed_slack',
    title: 'Student finishes onboarding → Slack message',
    description: 'When a student submits their intake form, post to a channel so whoever picks them up knows.',
    eventType: 'customer.onboarding_completed',
    app: 'slack',
    appLabel: 'Slack',
    setupFields: [
      { key: 'workspace', label: 'Slack workspace', required: true, hint: 'Whichever workspace you authorised' },
      { key: 'channel', label: 'Channel', required: true, hint: 'Where the message goes' },
      { key: 'message', label: 'Message', required: true, hint: 'Use the event fields below' },
    ],
    eventFields: ['email', 'program_title', 'form_name', 'answers', 'responses', 'occurred_at'],
    available: true,
  },
  {
    key: 'coach_assigned_slack',
    title: 'Coach assigned to a student → Slack message',
    description: 'When someone assigns a coach, tell the coach or a channel who they just picked up.',
    eventType: 'coach.assigned',
    app: 'slack',
    appLabel: 'Slack',
    setupFields: [
      { key: 'workspace', label: 'Slack workspace', required: true },
      { key: 'channel', label: 'Channel or person', required: true },
      { key: 'message', label: 'Message', required: true },
    ],
    eventFields: ['student_name', 'student_email', 'coach_name', 'coach_email', 'occurred_at'],
    available: true,
  },
  {
    key: 'task_created_calendar',
    title: 'Task created → Google Calendar event',
    description: 'Put a scheduled task on a calendar so it is not only a list item.',
    eventType: 'task.created',
    app: 'google_calendar',
    appLabel: 'Google Calendar',
    setupFields: [
      { key: 'calendar', label: 'Calendar', required: true },
      { key: 'title', label: 'Event title', required: true },
    ],
    eventFields: ['title', 'due_at'],
    available: false,
    // Checked against the tasks table: it has title, description and due_at, and nothing else.
    unavailableReason:
      'A calendar entry needs a start, an end and a timezone. A task carries only a due date and time, '
      + 'so an end would have to be invented and the timezone guessed. Coaching sessions do hold a real '
      + 'start and end, so this becomes possible if sessions are wired up as a trigger.',
  },
];

export const templateByKey = (key: string) => TEMPLATES.find((t) => t.key === key) ?? null;
