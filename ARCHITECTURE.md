# Growth OS: System Architecture

Multi-client coaching + growth operating platform. Kajabi-style education, plus accountability, KPIs, sales, content, and team operations, delivered through private client workspaces that you (the platform owner) run from one control plane.

This document covers the 12 requested sections. The full column-by-column catalog for every table is in `docs/DATA_MODEL.md` (generated from the live schema, so it can never drift from the migrations).

---

## 0. Assumptions (flagged before implementation)

| # | Assumption | Why | Easy to change? |
|---|---|---|---|
| A1 | One Supabase project, one Postgres database, shared tables with `organization_id` (pool model), not a database per client. | Cheapest to run, simplest to report across clients, and RLS gives hard isolation. | Hard later. This is the foundational call. |
| A2 | Your own company is also an organization (`kind = 'platform'`). Templates live in a dedicated `template_library` organization. Clients are `kind = 'client'`. | Templates are built with the same program/scorecard/pipeline builders as real client content. No second "template editor". | Yes |
| A3 | Super admin and internal team are platform-level roles stored in `platform_staff`, never on the user's own profile row. | A user can edit their own profile. They must never be able to edit their own platform role. | Yes |
| A4 | Internal team members reach a client only through `team_assignments`. Being staff alone grants nothing inside a client workspace. | Matches "can only access clients assigned to them". | Yes |
| A5 | Business-critical writes (create org, invite, accept, role change, template duplication, enroll, complete lesson, submit KPI) run as Postgres functions (RPC) called from server actions. Simple CRUD goes straight through RLS. | Multi-table writes stay atomic, and the permission check lives next to the data, so a future mobile app or Zapier integration can't skip it. | Yes |
| A6 | Soft delete (`deleted_at`) on business data. Hard delete is reserved for super admin and GDPR-style purges. | Requirement, plus recoverability. | Yes |
| A7 | Stripe is the payment processor. Checkout creation and webhook fulfillment are built, but no Stripe products or prices exist yet, so nothing is charging. | "Stripe-ready" requirement. | Yes |
| A8 | Impersonation is "view as" and read-only by default. Write-enabled impersonation needs an explicit flag and is fully audited. | Safest default for a coaching business handling client financials. | Yes |
| A9 | Email goes through an `email_outbox` queue drained by the cron worker. A Resend adapter is included and switches on when `RESEND_API_KEY` is set. | Keeps transactions fast and retry-safe. | Yes |
| A10 | A "student" is a membership with the `student` role, not a separate user type. The same person can be a student in one org and a client admin in another. | One login, many workspaces. | Yes |
| A11 | Currency amounts are stored as integer cents plus a `currency` code. | No floating-point money bugs. | Yes |
| A12 | Nothing was deployed to your live Supabase account. Migrations were run and tested on a local Postgres 16 with Supabase's `auth` and `storage` schemas stubbed. | Changes to a live project should be your call. | n/a |

---

## 1. System architecture

