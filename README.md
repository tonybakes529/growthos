# Growth OS

Backend foundation for a multi-client coaching + growth operating platform: private client workspaces, a Kajabi-style program engine, KPIs and scorecards, sales and content tracking, client health, automations, and a super-admin control plane. The UI is deliberately bare. Every page that exists is wired to real data.

- **Architecture, role matrix, RLS strategy, workflows, phases, risks:** [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Every table and column (generated from the schema):** [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)

## What's in the box

| Path | What it is |
|---|---|
| `supabase/migrations/` | 18 migrations: 149 tables, RLS on all of them, permission engine, workflow functions (`app.*`), reporting views, storage, Stripe fulfillment |
| `supabase/seed.sql` | Template library + 3 client workspaces, created through the real workflows |
| `supabase/tests/` | SQL test suite: tenant isolation, permissions, anti-elevation, LMS rules, templates, billing, impersonation, storage |
| `src/lib/` | Supabase clients, session/org context, permission guard, server-action wrapper, error mapping, generated DB types |
| `src/modules/` | Server actions per domain (organizations, invitations, programs, KPIs, tasks, health, billing, automations, ...) |
| `src/app/` | Placeholder pages (admin client list, workspace programs, lesson outline, invite accept, login) + Stripe webhook + cron routes |
| `scripts/` | `test-db.sh`, `api-smoke.ts`, `run-worker.ts`, type and doc generators |

## Run it locally (Supabase CLI)

Requires Docker, Node 20+, and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
npm install
supabase start                 # applies migrations + seed.sql
cp .env.example .env.local     # paste the anon + service_role keys that `supabase start` printed
npm run dev                    # http://localhost:3000
```

Sign in with any seeded account (password `GrowthOS-demo-2026!`):

| Email | Role |
|---|---|
| owner@growthos.test | Super admin |
| devon@growthos.test | Account manager (all 3 clients) |
| maria@growthos.test | Coach (Apex + Northstar only) |
| jake@apexroofing.test | Client admin, Apex Roofing |
| sam@apexroofing.test | Team member, Apex Roofing (no financial access) |
| lena@northstarfit.test | Client admin, Northstar Fitness |
| ari@northstarfit.test | Student, Northstar Fitness |
| omar@clearpath.test | Client admin, Clearpath Consulting (onboarding not finished) |

## Deploy to your Supabase project

1. `supabase link --project-ref <ref>` then `supabase db push` (migrations only; don't push `seed.sql` to production).
2. **Project Settings → API → Exposed schemas:** add `app`.
3. Sign up with your real email, then run this once in the SQL editor to make yourself super admin:
   ```sql
   insert into public.platform_staff (user_id, role_id, title)
   select u.id, r.id, 'Founder' from public.users u, public.roles r
   where u.email = 'you@yourdomain.com' and r.key = 'super_admin'
   on conflict (user_id) do update set role_id = excluded.role_id, status = 'active';
   ```
4. Build your template library: create an organization with `kind = 'template_library'`, build programs, scorecards and pipelines in it, then register them (`registerTemplate`) and add them to an onboarding template.
5. Deploy the Next.js app (Vercel). `vercel.json` schedules `/api/cron/events` every minute and `/api/cron/daily` once a day. Set `CRON_SECRET`.
6. When you're ready for payments: create Stripe products and prices, save their ids on `offers.stripe_product_id` and `pricing_options.stripe_price_id`, and point a Stripe webhook at `/api/webhooks/stripe` (events `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`).

> If `supabase db push` reports it couldn't create the trigger on `storage.objects`, that's expected on some hosted projects. The app already calls `confirmUpload` after each upload.

## Tests

```bash
npm run typecheck
bash scripts/test-db.sh        # plain Postgres 15+: stubs Supabase auth/storage, applies everything, runs supabase/tests
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... npx tsx scripts/api-smoke.ts   # against a seeded stack
```

What the suites prove, among other things:

- A client can't read, write, link to, or RPC into another client's data, even with a forged `organization_id`.
- Staff only see the clients they're assigned to. Suspended clients lose access, but staff keep it.
- Team members never see financial KPIs, spend, purchases, commercial profile fields, health scores, or staff-only tasks.
- Nobody can raise their own permissions, grant permissions they don't hold, or write to access-control tables directly.
- Drip, sequential locks, quiz-gated and assignment-gated lessons are enforced in the database, locked lesson content is invisible, and completion rolls up to modules, programs and certificates.
- Impersonation shows exactly the target's view, blocks writes, and is audited.
- Stripe fulfillment is idempotent and handles installments, failures and new-buyer invitations.

## Conventions

- **Never pass organization ids from the browser.** Pages and actions take an org **slug**, and `requireOrg(slug)` resolves it in the database.
- **Multi-step or sensitive writes are `app.*` functions.** Simple CRUD goes straight to tables, and RLS enforces it.
- **New tenant table:** create it with `organization_id`, then `select private.standardize('<table>', '<permission module>', <soft_delete>, <audited>);`. That adds audit columns, the tenant key constraint, triggers and standard policies. Run `npm run db:types` and `npm run db:docs` afterwards.
- **New permission:** insert it into `public.permissions`, grant it to roles, and add it to `src/lib/permissions/keys.ts`.
