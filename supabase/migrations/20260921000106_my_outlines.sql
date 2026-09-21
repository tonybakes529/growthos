-- =============================================================================
-- 0106 MY OUTLINES
--
-- A student's home page shows "what to do next", which needs the outline of each course they are taking. It had
-- to load the course list first and only then ask for each outline: two rounds before the page could render.
-- This returns the outline of every active course the caller is enrolled in, in one request that can go out
-- alongside the course list.
--
-- Each outline comes from app.get_program_outline, so drip, sequencing and lock rules are exactly the ones the
-- course page applies. Only courses the caller can open are included (the same test get_program_outline
-- makes), so one inaccessible course never fails the whole request. Rows keep get_program_outline's order.
-- SECURITY INVOKER: the enrollments read here are filtered by the caller's row-level security.
-- =============================================================================

create or replace function app.get_my_outlines(p_org uuid)
returns table (
  program_id uuid, section_id uuid, section_title text, section_position integer, module_id uuid, module_title text,
  module_position integer, lesson_id uuid, lesson_title text, lesson_position integer, estimated_minutes integer,
  is_available boolean, unlocks_at timestamptz, lock_reason text, progress_status text, completed_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select e.program_id, o.section_id, o.section_title, o.section_position, o.module_id, o.module_title,
         o.module_position, o.lesson_id, o.lesson_title, o.lesson_position, o.estimated_minutes,
         o.is_available, o.unlocks_at, o.lock_reason, o.progress_status, o.completed_at
  from public.program_enrollments e
  cross join lateral app.get_program_outline(e.program_id) with ordinality o
  where e.organization_id = p_org
    and e.user_id = private.effective_user_id()
    and e.status = 'active'
    and e.program_id in (select private.my_enrolled_program_ids())
  order by e.program_id, o.ordinality;
$$;

revoke all on function app.get_my_outlines(uuid) from public, anon;
grant execute on function app.get_my_outlines(uuid) to authenticated, service_role;