```
┌───────────────────────────── Next.js (App Router, later) ─────────────────────────────┐
│  /admin/*  (platform control plane)        /w/[orgSlug]/*  (client workspace)         │
│  Server Components + Server Actions only. No service-role key in the browser.        │
└───────────────┬───────────────────────────────────────────────────────┬──────────────┘
                │ src/modules/*  (TypeScript domain modules)             │ /api/webhooks/*
                │  • resolve session + org context (server-side)         │  Stripe, email, automations
                │  • zod-validate input                                  │  (service role, signature-verified)
                │  • call RPC or table query as the USER (anon key + JWT)│
┌───────────────▼───────────────────────────────────────────────────────▼──────────────┐
│ Supabase                                                                              │
│  Auth (GoTrue) ── JWT(sub = user id) ──►  PostgREST ──► Postgres                      │
│                                                        ├─ public.*   tables (RLS ON)  │
│                                                        ├─ app.*      RPC workflows    │
│                                                        ├─ private.*  auth helpers     │
│                                                        │             (not exposed)    │
│                                                        ├─ triggers: stamps, audit,    │
│                                                        │   domain events, guards      │
│                                                        └─ views (security_invoker)    │
│  Storage: private bucket `org-files`, path {org_id}/{file_id}/{name}, signed URLs     │
│  Cron worker (/api/cron): domain_events → automations, email_outbox → Resend         │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Layers and why**

1. **Postgres is the security boundary.** RLS is enabled on every table in `public`. Even if a server action has a bug, the database refuses cross-tenant reads and writes, because queries run as the signed-in user, not as a superuser.
2. **`private` schema** holds the permission engine (`has_permission`, `orgs_with_permission`, `effective_user_id`). It's not exposed through the API, and the functions are `SECURITY DEFINER` with a pinned `search_path`.
3. **`app` schema** holds workflow RPCs. Each one re-checks permissions internally and never trusts an `organization_id` passed in without verifying the caller's rights to it.
4. **TypeScript modules** (`src/modules/*`) are thin: validate input, resolve context, call the database, map errors. They're framework-agnostic, so they work in Next.js server actions, route handlers, or a background worker.
5. **Event backbone.** Important writes insert into `domain_events` (outbox pattern). A worker later reads them and runs automations. That's how "lesson completed → notify coach" works without coupling modules.

**Platform data vs organization data**

| Platform-level (no `organization_id`) | Organization-level (`organization_id NOT NULL`) |
|---|---|
| users, user_profiles, platform_staff, permissions, system roles, login_activity, impersonation_sessions, health_score_models, onboarding_templates, all `*_templates` registries, stripe_events | everything a client owns: members, contacts, offers, programs, KPIs, tasks, pipelines, content, messages, files, audit rows for that org |

`organizations` itself is the root of the tenant tree. `audit_logs` has a nullable `organization_id` because platform actions also get logged.

---

## 2. Entity relationship structure

```
auth.users 1─1 users 1─1 user_profiles
users 1─1 platform_staff ─► roles(scope=platform)
users 1─* organization_memberships *─1 organizations
users 1─* team_assignments *─1 organizations        (internal staff → client)
roles 1─* role_permissions *─1 permissions
organization_memberships/team_assignments ─► roles(scope=organization)
permission_overrides (org, user, permission, grant|deny)
invitations ─► organizations, roles  → accepted into organization_memberships

organizations 1─1 client_profiles (dates, account manager, coach, MRR, revenue, last-activity signals)
organizations 1─* [every tenant table]

CRM:      contacts *─* tags (contact_tags) · notes/files/activity_history polymorphic (entity_type, entity_id)
          custom_fields 1─* custom_field_values (entity_type, entity_id)

Offers:   offers 1─* offer_versions 1─* pricing_options
          offers *─* programs (offer_entitlements)      ← several offers unlock the same program
          offer_assignments (manual grant of an offer to a user/contact)
          order_forms ─► offer, pricing_option
          purchases ─► offer, pricing_option, coupon, contact/user → subscriptions, payment_records
          purchases → program_enrollments (source_purchase_id)

LMS:      programs 1─* program_sections 1─* modules 1─* lessons 1─* lesson_blocks
          lessons/modules/programs 1─* resources ─► files
          program_enrollments (user × program) 1─* lesson_progress, module_progress
          lessons 1─* assignments 1─* assignment_submissions 1─* assignment_feedback
          lessons 1─* quizzes 1─* quiz_questions ; quizzes 1─* quiz_attempts
          program_enrollments 1─0..1 certificates

Coaching: recurring_calls 1─* coaching_sessions 1─* session_attendees / session_notes / call_recordings
          coaching_sessions 1─* action_items ; accountability_checkins ; client_wins ; client_blockers
          milestones 1─* milestone_progress

Growth:   goals 1─* quarterly_goals 1─* monthly_targets ─► kpi_definitions
          kpi_definitions 1─* kpi_entries ; scorecards *─* kpi_definitions (scorecard_kpis)
          scorecards 1─* weekly_scorecards 1─* kpi_entries
          dashboards 1─* dashboard_widgets ─► kpi_definitions / report keys
          experiments, growth_projects 1─* tasks ; tasks 1─* task_assignments / task_comments
          standard_operating_procedures 1─* sop_versions
          meeting_agendas 1─* meeting_notes 1─* decisions

Sales:    pipelines 1─* pipeline_stages ; leads ─► contacts, attribution_sources
          opportunities ─► pipeline, stage, lead, offer, setter, closer, lost_reason
          appointments / sales_calls / sales_notes / follow_up_tasks ─► opportunity
          commissions ─► opportunity/payment_record, setter|closer ; marketing_spend ─► attribution_source

Content:  content_ideas → content_items ─► content_statuses ; scripts, content_tasks
          publishing_dates / published_links ─► content_platforms ; content_metrics ─► published_links
          calls_to_action, lead_magnets ─► files, offers

Community: announcements ; discussions 1─* discussion_comments
          conversations 1─* conversation_participants / direct_messages
          notifications, notification_preferences, email_templates, email_outbox

Templates: {program,lesson,scorecard,dashboard,task,sop,offer,pipeline}_templates ─► source rows in the template_library org
          onboarding_templates 1─* onboarding_template_items (template_type, template_id)
          onboarding_questionnaires 1─* questionnaire_questions (maps_to: profile field | KPI baseline)
          questionnaire_responses ; template_applications (who copied what where)

Automation: domain_events → automation_runs ; automations 1─* automation_conditions / automation_actions
           automation_runs 1─* automation_run_steps ; webhook_endpoints

Health:   health_score_models 1─* health_score_factors
          client_health_scores 1─* client_health_score_components ; coach_ratings
```

---

## 3. Tables (by domain)

149 tables. The full list with every column, type, default, and foreign key is in **`docs/DATA_MODEL.md`**. Migration files map 1:1 to the domains below.

| Migration | Tables |
|---|---|
| `0002_identity_tenancy` | users, user_profiles, organizations, roles, permissions, role_permissions, platform_staff, organization_memberships, team_assignments, permission_overrides, invitations, login_activity, impersonation_sessions, audit_logs, activity_history, domain_events |
| `0003_crm_files_fields` | client_profiles, tags, contacts, contact_tags, notes, files, custom_fields, custom_field_values |
| `0004_offers_billing` | offers, offer_versions, pricing_options, offer_entitlements, offer_assignments, coupons, coupon_redemptions, order_forms, billing_customers, purchases, subscriptions, payment_records, stripe_events |
| `0005_programs_lms` | programs, program_sections, modules, lessons, lesson_blocks, resources, program_enrollments, lesson_progress, module_progress, lesson_unlocks, assignments, assignment_submissions, assignment_feedback, quizzes, quiz_questions, quiz_answer_keys, quiz_attempts, certificates |
| `0006_coaching_delivery` | recurring_calls, coaching_sessions, session_attendees, session_notes, call_recordings, action_items, accountability_checkins, client_wins, client_blockers, milestones, milestone_progress, coach_ratings |
| `0007_growth_os` | goals, quarterly_goals, kpi_definitions, monthly_targets, kpi_entries, scorecards, scorecard_kpis, weekly_scorecards, dashboards, dashboard_widgets, experiments, growth_projects, tasks, task_assignments, task_comments, standard_operating_procedures, sop_versions, meeting_agendas, meeting_notes, decisions |
| `0008_sales` | pipelines, pipeline_stages, attribution_sources, lost_reasons, setters, closers, leads, opportunities, appointments, sales_calls, sales_notes, follow_up_tasks, commissions, marketing_spend |
| `0009_content` | content_platforms, content_statuses, calls_to_action, lead_magnets, content_ideas, content_items, scripts, content_tasks, publishing_dates, published_links, content_metrics |
| `0010_community` | announcements, discussions, discussion_comments, conversations, conversation_participants, direct_messages, notifications, notification_preferences, email_templates, email_outbox |
| `0011_templates_onboarding` | program_templates, lesson_templates, scorecard_templates, dashboard_templates, task_templates, task_template_items, sop_templates, offer_templates, pipeline_templates, onboarding_templates, onboarding_template_items, onboarding_questionnaires, questionnaire_questions, questionnaire_responses, template_applications |
| `0012_automations_health` | automation_trigger_types, automation_action_types, automations, automation_conditions, automation_actions, automation_runs, automation_run_steps, webhook_endpoints, health_score_models, health_score_factors, client_health_scores, client_health_score_components |
| `0013_rls_policies` | all hand-written policies + column guards on organizations / client_profiles |
| `0014_workflows` | every `app.*` workflow function |
| `0015_reporting` | reporting views + `kpi_trend`, `kpi_period_comparison`, `platform_metrics` |
| `0016_storage` | private `org-files` bucket, storage policies, upload confirmation |
| `0017_billing_fulfillment` | `app.fulfill_purchase`, `app.record_subscription_event` (service role only) |
| `0099_finalize_grants` | re-asserts function privileges; keep it last |

Notes on naming vs your list:
- `users` is a public mirror of `auth.users` (Supabase owns the real one).
- `accountability_check-ins` became `accountability_checkins` (hyphens aren't legal in unquoted SQL names).
- `KPI_definitions`/`KPI_entries`/`SOP_templates` are lowercase (Postgres convention).
- `offer_assignments` is a manual grant. The "offer unlocks program" mapping is `offer_entitlements`. Both exist.
- `setters` and `closers` are rep rosters with commission rates, optionally linked to a user.
- Added because the requirements need them: `marketing_spend` (for CPL, cost per appointment, CAC, ROAS), `coach_ratings` (health factor), `lesson_unlocks` (the "unlock lesson" action), `quiz_answer_keys` (answers kept away from students), `sop_versions`, `assignment_feedback`, `conversations`, `email_outbox`, `stripe_events`, `billing_customers`, `domain_events`, `impersonation_sessions`.

---

## 4. Important fields (standard conventions)

Every organization-owned table has:

| Column | Purpose |
|---|---|
| `id uuid pk default gen_random_uuid()` | Non-guessable IDs |
| `organization_id uuid not null → organizations` | Tenant key. Indexed, and first in composite indexes |
| `created_at, updated_at timestamptz` | Maintained by the `private.stamp()` trigger |
| `created_by, updated_by uuid → users` | Set by trigger from the *real* actor, so the browser can't spoof them |
| `deleted_at, deleted_by` | Soft delete on business data |
| `metadata jsonb default '{}'` | Integration payloads without schema churn (on selected tables) |

Domain highlights (full detail in DATA_MODEL.md):

- **organizations**: `kind (platform|client|template_library)`, `slug unique`, `status (onboarding|active|paused|suspended|archived)`, `timezone`, `currency`, `stripe_customer_id`.
- **client_profiles**: `start_date`, `renewal_date`, `contract_value_cents`, `mrr_cents`, `current_monthly_revenue_cents`, `revenue_target_cents`, `industry`, `account_manager_id`, `primary_coach_id`, `last_client_login_at`, `last_kpi_update_at`, `last_interaction_at`, `tags text[]`, `baseline jsonb`. Commercial columns are staff-only (a trigger enforces this). Health lives in `client_health_scores`, which clients can't read.
- **roles**: `key`, `scope (platform|organization)`, `organization_id null = system role`, `rank` (anti-elevation), `is_system`, `assignable_to (member|staff|both)`.
- **permissions**: `key` like `programs.update`, `module`, `action (read|create|update|delete|export|manage)`, `is_sensitive`.
- **lessons**: `drip_type (immediate|days_after_enrollment|fixed_date)`, `drip_days`, `drip_date`, `requires_previous_completion`, `is_preview`, `estimated_minutes`, `position`.
- **lesson_blocks**: `block_type (video|text|audio|document|download|embed|image|quiz|assignment)`, `content jsonb`, `file_id`.
- **program_enrollments**: `status`, `source (manual|purchase|template|automation|offer_assignment)`, `source_purchase_id`, `enrolled_at`, `access_expires_at`, `progress_percent`, `completed_at`, `last_activity_at`.
- **pricing_options**: `pricing_type (one_time|payment_plan|subscription|free)`, `amount_cents`, `installment_count`, `installment_interval`, `billing_interval`, `trial_days`, `stripe_price_id`, `available_from/until` (limited-time offers).
- **kpi_definitions**: `key`, `name`, `description`, `category`, `unit (count|currency|percent|ratio|duration|number)`, `frequency (daily|weekly|monthly|quarterly)`, `direction (higher_is_better|lower_is_better)`, `goal_value`, `at_risk_threshold_pct`, `data_source`, `entry_method (manual|automated|calculated)`, `formula jsonb` (for example close rate = closed / shows), `owner_id`, `is_financial`, `is_active`.
- **kpi_entries**: `kpi_definition_id`, `period_start`, `period_end`, `value numeric`, `target_value` (snapshot), `source`, `weekly_scorecard_id`, `note`. Unique on `(kpi_definition_id, period_start)`. Comparison to the previous period and the on-track/at-risk/off-track status are computed in `kpi_entry_status_v`.
- **tasks**: `status`, `priority`, `due_at`, `completed_at`, `visibility (organization|assignees)`, and polymorphic `related_type/related_id` (goal, experiment, opportunity, content item...), `growth_project_id`, `source_template_id`.
- **opportunities**: `value_cents`, `cash_collected_cents`, `status (open|won|lost)`, `setter_id`, `closer_id`, `offer_id`, `attribution_source_id`, `lost_reason_id`, `closed_at`.
- **client_health_score_components**: `factor_key`, `raw_value`, `normalized_score 0–100`, `weight`, `weighted_contribution`, `explanation`. This is what makes a score explainable.
- **audit_logs**: `organization_id?`, `actor_id` (real user), `impersonated_user_id`, `action (insert|update|delete|soft_delete|custom)`, `table_name`, `record_id`, `old_values`, `new_values`, `changed_fields text[]`, `ip`, `user_agent`, `request_id`.

---

## 5. Relationships (rules that matter)

- Every child row carries its own `organization_id` (denormalized) instead of only its parent's. RLS then never needs a join to decide tenancy, and composite foreign keys `(organization_id, parent_id)` guarantee a child can't point at another tenant's parent. For example, `lessons(organization_id, module_id) → modules(organization_id, id)`. **The database rejects cross-tenant links, not just the app.**
- Polymorphic links (`notes`, `files`, `activity_history`, `custom_field_values`, `tasks.related_*`) use `(entity_type, entity_id)` with a check-listed `entity_type`, plus the same `organization_id`.
- Offer → program is many-to-many (`offer_entitlements`), so several offers unlock the same program. A purchase creates enrollments for every entitled program.
- Template registries point at *source rows* in the template library org. Duplication deep-copies the tree and records `source_template_id` / `copied_from_id` on each copy, which enables "template changed, push update" later.

---

## 6. Role and permission matrix

Permissions are `module.action` keys (62 in total, seeded in `0002`). Roles are bundles. Per-user, per-org `permission_overrides` (grant/deny) customize any role, which is how "internal team member permissions customized by client" works.

Legend: **F** = full (read/create/update/delete/export), **R** = read, **RW** = read/create/update, **own** = only rows assigned to or created by them, **—** = none.

| Module | Super Admin | Account Mgr (staff) | Coach (staff) | Sales Mgr (staff) | Content Mgr (staff) | Client Admin | Client Team Member | Student |
|---|---|---|---|---|---|---|---|---|
| organization settings | F | RW | R | R | R | RW | R | — |
| members / invitations | F | F | R | R | R | F | R | — |
| roles & overrides | F | F | — | — | — | RW (≤ own perms) | — | — |
| contacts / notes | F | F | R | F | R | F | RW | — |
| files / resources | F | F | F | RW | F | F | R | enrolled only |
| offers | F | F | R | R | — | F | R | — |
| billing (purchases, payments, subs, coupons) | F | F | — | R | — | F | — | own purchases |
| programs (builder) | F | F | F | — | — | F | — | enrolled only |
| enrollments / progress | F | F | F | — | — | F | own | own |
| assignments / quizzes | F | F | F (grade) | — | — | F | own | own |
| coaching sessions / notes | F | F | F | R | — | F | R (attendee) | attendee only |
| wins / blockers / check-ins | F | F | F | R | R | F | RW | own |
| goals | F | F | F | R | R | F | R | — |
| KPIs (non-financial) | F | F | F | R | R | F | RW entries | — |
| **financial KPIs** | F | F | R | R | — | F | only via override | — |
| dashboards | F | F | F | R | R | F | shared only | shared only |
| tasks | F | F | F | F | F | F | own + org-visible | own |
| SOPs / meetings / decisions | F | F | F | R | R | F | R | — |
| sales pipeline | F | F | R | F | — | F | RW | — |
| content | F | F | R | — | F | F | RW | — |
| community / messages | F | F | F | RW | RW | F | RW | RW |
| automations | F | F | R | — | — | RW | — | — |
| client health | F | F | RW | R | — | — | — | — |
| reports / export | F | F | R | R | R | F | — | — |
| audit log (org) | F | R | — | — | — | R | — | — |
| templates (library) | F | apply | apply | — | — | — | — | — |
| platform: all clients, impersonation, staff | F | assigned only | assigned only | assigned only | assigned only | — | — | — |

**Anti-elevation rules (enforced in the database):**
1. Nobody can change their own membership, role, or overrides (`app.change_member_role` and `app.set_permission_override` reject `target = caller`).
2. You can only grant a role, or a `grant` override, whose permission set is a subset of your own effective permissions in that org.
3. Custom org roles can only contain permissions the creator holds.
4. `platform_staff` is writable only by super admin, and at least one active super admin must always remain.
5. Direct INSERT/UPDATE on memberships, overrides, team assignments, and platform_staff is blocked by RLS. They go through RPCs.

---

## 7. Row-level security strategy

1. **RLS on for every `public` table.** A migration test fails if any table is missing it.
2. **One permission engine.** `private.orgs_with_permission(perm)` returns the set of org IDs where the current user holds `perm`, combining super admin (all orgs), memberships, team assignments, role permissions, and overrides (deny wins). Policies look like:
   ```sql
   using (organization_id in (select private.orgs_with_permission('tasks.read')))
   ```
   The `(select …)` form makes Postgres evaluate it once per statement (hashed InitPlan), not once per row. That's the difference between 2 ms and 2 s on large tables.
3. **Policies are generated from a registry** (`private.rls_registry`: table → module, soft-delete flag, audit flag). Standard tables get `select/insert/update/delete` policies mapped to `module.read/create/update/delete`. This removes copy-paste policy bugs across ~150 tables.
4. **Hand-written policies** for tables whose visibility is per-person: programs/modules/lessons/blocks/resources (enrolled users), enrollments and progress (own rows), tasks (assignees or org-visible), coaching sessions (attendees), dashboards (shared), DMs (participants), notifications (recipient), files (linked-resource access), financial KPIs (`financials.read`), health scores (staff only).
5. **Never trust client org IDs.** Inserts are checked by `WITH CHECK` against the same permission set, so a forged `organization_id` fails. RPCs re-verify.
6. **Impersonation.** `private.effective_user_id()` returns the target user while a super admin has an active `impersonation_sessions` row. All RLS helpers use it, so the admin sees exactly what the client sees. The stamp trigger blocks writes during read-only impersonation. Audit rows record both the real actor and the impersonated user.
7. **Storage.** A private bucket with paths `{organization_id}/{file_id}/{filename}`. The storage policy joins to `files` and reuses `private.can_read_file()`. Downloads use short-lived signed URLs minted server-side after the check.
8. **Service role** is used only in webhook handlers and workers, never in user-facing actions.

---

## 8. Core backend workflows (implemented as `app.*` RPCs)

| Workflow | Function | What it does atomically |
|---|---|---|
| Create client | `app.create_client_organization(name, slug, onboarding_template_id, admin_email, admin_name, account_manager_id, coach_id)` | org + client_profile → apply onboarding template → invitation for client admin → team assignments → activity + audit + `client.created` event |
| Apply templates | `app.apply_template(template_type, template_id, target_org)` / `app.apply_templates_bulk(...)` | deep copy of program tree / scorecard + KPIs / pipeline + stages / dashboard + widgets / SOP / offer + versions + pricing / task list, remapping every ID |
| Invite | `app.invite_member(org, email, role_key, program_ids[])` | anti-elevation check → hashed token → email_outbox → `member.invited` event |
| Accept | `app.accept_invitation(token)` | validates token, email match, and expiry → membership → pre-assigned enrollments + onboarding tasks → `member.joined` |
| Role change / override | `app.change_member_role`, `app.set_permission_override` | subset check, no self-edit, audit |
| Assign staff | `app.assign_team_member(org, user, role_key)` | super admin or account manager only |
| Questionnaire | `app.submit_onboarding_questionnaire(org, answers)` | response stored → mapped fields written to client_profile → baseline kpi_entries created |
| Enroll | `app.enroll_user(org, program, user, source)` | idempotent, `enrollment.created` event |
| Program outline | `app.get_program_outline(program)` | every lesson with computed `is_available`, `unlocks_at`, `lock_reason`, progress |
| Complete lesson | `app.complete_lesson(lesson)` | checks drip and sequential lock → progress → module rollup → enrollment % → certificate on 100% → events |
| Submit assignment / grade | `app.submit_assignment`, `app.review_submission` | notifications to coach/student |
| Quiz | `app.submit_quiz_attempt(quiz, answers)` | auto-scores and stores the attempt |
| KPI entry | `app.upsert_kpi_entry(kpi, period_start, value)` | period normalization, target snapshot, `last_kpi_update_at`, `kpi.missed` event when off track |
| Weekly scorecard | `app.submit_weekly_scorecard(scorecard, week_start, values, wins, blockers)` | batch entries + wins/blockers rows |
| Tasks | `app.create_task(...)`, `app.set_task_status(...)` | assignments, notifications, `task.completed` |
| Soft delete | `app.soft_delete(table, id)` | registry-whitelisted, `module.delete` check, audit |
| Unlock lesson | `app.unlock_lesson(lesson, user)` | early access past drip/sequence, notifies the student |
| Stripe | `app.fulfill_purchase(...)`, `app.record_subscription_event(...)` | service role only; idempotent; purchase → subscription → payment → enrollment or student invite |
| Impersonation | `app.start_impersonation(user, org, reason, allow_writes)`, `app.end_impersonation()` | super admin only, 60-minute expiry, audited |
| Health score | `app.calculate_health_score(org)` / `app.calculate_all_health_scores()` | computes each factor from live data → components + score + band → client_profiles cache → `client.at_risk` event |
| Suspend/archive | `app.set_organization_status(org, status)` | super admin, audited |
| Login tracking | `app.record_login(user_agent, ip)` | login_activity + last login |
| Admin overview | view `admin_client_overview_v` | one row per client with every control-plane column you listed |

### 8a. Client workspace areas (data and actions, no visuals yet)

Every area resolves `/w/[orgSlug]` through `requireOrg()` and shows only what RLS returns for the viewer.

| Area | Reads | Actions | Visible to |
|---|---|---|---|
| **Home** | `kpi_latest_v`, open tasks (`listTasks mine`), next `coaching_sessions`, latest `announcements`, `notifications`, `client_wins`, program progress | mark notification read, quick KPI entry, complete task | everyone (content filtered by role) |
| **Roadmap** | `milestones` + `milestone_progress`, `goals` → `quarterly_goals`, `growth_projects` | update milestone status, create project | members with `accountability.read` / `goals.read` |
| **Programs** | `programs`, `app.get_program_outline`, `lesson_blocks`, `resources`, `quizzes`, `assignments`, `certificates` | complete lesson, record view, submit assignment, take quiz; builders: create/edit/reorder/publish, enroll, unlock | learners: enrolled only · builders: `programs.*` |
| **Weekly Scorecard** | `getWeeklyScorecard` (scorecard KPIs + week entries + status) | `submitWeeklyScorecard` (values, wins, blockers) | `kpis.read`; financial rows need `financials.read` |
| **KPIs** | `kpi_definitions`, `kpi_entry_status_v`, `app.kpi_trend`, `app.kpi_period_comparison` | define/edit KPI, enter value, set monthly targets | `kpis.*` |
| **Goals** | `goals`, `quarterly_goals`, `monthly_targets`, linked KPIs | create goal / quarterly goal, set target, update progress | `goals.*` |
| **Tasks** | `tasks`, `task_assignments`, `task_comments` | create, assign, change status, comment | everyone sees org-visible + own; staff-only tasks never reach clients |
| **Sales Pipeline** | `pipelines`, `pipeline_stages`, `opportunities`, `leads`, `appointments`, `sales_calls`, `sales_by_rep_monthly_v`, `org_growth_metrics_monthly_v` | move stage, log call, mark won/lost, add follow-up, log spend (financial) | `sales.*`; spend + cash need `financials.read` |
| **Content Tracker** | `content_ideas`, `content_items`, `scripts`, `publishing_dates`, `published_links`, `content_performance_v` | add idea, convert to item, write script, schedule, log link, capture metrics | `content.*` |
| **Coaching Calls** | `coaching_sessions`, `session_attendees`, shared `session_notes`, published `call_recordings` (replay library), `action_items` | RSVP, complete session (staff), add notes, publish replay | attendees, org-wide calls with `coaching.read`, program calls for enrolled |
| **Resources** | `resources`, `files`, `standard_operating_procedures` + current `sop_versions` | upload (signed URL), download (signed URL), edit SOP | `files.read` / `sops.read` |
| **Team** | `listMembers` (members + assigned staff), `invitations`, `roles`, `permission_overrides` | invite, revoke, change role, override permission, custom role, remove | `members.*`, `roles.manage` (anti-elevation enforced) |
| **Messages** | `conversations`, `direct_messages`, `discussions`, `discussion_comments`, `announcements` | start conversation, send message, post, comment, moderate | participants only for DMs; `community.*` for discussions |
| **Settings** | `organizations`, `client_profiles` (business fields), `email_templates`, `notification_preferences`, `automations`, `audit_logs` | edit business facts, notification prefs, email overrides, automations, view audit log, export | `organization.update`, `automations.*`, `audit.read`, `organization.export` |

### 8b. Super admin control plane

| Need | Source |
|---|---|
| Client list with search, filters, tags, status | `listClients` → `admin_client_overview_v` |
| Health score and why | `client_health_scores` + `client_health_score_components` (`getHealthBreakdown`) |
| Revenue by client, start/renewal dates, assigned coach/AM | `client_profiles` columns in the overview view |
| Last login, last KPI update, program progress, overdue tasks, wins, blockers, next call | computed columns in `admin_client_overview_v` |
| At-risk alerts | `needs_attention` flag + `client.at_risk` domain events (automation-ready) |
| Enter any workspace | super admin passes every `orgs_with_permission` check; `/w/[slug]` just works |
| Preview as a client user | `startImpersonation` (read-only by default, audited) |
| Duplicate templates into one or many accounts | `applyTemplate`, `applyTemplatesBulk` |
| Export client data | `exportClientData`, `exportCsv` (both audited) |
| Suspend or archive | `setClientStatus` (clients lose access; staff keep it) |
| Platform-wide numbers | `app.platform_metrics()` |

---

## 9. Project folder structure

```
growth-os/
├─ ARCHITECTURE.md
├─ docs/DATA_MODEL.md                 generated column catalog
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/0001…0099_*.sql      schema, RLS, workflows, views, storage, billing
│  ├─ seed.sql                        demo tenants
│  └─ tests/                          SQL test suite (tenant isolation + workflows)
├─ scripts/
│  ├─ test-db.sh                      runs migrations + seed + SQL tests on local Postgres
│  ├─ api-smoke.ts                    tenant-isolation + workflow checks through the REST API
│  ├─ run-worker.ts                   drains domain events once (automations)
│  ├─ gen-data-model.py               regenerates docs/DATA_MODEL.md
│  └─ gen-types.py                    regenerates src/lib/supabase/database.types.ts
├─ src/
│  ├─ lib/
│  │  ├─ supabase/{server,admin,middleware,database.types}.ts
│  │  ├─ auth/{session,context}.ts    requireSession, requireOrg(slug), can(), assertCan()
│  │  ├─ permissions/keys.ts          typed permission keys
│  │  ├─ action.ts                    zod-validated server-action wrapper → ActionResult<T>
│  │  └─ errors.ts, env.ts
│  ├─ modules/
│  │  ├─ organizations/  invitations/  memberships/  team/  templates/  onboarding/
│  │  ├─ programs/  enrollments/  assignments/  kpis/  goals/  tasks/
│  │  ├─ files/  audit/  impersonation/  health/  reports/  records/
│  │  ├─ billing/      checkout, Stripe webhook fulfillment
│  │  ├─ automations/  event worker, conditions, action executors, scheduled checks
│  │  └─ email/        outbox drain + provider interface (Resend)
│  └─ app/                            Next.js routes (placeholder, wired to real actions)
│     ├─ admin/clients/page.tsx
│     ├─ w/[orgSlug]/programs/page.tsx
│     ├─ invite/[token]/page.tsx
│     ├─ api/webhooks/stripe/route.ts
│     └─ api/cron/[job]/route.ts      events (every minute), daily (checks + health)
└─ package.json, tsconfig.json, .env.example, vercel.json
```

---

## 10. API surface (server actions)

All live in `src/modules/*/actions.ts`, return `Result<T>`, and take an `orgSlug` (resolved server-side to an ID after the membership check), never a raw org ID from the browser.

- **Platform:** `createClient`, `listClients(filters)`, `setClientStatus`, `assignTeamMember`, `removeTeamMember`, `applyTemplates(templateRefs, orgSlugs[])`, `startImpersonation`, `endImpersonation`, `exportClientData(orgSlug)`, `recalculateHealthScores`
- **Auth/identity:** `recordLogin`, `updateMyProfile`, `getMyWorkspaces`
- **Members:** `inviteMember`, `acceptInvitation(token)`, `revokeInvitation`, `changeMemberRole`, `setPermissionOverride`, `removeMember`, `createCustomRole`
- **Onboarding:** `getQuestionnaire`, `submitQuestionnaire`
- **Programs:** `createProgram`, `updateProgram`, `createSection`, `createModule`, `createLesson`, `upsertLessonBlock`, `reorder(entity, ids[])`, `publishProgram`, `getProgramOutline`
- **Enrollments:** `enrollUser`, `revokeEnrollment`, `completeLesson`, `getProgressReport(programId)`
- **Assignments/quizzes:** `submitAssignment`, `reviewSubmission`, `submitQuizAttempt`
- **KPIs:** `createKpiDefinition`, `updateKpiDefinition`, `upsertKpiEntry`, `submitWeeklyScorecard`, `getKpiTrend(kpiId, range, granularity)`
- **Goals:** `createGoal`, `createQuarterlyGoal`, `setMonthlyTarget`, `updateGoalProgress`
- **Tasks:** `createTask`, `setTaskStatus`, `assignTask`, `commentOnTask`, `listMyTasks`
- **Files:** `createUploadUrl`, `getDownloadUrl`
- **Audit:** `listAuditLog(orgSlug, filters)`
- **Reports:** `getSalesFunnel`, `getProgramCompletion`, `exportCsv(reportKey, range)`
- **Webhooks (route handlers):** `POST /api/webhooks/stripe` (signature-verified, idempotent via `stripe_events`)

---

## 11. Implementation phases

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | schema, tenancy, RLS, roles/permissions, invitations, audit, impersonation, templates, LMS core, KPIs, tasks, goals, health, automation worker, Stripe fulfillment, seed, tests | **Built in this delivery** |
| 2. Connect Supabase + auth UI | create project, `supabase db push`, auth pages (magic link + password), workspace switcher, invite acceptance page | Next |
| 3. Admin control plane UI | client list with filters, health, alerts, bulk template apply, export | |
| 4. Client workspace UI | Home, Roadmap, Programs player, Scorecard, KPIs, Goals, Tasks, Pipeline, Content, Calls, Resources, Team, Messages, Settings | |
| 5. Payments | Create Stripe products/prices and store their ids, Billing Portal, dunning emails (checkout + webhook fulfillment already built) | |
| 6. Automations UI | builder for triggers/conditions/actions (worker + executors already built), email template editor | |
| 7. Integrations | automated KPI sources (Stripe, YouTube, Meta Ads, GHL, Calendly), Zapier/webhooks | |
| 8. Scale + hardening | partitioning for events/audit, read replicas, rate limits, SOC2-style controls | |

---

## 12. Risks, edge cases, scalability

**Security**
- *RLS helper recursion.* Helpers that query `organization_memberships` would recurse into that table's own policy. Solved with `SECURITY DEFINER` helpers in `private`.
- *Service-role leakage.* The admin client is in a file that imports `server-only`. It is never used in user actions.
- *Impersonation abuse.* Super admin only, read-only by default, 60-minute expiry, reason required, every row audited.
- *Invitation hijack.* Tokens are stored as SHA-256 hashes, single use, expire in 7 days, and the accepting account's email must match.
- *Last super admin removal* is blocked by a trigger.
- *Financial leakage to team members.* `is_financial` KPIs and billing tables need explicit permissions, and students never get them.

**Edge cases handled**
- A user in several orgs (a coach who is also a client). The context is always resolved per request from the URL slug.
- The same program unlocked by two offers. Enrollment is unique on `(program, user)`, and the second purchase just records another source.
- A drip lesson that is also sequential. Both conditions must pass, and the outline shows the reason.
- A lesson added after a student finished. Progress % is recomputed from current lesson counts, so the student drops below 100% but keeps their certificate.
- Template edited after being applied. Copies are independent, and `copied_from_id` enables a future "sync changes" feature.
- Timezones. Periods are stored as dates in the org's timezone, and events as `timestamptz`.
- KPI with "lower is better" (CAC, CPL). `direction` flips the status math.
- Archived org. Members lose access (`orgs_with_permission` ignores non-active orgs for non-staff) while data stays intact.

**Scalability**
- Composite indexes lead with `organization_id`.
- `domain_events`, `audit_logs`, `login_activity`, `content_metrics`, and `kpi_entries` are the high-volume tables. They're ready for monthly partitioning (by `created_at`) once they pass roughly 10M rows.
- Health scores and admin overview metrics are cached on `client_profiles` and refreshed by a scheduled job, so the admin list stays O(clients), not O(all rows).
- The permission set per request is small (orgs × perms), and policies evaluate it once per statement.
- If one client grows huge, the pool model can move that tenant to a dedicated project later, because every row already carries `organization_id`.
