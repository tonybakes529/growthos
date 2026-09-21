-- =============================================================================
-- 0105 WORKSPACE COUNTS
--
-- The workspace home and activity pages downloaded every customer record, every enrollment and every open deal
-- just to show a handful of numbers, so they slowed down as a client's business grew (and would have gone wrong
-- past the API's 1,000-row cap). This returns those numbers in one request.
--
-- SECURITY INVOKER: every count runs under the caller's row-level security, exactly like the queries it replaces,
-- so nobody can count rows they could not already read.
-- =============================================================================

create or replace function app.workspace_counts(p_org uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'customers', c.total, 'invited', c.invited, 'joined', c.joined, 'completed', c.completed,
    'new_30d', c.new_30d, 'completed_30d', c.completed_30d, 'unfinished_with_form', c.unfinished_with_form,
    'enrolled', e.enrolled, 'avg_progress', e.avg_progress,
    'open_deals', d.open_deals, 'open_value_cents', d.open_value_cents
  )
  from (
    select count(*) as total,
           count(*) filter (where co.status = 'invited') as invited,
           count(*) filter (where co.status <> 'invited') as joined,
           count(*) filter (where co.status = 'completed') as completed,
           count(*) filter (where co.invited_at >= now() - interval '30 days') as new_30d,
           count(*) filter (where co.completed_at >= now() - interval '30 days') as completed_30d,
           -- "not finished onboarding" only counts when their course has a form to fill in
           count(*) filter (where co.status in ('registered', 'in_progress')
                              and p.onboarding_form_id is not null and p.deleted_at is null) as unfinished_with_form
    from public.customer_onboardings co
    left join public.programs p on p.id = co.program_id
    where co.organization_id = p_org
  ) c,
  (
    select count(*) as enrolled, round(avg(pe.progress_percent)) as avg_progress
    from public.program_enrollments pe
    where pe.organization_id = p_org and pe.status in ('active', 'completed')
  ) e,
  (
    select count(*) as open_deals, coalesce(sum(o.value_cents), 0) as open_value_cents
    from public.opportunities o
    where o.organization_id = p_org and o.status = 'open' and o.deleted_at is null
  ) d;
$$;

revoke all on function app.workspace_counts(uuid) from public, anon;
grant execute on function app.workspace_counts(uuid) to authenticated, service_role;
