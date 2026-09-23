-- =============================================================================
-- 0115 STUDENT KPI TRACKER: THE NUMBERS
--
-- Resolves a student's week. Three kinds of row, matching the colours in the
-- spreadsheet this replaces:
--
--   manual     typed by the student. In practice only Ad Spend, which is read
--              out of Meta Business Suite and cannot be counted from anything.
--   counted    counted from that week's lead log.
--   calculated a formula over the other rows, using the formula jsonb that has
--              been on kpi_definitions since 0007 and was never evaluated.
--
-- Only typed values are stored. Counted and calculated rows are resolved on
-- read, so a corrected lead moves the dashboard in the same request and there
-- is nothing to recompute and nothing to go stale.
-- =============================================================================

comment on column public.kpi_definitions.source_spec is
  'For entry_method = counted. {"count":"leads|answered|qualified|booked|taken|converted"}, {"sum":"cash|revenue"}, or {"objection":"<lost_reason id>"}.';

-- ---------------------------------------------------------------------------
-- The evaluator
-- ---------------------------------------------------------------------------
create or replace function private.tracker_rows(p_org uuid, p_user uuid, p_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  agg  record;
  r    record;
  vals jsonb := '{}'::jsonb;          -- kpi key -> value, so formulas can name other rows
  out  jsonb := '[]'::jsonb;
  v    numeric;
  num  numeric;
  den  numeric;
  spec jsonb;
  f    jsonb;
begin
  -- one pass over the week's leads gives every counted row its number
  select count(*)::numeric                                   as leads,
         count(*) filter (where answered)::numeric           as answered,
         count(*) filter (where qualified)::numeric          as qualified,
         count(*) filter (where booked)::numeric             as booked,
         count(*) filter (where taken)::numeric              as taken,
         count(*) filter (where converted)::numeric          as converted,
         (coalesce(sum(cash_collected_cents), 0) / 100.0)    as cash,
         (coalesce(sum(revenue_cents), 0) / 100.0)           as revenue
  into agg
  from public.student_leads
  where organization_id = p_org and user_id = p_user and deleted_at is null
    and captured_on >= p_week and captured_on < p_week + 7;

  -- pass 1: everything a formula might refer to
  for r in
    select k.id, k.key, k.entry_method, k.source_spec
    from public.kpi_definitions k
    join public.scorecard_kpis sk on sk.kpi_definition_id = k.id
    join public.scorecards s on s.id = sk.scorecard_id
    where s.organization_id = p_org and s.scope = 'student' and s.deleted_at is null and s.is_active
      and k.deleted_at is null and k.is_active and k.entry_method <> 'calculated'
  loop
    v := null;
    if r.entry_method = 'counted' then
      spec := coalesce(r.source_spec, '{}'::jsonb);
      v := case
        when spec ? 'objection' then (
          select count(*)::numeric from public.student_leads l
          where l.organization_id = p_org and l.user_id = p_user and l.deleted_at is null
            and l.captured_on >= p_week and l.captured_on < p_week + 7
            and l.objection_id = (spec->>'objection')::uuid)
        when spec->>'sum' = 'cash'      then agg.cash
        when spec->>'sum' = 'revenue'   then agg.revenue
        when spec->>'count' = 'leads'     then agg.leads
        when spec->>'count' = 'answered'  then agg.answered
        when spec->>'count' = 'qualified' then agg.qualified
        when spec->>'count' = 'booked'    then agg.booked
        when spec->>'count' = 'taken'     then agg.taken
        when spec->>'count' = 'converted' then agg.converted
        else null end;
    else
      select e.value into v from public.kpi_entries e
      where e.kpi_definition_id = r.id and e.period_start = p_week and e.user_id = p_user;
    end if;
    vals := vals || jsonb_build_object(r.key, v);
  end loop;

  -- pass 2: calculated rows, in order, so one may build on an earlier one
  for r in
    select k.id, k.key, k.formula
    from public.kpi_definitions k
    join public.scorecard_kpis sk on sk.kpi_definition_id = k.id
    join public.scorecards s on s.id = sk.scorecard_id
    where s.organization_id = p_org and s.scope = 'student' and s.deleted_at is null and s.is_active
      and k.deleted_at is null and k.is_active and k.entry_method = 'calculated'
    order by sk.position, k.position
  loop
    f := coalesce(r.formula, '{}'::jsonb);
    num := nullif(vals->>(f->>'numerator'), '')::numeric;
    den := nullif(vals->>(f->>'denominator'), '')::numeric;
    v := case f->>'op'
           when 'divide'   then case when den is null or den = 0 then null else num / den end
           when 'multiply' then num * den
           when 'add'      then num + den
           when 'subtract' then num - den
         end;
    if v is not null and (f ? 'multiply') then v := v * (f->>'multiply')::numeric; end if;
    vals := vals || jsonb_build_object(r.key, v);
  end loop;

  -- pass 3: the rows in the order the tracker shows them
  for r in
    select k.id, k.key, k.name, k.unit, k.entry_method, k.goal_value, k.direction, sk.position
    from public.kpi_definitions k
    join public.scorecard_kpis sk on sk.kpi_definition_id = k.id
    join public.scorecards s on s.id = sk.scorecard_id
    where s.organization_id = p_org and s.scope = 'student' and s.deleted_at is null and s.is_active
      and k.deleted_at is null and k.is_active
    order by sk.position, k.position
  loop
    v := nullif(vals->>r.key, '')::numeric;
    out := out || jsonb_build_object(
      'kpi_id', r.id, 'key', r.key, 'name', r.name, 'unit', r.unit,
      'entry_method', r.entry_method, 'goal_value', r.goal_value, 'direction', r.direction,
      'value', v,
      'status', case when v is null or r.goal_value is null then null
                     else private.kpi_status(v, r.goal_value, r.direction, 90, 75) end);
  end loop;
  return out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading a tracker. p_user null means "mine", which needs no permission at
-- all: a student holds none, and granting them one would flip them out of the
-- learner navigation (isLearner in src/lib/auth/context.ts).
-- ---------------------------------------------------------------------------
create or replace function app.get_tracker(p_slug text, p_week date default current_date, p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid    uuid := private.require_user();
  target uuid;
  o      public.organizations;
  card   public.scorecards;
  week   date := date_trunc('week', p_week)::date;
begin
  select * into o from public.organizations where slug = p_slug::extensions.citext;
  if o.id is null then return null; end if;
  target := coalesce(p_user, uid);

  if target <> uid then
    perform private.assert_permission(o.id, 'kpis.read');
  elsif not exists (select 1 from public.organization_memberships m
                    where m.organization_id = o.id and m.user_id = uid and m.status = 'active')
        and not private.has_permission(o.id, 'kpis.read') then
    raise exception 'tracker not found' using errcode = 'P0002';
  end if;

  select * into card from public.scorecards
  where organization_id = o.id and scope = 'student' and deleted_at is null and is_active
  order by created_at limit 1;

  return jsonb_build_object(
    'week_start', week,
    'week_end', week + 6,
    'scorecard', case when card.id is null then null else jsonb_build_object('id', card.id, 'name', card.name) end,
    'student', (select jsonb_build_object('user_id', u.id, 'email', u.email::text,
                        'name', coalesce(nullif(btrim(up.display_name), ''), u.email::text))
                from public.users u left join public.user_profiles up on up.user_id = u.id where u.id = target),
    'rows', case when card.id is null then '[]'::jsonb else private.tracker_rows(o.id, target, week) end,
    'leads', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', l.id, 'captured_on', l.captured_on, 'name', l.name, 'phone', l.phone,
                  'email', l.email::text, 'answered', l.answered, 'qualified', l.qualified,
                  'booked', l.booked, 'taken', l.taken, 'converted', l.converted,
                  'objection_id', l.objection_id,
                  'cash_collected', l.cash_collected_cents / 100.0, 'revenue', l.revenue_cents / 100.0,
                  'follow_up_attempts', l.follow_up_attempts, 'notes', l.notes)
                order by l.captured_on desc, l.created_at desc)
              from public.student_leads l
              where l.organization_id = o.id and l.user_id = target and l.deleted_at is null
                and l.captured_on >= week and l.captured_on < week + 7), '[]'::jsonb),
    -- the objection breakdown is a group-by, so editing the workspace's lost reasons changes it
    'objections', coalesce((select jsonb_agg(jsonb_build_object('id', lr.id, 'label', lr.label, 'count', c.n)
                    order by c.n desc, lr.label)
                  from public.lost_reasons lr
                  left join lateral (select count(*) as n from public.student_leads l
                                     where l.organization_id = o.id and l.user_id = target and l.deleted_at is null
                                       and l.captured_on >= week and l.captured_on < week + 7
                                       and l.objection_id = lr.id) c on true
                  where lr.organization_id = o.id and lr.is_active), '[]'::jsonb));   -- lost_reasons has no soft delete
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing. Same rule throughout: your own needs nothing, someone else's needs
-- kpis.update.
-- ---------------------------------------------------------------------------
create or replace function private.tracker_target(p_org uuid, p_user uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(); target uuid := coalesce(p_user, uid);
begin
  if target <> uid then
    perform private.assert_permission(p_org, 'kpis.update');
  elsif not exists (select 1 from public.organization_memberships m
                    where m.organization_id = p_org and m.user_id = uid and m.status = 'active')
        and not private.has_permission(p_org, 'kpis.update') then
    raise exception 'tracker not found' using errcode = 'P0002';
  end if;
  return target;
end;
$$;

create or replace function app.save_tracker_value(p_kpi_id uuid, p_week date, p_value numeric, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k      public.kpi_definitions;
  target uuid;
  week   date := date_trunc('week', p_week)::date;
begin
  select * into k from public.kpi_definitions where id = p_kpi_id and deleted_at is null;
  if k.id is null then raise exception 'KPI not found' using errcode = 'P0002'; end if;
  if k.entry_method <> 'manual' then
    raise exception '"%" is worked out from your leads, so it cannot be typed in', k.name;
  end if;
  target := private.tracker_target(k.organization_id, p_user);

  if p_value is null then
    delete from public.kpi_entries where kpi_definition_id = k.id and user_id = target and period_start = week;
  else
    insert into public.kpi_entries (organization_id, kpi_definition_id, user_id, period_start, period_end,
                                    value, target_value, source, entered_by)
    values (k.organization_id, k.id, target, week, week + 6, p_value, k.goal_value, 'manual', private.require_user())
    on conflict (kpi_definition_id, user_id, period_start) where user_id is not null do update
      set value = excluded.value, entered_by = excluded.entered_by;
  end if;
  return jsonb_build_object('kpi_id', k.id, 'week_start', week, 'value', p_value);
end;
$$;

-- p_lead: {id?, captured_on, name, phone, email, answered, qualified, booked, taken, converted,
--          objection_id, cash_collected, revenue, follow_up_attempts, notes}
create or replace function app.save_lead(p_org uuid, p_lead jsonb, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target uuid := private.tracker_target(p_org, p_user);
  lid    uuid := nullif(p_lead->>'id', '')::uuid;
  obj    uuid := nullif(p_lead->>'objection_id', '')::uuid;
  row    public.student_leads;
begin
  if obj is not null and not exists (select 1 from public.lost_reasons lr
                                     where lr.id = obj and lr.organization_id = p_org) then
    raise exception 'that objection is not on this workspace''s list';
  end if;

  if lid is null then
    insert into public.student_leads (
      organization_id, user_id, captured_on, name, phone, email,
      answered, qualified, booked, taken, converted, objection_id,
      cash_collected_cents, revenue_cents, follow_up_attempts, notes)
    values (
      p_org, target, coalesce(nullif(p_lead->>'captured_on', '')::date, current_date),
      nullif(btrim(p_lead->>'name'), ''), nullif(btrim(p_lead->>'phone'), ''),
      nullif(btrim(p_lead->>'email'), '')::extensions.citext,
      coalesce((p_lead->>'answered')::boolean, false), coalesce((p_lead->>'qualified')::boolean, false),
      coalesce((p_lead->>'booked')::boolean, false), coalesce((p_lead->>'taken')::boolean, false),
      coalesce((p_lead->>'converted')::boolean, false), obj,
      round(coalesce(nullif(p_lead->>'cash_collected', '')::numeric, 0) * 100),
      round(coalesce(nullif(p_lead->>'revenue', '')::numeric, 0) * 100),
      coalesce(nullif(p_lead->>'follow_up_attempts', '')::int, 0),
      nullif(btrim(p_lead->>'notes'), ''))
    returning * into row;
  else
    select * into row from public.student_leads where id = lid and deleted_at is null;
    if row.id is null or row.organization_id <> p_org then
      raise exception 'lead not found' using errcode = 'P0002';
    end if;
    -- editing someone else's row is the same decision as writing their numbers
    if row.user_id <> target then perform private.tracker_target(p_org, row.user_id); end if;
    update public.student_leads set
      captured_on = coalesce(nullif(p_lead->>'captured_on', '')::date, captured_on),
      name = nullif(btrim(p_lead->>'name'), ''), phone = nullif(btrim(p_lead->>'phone'), ''),
      email = nullif(btrim(p_lead->>'email'), '')::extensions.citext,
      answered = coalesce((p_lead->>'answered')::boolean, false),
      qualified = coalesce((p_lead->>'qualified')::boolean, false),
      booked = coalesce((p_lead->>'booked')::boolean, false),
      taken = coalesce((p_lead->>'taken')::boolean, false),
      converted = coalesce((p_lead->>'converted')::boolean, false),
      objection_id = obj,
      cash_collected_cents = round(coalesce(nullif(p_lead->>'cash_collected', '')::numeric, 0) * 100),
      revenue_cents = round(coalesce(nullif(p_lead->>'revenue', '')::numeric, 0) * 100),
      follow_up_attempts = coalesce(nullif(p_lead->>'follow_up_attempts', '')::int, 0),
      notes = nullif(btrim(p_lead->>'notes'), '')
    where id = row.id returning * into row;
  end if;
  return jsonb_build_object('id', row.id, 'captured_on', row.captured_on);
end;
$$;

create or replace function app.delete_lead(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  row public.student_leads;
begin
  select * into row from public.student_leads where id = p_lead_id and deleted_at is null;
  if row.id is null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if row.user_id <> uid then perform private.assert_permission(row.organization_id, 'kpis.update'); end if;
  update public.student_leads set deleted_at = now(), deleted_by = uid where id = row.id;
  return jsonb_build_object('id', row.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- The standard tracker, installed in one click. Rebuilding the client's
-- spreadsheet: Ad Spend typed, the funnel counted, the ratios calculated.
--
-- Every key is prefixed tracker_. kpi_definitions.key is unique per workspace, so
-- an unprefixed 'cash_collected' would collide with a KPI the client already keeps
-- on their weekly scorecard and the upsert would quietly rewrite it.
-- ---------------------------------------------------------------------------
create or replace function app.install_student_tracker(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  card uuid;
  r    record;
  kid  uuid;
  n    int := 0;
begin
  perform private.require_user();
  perform private.assert_permission(p_organization_id, 'kpis.create');

  select id into card from public.scorecards
  where organization_id = p_organization_id and scope = 'student' and deleted_at is null limit 1;
  if card is null then
    insert into public.scorecards (organization_id, name, description, frequency, scope)
    values (p_organization_id, 'Sales tracker',
            'Each student logs their leads and sees their own numbers for the week.', 'weekly', 'student')
    returning id into card;
  end if;

  -- the objections the sheet tracks, if the workspace has no list of its own yet
  insert into public.lost_reasons (organization_id, label, category)
  select p_organization_id, x.label, x.category
  from (values ('Time', 'timing'), ('Money', 'price'),
               ('Need to think about it', 'timing'), ('Partner', 'other')) as x(label, category)
  on conflict (organization_id, label) do nothing;

  for r in
    select * from (values
      ('tracker_ad_spend', 'Ad Spend', 'currency', 'manual', null::jsonb, null::jsonb),
      ('tracker_new_leads', 'New Leads', 'count', 'counted', '{"count":"leads"}'::jsonb, null),
      ('tracker_qualified_leads', 'Qualified Leads', 'count', 'counted', '{"count":"qualified"}'::jsonb, null),
      ('tracker_booked_calls', 'Booked Calls', 'count', 'counted', '{"count":"booked"}'::jsonb, null),
      ('tracker_cost_per_booked_call', 'Cost per Booked Call', 'currency', 'calculated', null, '{"op":"divide","numerator":"tracker_ad_spend","denominator":"tracker_booked_calls"}'::jsonb),
      ('tracker_sales_calls_taken', 'Sales Calls Taken', 'count', 'counted', '{"count":"taken"}'::jsonb, null),
      ('tracker_su_rate', 'Sales Call SU Rate', 'percent', 'calculated', null, '{"op":"divide","numerator":"tracker_sales_calls_taken","denominator":"tracker_booked_calls","multiply":100}'::jsonb),
      ('tracker_lead_to_call_cr', 'Lead to Sales Call CR', 'percent', 'calculated', null, '{"op":"divide","numerator":"tracker_booked_calls","denominator":"tracker_new_leads","multiply":100}'::jsonb),
      ('tracker_qualified_rate', 'Qualified Leads Per New Leads', 'percent', 'calculated', null, '{"op":"divide","numerator":"tracker_qualified_leads","denominator":"tracker_new_leads","multiply":100}'::jsonb),
      ('tracker_clients_converted', 'Clients Converted', 'count', 'counted', '{"count":"converted"}'::jsonb, null),
      ('tracker_cpa', 'Cost per Acquisition', 'currency', 'calculated', null, '{"op":"divide","numerator":"tracker_ad_spend","denominator":"tracker_clients_converted"}'::jsonb),
      ('tracker_cash_collected', 'Cash Collected', 'currency', 'counted', '{"sum":"cash"}'::jsonb, null),
      ('tracker_sales_value', 'Total Sales Value', 'currency', 'counted', '{"sum":"revenue"}'::jsonb, null),
      ('tracker_cash_roas', 'Cash ROAS', 'ratio', 'calculated', null, '{"op":"divide","numerator":"tracker_cash_collected","denominator":"tracker_ad_spend"}'::jsonb),
      ('tracker_sales_roas', 'Sales ROAS', 'ratio', 'calculated', null, '{"op":"divide","numerator":"tracker_sales_value","denominator":"tracker_ad_spend"}'::jsonb),
      ('tracker_close_rate', 'Close %', 'percent', 'calculated', null, '{"op":"divide","numerator":"tracker_clients_converted","denominator":"tracker_sales_calls_taken","multiply":100}'::jsonb)
    ) as v(key, name, unit, entry_method, source_spec, formula)
  loop
    insert into public.kpi_definitions (organization_id, key, name, category, unit, frequency,
                                        entry_method, source_spec, formula, position)
    values (p_organization_id, r.key, r.name, 'sales', r.unit, 'weekly',
            r.entry_method, r.source_spec, r.formula, n)
    on conflict (organization_id, key) do update
      set name = excluded.name, unit = excluded.unit, entry_method = excluded.entry_method,
          source_spec = excluded.source_spec, formula = excluded.formula, deleted_at = null
    returning id into kid;

    insert into public.scorecard_kpis (organization_id, scorecard_id, kpi_definition_id, position, is_required)
    values (p_organization_id, card, kid, n, false)
    on conflict (scorecard_id, kpi_definition_id) do update set position = excluded.position;
    n := n + 1;
  end loop;

  return jsonb_build_object('scorecard_id', card, 'rows', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function app.get_tracker(text, date, uuid), app.save_tracker_value(uuid, date, numeric, uuid),
                       app.save_lead(uuid, jsonb, uuid), app.delete_lead(uuid),
                       app.install_student_tracker(uuid) from public, anon;
grant execute on function app.get_tracker(text, date, uuid), app.save_tracker_value(uuid, date, numeric, uuid),
                          app.save_lead(uuid, jsonb, uuid), app.delete_lead(uuid),
                          app.install_student_tracker(uuid) to authenticated, service_role;

revoke all on function private.tracker_rows(uuid, uuid, date), private.tracker_target(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.tracker_rows(uuid, uuid, date), private.tracker_target(uuid, uuid) to service_role;
