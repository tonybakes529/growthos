-- =============================================================================
-- 0001 FOUNDATION
-- Schemas, extensions, and the table "standardizer" that gives every tenant
-- table the same audit columns, tenant constraints, triggers and RLS policies.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- private: permission engine + trigger functions. NOT exposed through the API.
create schema if not exists private;
-- app: workflow RPCs. Exposed through PostgREST (see supabase/config.toml).
create schema if not exists app;

grant usage on schema private to authenticated, service_role;
grant usage on schema app to authenticated, service_role;
revoke all on schema private from anon;

-- -----------------------------------------------------------------------------
-- Registry: one row per table. Drives policies, triggers, soft delete, audit.
-- -----------------------------------------------------------------------------
create table private.rls_registry (
  table_name    text primary key,
  module        text,            -- permission module, e.g. 'programs'
  org_scoped    boolean not null default true,
  soft_delete   boolean not null default false,
  audited       boolean not null default false,
  policy_mode   text not null default 'standard'
                check (policy_mode in ('standard', 'custom', 'service_only')),
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- stamp(): created/updated metadata from the REAL actor, immutable tenant key,
-- and the read-only impersonation guard. Attached to every standardized table.
-- -----------------------------------------------------------------------------
create or replace function private.stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j   jsonb := to_jsonb(new);
  o   jsonb;
  uid uuid := auth.uid();
begin
  perform private.assert_writable();

  if tg_op = 'INSERT' then
    if j ? 'created_by' and uid is not null then
      j := j || jsonb_build_object('created_by', uid);
    end if;
    if j ? 'created_at' and (j->>'created_at') is null then
      j := j || jsonb_build_object('created_at', now());
    end if;
  else
    o := to_jsonb(old);
    if j ? 'organization_id'
       and (j->>'organization_id') is distinct from (o->>'organization_id') then
      raise exception 'organization_id is immutable on %', tg_table_name
        using errcode = '42501';
    end if;
    if j ? 'created_at' then j := j || jsonb_build_object('created_at', o->'created_at'); end if;
    if j ? 'created_by' then j := j || jsonb_build_object('created_by', o->'created_by'); end if;
  end if;

  if j ? 'updated_at' then
    j := j || jsonb_build_object('updated_at', now());
  end if;
  if j ? 'updated_by' and uid is not null then
    j := j || jsonb_build_object('updated_by', uid);
  end if;

  new := jsonb_populate_record(new, j);
  return new;
end;
$$;

-- Placeholder; real body is defined in 0002 once impersonation_sessions exists.
create or replace function private.assert_writable()
returns void language plpgsql as $$ begin return; end; $$;

-- -----------------------------------------------------------------------------
-- standardize(): call right after CREATE TABLE.
-- -----------------------------------------------------------------------------
create or replace function private.standardize(
  p_table        text,
  p_module       text,
  p_soft_delete  boolean default false,
  p_audited      boolean default false,
  p_policy_mode  text    default 'standard',
  p_actor_cols   boolean default true
) returns void
language plpgsql
as $$
declare
  has_org boolean;
  has_id  boolean;
  t regclass := format('public.%I', p_table)::regclass;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'organization_id'
  ) into has_org;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'id'
  ) into has_id;

  execute format('alter table %s add column if not exists created_at timestamptz not null default now()', t);
  execute format('alter table %s add column if not exists updated_at timestamptz not null default now()', t);
  if p_actor_cols then
    execute format('alter table %s add column if not exists created_by uuid references public.users(id) on delete set null', t);
    execute format('alter table %s add column if not exists updated_by uuid references public.users(id) on delete set null', t);
  end if;
  if p_soft_delete then
    execute format('alter table %s add column if not exists deleted_at timestamptz', t);
    execute format('alter table %s add column if not exists deleted_by uuid references public.users(id) on delete set null', t);
  end if;

  if has_org and has_id then
    -- (organization_id, id) is the target of composite FKs from child tables,
    -- which makes cross-tenant parent/child links impossible at the DB level.
    execute format('alter table %s add constraint %I unique (organization_id, id)', t, p_table || '_org_id_key');
    if p_soft_delete then
      execute format('create index if not exists %I on %s (organization_id) where deleted_at is null', p_table || '_org_idx', t);
    else
      execute format('create index if not exists %I on %s (organization_id)', p_table || '_org_idx', t);
    end if;
  end if;

  execute format('alter table %s enable row level security', t);
  execute format('drop trigger if exists stamp on %s', t);
  execute format('create trigger stamp before insert or update on %s for each row execute function private.stamp()', t);

  insert into private.rls_registry (table_name, module, org_scoped, soft_delete, audited, policy_mode)
  values (p_table, p_module, has_org, p_soft_delete, p_audited, p_policy_mode)
  on conflict (table_name) do update
    set module = excluded.module, org_scoped = excluded.org_scoped,
        soft_delete = excluded.soft_delete, audited = excluded.audited,
        policy_mode = excluded.policy_mode;

  if p_audited then
    execute format('drop trigger if exists audit on %s', t);
    execute format('create trigger audit after insert or update or delete on %s for each row execute function private.audit()', t);
  end if;

  if p_policy_mode = 'standard' and has_org then
    perform private.apply_standard_policies(p_table, p_module, p_soft_delete);
  end if;
end;
$$;

-- Placeholders replaced in 0002 (so 0001 has no forward references at runtime).
create or replace function private.audit() returns trigger language plpgsql as $$ begin return null; end; $$;
create or replace function private.apply_standard_policies(p_table text, p_module text, p_soft_delete boolean)
returns void language plpgsql as $$ begin raise exception 'apply_standard_policies not initialised'; end; $$;
