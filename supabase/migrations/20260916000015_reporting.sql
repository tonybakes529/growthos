-- =============================================================================
-- 0015 REPORTING
-- All views use security_invoker = true, so the caller's RLS applies: a client
-- only ever aggregates its own rows, staff aggregate their assigned clients,
-- and the super admin aggregates everything.
-- =============================================================================

-- KPI entries with previous-period comparison and status.
create view public.kpi_entry_status_v with (security_invoker = true) as
select
  e.id, e.organization_id, e.kpi_definition_id, k.key as kpi_key, k.name as kpi_name, k.category, k.unit,
  k.frequency, k.direction, k.is_financial, k.owner_id,
  e.period_start, e.period_end, e.value, e.target_value, e.source, e.note,
  lag(e.value) over w as previous_value,
  case when lag(e.value) over w is not null and lag(e.value) over w <> 0
       then round(100 * (e.value - lag(e.value) over w) / abs(lag(e.value) over w), 2) end as change_percent,
  case when e.target_value > 0 then round(100 * e.value / e.target_value, 2) end as percent_of_target,
  private.kpi_status(e.value, e.target_value, k.direction, k.at_risk_threshold_pct, k.off_track_threshold_pct) as status
from public.kpi_entries e
join public.kpi_definitions k on k.id = e.kpi_definition_id
window w as (partition by e.kpi_definition_id order by e.period_start);

-- Latest value per KPI (for scorecard/overview tiles).
create view public.kpi_latest_v with (security_invoker = true) as
select distinct on (kpi_definition_id) *
from public.kpi_entry_status_v
order by kpi_definition_id, period_start desc;

-- Monthly growth metrics per org (the "growth operating system" core numbers).
create view public.org_growth_metrics_monthly_v with (security_invoker = true) as
with
leads as (
  select organization_id, date_trunc('month', first_touch_at)::date m, count(*) leads,
         count(*) filter (where inbound) inbound_leads, count(*) filter (where not inbound) outbound_leads
  from public.leads where deleted_at is null group by 1, 2),
appts as (
  select organization_id, date_trunc('month', scheduled_start)::date m,
         count(*) filter (where status not in ('canceled')) booked,
         count(*) filter (where status = 'showed') showed,
         count(*) filter (where status in ('showed', 'no_show')) held_or_noshow
  from public.appointments where deleted_at is null group by 1, 2),
wins as (
  select organization_id, date_trunc('month', closed_at)::date m,
         count(*) filter (where status = 'won') closes,
         sum(value_cents) filter (where status = 'won') contracted_cents
  from public.opportunities where deleted_at is null and closed_at is not null group by 1, 2),
cash as (
  select organization_id, date_trunc('month', paid_at)::date m,
         sum(amount_cents - refunded_cents) filter (where status in ('succeeded', 'partially_refunded')) cash_cents
  from public.payment_records where paid_at is not null group by 1, 2),
spend as (
  select organization_id, date_trunc('month', spend_date)::date m, sum(amount_cents) spend_cents
  from public.marketing_spend group by 1, 2),
content as (
  select organization_id, date_trunc('month', published_at)::date m, count(*) published
  from public.published_links group by 1, 2),
months as (
  select organization_id, m from leads union select organization_id, m from appts
  union select organization_id, m from wins union select organization_id, m from cash
  union select organization_id, m from spend union select organization_id, m from content)
select
  mo.organization_id, mo.m as month,
  coalesce(l.leads, 0) leads, coalesce(l.inbound_leads, 0) inbound_leads, coalesce(l.outbound_leads, 0) outbound_leads,
  coalesce(a.booked, 0) appointments_booked, coalesce(a.showed, 0) appointments_showed,
  round(100.0 * a.showed / nullif(a.held_or_noshow, 0), 1) show_rate_pct,
  coalesce(w.closes, 0) closes,
  round(100.0 * w.closes / nullif(a.showed, 0), 1) close_rate_pct,
  coalesce(w.contracted_cents, 0) contracted_revenue_cents,
  coalesce(c.cash_cents, 0) cash_collected_cents,
  s.spend_cents marketing_spend_cents,
  round(s.spend_cents::numeric / nullif(l.leads, 0)) cost_per_lead_cents,
  round(s.spend_cents::numeric / nullif(a.booked, 0)) cost_per_appointment_cents,
  round(s.spend_cents::numeric / nullif(w.closes, 0)) cac_cents,
  round(c.cash_cents::numeric / nullif(s.spend_cents, 0), 2) roas,
  coalesce(ct.published, 0) content_published
