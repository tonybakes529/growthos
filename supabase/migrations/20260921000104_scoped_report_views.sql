-- =============================================================================
-- 0104 SCOPED REPORT VIEWS
--
-- The app always reads these views for one workspace (`.eq('organization_id', ...)`), but Postgres could
-- not apply that filter until after it had processed every row the caller can see. For a client that is
-- their whole history; for staff and the super admin it is every client's whole history, on every
-- scorecard, home and pipeline page load, growing week by week.
--
--   * kpi_entry_status_v: the previous-period window was partitioned by KPI only. A filter may only move
--     inside a window when it is on a partition column, so organization_id joins the partition. Each KPI
--     belongs to exactly one workspace (composite FK), so the partitions, and every value, are unchanged.
--   * kpi_latest_v: same reason for DISTINCT ON. Rows per workspace come back in the same order as before.
--   * org_growth_metrics_monthly_v: each of the six monthly roll-ups is used twice (the month spine and the
--     join), so Postgres materialized them in full before filtering. NOT MATERIALIZED lets the workspace and
--     month filters reach the base tables.
--
-- Output is identical (verified row for row against the live data before applying). Columns, names, types
-- and security_invoker are unchanged.
-- =============================================================================

create or replace view public.kpi_entry_status_v with (security_invoker = true) as
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
window w as (partition by e.organization_id, e.kpi_definition_id order by e.period_start);

create or replace view public.kpi_latest_v with (security_invoker = true) as
select distinct on (organization_id, kpi_definition_id) *
from public.kpi_entry_status_v
order by organization_id, kpi_definition_id, period_start desc;

create or replace view public.org_growth_metrics_monthly_v with (security_invoker = true) as
with
leads as not materialized (
  select organization_id, date_trunc('month', first_touch_at)::date m, count(*) leads,
         count(*) filter (where inbound) inbound_leads, count(*) filter (where not inbound) outbound_leads
  from public.leads where deleted_at is null group by 1, 2),
appts as not materialized (
  select organization_id, date_trunc('month', scheduled_start)::date m,
         count(*) filter (where status not in ('canceled')) booked,
         count(*) filter (where status = 'showed') showed,
         count(*) filter (where status in ('showed', 'no_show')) held_or_noshow
  from public.appointments where deleted_at is null group by 1, 2),
wins as not materialized (
  select organization_id, date_trunc('month', closed_at)::date m,
         count(*) filter (where status = 'won') closes,
         sum(value_cents) filter (where status = 'won') contracted_cents
  from public.opportunities where deleted_at is null and closed_at is not null group by 1, 2),
cash as not materialized (
  select organization_id, date_trunc('month', paid_at)::date m,
         sum(amount_cents - refunded_cents) filter (where status in ('succeeded', 'partially_refunded')) cash_cents
  from public.payment_records where paid_at is not null group by 1, 2),
spend as not materialized (
  select organization_id, date_trunc('month', spend_date)::date m, sum(amount_cents) spend_cents
  from public.marketing_spend group by 1, 2),
content as not materialized (
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
