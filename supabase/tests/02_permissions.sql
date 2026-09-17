-- Role permissions, financial gating, anti-elevation, staff-only data.
begin;
set local role authenticated;

-- Client team member ---------------------------------------------------------------
select tests.login('sam@apexroofing.test');
do $$
declare apex uuid := tests.org('apex-roofing');
begin
  perform tests.eq((select count(*) from kpi_definitions where key = 'cash_collected'), 0::bigint, 'team member cannot see financial KPI');
  perform tests.eq((select count(*) from kpi_entry_status_v where kpi_key = 'cash_collected'), 0::bigint, 'nor its entries via view');
  perform tests.eq((select count(*) from kpi_definitions where key = 'leads_generated'), 1::bigint, 'team member sees operational KPI');
  perform tests.eq((select count(*) from marketing_spend), 0::bigint, 'team member cannot see spend');
  perform tests.eq((select count(*) from purchases), 0::bigint, 'team member cannot see purchases');
  perform tests.eq((select count(*) from client_profiles), 0::bigint, 'team member cannot see commercial profile');
  perform tests.eq((select count(*) from client_health_scores), 0::bigint, 'team member cannot see health');
  perform tests.eq((select count(*) from tasks where visibility = 'staff'), 0::bigint, 'team member cannot see staff tasks');
  perform tests.eq((select count(*) from audit_logs), 0::bigint, 'team member cannot read audit log');
  perform tests.throws(format($q$select app.invite_member(%L, 'x@y.test', 'student')$q$, apex), 'permission denied', 'team member invites');
end $$;

do $$
declare apex uuid := tests.org('apex-roofing'); r jsonb;
begin
  -- team member CAN submit operational KPIs but not financial ones
  r := app.upsert_kpi_entry((select id from kpi_definitions where key = 'leads_generated'), current_date, 44);
  perform tests.eq(r->>'value', '44', 'team member submits leads');
  perform tests.throws(format($q$select app.upsert_kpi_entry(%L, current_date, 1)$q$,
    (select id from public.kpi_definitions where organization_id = apex and key = 'cash_collected' limit 1)),
    'permission denied', 'team member submits financial KPI');
  perform tests.throws(format($q$select app.soft_delete('contacts', (select id from contacts limit 1))$q$), 'permission denied', 'team member deletes contact');
end $$;

-- Client admin -----------------------------------------------------------------------
select tests.login('jake@apexroofing.test');
do $$
declare
  apex uuid := tests.org('apex-roofing');
  sam  uuid := tests.uid('sam@apexroofing.test');
  jake uuid := tests.uid('jake@apexroofing.test');
  mid  uuid;
begin
  perform tests.eq((select count(*) from tasks where visibility = 'staff'), 0::bigint, 'client admin cannot see staff tasks');
  perform tests.eq((select count(*) from client_health_scores), 0::bigint, 'client admin cannot see health scores');
  perform tests.ok((select count(*) from kpi_definitions where is_financial) > 0, 'client admin sees financial KPIs');
  perform tests.ok((select count(*) from audit_logs) > 0, 'client admin reads own audit log');

  -- no direct writes to access-control tables
  perform tests.throws(format($q$insert into organization_memberships (organization_id, user_id, role_id)
    values (%L, %L, (select id from roles where key = 'client_admin'))$q$, apex, sam), 'row-level security', 'direct membership insert');
  update organization_memberships set role_id = (select id from roles where key = 'client_admin') where user_id = sam;
  perform tests.eq((select r.key from organization_memberships m join roles r on r.id = m.role_id where m.user_id = sam),
                   'client_team_member', 'direct role update had no effect');
  perform tests.throws($q$insert into platform_staff (user_id, role_id) select auth.uid(), id from roles where key = 'super_admin'$q$,
                       'row-level security', 'self-promotion to super admin');

  -- anti-elevation through RPCs
  select id into mid from organization_memberships where user_id = jake;
  perform tests.throws(format($q$select app.change_member_role(%L, 'client_team_member')$q$, mid), 'your own role', 'change own role');
  perform tests.throws(format($q$select app.set_permission_override(%L, %L, 'health.read', 'grant')$q$, apex, sam),
                       'do not hold health.read', 'grant a permission you lack');
  perform tests.throws(format($q$select app.set_permission_override(%L, %L, 'health.read', 'grant')$q$, apex, jake),
                       'your own permissions', 'override yourself');
  perform tests.throws(format($q$select app.upsert_custom_role(%L, 'spy', 'Spy', array['health.read'])$q$, apex),
                       'do not hold', 'custom role with elevated permission');
  perform tests.throws(format($q$select app.upsert_custom_role(%L, 'super_admin', 'x', array['tasks.read'])$q$, apex),
                       'reserved', 'custom role shadowing a system key');

  -- platform-controlled columns
  perform tests.throws(format($q$update organizations set status = 'archived' where id = %L$q$, apex), 'super admin', 'client changes org status');
  perform tests.throws(format($q$update client_profiles set mrr_cents = 1 where organization_id = %L$q$, apex), 'managed by the platform', 'client edits MRR');
  update client_profiles set industry = 'Roofing & gutters' where organization_id = apex;
  perform tests.eq((select industry from client_profiles where organization_id = apex), 'Roofing & gutters', 'client edits business facts');

  -- legitimate delegation: grant sam financial visibility, then deny KPIs entirely
  perform app.set_permission_override(apex, sam, 'financials.read', 'grant', 'Sam runs payroll reports');
  perform tests.ok(private.has_permission(apex, 'financials.read'), 'jake still has it');
