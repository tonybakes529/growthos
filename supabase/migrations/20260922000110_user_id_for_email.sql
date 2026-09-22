-- =============================================================================
-- 0110 FIND AN EXISTING LOGIN BY EMAIL
--
-- Adding someone who already has a Growth OS login needs no new account and therefore no service role key, but
-- the admin cannot see that person through row-level security until they are a member. This looks them up.
--
-- Only someone who may already invite people into the workspace can ask (members.create), which is the same
-- thing invite_member reveals when it refuses an address that is already a member.
-- =============================================================================

create or replace function app.user_id_for_email(p_organization_id uuid, p_email text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid;
begin
  perform private.require_user();
  perform private.assert_permission(p_organization_id, 'members.create');
  select u.id into uid from public.users u where u.email = p_email::extensions.citext;
  return uid;
end;
$$;

revoke all on function app.user_id_for_email(uuid, text) from public, anon;
grant execute on function app.user_id_for_email(uuid, text) to authenticated, service_role;
