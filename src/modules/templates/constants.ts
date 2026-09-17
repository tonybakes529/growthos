export const TEMPLATE_TYPES = ['program', 'lesson', 'scorecard', 'dashboard', 'task', 'sop', 'offer', 'pipeline'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];