from months mo
left join leads l   on l.organization_id = mo.organization_id and l.m = mo.m
left join appts a   on a.organization_id = mo.organization_id and a.m = mo.m
left join wins w    on w.organization_id = mo.organization_id and w.m = mo.m
left join cash c    on c.organization_id = mo.organization_id and c.m = mo.m
left join spend s   on s.organization_id = mo.organization_id and s.m = mo.m
left join content ct on ct.organization_id = mo.organization_id and ct.m = mo.m;

create view public.sales_by_rep_monthly_v with (security_invoker = true) as
select o.organization_id, date_trunc('month', o.closed_at)::date as month, 'closer' as rep_type,
       o.closer_id as rep_id, c.display_name as rep_name,
       count(*) filter (where o.status = 'won') as closes, count(*) as decided,
       sum(o.value_cents) filter (where o.status = 'won') as contracted_cents,
       sum(o.cash_collected_cents) filter (where o.status = 'won') as cash_cents
from public.opportunities o join public.closers c on c.id = o.closer_id
where o.closed_at is not null and o.deleted_at is null
group by 1, 2, 4, 5
union all
select o.organization_id, date_trunc('month', o.closed_at)::date, 'setter', o.setter_id, s.display_name,
       count(*) filter (where o.status = 'won'), count(*),
       sum(o.value_cents) filter (where o.status = 'won'),
       sum(o.cash_collected_cents) filter (where o.status = 'won')
from public.opportunities o join public.setters s on s.id = o.setter_id
where o.closed_at is not null and o.deleted_at is null
group by 1, 2, 4, 5;

create view public.sales_by_offer_monthly_v with (security_invoker = true) as
select p.organization_id, date_trunc('month', p.purchased_at)::date as month, p.offer_id, o.name as offer_name,
       count(*) as purchases, sum(p.total_amount_cents) as contracted_cents, sum(p.amount_paid_cents) as paid_cents
from public.purchases p join public.offers o on o.id = p.offer_id
where p.deleted_at is null and p.status not in ('failed', 'canceled')
group by 1, 2, 3, 4;

create view public.program_completion_v with (security_invoker = true) as
select p.organization_id, p.id as program_id, p.title,
       count(e.id) as enrolled,
       count(e.id) filter (where e.status = 'active') as active,
       count(e.id) filter (where e.status = 'completed') as completed,
       round(avg(e.progress_percent), 1) as avg_progress_percent,
       round(100.0 * count(e.id) filter (where e.status = 'completed') / nullif(count(e.id), 0), 1) as completion_rate_pct,
       max(e.last_activity_at) as last_activity_at
from public.programs p
left join public.program_enrollments e on e.program_id = p.id and e.status <> 'revoked'
where p.deleted_at is null
group by p.organization_id, p.id, p.title;

create view public.content_performance_v with (security_invoker = true) as
select ci.organization_id, ci.id as content_item_id, ci.title, ci.format, pl.id as published_link_id,
       cp.platform, pl.url, pl.published_at,
       m.views, m.likes, m.comments, m.shares, m.saves, m.link_clicks, m.inbound_conversations, m.leads_generated,
       coalesce(m.likes, 0) + coalesce(m.comments, 0) + coalesce(m.shares, 0) + coalesce(m.saves, 0) as engagement,
       round(100.0 * (coalesce(m.likes, 0) + coalesce(m.comments, 0) + coalesce(m.shares, 0) + coalesce(m.saves, 0))
             / nullif(m.views, 0), 2) as engagement_rate_pct,
       m.captured_at as metrics_captured_at
