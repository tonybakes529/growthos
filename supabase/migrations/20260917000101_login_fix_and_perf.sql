-- ---------------------------------------------------------------------------
-- 1. Fix app.record_login for client users.
--    The function is security definer, but protect_client_profile_columns()
--    checks auth.uid(), which is still the signed-in client. Its exception
--    rolled back the whole call, so client logins recorded nothing at all:
--    no login_activity row, no users.last_login_at, no last_client_login_at
--    (the "last client login" health signal and the client.inactive
--    automation both read that column). Use the scoped guard bypass that the
--    other workflow functions already use.
-- ---------------------------------------------------------------------------
create or replace function app.record_login(p_organization_id uuid default null, p_user_agent text default null, p_ip inet default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  insert into public.login_activity (user_id, organization_id, event, ip_address, user_agent)
  values (uid, case when p_organization_id in (select private.orgs_with_access()) then p_organization_id end,
          case when p_organization_id is null then 'login' else 'workspace_switch' end, p_ip, p_user_agent);
  update public.users set last_login_at = now(), last_seen_at = now() where id = uid;
  -- client-side logins (not staff) drive the "last client login" signal
  perform private.bypass_org_guard();
  update public.client_profiles cp set last_client_login_at = now()
  where cp.organization_id in (select organization_id from public.organization_memberships
                               where user_id = uid and status = 'active');
  perform private.end_org_guard_bypass();
  update public.organization_memberships set last_active_at = now() where user_id = uid and status = 'active';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. login_activity_select re-evaluated auth.uid() for every row. Wrap it in a
--    scalar subquery so the planner runs it once per statement (initplan),
--    matching every other policy in the schema.
-- ---------------------------------------------------------------------------
drop policy if exists login_activity_select on public.login_activity;
create policy login_activity_select on public.login_activity for select to authenticated using (
  user_id = (select auth.uid()) or (select private.is_real_super_admin())
);

-- ---------------------------------------------------------------------------
-- 3. Index foreign keys that have no usable index.
--    Without one, every ON DELETE CASCADE / SET NULL on the parent seq-scans
--    the child table, and joins / PostgREST embeds through the FK cannot use
--    an index. A FK counts as covered when an index leads with its selective
--    column, or with (organization_id, selective column).
--    Audit columns (created_by / updated_by / deleted_by) are skipped on
--    purpose: they are only traversed when a user row is hard-deleted, and
--    ~300 extra indexes would tax every write for no read benefit.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    with fk as (
      select c.conrelid, cl.relname as tbl,
        (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
           from unnest(c.conkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
        (select string_agg(a.attname, '_' order by k.ord)
           from unnest(c.conkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
          where a.attname <> 'organization_id' or cardinality(c.conkey) = 1) as shortcols,
        sel.attname as sel_col, sel.attnum as sel_att
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_class cl on cl.oid = c.conrelid
      cross join lateral (
        select a.attname, a.attnum
          from unnest(c.conkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         where a.attname <> 'organization_id' or cardinality(c.conkey) = 1
         order by k.ord desc limit 1) sel
      where c.contype = 'f' and n.nspname = 'public'
    )
    select distinct tbl, cols, left(tbl || '_' || shortcols || '_fkidx', 63) as idx
    from fk
    where sel_col not in ('created_by', 'updated_by', 'deleted_by')
      and not exists (
        select 1 from pg_index i
        where i.indrelid = fk.conrelid and i.indpred is null
          and ((i.indkey::int2[])[0] = fk.sel_att
            or ((i.indkey::int2[])[1] = fk.sel_att
                and (select attname from pg_attribute
                      where attrelid = fk.conrelid and attnum = (i.indkey::int2[])[0]) = 'organization_id')))
    order by tbl, cols
  loop
    execute format('create index if not exists %I on public.%I (%s)', r.idx, r.tbl, r.cols);
  end loop;
end;
$$;
