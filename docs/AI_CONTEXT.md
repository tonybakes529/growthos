# Growth OS: AI Briefing

You are an AI assistant being brought onto an existing codebase. This document is your complete orientation. Read it fully before proposing or writing anything. It is written to be pasted into any AI tool as context, so it assumes you know nothing about the project.

Last verified against the live system: 2026-09-17, branch `feat/customer-onboarding` (customer onboarding added, see section 11a).

Where this document and the code disagree, the code wins. Where this document and `ARCHITECTURE.md` disagree, this document is newer (for example `ARCHITECTURE.md` says 62 permissions, the live database has 111).

---

## 1. What this product is

Growth OS is a multi-tenant coaching and business-growth platform owned by Tony (Bakes Media). Think "Kajabi-style course delivery, plus weekly KPI scorecards, accountability, a sales pipeline, tasks, and a control plane for the agency running it".

There are two sides:

1. **The control plane** (`/admin/*`). Tony and his internal team see every client, their health score, MRR, renewals, last login, blockers, and can create new client workspaces and push templates into them.
2. **Client workspaces** (`/w/[orgSlug]/*`). Each paying client (for example "Apex Roofing Co") gets a private workspace. Inside it, people hold one of three roles: client admin, client team member, or student.

One login can belong to many workspaces with a different role in each.

---

## 2. Stack and live infrastructure

| Layer | Choice |
|---|---|
| Framework | Next.js 15.5 App Router, React 19, TypeScript strict |
| Rendering | Server Components and Server Actions only. There are no client-side data fetches and almost no client components (`side-nav.tsx` is the only one). |
| Database | Supabase Postgres 17, region us-east-1, project ref `bldilrppngmmjjaykoji` |
| Auth | Supabase Auth (GoTrue), email + password, ES256 asymmetric JWTs |
| Data access | `@supabase/ssr` 0.12 and `supabase-js` 2.116, through PostgREST. No ORM. |
| Validation | zod on every server action input |
| Styling | One plain CSS file (`src/app/globals.css`), class names like `card`, `btn`, `grid g2`. No Tailwind, no component library. |
| Payments | Stripe (checkout + webhook fulfillment built, no products created yet, nothing charges) |
| Email | `email_outbox` table drained by a cron worker, Resend adapter, off until `RESEND_API_KEY` is set |
| Hosting | Vercel Hobby plan, region iad1, auto-deploys from `main` |
| Repo | github.com/tonybakes529/growthos (currently public) |
| Live URL | https://growthos-tan.vercel.app |

Live database size: 153 tables, 476 RLS policies, 54 `app.*` workflow functions, 9 reporting views, 111 permissions, 9 system roles, 25 automation trigger types.

---

## 3. The one idea you must not violate

**Postgres is the security boundary, not the application.**

