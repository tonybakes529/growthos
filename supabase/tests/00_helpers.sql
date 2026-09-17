-- Test helpers (local only). Each test file runs in its own session and rolls back.
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

-- Switch the "logged in" user for the rest of the transaction.
create or replace function tests.login(p_email text)
returns uuid language plpgsql security definer as $$
declare uid uuid;
begin
  select id into uid from public.users where email = p_email;
  if uid is null then raise exception 'no seeded user %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  return uid;
end;
$$;

create or replace function tests.uid(p_email text)
returns uuid language sql stable security definer as $$ select id from public.users where email = p_email $$;

create or replace function tests.org(p_slug text)
returns uuid language sql stable security definer as $$ select id from public.organizations where slug = p_slug $$;

-- Assert that a statement fails, optionally with a message matching p_like.
create or replace function tests.throws(p_sql text, p_like text default null, p_label text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_like is not null and sqlerrm not ilike '%' || p_like || '%' then
      raise exception 'FAIL %: expected error like "%", got "%"', coalesce(p_label, p_sql), p_like, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL %: expected an error but the statement succeeded', coalesce(p_label, p_sql);
end;
$$;

create or replace function tests.eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_label, p_expected, p_actual;
  end if;
end;
$$;

create or replace function tests.ok(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL %', p_label; end if;
end;
$$;

grant execute on all functions in schema tests to authenticated, anon;

-- Schema-level guarantees ------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(tablename, ', ') into bad from pg_tables where schemaname = 'public' and not rowsecurity;
  if bad is not null then raise exception 'FAIL tables without RLS: %', bad; end if;

  -- every org-scoped table registered with a tenant key
  select string_agg(c.table_name, ', ') into bad
  from information_schema.columns c
  join pg_tables t on t.tablename = c.table_name and t.schemaname = 'public'
  where c.table_schema = 'public' and c.column_name = 'organization_id'
    and not exists (select 1 from private.rls_registry r where r.table_name = c.table_name);
  if bad is not null then raise exception 'FAIL org tables missing from registry: %', bad; end if;

  -- every table has at least one policy unless it is service-only
  select string_agg(t.tablename, ', ') into bad
  from pg_tables t
  where t.schemaname = 'public'
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)
    and t.tablename not in (select table_name from private.rls_registry where policy_mode = 'service_only');
  if bad is not null then raise exception 'FAIL tables with RLS but no policies (unreachable): %', bad; end if;

  -- no SECURITY DEFINER function in exposed schemas without a pinned search_path
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'private') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then raise exception 'FAIL definer functions without search_path: %', bad; end if;

  raise notice 'schema guarantees ok';
end $$;

-- No privileged internals are executable by API roles ---------------------------
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('clone_row', 'apply_template', 'create_invitation', 'enroll', 'calculate_health_score',
                      'upsert_kpi_entry', 'bypass_org_guard', 'notify', 'emit_event', 'log_audit', 'user_grants', 'permission_set')
    and has_function_privilege('authenticated', p.oid, 'execute');
  if bad is not null then raise exception 'FAIL authenticated can execute private internals: %', bad; end if;

  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname <> 'get_invitation' and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'FAIL anon can execute app functions: %', bad; end if;
end $$;
