-- =============================================================================
-- 0112 DO NOT ASK THE SAME QUESTIONS TWICE
--
-- 0111 resolved a record's form as: the form already started, then the course's
-- form, then the workspace intake form. That last fallback applied to course
-- records too, so a student holding both a workspace intake record and a course
-- record, where the course has no form of its own, was shown the workspace form
-- once per record. Two identical 34-question forms, back to back.
--
-- The two kinds of record answer different questions, so they resolve
-- differently and never fall through to each other:
--   workspace intake (program_id null) -> the workspace's intake form
--   course record                      -> that course's own form, or nothing
--
-- A course that wants the workspace questions asked again can still point at
-- the same form explicitly.
-- =============================================================================

create or replace function private.intake_form_id(p_org uuid, p_program uuid, p_form uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_form,                                   -- the form they already started wins, always
    case
      when p_program is null then
        (select o.default_onboarding_form_id from public.organizations o where o.id = p_org)
      else
        (select p.onboarding_form_id from public.programs p
         where p.id = p_program and p.organization_id = p_org and p.deleted_at is null)
    end);
$$;
