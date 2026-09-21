-- =============================================================================
-- 0107 WORKER INDEXES
--
-- The automation worker checks "has this task already had a task.overdue event?" once per overdue task, and picks
-- up delayed steps by run_after. Neither had an index, so both scanned tables that only ever grow.
-- =============================================================================

create index if not exists domain_events_entity_idx on public.domain_events (entity_id, event_type);

create index if not exists automation_run_steps_scheduled_idx on public.automation_run_steps (run_after)
  where status = 'scheduled';
