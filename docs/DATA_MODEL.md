# Data Model

Generated from the migrated schema by `scripts/gen-data-model.py`. Do not edit by hand.

**149 tables.** Standard audit columns (`created_at`, `updated_at`, `created_by`, `updated_by`, and `deleted_at`/`deleted_by` where soft delete is on) are listed once per table in the flags line instead of the column list.

Legend: 🏢 tenant-scoped (`organization_id`) · 🗑 soft delete · 📝 audited · 🔐 custom RLS · 🚫 service-role only

## Contents

- **Identity, Tenancy, Permissions, Audit**: [users](#users), [user_profiles](#user_profiles), [organizations](#organizations), [permissions](#permissions), [roles](#roles), [role_permissions](#role_permissions), [platform_staff](#platform_staff), [organization_memberships](#organization_memberships), [team_assignments](#team_assignments), [permission_overrides](#permission_overrides), [invitations](#invitations), [login_activity](#login_activity), [impersonation_sessions](#impersonation_sessions), [audit_logs](#audit_logs), [activity_history](#activity_history), [domain_events](#domain_events)
- **Client Profiles, Contacts, Notes, Files, Custom Fields**: [client_profiles](#client_profiles), [tags](#tags), [contacts](#contacts), [contact_tags](#contact_tags), [notes](#notes), [files](#files), [custom_fields](#custom_fields), [custom_field_values](#custom_field_values)
- **Offers, Pricing, Purchases, Subscriptions, Payments (Stripe-Ready)**: [offers](#offers), [offer_versions](#offer_versions), [pricing_options](#pricing_options), [offer_entitlements](#offer_entitlements), [coupons](#coupons), [order_forms](#order_forms), [billing_customers](#billing_customers), [purchases](#purchases), [coupon_redemptions](#coupon_redemptions), [subscriptions](#subscriptions), [payment_records](#payment_records), [offer_assignments](#offer_assignments), [stripe_events](#stripe_events)
- **Coaching Programs (Kajabi-Style Lms)**: [programs](#programs), [program_sections](#program_sections), [modules](#modules), [lessons](#lessons), [lesson_blocks](#lesson_blocks), [resources](#resources), [program_enrollments](#program_enrollments), [lesson_progress](#lesson_progress), [module_progress](#module_progress), [lesson_unlocks](#lesson_unlocks), [assignments](#assignments), [assignment_submissions](#assignment_submissions), [assignment_feedback](#assignment_feedback), [quizzes](#quizzes), [quiz_questions](#quiz_questions), [quiz_answer_keys](#quiz_answer_keys), [quiz_attempts](#quiz_attempts), [certificates](#certificates)
- **Coaching Delivery + Accountability**: [recurring_calls](#recurring_calls), [coaching_sessions](#coaching_sessions), [session_attendees](#session_attendees), [session_notes](#session_notes), [call_recordings](#call_recordings), [action_items](#action_items), [accountability_checkins](#accountability_checkins), [client_wins](#client_wins), [client_blockers](#client_blockers), [milestones](#milestones), [milestone_progress](#milestone_progress), [coach_ratings](#coach_ratings)
- **Growth Operating System**: [goals](#goals), [kpi_definitions](#kpi_definitions), [quarterly_goals](#quarterly_goals), [monthly_targets](#monthly_targets), [scorecards](#scorecards), [scorecard_kpis](#scorecard_kpis), [weekly_scorecards](#weekly_scorecards), [kpi_entries](#kpi_entries), [dashboards](#dashboards), [dashboard_widgets](#dashboard_widgets), [growth_projects](#growth_projects), [experiments](#experiments), [tasks](#tasks), [task_assignments](#task_assignments), [task_comments](#task_comments), [standard_operating_procedures](#standard_operating_procedures), [sop_versions](#sop_versions), [meeting_agendas](#meeting_agendas), [meeting_notes](#meeting_notes), [decisions](#decisions)
- **Sales System**: [pipelines](#pipelines), [pipeline_stages](#pipeline_stages), [attribution_sources](#attribution_sources), [lost_reasons](#lost_reasons), [setters](#setters), [closers](#closers), [leads](#leads), [opportunities](#opportunities), [appointments](#appointments), [sales_calls](#sales_calls), [sales_notes](#sales_notes), [follow_up_tasks](#follow_up_tasks), [commissions](#commissions), [marketing_spend](#marketing_spend)
- **Content System**: [content_platforms](#content_platforms), [content_statuses](#content_statuses), [calls_to_action](#calls_to_action), [lead_magnets](#lead_magnets), [content_ideas](#content_ideas), [content_items](#content_items), [scripts](#scripts), [content_tasks](#content_tasks), [publishing_dates](#publishing_dates), [published_links](#published_links), [content_metrics](#content_metrics)
- **Community, Messaging, Notifications, Email**: [announcements](#announcements), [discussions](#discussions), [discussion_comments](#discussion_comments), [conversations](#conversations), [conversation_participants](#conversation_participants), [direct_messages](#direct_messages), [notifications](#notifications), [notification_preferences](#notification_preferences), [email_templates](#email_templates), [email_outbox](#email_outbox)
- **Templates + Onboarding**: [program_templates](#program_templates), [lesson_templates](#lesson_templates), [scorecard_templates](#scorecard_templates), [dashboard_templates](#dashboard_templates), [sop_templates](#sop_templates), [offer_templates](#offer_templates), [pipeline_templates](#pipeline_templates), [task_templates](#task_templates), [task_template_items](#task_template_items), [onboarding_questionnaires](#onboarding_questionnaires), [questionnaire_questions](#questionnaire_questions), [onboarding_templates](#onboarding_templates), [onboarding_template_items](#onboarding_template_items), [questionnaire_responses](#questionnaire_responses), [template_applications](#template_applications)
- **Automations + Client Health Scoring**: [automation_trigger_types](#automation_trigger_types), [automation_action_types](#automation_action_types), [automations](#automations), [automation_conditions](#automation_conditions), [automation_actions](#automation_actions), [automation_runs](#automation_runs), [automation_run_steps](#automation_run_steps), [webhook_endpoints](#webhook_endpoints), [health_score_models](#health_score_models), [health_score_factors](#health_score_factors), [client_health_scores](#client_health_scores), [client_health_score_components](#client_health_score_components)

## Identity, Tenancy, Permissions, Audit
_Migration: `20260916000002_identity_tenancy.sql`_

### users
🔐 custom RLS · permission module `members` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  |  |
| `email` | extensions.citext |  |  |
| `status` | text |  | 'active'::text |
| `last_login_at` | timestamp with time zone | yes |  |
| `last_seen_at` | timestamp with time zone | yes |  |

### user_profiles
🔐 custom RLS · permission module `members` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `user_id` | uuid |  |  |
| `first_name` | text | yes |  |
| `last_name` | text | yes |  |
| `display_name` | text | yes |  |
| `avatar_url` | text | yes |  |
| `phone` | text | yes |  |
| `job_title` | text | yes |  |
| `bio` | text | yes |  |
| `timezone` | text |  | 'America/New_York'::text |
| `locale` | text |  | 'en-US'::text |
| `onboarding_completed_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (user_id) REFERENCES users(id)`

### organizations
🗑 soft delete · 📝 audited · 🔐 custom RLS · permission module `organization` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `kind` | text |  | 'client'::text |
| `name` | text |  |  |
| `slug` | extensions.citext |  |  |
| `status` | text |  | 'onboarding'::text |
| `timezone` | text |  | 'America/New_York'::text |
| `currency` | character(3) |  | 'USD'::bpchar |
| `logo_url` | text | yes |  |
| `website` | text | yes |  |
| `stripe_customer_id` | text | yes |  |
| `settings` | jsonb |  | '{}'::jsonb |
| `archived_at` | timestamp with time zone | yes |  |
| `suspended_at` | timestamp with time zone | yes |  |

### permissions
🔐 custom RLS · permission module `roles` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `key` | text |  |  |
| `module` | text |  |  |
| `action` | text |  |  |
| `description` | text | yes |  |
| `is_sensitive` | boolean |  | false |

### roles
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `roles` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid | yes |  |
| `key` | text |  |  |
| `name` | text |  |  |
| `description` | text | yes |  |
| `scope` | text |  |  |
| `audience` | text |  | 'member'::text |
| `rank` | integer |  | 0 |
| `is_system` | boolean |  | false |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### role_permissions
📝 audited · 🔐 custom RLS · permission module `roles` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `role_id` | uuid |  |  |
| `permission_id` | uuid |  |  |

**References:** `FOREIGN KEY (permission_id) REFERENCES permissions(id)`; `FOREIGN KEY (role_id) REFERENCES roles(id)`

### platform_staff
📝 audited · 🔐 custom RLS · permission module `platform` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `user_id` | uuid |  |  |
| `role_id` | uuid |  |  |
| `status` | text |  | 'active'::text |
| `title` | text | yes |  |

**References:** `FOREIGN KEY (role_id) REFERENCES roles(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### organization_memberships
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `members` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `role_id` | uuid |  |  |
| `status` | text |  | 'active'::text |
| `title` | text | yes |  |
| `joined_at` | timestamp with time zone |  | now() |
| `invited_by` | uuid | yes |  |
| `last_active_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (role_id) REFERENCES roles(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### team_assignments
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `members` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `role_id` | uuid |  |  |
| `is_primary` | boolean |  | false |
| `status` | text |  | 'active'::text |
| `starts_at` | timestamp with time zone |  | now() |
| `ends_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (role_id) REFERENCES roles(id)`; `FOREIGN KEY (user_id) REFERENCES platform_staff(user_id)`

### permission_overrides
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `roles` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `permission_id` | uuid |  |  |
| `effect` | text |  |  |
| `reason` | text | yes |  |
| `expires_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (permission_id) REFERENCES permissions(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### invitations
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `members` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `email` | extensions.citext |  |  |
| `role_id` | uuid |  |  |
| `token_hash` | text |  |  |
| `status` | text |  | 'pending'::text |
| `invited_by` | uuid | yes |  |
| `expires_at` | timestamp with time zone |  | (now() + '7 days'::interval) |
| `accepted_at` | timestamp with time zone | yes |  |
| `accepted_by` | uuid | yes |  |
| `payload` | jsonb |  | '{}'::jsonb |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (role_id) REFERENCES roles(id)`

### login_activity
🔐 custom RLS · permission module `platform` · audit cols: created_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint |  |  |
| `user_id` | uuid | yes |  |
| `organization_id` | uuid | yes |  |
| `event` | text |  |  |
| `ip_address` | inet | yes |  |
| `user_agent` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### impersonation_sessions
🔐 custom RLS · permission module `platform`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `admin_user_id` | uuid |  |  |
| `target_user_id` | uuid |  |  |
| `organization_id` | uuid | yes |  |
| `reason` | text |  |  |
| `allow_writes` | boolean |  | false |
| `started_at` | timestamp with time zone |  | now() |
| `expires_at` | timestamp with time zone |  | (now() + '01:00:00'::interval) |
| `ended_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (admin_user_id) REFERENCES users(id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (target_user_id) REFERENCES users(id)`

### audit_logs
🔐 custom RLS · permission module `audit` · audit cols: created_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint |  |  |
| `organization_id` | uuid | yes |  |
| `actor_id` | uuid | yes |  |
| `impersonated_user_id` | uuid | yes |  |
| `action` | text |  |  |
| `table_name` | text | yes |  |
| `record_id` | uuid | yes |  |
| `old_values` | jsonb | yes |  |
| `new_values` | jsonb | yes |  |
| `changed_fields` | text[] | yes |  |
| `context` | jsonb |  | '{}'::jsonb |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### activity_history
🏢 tenant · 🔐 custom RLS · permission module `organization` · audit cols: created_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint |  |  |
| `organization_id` | uuid |  |  |
| `actor_id` | uuid | yes |  |
| `entity_type` | text |  |  |
| `entity_id` | uuid | yes |  |
| `verb` | text |  |  |
| `summary` | text |  |  |
| `data` | jsonb |  | '{}'::jsonb |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### domain_events
🚫 service only · permission module `platform`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint |  |  |
| `organization_id` | uuid | yes |  |
| `event_type` | text |  |  |
| `entity_type` | text | yes |  |
| `entity_id` | uuid | yes |  |
| `actor_id` | uuid | yes |  |
| `payload` | jsonb |  | '{}'::jsonb |
| `status` | text |  | 'pending'::text |
| `attempts` | integer |  | 0 |
| `last_error` | text | yes |  |
| `occurred_at` | timestamp with time zone |  | now() |
| `processed_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

## Client Profiles, Contacts, Notes, Files, Custom Fields
_Migration: `20260916000003_crm_files_fields.sql`_

### client_profiles
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `organization` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `organization_id` | uuid |  |  |
| `legal_name` | text | yes |  |
| `industry` | text | yes |  |
| `business_model` | text | yes |  |
| `primary_contact_user_id` | uuid | yes |  |
| `account_manager_id` | uuid | yes |  |
| `primary_coach_id` | uuid | yes |  |
| `start_date` | date | yes |  |
| `renewal_date` | date | yes |  |
| `contract_term_months` | integer | yes |  |
| `contract_value_cents` | bigint | yes |  |
| `mrr_cents` | bigint | yes |  |
| `current_monthly_revenue_cents` | bigint | yes |  |
| `revenue_target_cents` | bigint | yes |  |
| `team_size` | integer | yes |  |
| `onboarding_template_id` | uuid | yes |  |
| `onboarding_completed_at` | timestamp with time zone | yes |  |
| `last_client_login_at` | timestamp with time zone | yes |  |
| `last_kpi_update_at` | timestamp with time zone | yes |  |
| `last_interaction_at` | timestamp with time zone | yes |  |
| `tags` | text[] |  | '{}'::text[] |
| `baseline` | jsonb |  | '{}'::jsonb |

**References:** `FOREIGN KEY (onboarding_template_id) REFERENCES onboarding_templates(id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (primary_contact_user_id) REFERENCES users(id)`

### tags
🏢 tenant · permission module `contacts` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `color` | text | yes |  |
| `category` | text |  | 'contact'::text |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### contacts
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `contacts` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `first_name` | text | yes |  |
| `last_name` | text | yes |  |
| `email` | extensions.citext | yes |  |
| `phone` | text | yes |  |
| `company` | text | yes |  |
| `lifecycle_stage` | text |  | 'lead'::text |
| `source` | text | yes |  |
| `owner_id` | uuid | yes |  |
| `address` | jsonb |  | '{}'::jsonb |
| `social` | jsonb |  | '{}'::jsonb |
| `last_contacted_at` | timestamp with time zone | yes |  |
| `metadata` | jsonb |  | '{}'::jsonb |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### contact_tags
🏢 tenant · permission module `contacts` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `organization_id` | uuid |  |  |
| `contact_id` | uuid |  |  |
| `tag_id` | uuid |  |  |

**References:** `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, tag_id) REFERENCES tags(organization_id, id)`

### notes
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `notes` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `entity_type` | text |  |  |
| `entity_id` | uuid |  |  |
| `body` | text |  |  |
| `visibility` | text |  | 'organization'::text |
| `is_pinned` | boolean |  | false |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### files
🏢 tenant · 🗑 soft delete · 📝 audited · 🔐 custom RLS · permission module `files` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `bucket` | text |  | 'org-files'::text |
| `storage_path` | text |  |  |
| `file_name` | text |  |  |
| `mime_type` | text | yes |  |
| `size_bytes` | bigint | yes |  |
| `kind` | text |  | 'document'::text |
| `visibility` | text |  | 'organization'::text |
| `entity_type` | text | yes |  |
| `entity_id` | uuid | yes |  |
| `upload_status` | text |  | 'pending'::text |
| `checksum_sha256` | text | yes |  |
| `duration_seconds` | integer | yes |  |
| `external_url` | text | yes |  |
| `metadata` | jsonb |  | '{}'::jsonb |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### custom_fields
🏢 tenant · permission module `custom_fields` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `entity_type` | text |  |  |
| `key` | text |  |  |
| `label` | text |  |  |
| `field_type` | text |  |  |
| `options` | jsonb |  | '[]'::jsonb |
| `is_required` | boolean |  | false |
| `position` | integer |  | 0 |
| `is_archived` | boolean |  | false |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### custom_field_values
🏢 tenant · permission module `contacts` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `custom_field_id` | uuid |  |  |
| `entity_id` | uuid |  |  |
| `value` | jsonb | yes |  |

**References:** `FOREIGN KEY (organization_id, custom_field_id) REFERENCES custom_fields(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

## Offers, Pricing, Purchases, Subscriptions, Payments (Stripe-Ready)
_Migration: `20260916000004_offers_billing.sql`_

### offers
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `offers` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `slug` | text |  |  |
| `description` | text | yes |  |
| `offer_type` | text |  | 'program'::text |
| `status` | text |  | 'draft'::text |
| `current_version_id` | uuid | yes |  |
| `stripe_product_id` | text | yes |  |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, current_version_id) REFERENCES offer_versions(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### offer_versions
🏢 tenant · permission module `offers` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `offer_id` | uuid |  |  |
| `version` | integer |  |  |
| `headline` | text | yes |  |
| `promise` | text | yes |  |
| `deliverables` | jsonb |  | '[]'::jsonb |
| `guarantee` | text | yes |  |
| `terms` | text | yes |  |
| `published_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`

### pricing_options
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `offers` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `offer_id` | uuid |  |  |
| `offer_version_id` | uuid | yes |  |
| `name` | text |  |  |
| `pricing_type` | text |  |  |
| `currency` | character(3) |  | 'USD'::bpchar |
| `amount_cents` | bigint |  | 0 |
| `installment_count` | integer | yes |  |
| `installment_interval` | text | yes |  |
| `billing_interval` | text | yes |  |
| `trial_days` | integer |  | 0 |
| `setup_fee_cents` | bigint |  | 0 |
| `available_from` | timestamp with time zone | yes |  |
| `available_until` | timestamp with time zone | yes |  |
| `max_purchases` | integer | yes |  |
| `is_active` | boolean |  | true |
| `stripe_price_id` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`; `FOREIGN KEY (organization_id, offer_version_id) REFERENCES offer_versions(organization_id, id)`

### offer_entitlements
🏢 tenant · permission module `offers` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `offer_id` | uuid |  |  |
| `entitlement_type` | text |  | 'program'::text |
| `program_id` | uuid | yes |  |
| `access_days` | integer | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### coupons
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `billing` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `code` | extensions.citext |  |  |
| `discount_type` | text |  |  |
| `percent_off` | numeric(5,2) | yes |  |
| `amount_off_cents` | bigint | yes |  |
| `currency` | character(3) | yes |  |
| `duration` | text |  | 'once'::text |
| `duration_months` | integer | yes |  |
| `applies_to_offer_ids` | uuid[] | yes |  |
| `max_redemptions` | integer | yes |  |
| `redemption_count` | integer |  | 0 |
| `starts_at` | timestamp with time zone | yes |  |
| `expires_at` | timestamp with time zone | yes |  |
| `is_active` | boolean |  | true |
| `stripe_coupon_id` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### order_forms
🏢 tenant · 🗑 soft delete · permission module `offers` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `offer_id` | uuid |  |  |
| `slug` | text |  |  |
| `title` | text |  |  |
| `pricing_option_ids` | uuid[] |  | '{}'::uuid[] |
| `bump_offer_id` | uuid | yes |  |
| `fields` | jsonb |  | '[]'::jsonb |
| `success_url` | text | yes |  |
| `status` | text |  | 'draft'::text |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`

### billing_customers
🏢 tenant · permission module `billing` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `contact_id` | uuid | yes |  |
| `user_id` | uuid | yes |  |
| `stripe_customer_id` | text | yes |  |
| `email` | extensions.citext | yes |  |

**References:** `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### purchases
🏢 tenant · 🗑 soft delete · 📝 audited · 🔐 custom RLS · permission module `billing` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `offer_id` | uuid |  |  |
| `pricing_option_id` | uuid | yes |  |
| `order_form_id` | uuid | yes |  |
| `coupon_id` | uuid | yes |  |
| `contact_id` | uuid | yes |  |
| `user_id` | uuid | yes |  |
| `billing_customer_id` | uuid | yes |  |
| `status` | text |  | 'pending'::text |
| `currency` | character(3) |  | 'USD'::bpchar |
| `list_amount_cents` | bigint |  | 0 |
| `discount_cents` | bigint |  | 0 |
| `total_amount_cents` | bigint |  | 0 |
| `amount_paid_cents` | bigint |  | 0 |
| `setter_id` | uuid | yes |  |
| `closer_id` | uuid | yes |  |
| `opportunity_id` | uuid | yes |  |
| `attribution_source_id` | uuid | yes |  |
| `purchased_at` | timestamp with time zone |  | now() |
| `stripe_checkout_session_id` | text | yes |  |
| `stripe_payment_intent_id` | text | yes |  |
| `metadata` | jsonb |  | '{}'::jsonb |

**References:** `FOREIGN KEY (organization_id, attribution_source_id) REFERENCES attribution_sources(organization_id, id)`; `FOREIGN KEY (organization_id, closer_id) REFERENCES closers(organization_id, id)`; `FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id)`; `FOREIGN KEY (organization_id, billing_customer_id) REFERENCES billing_customers(organization_id, id)`; `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id, coupon_id) REFERENCES coupons(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`; `FOREIGN KEY (organization_id, order_form_id) REFERENCES order_forms(organization_id, id)`; `FOREIGN KEY (organization_id, pricing_option_id) REFERENCES pricing_options(organization_id, id)`; `FOREIGN KEY (organization_id, setter_id) REFERENCES setters(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### coupon_redemptions
🏢 tenant · permission module `billing` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `coupon_id` | uuid |  |  |
| `purchase_id` | uuid |  |  |
| `discount_cents` | bigint |  |  |

**References:** `FOREIGN KEY (organization_id, coupon_id) REFERENCES coupons(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, purchase_id) REFERENCES purchases(organization_id, id)`

### subscriptions
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `billing` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `purchase_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `status` | text |  |  |
| `kind` | text |  |  |
| `amount_cents` | bigint |  |  |
| `currency` | character(3) |  | 'USD'::bpchar |
| `interval` | text |  |  |
| `installments_total` | integer | yes |  |
| `installments_paid` | integer |  | 0 |
| `current_period_start` | timestamp with time zone | yes |  |
| `current_period_end` | timestamp with time zone | yes |  |
| `cancel_at_period_end` | boolean |  | false |
| `canceled_at` | timestamp with time zone | yes |  |
| `stripe_subscription_id` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, purchase_id) REFERENCES purchases(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### payment_records
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `billing` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `purchase_id` | uuid | yes |  |
| `subscription_id` | uuid | yes |  |
| `user_id` | uuid | yes |  |
| `status` | text |  |  |
| `amount_cents` | bigint |  |  |
| `refunded_cents` | bigint |  | 0 |
| `fee_cents` | bigint | yes |  |
| `currency` | character(3) |  | 'USD'::bpchar |
| `paid_at` | timestamp with time zone | yes |  |
| `failure_reason` | text | yes |  |
| `method` | text | yes |  |
| `stripe_invoice_id` | text | yes |  |
| `stripe_charge_id` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, purchase_id) REFERENCES purchases(organization_id, id)`; `FOREIGN KEY (organization_id, subscription_id) REFERENCES subscriptions(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### offer_assignments
🏢 tenant · 📝 audited · permission module `offers` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `offer_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `contact_id` | uuid | yes |  |
| `reason` | text | yes |  |
| `starts_at` | timestamp with time zone |  | now() |
| `ends_at` | timestamp with time zone | yes |  |
| `status` | text |  | 'active'::text |

**References:** `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### stripe_events
🚫 service only · permission module `billing`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text |  |  |
| `type` | text |  |  |
| `organization_id` | uuid | yes |  |
| `payload` | jsonb |  |  |
| `processed_at` | timestamp with time zone | yes |  |
| `error` | text | yes |  |
| `received_at` | timestamp with time zone |  | now() |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

## Coaching Programs (Kajabi-Style Lms)
_Migration: `20260916000005_programs_lms.sql`_

### programs
🏢 tenant · 🗑 soft delete · 📝 audited · 🔐 custom RLS · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `slug` | text |  |  |
| `subtitle` | text | yes |  |
| `description` | text | yes |  |
| `cover_file_id` | uuid | yes |  |
| `status` | text |  | 'draft'::text |
| `visibility` | text |  | 'enrolled'::text |
| `is_sequential` | boolean |  | false |
| `default_access_days` | integer | yes |  |
| `certificate_enabled` | boolean |  | false |
| `certificate_settings` | jsonb |  | '{}'::jsonb |
| `community_enabled` | boolean |  | true |
| `estimated_hours` | numeric(6,2) | yes |  |
| `published_at` | timestamp with time zone | yes |  |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, cover_file_id) REFERENCES files(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### program_sections
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `position` | integer |  | 0 |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### modules
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `section_id` | uuid |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `position` | integer |  | 0 |
| `drip_type` | text |  | 'immediate'::text |
| `drip_days` | integer | yes |  |
| `drip_date` | timestamp with time zone | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`; `FOREIGN KEY (organization_id, section_id) REFERENCES program_sections(organization_id, id)`

### lessons
🏢 tenant · 🗑 soft delete · 📝 audited · 🔐 custom RLS · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `module_id` | uuid |  |  |
| `title` | text |  |  |
| `summary` | text | yes |  |
| `position` | integer |  | 0 |
| `status` | text |  | 'published'::text |
| `drip_type` | text |  | 'immediate'::text |
| `drip_days` | integer | yes |  |
| `drip_date` | timestamp with time zone | yes |  |
| `requires_previous_completion` | boolean |  | false |
| `is_preview` | boolean |  | false |
| `estimated_minutes` | integer | yes |  |
| `completion_rule` | text |  | 'manual'::text |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, module_id) REFERENCES modules(organization_id, id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### lesson_blocks
🏢 tenant · 🔐 custom RLS · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `lesson_id` | uuid |  |  |
| `block_type` | text |  |  |
| `position` | integer |  | 0 |
| `content` | jsonb |  | '{}'::jsonb |
| `file_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, file_id) REFERENCES files(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, lesson_id) REFERENCES lessons(organization_id, id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### resources
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `files` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid | yes |  |
| `module_id` | uuid | yes |  |
| `lesson_id` | uuid | yes |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `resource_type` | text |  | 'file'::text |
| `file_id` | uuid | yes |  |
| `url` | text | yes |  |
| `visibility` | text |  | 'program'::text |
| `category` | text | yes |  |
| `position` | integer |  | 0 |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, file_id) REFERENCES files(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, lesson_id) REFERENCES lessons(organization_id, id)`; `FOREIGN KEY (organization_id, module_id) REFERENCES modules(organization_id, id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### program_enrollments
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `enrollments` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `status` | text |  | 'active'::text |
| `source` | text |  | 'manual'::text |
| `source_purchase_id` | uuid | yes |  |
| `enrolled_by` | uuid | yes |  |
| `enrolled_at` | timestamp with time zone |  | now() |
| `starts_at` | timestamp with time zone |  | now() |
| `access_expires_at` | timestamp with time zone | yes |  |
| `progress_percent` | numeric(5,2) |  | 0 |
| `lessons_completed` | integer |  | 0 |
| `lessons_total` | integer |  | 0 |
| `completed_at` | timestamp with time zone | yes |  |
| `last_activity_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`; `FOREIGN KEY (organization_id, source_purchase_id) REFERENCES purchases(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### lesson_progress
🏢 tenant · 🔐 custom RLS · permission module `enrollments` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `enrollment_id` | uuid |  |  |
| `lesson_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `status` | text |  | 'in_progress'::text |
| `percent_watched` | numeric(5,2) | yes |  |
| `last_position_s` | integer | yes |  |
| `started_at` | timestamp with time zone |  | now() |
| `completed_at` | timestamp with time zone | yes |  |
| `time_spent_s` | integer |  | 0 |

**References:** `FOREIGN KEY (organization_id, enrollment_id) REFERENCES program_enrollments(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, lesson_id) REFERENCES lessons(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### module_progress
🏢 tenant · 🔐 custom RLS · permission module `enrollments` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `enrollment_id` | uuid |  |  |
| `module_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `lessons_completed` | integer |  | 0 |
| `lessons_total` | integer |  | 0 |
| `progress_percent` | numeric(5,2) |  | 0 |
| `completed_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, enrollment_id) REFERENCES program_enrollments(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, module_id) REFERENCES modules(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### lesson_unlocks
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `enrollments` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `lesson_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `reason` | text | yes |  |
| `source` | text |  | 'manual'::text |
| `expires_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, lesson_id) REFERENCES lessons(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### assignments
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `lesson_id` | uuid |  |  |
| `title` | text |  |  |
| `instructions` | text | yes |  |
| `submission_types` | text[] |  | ARRAY['text'::text] |
| `requires_review` | boolean |  | true |
| `due_days_after_enrollment` | integer | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, lesson_id) REFERENCES lessons(organization_id, id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### assignment_submissions
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `enrollments` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `assignment_id` | uuid |  |  |
| `enrollment_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `attempt` | integer |  | 1 |
| `body` | text | yes |  |
| `links` | text[] |  | '{}'::text[] |
| `file_ids` | uuid[] |  | '{}'::uuid[] |
| `status` | text |  | 'submitted'::text |
| `submitted_at` | timestamp with time zone | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `reviewed_by` | uuid | yes |  |
| `grade` | numeric(5,2) | yes |  |

**References:** `FOREIGN KEY (organization_id, assignment_id) REFERENCES assignments(organization_id, id)`; `FOREIGN KEY (organization_id, enrollment_id) REFERENCES program_enrollments(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### assignment_feedback
🏢 tenant · 🔐 custom RLS · permission module `enrollments` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `submission_id` | uuid |  |  |
| `author_id` | uuid |  |  |
| `body` | text |  |  |
| `file_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, submission_id) REFERENCES assignment_submissions(organization_id, id)`

### quizzes
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `lesson_id` | uuid |  |  |
| `title` | text |  |  |
| `pass_percent` | numeric(5,2) |  | 70 |
| `max_attempts` | integer | yes |  |
| `shuffle_questions` | boolean |  | false |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, lesson_id) REFERENCES lessons(organization_id, id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### quiz_questions
🏢 tenant · 🔐 custom RLS · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `quiz_id` | uuid |  |  |
| `position` | integer |  | 0 |
| `question_type` | text |  |  |
| `prompt` | text |  |  |
| `options` | jsonb |  | '[]'::jsonb |
| `points` | numeric(6,2) |  | 1 |
| `explanation` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`; `FOREIGN KEY (organization_id, quiz_id) REFERENCES quizzes(organization_id, id)`

### quiz_answer_keys
🏢 tenant · permission module `programs` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `question_id` | uuid |  |  |
| `organization_id` | uuid |  |  |
| `correct` | jsonb |  |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (question_id) REFERENCES quiz_questions(id)`

### quiz_attempts
🏢 tenant · 🔐 custom RLS · permission module `enrollments` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `quiz_id` | uuid |  |  |
| `enrollment_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `attempt` | integer |  |  |
| `answers` | jsonb |  | '{}'::jsonb |
| `score_points` | numeric(8,2) | yes |  |
| `max_points` | numeric(8,2) | yes |  |
| `score_percent` | numeric(5,2) | yes |  |
| `passed` | boolean | yes |  |
| `started_at` | timestamp with time zone |  | now() |
| `submitted_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, enrollment_id) REFERENCES program_enrollments(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, quiz_id) REFERENCES quizzes(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### certificates
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `enrollments` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `enrollment_id` | uuid |  |  |
| `program_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `certificate_number` | text |  | upper(substr(md5((gen_random_uuid()):... |
| `issued_at` | timestamp with time zone |  | now() |
| `file_id` | uuid | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, enrollment_id) REFERENCES program_enrollments(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

## Coaching Delivery + Accountability
_Migration: `20260916000006_coaching_delivery.sql`_

### recurring_calls
🏢 tenant · 🗑 soft delete · permission module `coaching` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `call_type` | text |  | 'group'::text |
| `host_id` | uuid | yes |  |
| `audience` | text |  | 'organization'::text |
| `program_id` | uuid | yes |  |
| `rrule` | text |  |  |
| `start_time` | time without time zone |  |  |
| `duration_minutes` | integer |  | 60 |
| `timezone` | text |  | 'America/New_York'::text |
| `meeting_url` | text | yes |  |
| `starts_on` | date |  | CURRENT_DATE |
| `ends_on` | date | yes |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### coaching_sessions
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `coaching` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `recurring_call_id` | uuid | yes |  |
| `title` | text |  |  |
| `session_type` | text |  | 'one_on_one'::text |
| `audience` | text |  | 'attendees'::text |
| `program_id` | uuid | yes |  |
| `host_id` | uuid | yes |  |
| `scheduled_start` | timestamp with time zone |  |  |
| `scheduled_end` | timestamp with time zone |  |  |
| `status` | text |  | 'scheduled'::text |
| `meeting_url` | text | yes |  |
| `agenda` | text | yes |  |
| `summary` | text | yes |  |
| `external_event_id` | text | yes |  |
| `completed_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`; `FOREIGN KEY (organization_id, recurring_call_id) REFERENCES recurring_calls(organization_id, id)`

### session_attendees
🏢 tenant · 🔐 custom RLS · permission module `coaching` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `coaching_session_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `contact_id` | uuid | yes |  |
| `role` | text |  | 'attendee'::text |
| `rsvp_status` | text |  | 'invited'::text |
| `attended` | boolean | yes |  |
| `joined_at` | timestamp with time zone | yes |  |
| `left_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, coaching_session_id) REFERENCES coaching_sessions(organization_id, id)`; `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### session_notes
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `coaching` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `coaching_session_id` | uuid |  |  |
| `author_id` | uuid | yes |  |
| `visibility` | text |  | 'shared'::text |
| `body` | text |  |  |

**References:** `FOREIGN KEY (organization_id, coaching_session_id) REFERENCES coaching_sessions(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### call_recordings
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `coaching` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `coaching_session_id` | uuid |  |  |
| `file_id` | uuid | yes |  |
| `external_url` | text | yes |  |
| `provider` | text | yes |  |
| `duration_seconds` | integer | yes |  |
| `transcript` | text | yes |  |
| `ai_summary` | text | yes |  |
| `is_replay_published` | boolean |  | false |
| `replay_title` | text | yes |  |
| `replay_category` | text | yes |  |
| `recorded_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, coaching_session_id) REFERENCES coaching_sessions(organization_id, id)`; `FOREIGN KEY (organization_id, file_id) REFERENCES files(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### action_items
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `coaching` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `coaching_session_id` | uuid | yes |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `owner_id` | uuid | yes |  |
| `due_at` | timestamp with time zone | yes |  |
| `status` | text |  | 'open'::text |
| `completed_at` | timestamp with time zone | yes |  |
| `task_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, coaching_session_id) REFERENCES coaching_sessions(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, task_id) REFERENCES tasks(organization_id, id)`

### accountability_checkins
🏢 tenant · 🔐 custom RLS · permission module `accountability` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `period_type` | text |  | 'weekly'::text |
| `period_start` | date |  |  |
| `commitments` | jsonb |  | '[]'::jsonb |
| `completed` | jsonb |  | '[]'::jsonb |
| `confidence` | integer | yes |  |
| `energy` | integer | yes |  |
| `reflection` | text | yes |  |
| `needs_help` | boolean |  | false |
| `submitted_at` | timestamp with time zone | yes |  |
| `coach_response` | text | yes |  |
| `responded_by` | uuid | yes |  |
| `responded_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### client_wins
🏢 tenant · 🗑 soft delete · permission module `accountability` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `impact_value_cents` | bigint | yes |  |
| `occurred_on` | date |  | CURRENT_DATE |
| `reported_by` | uuid | yes |  |
| `is_testimonial_ok` | boolean |  | false |
| `checkin_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, checkin_id) REFERENCES accountability_checkins(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### client_blockers
🏢 tenant · 🗑 soft delete · permission module `accountability` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `severity` | text |  | 'medium'::text |
| `status` | text |  | 'open'::text |
| `owner_id` | uuid | yes |  |
| `reported_by` | uuid | yes |  |
| `resolved_at` | timestamp with time zone | yes |  |
| `resolution` | text | yes |  |
| `checkin_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, checkin_id) REFERENCES accountability_checkins(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### milestones
🏢 tenant · 🗑 soft delete · permission module `accountability` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid | yes |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `phase` | text | yes |  |
| `position` | integer |  | 0 |
| `target_date` | date | yes |  |
| `criteria` | jsonb |  | '{}'::jsonb |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### milestone_progress
🏢 tenant · permission module `accountability` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `milestone_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `status` | text |  | 'not_started'::text |
| `progress_percent` | numeric(5,2) |  | 0 |
| `achieved_at` | timestamp with time zone | yes |  |
| `verified_by` | uuid | yes |  |
| `notes` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, milestone_id) REFERENCES milestones(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### coach_ratings
🏢 tenant · permission module `health` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `rated_by` | uuid |  |  |
| `rating` | integer |  |  |
| `comment` | text | yes |  |
| `rated_on` | date |  | CURRENT_DATE |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

## Growth Operating System
_Migration: `20260916000007_growth_os.sql`_

### goals
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `goals` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `parent_goal_id` | uuid | yes |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `level` | text |  | 'company'::text |
| `timeframe` | text |  | 'annual'::text |
| `starts_on` | date | yes |  |
| `ends_on` | date | yes |  |
| `owner_id` | uuid | yes |  |
| `kpi_definition_id` | uuid | yes |  |
| `target_value` | numeric | yes |  |
| `current_value` | numeric | yes |  |
| `unit` | text | yes |  |
| `status` | text |  | 'on_track'::text |
| `progress_percent` | numeric(5,2) |  | 0 |
| `achieved_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, kpi_definition_id) REFERENCES kpi_definitions(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, parent_goal_id) REFERENCES goals(organization_id, id)`

### kpi_definitions
🏢 tenant · 🗑 soft delete · 📝 audited · 🔐 custom RLS · permission module `kpis` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `key` | text |  |  |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text |  | 'general'::text |
| `unit` | text |  | 'count'::text |
| `currency` | character(3) | yes |  |
| `frequency` | text |  | 'weekly'::text |
| `aggregation` | text |  | 'sum'::text |
| `direction` | text |  | 'higher_is_better'::text |
| `goal_value` | numeric | yes |  |
| `at_risk_threshold_pct` | numeric(5,2) |  | 90 |
| `off_track_threshold_pct` | numeric(5,2) |  | 75 |
| `data_source` | text |  | 'manual'::text |
| `entry_method` | text |  | 'manual'::text |
| `formula` | jsonb | yes |  |
| `owner_id` | uuid | yes |  |
| `is_financial` | boolean |  | false |
| `is_active` | boolean |  | true |
| `position` | integer |  | 0 |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### quarterly_goals
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `goals` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `goal_id` | uuid | yes |  |
| `year` | integer |  |  |
| `quarter` | integer |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `owner_id` | uuid | yes |  |
| `kpi_definition_id` | uuid | yes |  |
| `target_value` | numeric | yes |  |
| `current_value` | numeric | yes |  |
| `status` | text |  | 'on_track'::text |
| `progress_percent` | numeric(5,2) |  | 0 |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, goal_id) REFERENCES goals(organization_id, id)`; `FOREIGN KEY (organization_id, kpi_definition_id) REFERENCES kpi_definitions(organization_id, id)`

### monthly_targets
🏢 tenant · 📝 audited · permission module `goals` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `quarterly_goal_id` | uuid | yes |  |
| `kpi_definition_id` | uuid |  |  |
| `month_start` | date |  |  |
| `target_value` | numeric |  |  |
| `stretch_value` | numeric | yes |  |
| `notes` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, kpi_definition_id) REFERENCES kpi_definitions(organization_id, id)`; `FOREIGN KEY (organization_id, quarterly_goal_id) REFERENCES quarterly_goals(organization_id, id)`

### scorecards
🏢 tenant · 🗑 soft delete · permission module `kpis` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `description` | text | yes |  |
| `frequency` | text |  | 'weekly'::text |
| `due_weekday` | integer |  | 1 |
| `owner_id` | uuid | yes |  |
| `is_active` | boolean |  | true |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### scorecard_kpis
🏢 tenant · permission module `kpis` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `organization_id` | uuid |  |  |
| `scorecard_id` | uuid |  |  |
| `kpi_definition_id` | uuid |  |  |
| `position` | integer |  | 0 |
| `is_required` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, kpi_definition_id) REFERENCES kpi_definitions(organization_id, id)`; `FOREIGN KEY (organization_id, scorecard_id) REFERENCES scorecards(organization_id, id)`

### weekly_scorecards
🏢 tenant · 📝 audited · permission module `kpis` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `scorecard_id` | uuid |  |  |
| `period_start` | date |  |  |
| `period_end` | date |  |  |
| `status` | text |  | 'open'::text |
| `submitted_by` | uuid | yes |  |
| `submitted_at` | timestamp with time zone | yes |  |
| `reviewed_by` | uuid | yes |  |
| `reviewed_at` | timestamp with time zone | yes |  |
| `summary` | text | yes |  |
| `coach_feedback` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, scorecard_id) REFERENCES scorecards(organization_id, id)`

### kpi_entries
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `kpis` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `kpi_definition_id` | uuid |  |  |
| `period_start` | date |  |  |
| `period_end` | date |  |  |
| `value` | numeric |  |  |
| `target_value` | numeric | yes |  |
| `source` | text |  | 'manual'::text |
| `weekly_scorecard_id` | uuid | yes |  |
| `note` | text | yes |  |
| `entered_by` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, kpi_definition_id) REFERENCES kpi_definitions(organization_id, id)`; `FOREIGN KEY (organization_id, weekly_scorecard_id) REFERENCES weekly_scorecards(organization_id, id)`

### dashboards
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `dashboards` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `description` | text | yes |  |
| `owner_id` | uuid | yes |  |
| `visibility` | text |  | 'organization'::text |
| `shared_with` | uuid[] |  | '{}'::uuid[] |
| `is_default` | boolean |  | false |
| `layout` | jsonb |  | '{}'::jsonb |
| `default_range` | text |  | 'last_30_days'::text |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### dashboard_widgets
🏢 tenant · 🔐 custom RLS · permission module `dashboards` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `dashboard_id` | uuid |  |  |
| `widget_type` | text |  |  |
| `title` | text | yes |  |
| `kpi_definition_id` | uuid | yes |  |
| `report_key` | text | yes |  |
| `config` | jsonb |  | '{}'::jsonb |
| `position` | jsonb |  | '{"h": 2, "w": 4, "x": 0, "y": 0}'::j... |

**References:** `FOREIGN KEY (organization_id, dashboard_id) REFERENCES dashboards(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, kpi_definition_id) REFERENCES kpi_definitions(organization_id, id)`

### growth_projects
🏢 tenant · 🗑 soft delete · permission module `goals` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `goal_id` | uuid | yes |  |
| `quarterly_goal_id` | uuid | yes |  |
| `owner_id` | uuid | yes |  |
| `status` | text |  | 'planned'::text |
| `priority` | text |  | 'medium'::text |
| `starts_on` | date | yes |  |
| `due_on` | date | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `progress_percent` | numeric(5,2) |  | 0 |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, goal_id) REFERENCES goals(organization_id, id)`; `FOREIGN KEY (organization_id, quarterly_goal_id) REFERENCES quarterly_goals(organization_id, id)`

### experiments
🏢 tenant · 🗑 soft delete · permission module `goals` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `growth_project_id` | uuid | yes |  |
| `title` | text |  |  |
| `hypothesis` | text | yes |  |
| `channel` | text | yes |  |
| `kpi_definition_id` | uuid | yes |  |
| `baseline_value` | numeric | yes |  |
| `target_value` | numeric | yes |  |
| `result_value` | numeric | yes |  |
| `status` | text |  | 'idea'::text |
| `ice_impact` | integer | yes |  |
| `ice_confidence` | integer | yes |  |
| `ice_ease` | integer | yes |  |
| `owner_id` | uuid | yes |  |
| `started_on` | date | yes |  |
| `ended_on` | date | yes |  |
| `learnings` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, growth_project_id) REFERENCES growth_projects(organization_id, id)`; `FOREIGN KEY (organization_id, kpi_definition_id) REFERENCES kpi_definitions(organization_id, id)`

### tasks
🏢 tenant · 🗑 soft delete · 📝 audited · 🔐 custom RLS · permission module `tasks` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `status` | text |  | 'todo'::text |
| `priority` | text |  | 'medium'::text |
| `task_type` | text |  | 'general'::text |
| `visibility` | text |  | 'organization'::text |
| `due_at` | timestamp with time zone | yes |  |
| `start_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `completed_by` | uuid | yes |  |
| `estimate_minutes` | integer | yes |  |
| `position` | integer |  | 0 |
| `parent_task_id` | uuid | yes |  |
| `growth_project_id` | uuid | yes |  |
| `related_type` | text | yes |  |
| `related_id` | uuid | yes |  |
| `source_template_id` | uuid | yes |  |
| `assignee_role_key` | text | yes |  |
| `recurrence_rule` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, growth_project_id) REFERENCES growth_projects(organization_id, id)`; `FOREIGN KEY (organization_id, parent_task_id) REFERENCES tasks(organization_id, id)`

### task_assignments
🏢 tenant · 🔐 custom RLS · permission module `tasks` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `organization_id` | uuid |  |  |
| `task_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `assigned_by` | uuid | yes |  |
| `assigned_at` | timestamp with time zone |  | now() |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, task_id) REFERENCES tasks(organization_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### task_comments
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `tasks` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `task_id` | uuid |  |  |
| `author_id` | uuid |  |  |
| `body` | text |  |  |
| `file_ids` | uuid[] |  | '{}'::uuid[] |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, task_id) REFERENCES tasks(organization_id, id)`

### standard_operating_procedures
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `sops` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `department` | text | yes |  |
| `summary` | text | yes |  |
| `owner_id` | uuid | yes |  |
| `status` | text |  | 'draft'::text |
| `current_version_id` | uuid | yes |  |
| `review_every_days` | integer | yes |  |
| `last_reviewed_at` | timestamp with time zone | yes |  |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, current_version_id) REFERENCES sop_versions(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### sop_versions
🏢 tenant · permission module `sops` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `sop_id` | uuid |  |  |
| `version` | integer |  |  |
| `body` | text |  |  |
| `steps` | jsonb |  | '[]'::jsonb |
| `change_note` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, sop_id) REFERENCES standard_operating_procedures(organization_id, id)`

### meeting_agendas
🏢 tenant · 🗑 soft delete · permission module `meetings` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `meeting_type` | text |  | 'weekly'::text |
| `meeting_at` | timestamp with time zone | yes |  |
| `coaching_session_id` | uuid | yes |  |
| `facilitator_id` | uuid | yes |  |
| `items` | jsonb |  | '[]'::jsonb |
| `status` | text |  | 'draft'::text |

**References:** `FOREIGN KEY (organization_id, coaching_session_id) REFERENCES coaching_sessions(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### meeting_notes
🏢 tenant · 🗑 soft delete · permission module `meetings` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `meeting_agenda_id` | uuid |  |  |
| `author_id` | uuid | yes |  |
| `body` | text |  |  |
| `attendees` | uuid[] |  | '{}'::uuid[] |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, meeting_agenda_id) REFERENCES meeting_agendas(organization_id, id)`

### decisions
🏢 tenant · 🗑 soft delete · permission module `meetings` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `meeting_note_id` | uuid | yes |  |
| `title` | text |  |  |
| `context` | text | yes |  |
| `decision` | text |  |  |
| `rationale` | text | yes |  |
| `decided_by` | uuid | yes |  |
| `decided_at` | timestamp with time zone |  | now() |
| `status` | text |  | 'active'::text |
| `review_on` | date | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, meeting_note_id) REFERENCES meeting_notes(organization_id, id)`

## Sales System
_Migration: `20260916000008_sales.sql`_

### pipelines
🏢 tenant · 🗑 soft delete · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `description` | text | yes |  |
| `pipeline_type` | text |  | 'sales'::text |
| `is_default` | boolean |  | false |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### pipeline_stages
🏢 tenant · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `pipeline_id` | uuid |  |  |
| `name` | text |  |  |
| `position` | integer |  | 0 |
| `stage_type` | text |  | 'open'::text |
| `probability` | numeric(5,2) | yes |  |
| `sla_hours` | integer | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, pipeline_id) REFERENCES pipelines(organization_id, id)`

### attribution_sources
🏢 tenant · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `channel` | text |  | 'other'::text |
| `platform` | text | yes |  |
| `utm_source` | text | yes |  |
| `utm_medium` | text | yes |  |
| `utm_campaign` | text | yes |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### lost_reasons
🏢 tenant · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `label` | text |  |  |
| `category` | text | yes |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### setters
🏢 tenant · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `display_name` | text |  |  |
| `commission_type` | text |  | 'percent'::text |
| `commission_rate` | numeric(6,3) | yes |  |
| `commission_flat_cents` | bigint | yes |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### closers
🏢 tenant · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `display_name` | text |  |  |
| `commission_type` | text |  | 'percent'::text |
| `commission_rate` | numeric(6,3) | yes |  |
| `commission_flat_cents` | bigint | yes |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### leads
🏢 tenant · 🗑 soft delete · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `contact_id` | uuid |  |  |
| `attribution_source_id` | uuid | yes |  |
| `lead_magnet_id` | uuid | yes |  |
| `status` | text |  | 'new'::text |
| `score` | integer | yes |  |
| `setter_id` | uuid | yes |  |
| `first_touch_at` | timestamp with time zone |  | now() |
| `qualified_at` | timestamp with time zone | yes |  |
| `utm` | jsonb |  | '{}'::jsonb |
| `inbound` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id, lead_magnet_id) REFERENCES lead_magnets(organization_id, id)`; `FOREIGN KEY (organization_id, attribution_source_id) REFERENCES attribution_sources(organization_id, id)`; `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, setter_id) REFERENCES setters(organization_id, id)`

### opportunities
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `pipeline_id` | uuid |  |  |
| `stage_id` | uuid |  |  |
| `lead_id` | uuid | yes |  |
| `contact_id` | uuid |  |  |
| `offer_id` | uuid | yes |  |
| `title` | text |  |  |
| `status` | text |  | 'open'::text |
| `value_cents` | bigint |  | 0 |
| `cash_collected_cents` | bigint |  | 0 |
| `currency` | character(3) |  | 'USD'::bpchar |
| `setter_id` | uuid | yes |  |
| `closer_id` | uuid | yes |  |
| `owner_id` | uuid | yes |  |
| `attribution_source_id` | uuid | yes |  |
| `lost_reason_id` | uuid | yes |  |
| `lost_notes` | text | yes |  |
| `expected_close_on` | date | yes |  |
| `stage_entered_at` | timestamp with time zone |  | now() |
| `closed_at` | timestamp with time zone | yes |  |
| `purchase_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id, attribution_source_id) REFERENCES attribution_sources(organization_id, id)`; `FOREIGN KEY (organization_id, closer_id) REFERENCES closers(organization_id, id)`; `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id)`; `FOREIGN KEY (organization_id, lost_reason_id) REFERENCES lost_reasons(organization_id, id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`; `FOREIGN KEY (organization_id, pipeline_id) REFERENCES pipelines(organization_id, id)`; `FOREIGN KEY (organization_id, purchase_id) REFERENCES purchases(organization_id, id)`; `FOREIGN KEY (organization_id, setter_id) REFERENCES setters(organization_id, id)`; `FOREIGN KEY (organization_id, stage_id) REFERENCES pipeline_stages(organization_id, id)`

### appointments
🏢 tenant · 🗑 soft delete · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `opportunity_id` | uuid | yes |  |
| `contact_id` | uuid |  |  |
| `appointment_type` | text |  | 'sales_call'::text |
| `scheduled_start` | timestamp with time zone |  |  |
| `scheduled_end` | timestamp with time zone | yes |  |
| `status` | text |  | 'booked'::text |
| `setter_id` | uuid | yes |  |
| `closer_id` | uuid | yes |  |
| `booked_at` | timestamp with time zone |  | now() |
| `booking_source` | text | yes |  |
| `external_event_id` | text | yes |  |

**References:** `FOREIGN KEY (organization_id, closer_id) REFERENCES closers(organization_id, id)`; `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id)`; `FOREIGN KEY (organization_id, setter_id) REFERENCES setters(organization_id, id)`

### sales_calls
🏢 tenant · 🗑 soft delete · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `appointment_id` | uuid | yes |  |
| `opportunity_id` | uuid | yes |  |
| `closer_id` | uuid | yes |  |
| `occurred_at` | timestamp with time zone |  |  |
| `duration_minutes` | integer | yes |  |
| `outcome` | text |  |  |
| `offer_pitched_id` | uuid | yes |  |
| `amount_cents` | bigint | yes |  |
| `recording_file_id` | uuid | yes |  |
| `recording_url` | text | yes |  |
| `call_score` | integer | yes |  |

**References:** `FOREIGN KEY (organization_id, appointment_id) REFERENCES appointments(organization_id, id)`; `FOREIGN KEY (organization_id, closer_id) REFERENCES closers(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_pitched_id) REFERENCES offers(organization_id, id)`; `FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id)`; `FOREIGN KEY (organization_id, recording_file_id) REFERENCES files(organization_id, id)`

### sales_notes
🏢 tenant · 🗑 soft delete · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `opportunity_id` | uuid | yes |  |
| `sales_call_id` | uuid | yes |  |
| `author_id` | uuid | yes |  |
| `note_type` | text |  | 'general'::text |
| `body` | text |  |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id)`; `FOREIGN KEY (organization_id, sales_call_id) REFERENCES sales_calls(organization_id, id)`

### follow_up_tasks
🏢 tenant · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `opportunity_id` | uuid | yes |  |
| `contact_id` | uuid | yes |  |
| `task_id` | uuid | yes |  |
| `channel` | text |  | 'call'::text |
| `due_at` | timestamp with time zone |  |  |
| `status` | text |  | 'pending'::text |
| `assigned_to` | uuid | yes |  |
| `outcome` | text | yes |  |
| `completed_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id)`; `FOREIGN KEY (organization_id, task_id) REFERENCES tasks(organization_id, id)`

### commissions
🏢 tenant · 📝 audited · permission module `billing` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `opportunity_id` | uuid | yes |  |
| `payment_record_id` | uuid | yes |  |
| `setter_id` | uuid | yes |  |
| `closer_id` | uuid | yes |  |
| `basis_cents` | bigint |  |  |
| `rate` | numeric(6,3) | yes |  |
| `amount_cents` | bigint |  |  |
| `status` | text |  | 'pending'::text |
| `earned_on` | date |  | CURRENT_DATE |
| `paid_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, closer_id) REFERENCES closers(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id)`; `FOREIGN KEY (organization_id, payment_record_id) REFERENCES payment_records(organization_id, id)`; `FOREIGN KEY (organization_id, setter_id) REFERENCES setters(organization_id, id)`

### marketing_spend
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `sales` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `attribution_source_id` | uuid | yes |  |
| `spend_date` | date |  |  |
| `channel` | text |  | 'paid_ads'::text |
| `campaign` | text | yes |  |
| `amount_cents` | bigint |  |  |
| `currency` | character(3) |  | 'USD'::bpchar |
| `impressions` | bigint | yes |  |
| `clicks` | bigint | yes |  |
| `source` | text |  | 'manual'::text |

**References:** `FOREIGN KEY (organization_id, attribution_source_id) REFERENCES attribution_sources(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

## Content System
_Migration: `20260916000009_content.sql`_

### content_platforms
🏢 tenant · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `platform` | text |  |  |
| `handle` | text | yes |  |
| `profile_url` | text | yes |  |
| `is_active` | boolean |  | true |
| `connection_id` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### content_statuses
🏢 tenant · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `position` | integer |  | 0 |
| `category` | text |  | 'in_progress'::text |
| `color` | text | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### calls_to_action
🏢 tenant · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `label` | text |  |  |
| `cta_type` | text |  | 'link'::text |
| `url` | text | yes |  |
| `keyword` | text | yes |  |
| `offer_id` | uuid | yes |  |
| `lead_magnet_id` | uuid | yes |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`; `FOREIGN KEY (organization_id, lead_magnet_id) REFERENCES lead_magnets(organization_id, id)`

### lead_magnets
🏢 tenant · 🗑 soft delete · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `magnet_type` | text |  | 'pdf'::text |
| `description` | text | yes |  |
| `file_id` | uuid | yes |  |
| `landing_url` | text | yes |  |
| `offer_id` | uuid | yes |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id, file_id) REFERENCES files(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, offer_id) REFERENCES offers(organization_id, id)`

### content_ideas
🏢 tenant · 🗑 soft delete · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `title` | text |  |  |
| `angle` | text | yes |  |
| `hook` | text | yes |  |
| `pillar` | text | yes |  |
| `source` | text | yes |  |
| `target_platforms` | text[] |  | '{}'::text[] |
| `score` | integer | yes |  |
| `status` | text |  | 'new'::text |
| `submitted_by` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### content_items
🏢 tenant · 🗑 soft delete · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `idea_id` | uuid | yes |  |
| `title` | text |  |  |
| `format` | text |  | 'long_form_video'::text |
| `status_id` | uuid | yes |  |
| `pillar` | text | yes |  |
| `owner_id` | uuid | yes |  |
| `editor_id` | uuid | yes |  |
| `cta_id` | uuid | yes |  |
| `lead_magnet_id` | uuid | yes |  |
| `due_on` | date | yes |  |
| `published_at` | timestamp with time zone | yes |  |
| `asset_file_ids` | uuid[] |  | '{}'::uuid[] |
| `thumbnail_file_id` | uuid | yes |  |
| `description` | text | yes |  |
| `tags` | text[] |  | '{}'::text[] |

**References:** `FOREIGN KEY (organization_id, cta_id) REFERENCES calls_to_action(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, idea_id) REFERENCES content_ideas(organization_id, id)`; `FOREIGN KEY (organization_id, lead_magnet_id) REFERENCES lead_magnets(organization_id, id)`; `FOREIGN KEY (organization_id, status_id) REFERENCES content_statuses(organization_id, id)`

### scripts
🏢 tenant · 🗑 soft delete · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `content_item_id` | uuid |  |  |
| `version` | integer |  | 1 |
| `title` | text | yes |  |
| `hook` | text | yes |  |
| `body` | text |  |  |
| `status` | text |  | 'draft'::text |
| `word_count` | integer | yes |  |
| `approved_by` | uuid | yes |  |
| `approved_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, content_item_id) REFERENCES content_items(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### content_tasks
🏢 tenant · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `content_item_id` | uuid |  |  |
| `task_id` | uuid |  |  |
| `stage` | text |  |  |

**References:** `FOREIGN KEY (organization_id, content_item_id) REFERENCES content_items(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, task_id) REFERENCES tasks(organization_id, id)`

### publishing_dates
🏢 tenant · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `content_item_id` | uuid |  |  |
| `content_platform_id` | uuid |  |  |
| `scheduled_for` | timestamp with time zone |  |  |
| `status` | text |  | 'scheduled'::text |
| `external_post_id` | text | yes |  |

**References:** `FOREIGN KEY (organization_id, content_item_id) REFERENCES content_items(organization_id, id)`; `FOREIGN KEY (organization_id, content_platform_id) REFERENCES content_platforms(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### published_links
🏢 tenant · permission module `content` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `content_item_id` | uuid |  |  |
| `content_platform_id` | uuid |  |  |
| `url` | text |  |  |
| `external_id` | text | yes |  |
| `published_at` | timestamp with time zone |  |  |
| `tracking_url` | text | yes |  |

**References:** `FOREIGN KEY (organization_id, content_item_id) REFERENCES content_items(organization_id, id)`; `FOREIGN KEY (organization_id, content_platform_id) REFERENCES content_platforms(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### content_metrics
🏢 tenant · permission module `content` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `published_link_id` | uuid |  |  |
| `captured_at` | timestamp with time zone |  | now() |
| `views` | bigint | yes |  |
| `impressions` | bigint | yes |  |
| `reach` | bigint | yes |  |
| `likes` | bigint | yes |  |
| `comments` | bigint | yes |  |
| `shares` | bigint | yes |  |
| `saves` | bigint | yes |  |
| `link_clicks` | bigint | yes |  |
| `watch_time_minutes` | numeric | yes |  |
| `avg_view_duration_s` | numeric | yes |  |
| `ctr_percent` | numeric(6,3) | yes |  |
| `subscribers_gained` | bigint | yes |  |
| `inbound_conversations` | bigint | yes |  |
| `leads_generated` | bigint | yes |  |
| `source` | text |  | 'manual'::text |
| `raw` | jsonb |  | '{}'::jsonb |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, published_link_id) REFERENCES published_links(organization_id, id)`

## Community, Messaging, Notifications, Email
_Migration: `20260916000010_community.sql`_

### announcements
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `community` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid | yes |  |
| `title` | text |  |  |
| `body` | text |  |  |
| `author_id` | uuid | yes |  |
| `is_pinned` | boolean |  | false |
| `publish_at` | timestamp with time zone |  | now() |
| `expires_at` | timestamp with time zone | yes |  |
| `send_email` | boolean |  | false |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### discussions
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `community` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `program_id` | uuid | yes |  |
| `lesson_id` | uuid | yes |  |
| `channel` | text |  | 'general'::text |
| `title` | text |  |  |
| `body` | text |  |  |
| `author_id` | uuid |  |  |
| `is_pinned` | boolean |  | false |
| `is_locked` | boolean |  | false |
| `is_hidden` | boolean |  | false |
| `comment_count` | integer |  | 0 |
| `last_activity_at` | timestamp with time zone |  | now() |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, lesson_id) REFERENCES lessons(organization_id, id)`; `FOREIGN KEY (organization_id, program_id) REFERENCES programs(organization_id, id)`

### discussion_comments
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `community` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `discussion_id` | uuid |  |  |
| `parent_comment_id` | uuid | yes |  |
| `author_id` | uuid |  |  |
| `body` | text |  |  |
| `is_hidden` | boolean |  | false |

**References:** `FOREIGN KEY (organization_id, discussion_id) REFERENCES discussions(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (organization_id, parent_comment_id) REFERENCES discussion_comments(organization_id, id)`

### conversations
🏢 tenant · 🔐 custom RLS · permission module `messages` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `subject` | text | yes |  |
| `kind` | text |  | 'direct'::text |
| `last_message_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### conversation_participants
🏢 tenant · 🔐 custom RLS · permission module `messages` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `organization_id` | uuid |  |  |
| `conversation_id` | uuid |  |  |
| `user_id` | uuid |  |  |
| `last_read_at` | timestamp with time zone | yes |  |
| `is_muted` | boolean |  | false |

**References:** `FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### direct_messages
🏢 tenant · 🗑 soft delete · 🔐 custom RLS · permission module `messages` · audit cols: created_at, updated_at, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `conversation_id` | uuid |  |  |
| `sender_id` | uuid |  |  |
| `body` | text |  |  |
| `file_ids` | uuid[] |  | '{}'::uuid[] |
| `edited_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### notifications
🏢 tenant · 🔐 custom RLS · permission module `messages` · audit cols: created_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid | yes |  |
| `user_id` | uuid |  |  |
| `notification_type` | text |  |  |
| `title` | text |  |  |
| `body` | text | yes |  |
| `link_path` | text | yes |  |
| `entity_type` | text | yes |  |
| `entity_id` | uuid | yes |  |
| `read_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### notification_preferences
🏢 tenant · 🔐 custom RLS · permission module `messages` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `user_id` | uuid |  |  |
| `organization_id` | uuid | yes |  |
| `notification_type` | text |  |  |
| `in_app` | boolean |  | true |
| `email` | boolean |  | true |
| `sms` | boolean |  | false |
| `digest` | text |  | 'instant'::text |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### email_templates
🏢 tenant · 🔐 custom RLS · permission module `organization` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid | yes |  |
| `key` | text |  |  |
| `name` | text |  |  |
| `subject` | text |  |  |
| `body_html` | text |  |  |
| `body_text` | text | yes |  |
| `variables` | text[] |  | '{}'::text[] |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### email_outbox
🏢 tenant · 🚫 service only · permission module `messages` · audit cols: created_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint |  |  |
| `organization_id` | uuid | yes |  |
| `template_key` | text |  |  |
| `to_email` | extensions.citext |  |  |
| `to_user_id` | uuid | yes |  |
| `variables` | jsonb |  | '{}'::jsonb |
| `status` | text |  | 'queued'::text |
| `attempts` | integer |  | 0 |
| `provider_message_id` | text | yes |  |
| `last_error` | text | yes |  |
| `send_after` | timestamp with time zone |  | now() |
| `sent_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (to_user_id) REFERENCES users(id)`

## Templates + Onboarding
_Migration: `20260916000011_templates_onboarding.sql`_

### program_templates
📝 audited · 🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `source_program_id` | uuid |  |  |
| `version` | integer |  | 1 |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (source_program_id) REFERENCES programs(id)`

### lesson_templates
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `source_lesson_id` | uuid |  |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (source_lesson_id) REFERENCES lessons(id)`

### scorecard_templates
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `source_scorecard_id` | uuid |  |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (source_scorecard_id) REFERENCES scorecards(id)`

### dashboard_templates
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `source_dashboard_id` | uuid |  |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (source_dashboard_id) REFERENCES dashboards(id)`

### sop_templates
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `source_sop_id` | uuid |  |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (source_sop_id) REFERENCES standard_operating_procedures(id)`

### offer_templates
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `source_offer_id` | uuid |  |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (source_offer_id) REFERENCES offers(id)`

### pipeline_templates
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `source_pipeline_id` | uuid |  |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (source_pipeline_id) REFERENCES pipelines(id)`

### task_templates
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `category` | text | yes |  |
| `is_active` | boolean |  | true |

### task_template_items
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `task_template_id` | uuid |  |  |
| `title` | text |  |  |
| `description` | text | yes |  |
| `task_type` | text |  | 'onboarding'::text |
| `priority` | text |  | 'medium'::text |
| `visibility` | text |  | 'organization'::text |
| `due_offset_days` | integer | yes |  |
| `assignee_role_key` | text | yes |  |
| `position` | integer |  | 0 |

**References:** `FOREIGN KEY (task_template_id) REFERENCES task_templates(id)`

### onboarding_questionnaires
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `is_active` | boolean |  | true |

### questionnaire_questions
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `questionnaire_id` | uuid |  |  |
| `key` | text |  |  |
| `label` | text |  |  |
| `help_text` | text | yes |  |
| `question_type` | text |  |  |
| `options` | jsonb |  | '[]'::jsonb |
| `is_required` | boolean |  | false |
| `position` | integer |  | 0 |
| `maps_to_type` | text | yes |  |
| `maps_to_key` | text | yes |  |

**References:** `FOREIGN KEY (questionnaire_id) REFERENCES onboarding_questionnaires(id)`

### onboarding_templates
📝 audited · 🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `questionnaire_id` | uuid | yes |  |
| `welcome_message` | text | yes |  |
| `default_status` | text |  | 'onboarding'::text |
| `is_default` | boolean |  | false |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (questionnaire_id) REFERENCES onboarding_questionnaires(id)`

### onboarding_template_items
🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `onboarding_template_id` | uuid |  |  |
| `template_type` | text |  |  |
| `template_id` | uuid |  |  |
| `options` | jsonb |  | '{}'::jsonb |
| `position` | integer |  | 0 |

**References:** `FOREIGN KEY (onboarding_template_id) REFERENCES onboarding_templates(id)`

### questionnaire_responses
🏢 tenant · 📝 audited · 🔐 custom RLS · permission module `organization` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `questionnaire_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `answers` | jsonb |  | '{}'::jsonb |
| `status` | text |  | 'submitted'::text |
| `submitted_at` | timestamp with time zone | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (questionnaire_id) REFERENCES onboarding_questionnaires(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`

### template_applications
🏢 tenant · 🔐 custom RLS · permission module `templates` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `template_type` | text |  |  |
| `template_id` | uuid |  |  |
| `created_root_id` | uuid | yes |  |
| `status` | text |  | 'applied'::text |
| `detail` | jsonb |  | '{}'::jsonb |
| `applied_at` | timestamp with time zone |  | now() |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

## Automations + Client Health Scoring
_Migration: `20260916000012_automations_health.sql`_

### automation_trigger_types
🔐 custom RLS · permission module `automations`

| Column | Type | Null | Default |
|---|---|---|---|
| `key` | text |  |  |
| `description` | text |  |  |
| `payload_schema` | jsonb |  | '{}'::jsonb |

### automation_action_types
🔐 custom RLS · permission module `automations`

| Column | Type | Null | Default |
|---|---|---|---|
| `key` | text |  |  |
| `description` | text |  |  |
| `config_schema` | jsonb |  | '{}'::jsonb |

### automations
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `automations` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `description` | text | yes |  |
| `trigger_type` | text |  |  |
| `trigger_config` | jsonb |  | '{}'::jsonb |
| `is_active` | boolean |  | false |
| `run_limit_per_subject` | integer | yes |  |
| `last_run_at` | timestamp with time zone | yes |  |
| `source_template_id` | uuid | yes |  |
| `copied_from_id` | uuid | yes |  |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`; `FOREIGN KEY (trigger_type) REFERENCES automation_trigger_types(key)`

### automation_conditions
🏢 tenant · permission module `automations` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `automation_id` | uuid |  |  |
| `field` | text |  |  |
| `operator` | text |  |  |
| `value` | jsonb | yes |  |
| `group_key` | integer |  | 0 |

**References:** `FOREIGN KEY (organization_id, automation_id) REFERENCES automations(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### automation_actions
🏢 tenant · permission module `automations` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `automation_id` | uuid |  |  |
| `action_type` | text |  |  |
| `config` | jsonb |  | '{}'::jsonb |
| `position` | integer |  | 0 |
| `delay_minutes` | integer |  | 0 |

**References:** `FOREIGN KEY (action_type) REFERENCES automation_action_types(key)`; `FOREIGN KEY (organization_id, automation_id) REFERENCES automations(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### automation_runs
🏢 tenant · 🔐 custom RLS · permission module `automations` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `automation_id` | uuid |  |  |
| `domain_event_id` | bigint | yes |  |
| `subject_type` | text | yes |  |
| `subject_id` | uuid | yes |  |
| `status` | text |  | 'queued'::text |
| `started_at` | timestamp with time zone | yes |  |
| `finished_at` | timestamp with time zone | yes |  |
| `error` | text | yes |  |

**References:** `FOREIGN KEY (domain_event_id) REFERENCES domain_events(id)`; `FOREIGN KEY (organization_id, automation_id) REFERENCES automations(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### automation_run_steps
🏢 tenant · 🔐 custom RLS · permission module `automations` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `automation_run_id` | uuid |  |  |
| `automation_action_id` | uuid | yes |  |
| `status` | text |  | 'pending'::text |
| `run_after` | timestamp with time zone |  | now() |
| `attempts` | integer |  | 0 |
| `result` | jsonb | yes |  |
| `error` | text | yes |  |

**References:** `FOREIGN KEY (organization_id, automation_action_id) REFERENCES automation_actions(organization_id, id)`; `FOREIGN KEY (organization_id, automation_run_id) REFERENCES automation_runs(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### webhook_endpoints
🏢 tenant · 🗑 soft delete · 📝 audited · permission module `automations` · audit cols: created_at, updated_at, created_by, updated_by, deleted_at, deleted_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `name` | text |  |  |
| `url` | text |  |  |
| `event_types` | text[] |  | '{}'::text[] |
| `secret_ref` | text | yes |  |
| `is_active` | boolean |  | true |
| `last_delivery_at` | timestamp with time zone | yes |  |
| `failure_count` | integer |  | 0 |

**References:** `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### health_score_models
📝 audited · 🔐 custom RLS · permission module `health` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `name` | text |  |  |
| `description` | text | yes |  |
| `is_default` | boolean |  | false |
| `healthy_min` | numeric(5,2) |  | 75 |
| `watch_min` | numeric(5,2) |  | 55 |
| `at_risk_min` | numeric(5,2) |  | 35 |
| `is_active` | boolean |  | true |

### health_score_factors
📝 audited · 🔐 custom RLS · permission module `health` · audit cols: created_at, updated_at, created_by, updated_by

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `model_id` | uuid |  |  |
| `factor_key` | text |  |  |
| `weight` | numeric(6,3) |  |  |
| `lookback_days` | integer |  | 30 |
| `worst_value` | numeric |  |  |
| `best_value` | numeric |  |  |
| `is_active` | boolean |  | true |

**References:** `FOREIGN KEY (model_id) REFERENCES health_score_models(id)`

### client_health_scores
🏢 tenant · permission module `health` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `model_id` | uuid |  |  |
| `score` | numeric(5,2) |  |  |
| `band` | text |  |  |
| `previous_score` | numeric(5,2) | yes |  |
| `is_latest` | boolean |  | true |
| `calculated_at` | timestamp with time zone |  | now() |
| `override_band` | text | yes |  |
| `override_reason` | text | yes |  |

**References:** `FOREIGN KEY (model_id) REFERENCES health_score_models(id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`

### client_health_score_components
🏢 tenant · permission module `health` · audit cols: created_at, updated_at

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid |  | gen_random_uuid() |
| `organization_id` | uuid |  |  |
| `health_score_id` | uuid |  |  |
| `factor_key` | text |  |  |
| `raw_value` | numeric | yes |  |
| `normalized_score` | numeric(5,2) |  |  |
| `weight` | numeric(6,3) |  |  |
| `weighted_contribution` | numeric(6,2) |  |  |
| `explanation` | text |  |  |

**References:** `FOREIGN KEY (organization_id, health_score_id) REFERENCES client_health_scores(organization_id, id)`; `FOREIGN KEY (organization_id) REFERENCES organizations(id)`
