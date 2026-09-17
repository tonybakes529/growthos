-- =============================================================================
-- 0099 FINALIZE GRANTS (keep this the last migration)
-- Re-asserts function privileges after every migration above has run, so a
-- function added later can never silently inherit PUBLIC execute.
-- =============================================================================

alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
grant execute on function app.get_invitation(text) to anon;
-- service-role-only workflows (Stripe webhooks)
revoke all on function app.fulfill_purchase(uuid, uuid, uuid, text, bigint, text, text, text, text, text, text, text, jsonb) from authenticated;
revoke all on function app.record_subscription_event(text, text, bigint, text, text) from authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
grant execute on function
  private.effective_user_id(), private.active_impersonation(), private.is_super_admin(), private.is_real_super_admin(),
  private.is_platform_staff(uuid), private.orgs_with_permission(text), private.orgs_with_access(),
  private.has_permission(uuid, text), private.my_enrolled_program_ids(), private.my_session_ids(),
  private.my_task_ids(), private.my_conversation_ids(), private.org_member_ids(uuid),
  private.can_view_lesson_content(uuid), private.can_read_file(uuid), private.can_see_program_scope(uuid, uuid),
  private.kpi_status(numeric, numeric, text, numeric, numeric), private.period_bounds(text, date),
  private.valid_entity_type(text)
to authenticated;

-- Service-only tables: no API role may touch them directly.
revoke all on public.domain_events, public.email_outbox, public.stripe_events from anon, authenticated;
