-- ---------------------------------------------------------------------------
-- 0118 gave zapier_workflows a read policy and no write policies, so saving a
-- setup from the guided flow was refused by row level security. The app already
-- checks connections.manage before it writes; this is the database enforcing the
-- same rule, which is where it has to hold.
--
-- Removing a setup is a soft delete, so it travels through the update policy.
-- A hard delete stays with super admins, as it does everywhere else.
-- ---------------------------------------------------------------------------

create policy zapier_workflows_insert on public.zapier_workflows for insert to authenticated with check (
  organization_id in (select private.orgs_with_permission('connections.manage')));

create policy zapier_workflows_update on public.zapier_workflows for update to authenticated
  using (organization_id in (select private.orgs_with_permission('connections.manage')))
  with check (organization_id in (select private.orgs_with_permission('connections.manage')));

create policy zapier_workflows_delete on public.zapier_workflows for delete to authenticated using (
  (select private.is_super_admin()));