from public.content_items ci
join public.published_links pl on pl.content_item_id = ci.id
join public.content_platforms cp on cp.id = pl.content_platform_id
left join lateral (select * from public.content_metrics cm where cm.published_link_id = pl.id
                   order by cm.captured_at desc limit 1) m on true
where ci.deleted_at is null;

create view public.team_performance_v with (security_invoker = true) as
select ta.organization_id, ta.user_id,
       count(*) filter (where t.status = 'done' and t.completed_at > now() - interval '30 days') as tasks_done_30d,
       count(*) filter (where t.status not in ('done', 'canceled') and t.due_at < now()) as tasks_overdue,
       count(*) filter (where t.status not in ('done', 'canceled')) as tasks_open
from public.task_assignments ta
join public.tasks t on t.id = ta.task_id and t.deleted_at is null
group by ta.organization_id, ta.user_id;

-- The super admin / staff control plane: one row per client they can see.
create view public.admin_client_overview_v with (security_invoker = true) as
select
  o.id as organization_id, o.name, o.slug, o.status, o.created_at,
  cp.industry, cp.tags, cp.start_date, cp.renewal_date, (cp.renewal_date - current_date) as days_to_renewal,
  cp.mrr_cents, cp.contract_value_cents, cp.current_monthly_revenue_cents, cp.revenue_target_cents,
  cp.account_manager_id, am.display_name as account_manager_name,
  cp.primary_coach_id, co.display_name as coach_name,
  cp.last_client_login_at, cp.last_kpi_update_at, cp.last_interaction_at, cp.onboarding_completed_at,
  hs.score as health_score, hs.band as health_band, hs.previous_score as previous_health_score, hs.calculated_at as health_calculated_at,
  (select round(avg(e.progress_percent), 1) from public.program_enrollments e
    where e.organization_id = o.id and e.status in ('active', 'completed')) as avg_program_progress,
  (select count(*) from public.tasks t where t.organization_id = o.id and t.deleted_at is null
    and t.status not in ('done', 'canceled') and t.due_at < now()) as overdue_tasks,
  (select count(*) from public.client_wins w where w.organization_id = o.id and w.deleted_at is null
    and w.occurred_on > current_date - 30) as wins_30d,
  (select w.title from public.client_wins w where w.organization_id = o.id and w.deleted_at is null
    order by w.occurred_on desc, w.created_at desc limit 1) as latest_win,
  (select count(*) from public.client_blockers b where b.organization_id = o.id and b.deleted_at is null
    and b.status in ('open', 'in_progress')) as open_blockers,
  (select min(s.scheduled_start) from public.coaching_sessions s where s.organization_id = o.id and s.deleted_at is null
    and s.status = 'scheduled' and s.scheduled_start > now()) as next_call_at,
  (hs.band in ('at_risk', 'critical')
    or cp.last_client_login_at < now() - interval '14 days'
    or cp.last_kpi_update_at < now() - interval '14 days'
    or (cp.renewal_date - current_date) between 0 and 30) as needs_attention
from public.organizations o
join public.client_profiles cp on cp.organization_id = o.id
left join public.user_profiles am on am.user_id = cp.account_manager_id
left join public.user_profiles co on co.user_id = cp.primary_coach_id
left join public.client_health_scores hs on hs.organization_id = o.id and hs.is_latest
where o.kind = 'client' and o.deleted_at is null
  and ((select private.is_platform_staff()) or (select private.is_super_admin()));

grant select on all tables in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Reporting RPCs (SECURITY INVOKER: RLS decides what is aggregated)
-- ---------------------------------------------------------------------------
create or replace function app.kpi_trend(p_kpi_definition_id uuid, p_from date, p_to date,
                                         p_granularity text default 'week')