Every query the app makes runs as the signed-in user (anon key + the user's JWT), so Row Level Security filters it. The app never uses the service-role key in a user-facing path. If a server action has a bug, the database still refuses cross-tenant reads and writes.

Practical consequences for any code you write:

- Never import `src/lib/supabase/admin.ts` (service role) into a page, layout, or user-facing action. It is only for the cron worker and the Stripe webhook.
- Never accept an `organization_id` from the browser. Accept an `orgSlug` from the URL and resolve it with `requireOrg(slug)`, which asks the database to verify the caller belongs there.
- Never "fix" a permission problem by bypassing RLS. If a user cannot see something, the answer is a permission, a policy, or an RPC, never the admin client.
- UI permission checks (`can(ctx, 'tasks.create')`) are for user experience only. The database enforces the same rule again.

---

## 4. Request lifecycle

A request to `/w/apex-roofing/tasks` goes through these steps:

1. **`src/middleware.ts`** calls `updateSession()`. It builds a Supabase client from the request cookies and calls `auth.getClaims()`, which verifies the JWT locally against the project's cached JWKS and refreshes the session cookie if it expired. If there is no user and the path starts with `/admin` or `/w/`, it redirects to `/login?next=...`. Middleware skips `_next/static`, `_next/image`, `favicon.ico`, `api/webhooks`, and `api/cron`.
2. **`getSession()`** in `src/lib/auth/session.ts` (wrapped in React `cache`, so once per request) verifies claims again locally, then calls the RPC `app.get_session_context()`. That returns `real_user_id`, `effective_user_id`, `is_super_admin`, `is_real_super_admin`, `is_platform_staff`, and any active `impersonation` session.
3. **`requireOrg(slug)`** in `src/lib/auth/context.ts` (also cached per request) runs `app.get_org_context(p_slug)` concurrently with step 2. The database checks membership or staff assignment and returns the org row plus the caller's full permission set for that org. If the caller has no access it raises, and the page calls `notFound()`.
4. **The page** (a Server Component) runs its data queries in one `Promise.all`, using `ctx.sb`, the per-request client that acts as the user.
5. **Mutations** are inline server actions in the page (`'use server'`) that call a function from `src/modules/*/actions.ts`, then call `done(path, result, 'Success message')` from `src/components/flash.ts`, which revalidates the path and redirects back with `?msg=` or `?err=` in the URL. The `<Flash>` component renders it.

Do not reintroduce `auth.getUser()` in steps 1 or 2. It was removed on 2026-09-17 because it made about 3 network calls to the Auth server per page view. The tradeoff is documented: a session revoked server-side stays valid until its access token expires (1 hour by default).

---

## 5. Tenancy model

- Pool model: one database, shared tables, every tenant-owned row has `organization_id uuid not null`.
- `organizations.kind` is one of `platform` (Tony's own company), `client`, or `template_library` (a special org whose rows are the source for templates).
- Every child table carries its own `organization_id` (denormalized) and uses composite foreign keys such as `lessons(organization_id, module_id) -> modules(organization_id, id)`. The database itself rejects a child that points at another tenant's parent.
- Platform-level tables have no `organization_id`: `users`, `user_profiles`, `platform_staff`, `permissions`, system `roles`, `login_activity`, `impersonation_sessions`, `health_score_models`, all `*_templates` registries, `stripe_events`.
- `public.users` is a mirror of `auth.users`. Supabase owns the real one.

### Standard columns on tenant tables

`id uuid`, `organization_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, and on business data `deleted_at`, `deleted_by`. The `private.stamp()` trigger sets the audit columns from the real actor, so the browser cannot spoof them. Business data is soft-deleted. Always filter `.is('deleted_at', null)` when reading tables that have it.

Money is integer cents plus a `currency` code. Never use floats for money.

---

## 6. Identity, roles, and permissions

### Three ways a user gets access

| Mechanism | Table | Who |
|---|---|---|
| Platform role | `platform_staff` | `super_admin` (everything, everywhere) and `internal_team` (nothing by itself) |
| Staff assignment to a client | `team_assignments` | Internal team reaching a specific client as `account_manager`, `coach`, `sales_manager`, or `content_manager`. Being staff alone grants nothing inside a client workspace. |
| Membership | `organization_memberships` | Client-side people: `client_admin`, `client_team_member`, `student`. Orgs may also define custom roles. |

A "student" is just a membership with the `student` role. It is not a separate user type.

### Permissions

Permissions are `module.action` string keys, for example `tasks.create`, `kpis.read`, `financials.read`, `roles.manage`, `programs.grade`, `templates.apply`. The TypeScript union lives in `src/lib/permissions/keys.ts` and must be kept in sync with the `permissions` table by hand.

Roles are bundles of permissions (`role_permissions`). `permission_overrides` grant or deny a single permission to one user in one org, and deny wins.

### The permission engine (schema `private`, not exposed over the API)

- `private.orgs_with_permission(perm text)`: the set of org ids where the current user holds `perm`. Combines super admin, memberships, team assignments, role permissions, and overrides.
- `private.orgs_with_access()`: orgs the user can enter at all.
- `private.has_permission(org, perm)`, `private.assert_permission(org, perm)`.
- `private.is_super_admin()`, `private.is_real_super_admin()`, `private.is_platform_staff()`.
- `private.effective_user_id()`: returns the impersonated user while a super admin has an active impersonation session. All RLS helpers use it, which is how "View as" shows exactly what the client sees.

All are `stable security definer` with a pinned empty `search_path`.

### What an RLS policy looks like

```sql
create policy tasks_select on public.tasks for select to authenticated
  using (organization_id in (select private.orgs_with_permission('tasks.read')));
```

The `(select ...)` wrapper is mandatory. It makes Postgres evaluate the function once per statement instead of once per row. Every policy in the schema follows this. If you write a policy that calls `auth.uid()` or a helper without the wrapper, Supabase's linter flags it and it will be slow at scale.

Most policies are generated from `private.rls_registry` (table -> module, soft-delete flag, audit flag). Tables whose visibility is per-person have hand-written policies in migration `0013`: programs and lessons (enrolled users only), enrollments and progress (own rows), tasks (assignees or org-visible), coaching sessions (attendees), DMs (participants), notifications (recipient), financial KPIs (`financials.read`), health scores (staff only, clients can never read their own health score).

### Anti-elevation rules, enforced in the database

1. Nobody can change their own membership, role, or overrides.
2. You can only grant a role or override whose permissions are a subset of your own in that org.
3. Custom roles can only contain permissions their creator holds.
4. `platform_staff` is writable only by super admin, and the last active super admin cannot be removed.
5. Direct INSERT or UPDATE on memberships, overrides, team assignments, and `platform_staff` is blocked by RLS. They must go through RPCs.

### Column guards

`organizations` and `client_profiles` have BEFORE UPDATE triggers that restrict which columns a non-staff user may change. On `client_profiles` a client admin may edit only business facts (`legal_name`, `industry`, `business_model`, `team_size`, `primary_contact_user_id`, `current_monthly_revenue_cents`, `revenue_target_cents`). Commercial and signal columns (MRR, renewal, `last_client_login_at`, health) are staff-only.

**Known trap:** the guard checks `auth.uid()`, which stays the end user even inside a `security definer` function. Any workflow that legitimately needs to write a guarded column on behalf of a client must wrap the write in `perform private.bypass_org_guard();` ... `perform private.end_org_guard_bypass();`. Forgetting this caused a production bug where every client login silently failed to record (fixed in migration `20260917000101`).

---

## 7. Database layout

| Schema | Purpose | Exposed via API |
|---|---|---|
| `public` | All tables and the 9 reporting views. RLS on every table. | Yes |
| `app` | 50 workflow RPCs. Each re-checks permissions internally. | Yes (added to PostgREST exposed schemas) |
| `private` | Permission engine, triggers, helpers. | No |

If an RPC call returns 404 or `PGRST106`, the `app` schema has dropped out of Supabase Dashboard > Settings > API > Exposed schemas.

Call RPCs like this: `sb.schema('app').rpc('create_task', { p_organization_id: ..., p_title: ... })`. Parameters are always prefixed `p_`.

### Migrations (`supabase/migrations/`)

| File | Contents |
|---|---|
| `0001_foundation` | extensions, schemas, stamp and audit triggers |
| `0002_identity_tenancy` | users, organizations, roles, permissions, memberships, team assignments, overrides, invitations, login activity, impersonation, audit logs, domain events |
| `0003_crm_files_fields` | client_profiles, contacts, tags, notes, files, custom fields |
| `0004_offers_billing` | offers, versions, pricing options, entitlements, coupons, purchases, subscriptions, payments, stripe_events |
| `0005_programs_lms` | programs > sections > modules > lessons > blocks, enrollments, progress, assignments, quizzes, certificates |
| `0006_coaching_delivery` | recurring calls, sessions, attendees, notes, recordings, action items, check-ins, wins, blockers, milestones |
| `0007_growth_os` | goals, KPIs, scorecards, dashboards, experiments, projects, tasks, SOPs, meetings |
| `0008_sales` | pipelines, stages, leads, opportunities, appointments, calls, commissions, marketing spend |
| `0009_content` | ideas, items, scripts, publishing, metrics |
| `0010_community` | announcements, discussions, conversations, DMs, notifications, email templates, email outbox |
| `0011_templates_onboarding` | template registries, onboarding templates, questionnaires |
| `0012_automations_health` | trigger and action types, automations, runs, webhooks, health models and scores |
| `0013_rls_policies` | hand-written policies and column guards |
| `0014_workflows` | every `app.*` function (1,846 lines, the heart of the backend) |
| `0015_reporting` | views, `kpi_trend`, `kpi_period_comparison`, `platform_metrics` |
| `0016_storage` | private `org-files` bucket and storage policies |
| `0017_billing_fulfillment` | `fulfill_purchase`, `record_subscription_event` (service role only) |
| `0099_finalize_grants` | re-asserts function privileges |
| `0100_hardening` | pins `search_path` on remaining functions |
| `20260917000101_login_fix_and_perf` | record_login fix, one RLS initplan fix, 231 foreign key indexes |

Every column of every table is catalogued in `docs/DATA_MODEL.md` (2,688 lines, generated by `npm run db:docs`). TypeScript types are generated into `src/lib/supabase/database.types.ts` by `npm run db:types`. Regenerate both after any schema change.

### Reporting views

`admin_client_overview_v` (one row per client for the control plane), `kpi_latest_v`, `kpi_entry_status_v` (computes on track, at risk, off track, respecting `direction` so "lower is better" KPIs like CPL work), `program_completion_v`, `org_growth_metrics_monthly_v`, `sales_by_rep_monthly_v`, `sales_by_offer_monthly_v`, `content_performance_v`, `team_performance_v`. All are `security_invoker`, so RLS applies through them.

---

## 8. Core workflows (the `app.*` RPCs)

Multi-table writes are RPCs so they stay atomic and the permission check lives next to the data. Simple single-table CRUD goes straight through RLS.

| Workflow | Function | Effect |
|---|---|---|
| Create client | `create_client_organization` | org + client_profile, apply onboarding template, invite client admin, assign staff, emit `client.created` |
| Apply template | `apply_template`, `apply_templates_bulk` | deep-copies a program tree, scorecard + KPIs, pipeline + stages, dashboard, SOP, offer, or task list into a client org, remapping every id |
| Invite / accept | `invite_member`, `accept_invitation` | hashed single-use token, 7-day expiry, accepting email must match, then membership + pre-assigned enrollments |
| Roles | `change_member_role`, `set_permission_override`, `assign_team_member` | anti-elevation enforced |
| Onboarding | `submit_onboarding_questionnaire` | stores answers, writes mapped fields to client_profile, creates baseline KPI entries |
| LMS | `enroll_user`, `get_program_outline`, `complete_lesson`, `unlock_lesson`, `submit_assignment`, `review_submission`, `submit_quiz_attempt` | drip and sequential locks, progress rollup, certificate at 100% |
| KPIs | `upsert_kpi_entry`, `submit_weekly_scorecard` | period normalization, target snapshot, emits `kpi.missed` when off track |
| Tasks | `create_task`, `set_task_status`, `assign_task` | notifications and events |
| Health | `calculate_health_score`, `calculate_all_health_scores` | explainable per-factor components, caches on client_profiles, emits `client.at_risk` |
| Impersonation | `start_impersonation`, `end_impersonation` | super admin only, read-only by default, 60-minute expiry, reason required, fully audited |
| Session | `get_session_context`, `get_org_context`, `get_my_workspaces`, `record_login` | request context |
| Billing | `fulfill_purchase`, `record_subscription_event` | service role only, idempotent |
| Deletion | `soft_delete(table, id)` | registry-whitelisted |

---

## 9. Events, automations, and background work

Important writes insert a row into `domain_events` (outbox pattern). Nothing reacts synchronously.

`src/modules/automations/worker.ts` (service role) does the reacting:

- `processDomainEvents()`: claims unprocessed events, finds matching `automations` for that org and trigger, evaluates `automation_conditions`, executes `automation_actions`, records `automation_runs` and steps. Also runs delayed steps.
- Action executors: `send_notification`, `notify_coach`, `send_email`, `create_task`, `assign_program`, `unlock_lesson`, `update_client_status`, `add_tag`, `remove_tag`, `create_follow_up`, `trigger_webhook`.
- `emitScheduledEvents()`: daily scan that emits `task.overdue` and `client.inactive`.
- `drainEmailOutbox()` in `src/modules/email/outbox.ts` sends queued email through Resend.

The 21 trigger types: `assignment.reviewed`, `assignment.submitted`, `call.completed`, `client.at_risk`, `client.created`, `client.inactive`, `client.invited`, `enrollment.created`, `goal.achieved`, `kpi.missed`, `kpi.submitted`, `lesson.completed`, `member.joined`, `payment.failed`, `payment.succeeded`, `program.completed`, `questionnaire.submitted`, `subscription.canceled`, `task.completed`, `task.created`, `task.overdue`.

Entry points are `GET /api/cron/events` and `GET /api/cron/daily`, both requiring `Authorization: Bearer $CRON_SECRET` with a timing-safe compare. They fail closed (HTTP 500) when `CRON_SECRET` is unset.

**Important limitation:** the code comments describe `/api/cron/events` as "every minute", but the Vercel Hobby plan allows daily crons only, so `vercel.json` runs it once a day at 08:00 UTC. Automations, delayed steps, and email therefore drain once per day until the plan is upgraded.

Stripe: `POST /api/webhooks/stripe` verifies the signature, inserts the event id into `stripe_events` first so a retried delivery is detected before any side effect, then handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.

---

## 10. Code map

```
src/
  middleware.ts                    session refresh + route protection
  lib/
    env.ts                         zod-validated env, lazy so `next build` works without secrets
    action.ts                      action(schema, handler) wrapper -> ActionResult<T>; zId, zSlug, zOrg, zDate
    errors.ts                      AppError, fromDbError (maps Postgres codes), unwrap, unwrapRequired
    auth/session.ts                getSession, requireSession, requirePlatformStaff, requireSuperAdmin
    auth/context.ts                requireOrg(slug), can(), assertCan(), assertWritable()
    permissions/keys.ts            Permission union type, ROLE_KEYS
    supabase/server.ts             per-request client acting AS THE USER
    supabase/admin.ts              service-role client, worker and webhook only
    supabase/middleware.ts         updateSession
    supabase/database.types.ts     generated
  modules/<domain>/actions.ts      thin server-side domain functions (22 modules)
  components/
    shell.tsx                      page frame, loads workspaces for the sidebar
    side-nav.tsx                   the only client component
    ui.tsx                         PageHead, Stat, Pill, Bar, Flash, day(), dayTime()
    flash.ts                       done(path, result, message) redirect helper
  app/                             routes, see section 11
supabase/migrations, seed.sql, tests/
scripts/test-db.sh, api-smoke.ts, run-worker.ts, gen-data-model.py, gen-types.py
```

Modules: organizations, invitations, memberships, team, templates, onboarding, programs, enrollments, assignments, kpis, goals, tasks, files, audit, impersonation, health, reports, records, sales, billing, automations, email.

### The pattern every server function follows

```ts
import 'server-only';
export const createTask = action(
  z.object({ orgSlug: zSlug, title: z.string().min(1).max(300) /* ... */ }),
  async (i) => {
    const ctx = await requireOrg(i.orgSlug);      // slug -> verified org + permissions
    assertCan(ctx, 'tasks.create');               // fail fast, DB re-checks
    const id = unwrap(await ctx.sb.schema('app').rpc('create_task', {
      p_organization_id: ctx.organizationId, p_title: i.title,
    }));
    return { taskId: id as string };
  },
);
```

Rules of the pattern:

- `action()` validates with zod and converts any thrown error into `{ ok: false, error: { code, message } }`. Internal errors are logged server-side and shown to the user only as "Something went wrong".
- `unwrap()` throws a mapped `AppError` on a database error. Postgres `42501` becomes `forbidden`, `P0002` and `PGRST116` become `not_found`, `23505` becomes `conflict` with a readable message, `P0001` (a plain `raise exception` from a workflow) becomes a user-facing `validation` message.
- Results are `ActionResult<T>`. Check `res.ok` before reading `res.data`.
- Pages fetch everything in one `Promise.all`. Do not add serial awaits.

---

## 11. What is built in the UI, and what is not

This is the most important section for planning work. The backend is far ahead of the frontend.

### Built (13 routes)

| Route | Notes |
|---|---|
| `/login`, `/signup`, `/invite/[token]`, `/logout` (POST only) | |
| `/` | redirect only: staff to `/admin/clients`, clients to their first workspace |
| `/admin/clients` | the entire control plane: stat tiles, filterable client table, new-workspace form, bulk template apply, recalculate health |
| `/w/[orgSlug]` | Home: KPI tiles, my tasks, upcoming calls, my programs, wins, blockers, announcements, onboarding questionnaire |
| `/w/[orgSlug]/programs`, `/programs/[programId]`, `/lessons/[lessonId]` | full LMS: outline, progress, lesson blocks, assignments, quizzes, plus builder and student report for those with permission |
| `/w/[orgSlug]/scorecard` | weekly KPI entry and week navigation |
| `/w/[orgSlug]/tasks` | table with inline edit and add form |
| `/w/[orgSlug]/pipeline` | deals by stage, move, add, 30-day metrics |
| `/w/[orgSlug]/team` | members, roles, invites, assigned staff, "View as" |

### Backend exists, no UI yet

Roadmap and milestones, Goals, KPI definitions and trends, Content tracker, Coaching calls and replay library, Resources and SOPs, Messages and discussions, Notifications, Settings, Automations builder, Audit log viewer, Health score breakdown, Reports and CSV export, Dashboards, Checkout and billing pages, Contacts CRM. The tables, RLS, and in most cases the server actions already exist. Building these is mostly frontend work against existing actions.

### Known UI defects (as of 2026-09-17)

1. Apex Roofing has no student in the seed data, only Northstar Fitness does. (The sidebar and Team page defects listed here earlier were fixed on 2026-09-17.)

---

## 11a. Customer onboarding (added 2026-09-17)

Hierarchy: operator (super admin or staff) -> client (`organizations`) -> course (`programs`) -> customer (a `contacts` row that becomes a `student` membership). The UI says "course"; the table is still `programs`.

**Journey, and what implements each step**

| Step | Implementation |
|---|---|
| Course purchased | Stripe webhook -> `app.fulfill_purchase` (unchanged), or `app.add_customer` from the Customers page, which is the same road minus the payment |
| Customer record created, no duplicates | `contacts` upsert on (org, email), then `customer_onboardings`, unique on (org, course, email) |
| Unique link | Existing `invitations`: 32 random bytes, only the SHA-256 hash stored, 7 days, single use, email must match. Student invitations that carry `program_ids` get `/join/{slug}/{token}` and the `customer_invitation` email template |
| Record appears whatever created the invitation | Triggers `track_customer` on `invitations` and on `program_enrollments`. `merge_customer_programs` carries earlier unaccepted courses onto a replacement invitation |
| Branded welcome + account | `/join/[orgSlug]/[token]`. Anon reads `app.get_invitation`, still the only anon-callable app function. The slug is cosmetic and checked, the token is the credential, the email always comes from the invitation |
| Knows client + course + form | `app.get_my_onboarding(slug)` resolves it from the signed-in user. The customer never sends a client, course or form id |
| Custom form | `/start/[orgSlug]`, outside the app shell, client branding from `organizations.logo_url` and `settings.brand_color` |
| Save progress | `onboarding-autosave.tsx` (second client component in the app) saves one field per request on change. "Save and finish later" is the no-JS path |
| Submit | `app.save_onboarding_answers(id, answers, submit)`. All validation is in the database. One row per question in `customer_onboarding_answers` |
| Event | `customer.onboarding_completed`, payload has `answers` keyed by each question's stable `key` (numbers stay numeric) plus a full `responses` list. Also `customer.invited`, `customer.registered`, `customer.onboarding_started` |

**Status values** on `customer_onboardings.status`: `invited` -> `registered` -> `in_progress` -> `completed`. The UI shows Invited or Active, and Not started, In progress or Complete.

**Pages**: `/w/[slug]/customers`, `/customers/[id]` (journey, details, enrollments with progress, assigned tasks, answers), `/onboarding` (form list, a tab inside Courses), `/onboarding/[formId]` (builder: add, edit, delete, reorder, required, publish, attach to course, wording, branding), `/onboarding/[formId]/preview`, `/automations`, `/activity`.

**Navigation** (`shell.tsx`): `MAIN` = Home, Customers (`enrollments.read`), Courses, Growth (`kpis.read`, opens `/scorecard`), Tasks; `MANAGE` = Team (`members.read`), Automations (`automations.read`), Activity (`organization.read`); `LEARNER` = Home, My Courses, My Tasks. `isLearner(ctx)` in `auth/context.ts` is true when every permission is in `community.*` or `messages.*`, which is what the system student role holds. Gate on permission keys, never role names. `SubNav` in `components/subnav.tsx` gives Courses its "Courses | Onboarding forms" tabs. URLs did not change.

**Home screens** (`/w/[slug]/page.tsx`): `LearnerHome` computes one next action from `getProgramOutline` (respects drip and sequencing), `TeamHome` builds a "Needs attention" list from overdue tasks, the reporting week's scorecard status, unfinished customers, off-track KPIs and blockers. `/admin/clients` derives per-client reasons from the same signals `admin_client_overview_v.needs_attention` uses, and lists the operator's tasks across workspaces via `listMyTasksEverywhere`.

**Security model**: forms need `programs.read` to view and `programs.update` to edit. Customer records and answers need `enrollments.read`, or being the customer. The `student` role holds none of these. `customer_onboardings` and `customer_onboarding_answers` have select policies only: every write goes through the RPCs, which check `auth.uid()`. Composite foreign keys stop a course pointing at another tenant's form. Pages use `requireOrgPage()`, so a workspace you cannot enter is a 404.

**Rules specific to this feature**
- Question `key`s are generated once and never change, including after a rename. Deleted questions are soft-deleted and their keys stay reserved, so old answers never attach to a new question.
- A form must be published to attach to a course, and cannot be unpublished while attached.
- The invite link is shown once through a 5 minute httpOnly cookie, never in the URL.
- Tests: `supabase/tests/04_customer_onboarding.sql` covers the full 18 point path.

**Open decision**: the Supabase project has "Confirm email" ON. A brand-new customer therefore has to click a confirmation email before they get a session, then sign in on the join page. The page handles it, but it is two extra steps. Turning "Confirm email" off in Supabase Auth makes it one step, which is reasonable here because the customer only ever arrives through a personal link sent to that email.

---

## 12. Environment, deployment, testing

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Committed in `.env.production` on purpose. The anon key is public by design and gated by RLS. Locally the same values live in gitignored `.env.local`. |
| `NEXT_PUBLIC_APP_URL` | No | Falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then localhost |
| `SUPABASE_SERVICE_ROLE_KEY` | For cron and Stripe | **Not yet set in Vercel.** Full-access secret. Never commit, never log, never send to a browser. |
| `CRON_SECRET` | For cron | **Not yet set in Vercel.** |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` | Optional | Features stay dormant without them |

### Commands

`npm run dev`, `npm run build`, `npm run typecheck`, `npm run db:test` (needs local Postgres 15+ and psql, runs all migrations + seed + the SQL suite in `supabase/tests/` covering tenant isolation, permissions, workflows), `npm run db:types`, `npm run db:docs`, `npm run worker:events`.

### Deployment

Push to `main` and Vercel builds and deploys to production automatically. Database migrations are **not** applied by the deploy. They are applied separately to the Supabase project, and the matching `.sql` file must be committed so local resets reproduce production.

Use https://growthos-tan.vercel.app. The URL `growthos-tonys-projects-7b39d31c.vercel.app` sits behind Vercel Authentication and shows Vercel's own login page to everyone but Tony.

Local development currently points at the **live** Supabase project. Writes in dev are real.

### Demo data

Three client orgs (Apex Roofing Co, Clearpath Consulting, Northstar Fitness) and eight `*.test` users covering super admin, staff, client admin, team member, and student. Credentials are in the local, untracked `HANDOFF.md`. They are deliberately not in this file because the repo is public. No real account exists yet for Tony.

---

## 13. Rules for any AI working on this codebase

**Security**
1. Never use the service-role client in a user-facing path.
2. Never trust an org id from the client. Slug in, `requireOrg()`, id out.
3. Every new `public` table needs RLS enabled and policies, with `(select ...)` wrapped helper calls. A test fails if a table has no RLS.
4. New tenant tables need `organization_id not null`, the standard audit columns, the stamp trigger, a composite FK to their parent, and an index leading with `organization_id`. Index every foreign key except the audit columns (`created_by`, `updated_by`, `deleted_by`), which are skipped on purpose.
5. Never commit secrets, the demo password, or `HANDOFF.md`. The repo is public.
6. Do not weaken or merge RLS policies to silence a linter. The 27 "multiple permissive policies" warnings are known and intentionally left: the quals are initplans, and several write policies grant wider read than the select policy.

**Code**
7. Follow the `action()` + `requireOrg()` + `assertCan()` + `unwrap()` pattern exactly.
8. Multi-table or permission-sensitive writes belong in an `app.*` RPC, not in TypeScript.
9. Server Components and Server Actions only. Do not add client-side fetching, a state library, Tailwind, or a component kit.
10. Parallelize page queries with `Promise.all`.
11. Filter `deleted_at is null` on soft-deletable tables.
12. After a schema change: write a migration file, apply it, run `db:types` and `db:docs`, update `permissions/keys.ts` if permissions changed.
13. If a workflow writes a guarded column on `organizations` or `client_profiles` for a non-staff user, use the scoped guard bypass (section 6).

**Process**
14. Run `npm run typecheck` and `npm run build` before declaring anything done.
15. Test as more than one role. Most bugs here are role-specific. The super admin passes every check, so testing only as super admin proves nothing.
16. Tony wants concise output, no em dashes, no over-explanation.

---

## 14. How to split work across multiple AIs

The architecture makes some splits safe and others dangerous.

**Safe to parallelize**
- Separate workspace pages. Each page under `src/app/w/[orgSlug]/` is self-contained and reads through existing actions. Two AIs can build "Goals" and "Content tracker" at the same time without touching the same files.
- Frontend-only work against existing actions (most of section 11's unbuilt list).
- Copy, styling, and `ui.tsx` additions, as long as one AI owns `globals.css` at a time.
- Read-only analysis: explaining a workflow, reviewing a policy, drafting SQL for review.

**Must be serialized through one owner**
- Anything in `supabase/migrations/`. Migration order matters and two AIs will collide on numbering and on `database.types.ts`.
- `src/lib/auth/*`, `src/lib/supabase/*`, `src/middleware.ts`, `src/lib/action.ts`, `src/lib/errors.ts`. Every request depends on them.
- `src/lib/permissions/keys.ts` and the `permissions` table, which must change together.
- `side-nav.tsx` and `shell.tsx`, shared by every page.

**What to give another AI so it is useful**
1. This file.
2. For any database work, the relevant slice of `docs/DATA_MODEL.md` (it is too big to paste whole) and the matching migration file.
3. For a new page, one existing page as a style reference. `src/app/w/[orgSlug]/tasks/page.tsx` is the cleanest small example, and its module `src/modules/tasks/actions.ts` shows the action pattern.
4. The role you want it tested as.

**What an AI without repo or database access cannot verify**
It cannot see live data, run the type checker, or confirm a policy works. Treat its SQL and permission logic as a draft, and have the AI with tool access (Claude Code in this setup, which has the Supabase, Vercel, and GitHub connections) apply, test, and deploy it. A good division is: other AIs draft pages, copy, and SQL; the tool-connected AI reviews against the real schema, applies migrations, tests as several roles, and ships.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| Org, workspace, tenant, client | The same thing: one row in `organizations` with `kind = 'client'` |
| Control plane | `/admin/*`, the platform owner's view across all clients |
| Staff | Tony's internal team, in `platform_staff`, reaching clients through `team_assignments` |
| Member | A client-side person, in `organization_memberships` |
| Effective user | The impersonated user during "View as", otherwise the real user |
| RPC, workflow | A Postgres function in the `app` schema |
| Guard | A trigger restricting which columns a non-staff user may update |
| Domain event | An outbox row in `domain_events` that automations react to later |
| Scorecard | A weekly set of KPI entries a client submits |
| Health score | Staff-only 0 to 100 rating per client, built from weighted explainable factors |
| Template library | The special org whose rows are copied into client orgs by `apply_template` |
