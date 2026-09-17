-- Pin search_path on the remaining helper functions (Supabase security advisor 0011)
alter function private.bypass_org_guard() set search_path = '';
alter function private.end_org_guard_bypass() set search_path = '';
alter function private.kpi_status(numeric, numeric, text, numeric, numeric) set search_path = '';
alter function private.period_bounds(text, date) set search_path = '';
alter function private.valid_entity_type(text) set search_path = '';
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname in ('standardize', 'grant_permissions', 'apply_program_content_policies', 'apply_standard_policies')
  loop
    execute format('alter function %s set search_path = public, private, pg_catalog', f);
  end loop;
end $$;

-- Expose the app schema (workflow RPCs) through PostgREST
grant usage on schema app to anon, authenticated, service_role;
