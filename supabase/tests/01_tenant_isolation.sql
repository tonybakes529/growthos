-- Tenant isolation: nobody sees or writes another workspace's data.
begin;
set local role authenticated;

-- Client admin of Apex -----------------------------------------------------------
select tests.login('jake@apexroofing.test');
do $$
declare apex uuid := tests.org('apex-roofing'); north uuid := tests.org('northstar-fitness');
begin
  perform tests.eq((select count(*) from organizations), 1::bigint, 'jake sees exactly one org');
  perform tests.eq((select slug::text from organizations), 'apex-roofing', 'jake sees apex');
  perform tests.eq((select count(*) from programs where organization_id <> apex), 0::bigint, 'no foreign programs');
  perform tests.eq((select count(*) from kpi_entries where organization_id <> apex), 0::bigint, 'no foreign kpi entries');
  perform tests.eq((select count(*) from contacts where organization_id <> apex), 0::bigint, 'no foreign contacts');
  perform tests.eq((select count(*) from tasks where organization_id <> apex), 0::bigint, 'no foreign tasks');
  perform tests.eq((select count(*) from audit_logs where organization_id is distinct from apex), 0::bigint, 'no foreign audit rows');
  perform tests.eq((select count(*) from template_applications), 0::bigint, 'clients cannot read template application log');
  perform tests.eq((select count(*) from program_templates), 0::bigint, 'clients cannot read template library registry');
  perform tests.ok((select count(*) from contacts) > 0, 'jake sees apex contacts');

  -- users visible: apex members + staff assigned to apex; never Lena/Ari/Omar
  perform tests.eq((select count(*) from users where email in ('lena@northstarfit.test', 'ari@northstarfit.test', 'omar@clearpath.test')),
                   0::bigint, 'no foreign users');
  perform tests.ok((select count(*) from users where email = 'maria@growthos.test') = 1, 'assigned coach is visible');

  -- forged tenant id on insert
  perform tests.throws(format($q$insert into contacts (organization_id, first_name) values (%L, 'x')$q$, north),
                       'row-level security', 'insert into another org');
  -- updates to other tenants silently touch nothing
  update contacts set first_name = 'hacked' where organization_id = north;
  -- tenant key is immutable
  perform tests.throws(format($q$update contacts set organization_id = %L where organization_id = %L$q$, north, apex),
                       null, 'move a row to another org');
  -- RPCs refuse foreign org ids
  perform tests.throws(format($q$select app.create_task(%L, 'x')$q$, north), 'permission denied', 'create_task in another org');
  perform tests.throws(format($q$select app.invite_member(%L, 'evil@x.test', 'client_admin')$q$, north), 'permission denied', 'invite into another org');
  perform tests.throws($q$select app.get_org_context('northstar-fitness')$q$, 'not found', 'resolve foreign slug');
  perform tests.throws(format($q$select app.enroll_user(%L, (select id from programs limit 1), %L)$q$, north, tests.uid('jake@apexroofing.test')),
                       'permission denied', 'enroll in another org');
end $$;

-- Northstar admin cannot see Apex ------------------------------------------------
select tests.login('lena@northstarfit.test');
do $$
begin
  perform tests.eq((select count(*) from organizations), 1::bigint, 'lena sees one org');
  perform tests.eq((select count(*) from contacts where first_name = 'hacked'), 0::bigint, 'jake update did not leak');
  perform tests.eq((select count(*) from opportunities), 0::bigint, 'lena sees no apex opportunities');
  perform tests.eq((select count(*) from marketing_spend), 0::bigint, 'lena sees no apex spend');
end $$;

-- Assigned staff -----------------------------------------------------------------
select tests.login('devon@growthos.test');
do $$
begin
  perform tests.eq((select count(*) from organizations where kind = 'client'), 3::bigint, 'account manager sees 3 assigned clients');
  perform tests.eq((select count(*) from organizations where kind = 'platform'), 0::bigint, 'staff do not see the platform org');
  perform tests.eq((select count(*) from admin_client_overview_v), 3::bigint, 'overview shows assigned clients');
end $$;

select tests.login('maria@growthos.test');
do $$
declare clear uuid := tests.org('clearpath-consulting');
begin
  perform tests.eq((select count(*) from organizations where kind = 'client'), 2::bigint, 'coach sees only her 2 clients');
  perform tests.eq((select count(*) from programs where organization_id = clear), 0::bigint, 'coach cannot see unassigned client programs');
  perform tests.throws($q$select app.get_org_context('clearpath-consulting')$q$, 'not found', 'coach resolves unassigned slug');
  perform tests.eq((select count(*) from admin_client_overview_v), 2::bigint, 'coach overview limited to assignments');
end $$;

-- Super admin sees everything ----------------------------------------------------
select tests.login('owner@growthos.test');
do $$
begin
  perform tests.eq((select count(*) from organizations), 5::bigint, 'super admin sees all orgs');
  perform tests.eq((select count(*) from admin_client_overview_v), 3::bigint, 'super admin overview has all clients');
  perform tests.ok((app.platform_metrics()->>'clients_total')::int = 3, 'platform metrics');
end $$;

-- Anonymous sees nothing -----------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
begin
  perform tests.eq((select count(*) from organizations), 0::bigint, 'anon orgs');
  perform tests.eq((select count(*) from programs), 0::bigint, 'anon programs');
  perform tests.eq((select count(*) from users), 0::bigint, 'anon users');
  perform tests.throws($q$select app.get_my_workspaces()$q$, 'permission denied', 'anon cannot call workflows');
end $$;
reset role;

-- Composite FKs block cross-tenant parent links even for the service role --------
do $$
begin
  perform tests.throws(format($q$insert into lessons (organization_id, program_id, module_id, title)
    select %L, m.program_id, m.id, 'cross' from modules m where m.organization_id = %L limit 1$q$,
    tests.org('apex-roofing'), tests.org('northstar-fitness')), 'foreign key', 'cross-tenant lesson→module');
  perform tests.throws(format($q$insert into opportunities (organization_id, pipeline_id, stage_id, contact_id, title)
    select %L, p.id, s.id, c.id, 'x' from pipelines p join pipeline_stages s on s.pipeline_id = p.id, contacts c
    where p.organization_id = %L and c.organization_id = %L limit 1$q$,
    tests.org('northstar-fitness'), tests.org('northstar-fitness'), tests.org('apex-roofing')), 'foreign key', 'cross-tenant contact on opportunity');
end $$;

select 'tenant isolation ok' as result;
rollback;