end $$;

select tests.login('sam@apexroofing.test');
do $$ begin
  perform tests.eq((select count(*) from kpi_definitions where key = 'cash_collected'), 1::bigint, 'grant override reveals financial KPI');
end $$;

select tests.login('jake@apexroofing.test');
select app.set_permission_override(tests.org('apex-roofing'), tests.uid('sam@apexroofing.test'), 'kpis.read', 'deny');
select tests.login('sam@apexroofing.test');
do $$ begin
  perform tests.eq((select count(*) from kpi_definitions), 0::bigint, 'deny override hides all KPIs');
end $$;

-- Custom role within bounds works
select tests.login('jake@apexroofing.test');
do $$
declare apex uuid := tests.org('apex-roofing'); rid uuid;
begin
  rid := app.upsert_custom_role(apex, 'estimator', 'Estimator', array['contacts.read', 'sales.read', 'sales.update', 'tasks.read']);
  perform tests.eq((select count(*) from role_permissions where role_id = rid), 4::bigint, 'custom role saved');
  perform tests.ok((app.invite_member(apex, 'new.estimator@apexroofing.test', 'estimator')->>'token') is not null, 'invite with custom role');
end $$;

-- Staff roles -----------------------------------------------------------------------
select tests.login('maria@growthos.test');
do $$
declare apex uuid := tests.org('apex-roofing');
begin
  perform tests.ok((select count(*) from tasks where visibility = 'staff') > 0, 'coach sees staff tasks');
  perform tests.ok((select count(*) from client_health_score_components where organization_id = apex) > 0, 'coach sees health components');
  perform tests.ok((app.calculate_health_score(apex)->>'score') is not null, 'coach recalculates health');
  perform tests.throws(format($q$select app.set_organization_status(%L, 'suspended')$q$, apex), 'super admin', 'coach suspends client');
  perform tests.throws(format($q$select app.assign_team_member(%L, %L, 'account_manager')$q$, apex, auth.uid()),
                       null, 'coach assigns staff');
  perform tests.throws($q$select app.apply_templates_bulk('[]', '{}')$q$, 'super admin', 'coach bulk-applies templates');
  perform tests.throws($q$select app.start_impersonation(tests.uid('jake@apexroofing.test'), null, 'debugging issue')$q$,
                       'super admin', 'coach impersonates');
end $$;

select tests.login('jake@apexroofing.test');
do $$ begin
  perform tests.throws(format($q$select app.calculate_health_score(%L)$q$, tests.org('apex-roofing')), 'permission denied', 'client runs health score');
end $$;

-- Student ----------------------------------------------------------------------------
select tests.login('ari@northstarfit.test');
do $$
begin
  perform tests.eq((select count(*) from programs), 1::bigint, 'student sees only enrolled program');
  perform tests.eq((select slug from programs), 'onboarding-bootcamp', 'student program is the bootcamp');
  perform tests.eq((select count(*) from kpi_definitions), 0::bigint, 'student sees no KPIs');
  perform tests.eq((select count(*) from contacts), 0::bigint, 'student sees no contacts');
  perform tests.eq((select count(*) from quiz_answer_keys), 0::bigint, 'student cannot read answer keys');
  perform tests.eq((select count(*) from dashboards), 0::bigint, 'student sees no org dashboards');
  perform tests.eq((select count(*) from organization_memberships), 1::bigint, 'student sees only own membership');
  perform tests.ok((select count(*) from coaching_sessions) = 1, 'student sees program group call');
  perform tests.throws(format($q$insert into lesson_progress (organization_id, enrollment_id, lesson_id, user_id, status)
    select organization_id, id, (select id from lessons limit 1), user_id, 'completed' from program_enrollments limit 1$q$),
    'row-level security', 'student forges progress');
end $$;

select 'permissions ok' as result;
rollback;