returns table (bucket date, value numeric, target numeric, entries int)
language sql stable security invoker set search_path = '' as $$
  select date_trunc(p_granularity, e.period_start)::date,
         case k.aggregation when 'sum' then sum(e.value) when 'average' then avg(e.value)
                            when 'max' then max(e.value) when 'min' then min(e.value)
                            else (array_agg(e.value order by e.period_start desc))[1] end,
         case k.aggregation when 'sum' then sum(e.target_value) else avg(e.target_value) end,
         count(*)::int
  from public.kpi_entries e
  join public.kpi_definitions k on k.id = e.kpi_definition_id
  where e.kpi_definition_id = p_kpi_definition_id
    and e.period_start between p_from and p_to
    and p_granularity in ('week', 'month', 'quarter', 'year')
  group by 1, k.aggregation
  order by 1;
$$;

-- Current period vs the immediately preceding period of equal length, per KPI.
create or replace function app.kpi_period_comparison(p_organization_id uuid, p_from date, p_to date)
returns table (kpi_definition_id uuid, kpi_key text, kpi_name text, unit text, direction text,
               current_value numeric, previous_value numeric, change_percent numeric, target numeric, status text)
language sql stable security invoker set search_path = '' as $$
  with k as (
    select * from public.kpi_definitions
    where organization_id = p_organization_id and deleted_at is null and is_active
  ), agg as (
    select k.id,
      (select case k.aggregation when 'sum' then sum(value) when 'average' then avg(value) when 'max' then max(value)
                                 when 'min' then min(value) else (array_agg(value order by period_start desc))[1] end
       from public.kpi_entries e where e.kpi_definition_id = k.id and e.period_start between p_from and p_to) cur,
      (select case k.aggregation when 'sum' then sum(value) when 'average' then avg(value) when 'max' then max(value)
                                 when 'min' then min(value) else (array_agg(value order by period_start desc))[1] end
       from public.kpi_entries e where e.kpi_definition_id = k.id
         and e.period_start between p_from - (p_to - p_from + 1) and p_from - 1) prev,
      (select case k.aggregation when 'sum' then sum(target_value) else avg(target_value) end
       from public.kpi_entries e where e.kpi_definition_id = k.id and e.period_start between p_from and p_to) tgt
    from k
  )
  select k.id, k.key, k.name, k.unit, k.direction, a.cur, a.prev,
         case when a.prev is not null and a.prev <> 0 then round(100 * (a.cur - a.prev) / abs(a.prev), 2) end,
         a.tgt,
         private.kpi_status(a.cur, a.tgt, k.direction, k.at_risk_threshold_pct, k.off_track_threshold_pct)
  from k join agg a on a.id = k.id
  order by k.position, k.name;
$$;

create or replace function app.platform_metrics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_super_admin();
  return (
    select jsonb_build_object(
      'clients_total', count(*),
      'clients_by_status', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.organizations
                             where kind = 'client' and deleted_at is null group by status) s),
      'mrr_cents', coalesce(sum(cp.mrr_cents) filter (where o.status in ('active', 'onboarding', 'paused')), 0),
      'client_revenue_under_management_cents', coalesce(sum(cp.current_monthly_revenue_cents), 0),
      'at_risk_clients', count(*) filter (where hs.band in ('at_risk', 'critical')),
      'renewals_next_30d', count(*) filter (where cp.renewal_date between current_date and current_date + 30),
      'avg_health_score', round(avg(hs.score), 1)
    )
    from public.organizations o
    join public.client_profiles cp on cp.organization_id = o.id
    left join public.client_health_scores hs on hs.organization_id = o.id and hs.is_latest
    where o.kind = 'client' and o.deleted_at is null
  );
end;
$$;

revoke all on function app.kpi_trend(uuid, date, date, text), app.kpi_period_comparison(uuid, date, date), app.platform_metrics() from public, anon;
grant execute on function app.kpi_trend(uuid, date, date, text), app.kpi_period_comparison(uuid, date, date), app.platform_metrics() to authenticated;
