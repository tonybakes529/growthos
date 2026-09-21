/** Tables are whitelisted by private.rls_registry in the database; this list only shapes the UI contract. */
export const SOFT_DELETE_TABLES = [
  'contacts', 'notes', 'files', 'offers', 'pricing_options', 'coupons', 'order_forms', 'purchases', 'programs',
  'program_sections', 'modules', 'lessons', 'resources', 'assignments', 'quizzes', 'recurring_calls', 'coaching_sessions',
  'session_notes', 'call_recordings', 'action_items', 'client_wins', 'client_blockers', 'milestones', 'goals',
  'kpi_definitions', 'quarterly_goals', 'scorecards', 'dashboards', 'growth_projects', 'experiments', 'tasks',
  'task_comments', 'standard_operating_procedures', 'meeting_agendas', 'meeting_notes', 'decisions', 'pipelines',
  'leads', 'opportunities', 'appointments', 'sales_calls', 'sales_notes', 'setter_assets', 'lead_magnets', 'content_ideas',
  'content_items', 'scripts', 'announcements', 'discussions', 'discussion_comments', 'direct_messages', 'automations',
  'webhook_endpoints',
] as const;
