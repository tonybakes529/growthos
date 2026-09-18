# Growth OS: How the Product Works

This document explains Growth OS to an AI (or a person) who needs to understand how the software behaves: who uses it, what each screen does, what happens automatically, and the rules that hold it together. It is about behaviour and flow, not visual design and not code. For code, tables and conventions read `docs/AI_CONTEXT.md`.

Accurate as of 2026-09-18, branch `feat/customer-onboarding`.

---

## 1. The idea in one paragraph

Growth OS is run by a **growth operator** (Tony's agency). The operator signs **clients**: businesses that sell a course or coaching program. Each client gets a private **workspace**. Inside the workspace the client's team runs their business: their courses, the customers who bought them, weekly KPI scorecards, tasks, team members and automations. When a **customer** buys a client's course, Growth OS creates their record, sends them a personal link, lets them create a login, walks them through that client's custom onboarding form, and hands the answers to the client and to the automation engine. The operator sets each client up once; from then on every buyer is onboarded without anyone touching anything.

---

## 2. The three levels and who lives at each

```
OPERATOR  (Tony + internal team)            sees every client, from the control plane
   └── CLIENT  (a business, e.g. Acme Coaching)   sees only its own workspace
          └── CUSTOMER  (a buyer of the client's course)   sees only their own course and onboarding
```

| Level | Roles | Where they land after login |
|---|---|---|
| Operator | **Super admin** (everything), **Internal team** (only the clients they are assigned to, as account manager, coach, sales manager or content manager) | `/admin/clients`, the control plane |
| Client | **Client admin** (runs the workspace), **Client team member** (works in it, limited), custom roles a client admin defines | Their workspace dashboard |
| Customer | **Student** (a membership with the student role) | Their unfinished onboarding if there is one, otherwise the workspace dashboard |

Important behaviours:
- One login can belong to many workspaces with a different role in each. A person can be a client admin at one company and a student at another.
- A student is not a separate kind of account. It is an ordinary login holding the student role inside one client's workspace.
- Internal team members get nothing inside a client just for being staff. They must be assigned to that client.
- Clients never see the control plane. A client who types the admin URL is bounced to their own workspace.
- Nobody can see another client's workspace. Typing another client's URL gives a 404, as if it did not exist.

---

## 3. Signed-out pages

| Page | Behaviour |
|---|---|
| `/login` | Email and password. After sign-in the person is routed by role (section 2). |
| `/signup` | Account creation for people who were invited as team members. |
| `/invite/{token}` | Accepting a team invitation. If the token turns out to be a customer invitation, the page forwards to the branded customer link below. |
| `/join/{client}/{token}` | The customer's personal link. Described in section 6. |
| `/` | Not a page. It only redirects by role. A customer with unfinished onboarding is sent straight to it. |

---

## 4. The operator's control plane (`/admin/clients`)

One screen. It answers "which clients need my attention" first, then "set up a new one".

**Top of the page**
- **Needs attention**: each flagged client with the reason in plain words (health at risk or critical, renews in N days, never logged in, no login or no KPIs for 14+ days, overdue tasks, blockers), with an Open button.
- **Renewals, next 60 days**, with MRR.
- **My tasks**: the operator's own open tasks across every client they can enter.
- Totals (super admin only): clients, MRR, at risk, renewals in 30 days.
- A compact client table: status, health, MRR, renewal, last login, assigned team, inline status change. Search and filter.
- **New client** stays one click away. Bulk template application and health recalculation live under "More tools".

Internal team members see the same layout limited to their assigned clients, with no totals and no create form.

**What you can do**
- **Create a client workspace.** Company name, URL slug, the client admin's email, industry, MRR, revenue target, renewal date, an onboarding template, and which staff are account manager and coach. Creating it copies the chosen template's content (courses, scorecards, dashboards, SOPs, tasks) into the new workspace, invites the client admin by email, and assigns the staff.
- **Apply a template to clients.** Push a course, scorecard, dashboard, SOP, offer or task list from the template library into one or many workspaces at once.
- **Recalculate health.** Rerun every client's health score now instead of waiting for the nightly job.
- **Open a workspace.** Click any client. The operator enters it with full rights and uses the same screens the client uses.
- **View as a member.** From a workspace's Team page, the super admin can view the app exactly as any member sees it, read-only, with a banner, for 60 minutes. This is the fastest way to check what a client or customer experiences.

The operator has no separate "operator version" of a workspace. The workspace screens adapt to permissions, and the operator simply has all of them.

---

## 5. The client workspace (`/w/{client}/...`)

Every client workspace has the same screens. What a person sees depends on their permissions, never on the name of their role, so custom roles and restricted team members get exactly the pages they can use.

**Navigation for people who run the workspace**: Home, Customers, Courses, SOPs, Growth, Tasks, then a smaller "Manage" group with Team, Automations and Activity. Onboarding forms sit inside Courses as a second tab. Growth opens the weekly scorecard. A link only appears when the person can use the page behind it.

**Navigation for customers (students)**: Home, My Courses, My Tasks. A student is anyone whose permissions are limited to community and messaging, which is what the system student role holds.

**Workspace switcher**: people who belong to several workspaces see the others listed with the role they hold in each.

| Screen | Client admin sees | Restricted team member sees | Student sees |
|---|---|---|---|
| Home | Needs attention, my tasks, summary tiles, latest KPIs, calls, wins, blockers | Same, minus customers and money KPIs | One next action, my courses, my tasks, calls |
| Customers | Every buyer and their onboarding status | Not shown | Not shown |
| Courses | All courses, builder, onboarding forms tab | All courses, no builder | Only enrolled courses |
| SOPs | Read, write, version, archive | Read only | Not shown |
| Growth | Weekly scorecard, enter and submit | Scorecard without financial rows | Not shown |
| Tasks | All tasks, create and assign | Tasks, create | Their own tasks |
| Team, Automations, Activity | Yes | Team and Activity only | Not shown |

### 5.1 Home
Answers "what needs to happen next in my business". A **Needs attention** list shows only real, actionable items, each linking to where it gets fixed: overdue tasks, this week's scorecard not submitted, customers who have not finished onboarding, invited customers who have not signed up, KPIs off track, open blockers. Beside it, **My tasks** with a Done button. Then summary tiles that link out: Customers (onboarded / in progress), Courses (published, enrolled, average progress), Weekly scorecard (due or submitted), and Open deals for people with sales access. Below: latest KPIs, upcoming calls, recent wins, open blockers. A new client admin also sees the operator's onboarding questionnaire here until they submit it.

For a **student**, Home is different: one large card with the single next action, computed from real progress. In order: finish onboarding (handled outside the shell), continue the next lesson they can open, start a course they have not begun, view a lesson that is still locked with the reason, or open an assigned task. Drip schedules and lesson sequencing are respected because the same outline logic as the course page decides what is open. Below that: their courses with progress, their tasks, upcoming calls.

### 5.2 Courses (called "programs" internally)
A course is a tree: sections contain modules, modules contain lessons, lessons contain content blocks (text, video, downloads, quizzes, assignments).

- **Learner view.** The outline with each lesson marked complete, locked or available. Lessons can be locked by drip (unlock N days after enrolment) or by sequence (finish the previous one first); the outline says why. Inside a lesson: content blocks, "Mark complete", assignments to submit, quizzes with a pass mark. Completing all lessons can issue a certificate.
- **Builder view** (anyone with course-edit rights, always the client admin and the operator). Add sections, modules and lessons, set drip days and sequencing, publish or unpublish the course. On a lesson, add text or a video by pasting a Loom, YouTube or Tella share link; the link is checked and turned into an embedded player.
- **Course settings** (builder view). Name, description, which onboarding form new buyers get (only published forms are offered), and an optional product ID so an outside checkout can name this course. If the course is sold through an offer, the offer's Stripe product and price IDs are shown read-only.
- **Customers panel** (client admin). Counts of invited, unfinished and completed for this course, with a link to the filtered Customers page.
- **Students panel** (client admin). Each enrolled person with their progress percent, and an Enroll control for existing members.

A course does not have to be published for buyers to be added to it, but it must be published before a learner can open its lessons.

### 5.3 Customers
The client's most important operational screen. One row per customer per course. The customer's profile page is the single place to understand one person: journey, details, every course they are enrolled in with progress, tasks assigned to them, and their onboarding answers.

**Columns and what they mean**
- **Status**: `Invited` (they have a link but no login yet) or `Active` (they created their login).
- **Onboarding**: `Not started`, `In progress`, `Complete`, or `No form` if the course has no onboarding form attached.
- Invited date, completed date.

**Tiles** at the top count the four stages: Invited, Not started, In progress, Complete. **Filters** by stage and by course.

**Click a customer** to open their record: a journey timeline (invited, created their login, started onboarding, completed onboarding, each with a timestamp or "Not yet"), their details, and every onboarding answer with its question. If a question was deleted from the form after they answered, the answer is still shown, marked as a removed question. Drafts from someone mid-onboarding are visible but flagged as still changing.

**Add a customer.** Pick a course, enter name and email. This does exactly what a purchase does, minus the payment: the customer record appears as Invited and a personal link is shown once. Use it for offline sales, or to try the customer journey yourself. Adding someone who is already Invited issues a fresh link and kills the old one. Adding someone who already has a login in this workspace enrols them immediately with no link needed.

**The link is shown once.** Only a hash of it is stored, so it cannot be displayed again. If it is lost, add the customer again to get a new one.

### 5.3a SOPs (the team's playbook)
The clear line in the product: **Courses are for customers, SOPs are for the team.** A customer never sees an SOP.

- One library per workspace, grouped by department. Each SOP has a title, a summary, a status (draft, active, archived) and a numbered history of versions.
- Anyone with `sops.create` (client admins, and the operator inside the workspace) writes new SOPs in plain text; lines starting with `#` become headings, `1.` or `-` become lists. Editing always publishes a new version with an optional "what changed" note; older versions stay readable.
- The operator can also drop SOPs in from the Growth OS library ("Add from the Growth OS library"), which copies the SOP so the client can edit their copy. Those show "From Growth OS".
- "Mark reviewed" records a review date. Archive hides it from the main list; delete soft-deletes it.
- Restricted team members read SOPs but cannot edit them. Students have no access at all.

### 5.4 Onboarding (the form builder)
Where the operator, or the client admin, builds the questions a new buyer answers right after creating their login.

- A workspace can have many forms. Each is a **draft** until published.
- **Questions**: eight types (short text, long text, email, number, website link, single select, multi select, checkbox), each with a label, optional help text, required or optional, and options for the two select types. Add, edit, delete, move up and down.
- Every question gets a permanent **automation key** (for example `what_is_your_current_monthly_revenue`) shown under it. Renaming the question never changes the key, so automations built on it keep working.
- **Delete** is soft: answers customers already gave stay on their records with the original label.
- **Publish** needs at least one question. A published form can be **attached** to one or more courses from the right-hand panel or from the course's settings. A form cannot be unpublished while a course is using it.
- **Preview** shows the form exactly as a customer will see it, using the same components, with submit disabled.
- **Wording**: the heading and intro the customer sees, and the message after they finish.
- **Branding**: a logo link and a brand colour for the whole workspace. These appear on the customer's personal link page and their onboarding form. Everything the customer sees carries the client's name, not "Growth OS".

The whole point is that different clients have completely different questions. Nothing is hard-coded.

### 5.5 Automations
A list of the workspace's automation rules: name, the event that triggers it, what it does, when it last ran, and an on/off switch.

One ready-made recipe can be created from the page: "when a customer completes onboarding (for any course or one course), notify (workspace admins / coach / account manager / the Growth OS team)". It creates a normal rule that a future rule builder could edit.

The page also lists the customer events the engine can react to, and warns when the background worker that runs automations is not switched on for the deployment (it is not, until two environment secrets are set).

### 5.6 Weekly Scorecard
A weekly grid of the client's KPIs: this week, last week, target, change and status, with previous/next week navigation. People with KPI-entry rights type the numbers and submit; everyone else reads. Financial KPIs (cash collected, marketing spend, cost per lead) are hidden from anyone without the financial permission, which is why a client team member sees fewer tiles than the client admin.

### 5.7 Tasks
A task table with filters (Open, Mine, Overdue, Done), inline status changes, and an "Add task" form for people who may create tasks. Staff can mark a task "staff only" so it never reaches the client.

### 5.8 Team
Members with role, status and last login. Managers can change roles and remove people. A panel shows the Growth OS staff assigned to this client. "Invite someone" sends a team invitation (not a customer one). Pending invitations can be revoked. The super admin sees a "View as" button beside each member.

### 5.9 Activity
Customer counts (all time, new in 30 days, completed onboarding and the completion rate among those with a login) and a feed of recent events in the workspace, such as "Jane Smith completed onboarding for 6-Week Business Growth Program".

---

## 6. The customer journey, step by step

This is the flow the whole product is built around. The customer never picks a client, a course or a form. All of that is known from their link and, later, their login.

```
BUY  →  CLICK LINK  →  CREATE LOGIN  →  ANSWER QUESTIONS  →  DONE
```

1. **Purchase.** A Stripe checkout for one of the client's offers, or the client adds them by hand on the Customers page. Either way Growth OS finds or creates the customer (no duplicates by email), links them to the course, and generates a personal link. Status: **Invited**.
2. **The link.** `https://.../join/{client}/{token}`. It is unique, unguessable (32 random bytes), single use, tied to the customer's email, and expires after 7 days. It is emailed (once email sending is switched on) and shown once to whoever added the customer. Anyone else's link, or an old replaced link, shows "this link isn't valid" and nothing else.
3. **Welcome page.** Branded with the client's name, logo and colour. "Welcome to Acme Coaching. You're enrolled in: 6-Week Business Growth Program." Greets them by first name if known. Then one of:
   - no account yet: name and password fields, email fixed to the invitation;
   - account exists: password only;
   - already signed in with the right email: a Continue button;
   - signed in as someone else: told to sign out first.
4. **Login created.** The invitation is accepted: they become a student in that client's workspace and are enrolled in the course. Status: **Active / Not started**. If the Supabase project requires email confirmation (it currently does), they first confirm by email, then return to the link and sign in.
5. **Onboarding form.** They land on `/start/{client}`: the client's branding, "Welcome, Jane. Let's get you set up.", and the client's questions. Each answer saves as they leave the field, so closing the tab loses nothing. A bad value (say a website that is not a link) is refused with a message on that field alone. Status: **In progress** after the first save. There is also a "Save and finish later" button.
6. **Complete.** "Complete onboarding" checks every required answer on the server. If something is missing, they are told which questions, and everything typed so far is kept. On success: **Complete**, a thank-you page with the client's message, and a button into the course.
7. **After that.** Signing in later takes them to the workspace dashboard with three links: Dashboard, Courses, Tasks. If the same person buys a second course with a form, signing in takes them into that onboarding first.

What the client sees meanwhile: the customer moves through the tiles and rows on the Customers page in real time, and the record page fills with answers.

What the automation engine sees: four events, `customer.invited`, `customer.registered`, `customer.onboarding_started`, `customer.onboarding_completed`. The last one carries every answer keyed by the question's automation key, with numbers as numbers and multi-selects as lists, so a rule can say "if monthly revenue is above 10,000, notify the coach and tag them high-ticket".

---

## 7. The operator's setup workflow, start to finish

```
CREATE CLIENT  →  CREATE COURSE  →  BUILD ONBOARDING FORM  →  PUBLISH + ATTACH  →  (client sells)  →  every buyer onboards automatically
```

1. Control plane: create the client workspace. Optionally invite the client admin at the same time.
2. Open the workspace. Courses: create the course, add lessons and videos, publish.
3. Onboarding: create a form, add questions, set the wording and branding, publish.
4. Attach the form to the course (from the form page or the course settings).
5. Optional: Automations, create an alert for completed onboarding.
6. Try it yourself: Customers, add a customer with your own email, open the link.

After step 4 the operator does nothing per customer. No creating accounts, no sending forms, no copying answers.

---

## 8. Rules that hold across the product

- **Isolation is absolute.** A client cannot see another client's customers, courses, forms, answers or activity. A customer cannot see another customer's onboarding. This is enforced by the database on every query, not just hidden in the interface, so a crafted request gets the same nothing as the screen does.
- **A course can only use a form from its own workspace.** The database refuses anything else.
- **Customer records cannot be edited directly by anyone.** They change only through the defined steps (invite, register, save answers, complete), and only the customer can write their own answers.
- **Statuses are derived from real events, not set by hand.** Invited becomes Active when the login is created; Not started becomes In progress on the first saved answer; Complete only on a successful submit.
- **Everything a customer sees is the client's brand.** No Growth OS navigation, no admin language, no choices about client or course.
- **Money is exact.** Amounts are stored in cents.
- **Deletion is soft.** Business data is hidden, not destroyed, and can be restored by the super admin.
- **Every sensitive action is audited**, including who was being impersonated when it happened.

---

## 9. What is automatic, and what still needs switching on

**Automatic today**
- Customer record creation from a purchase or a manual add.
- Personal link generation and one-time display.
- Role-based routing after login, including sending customers into unfinished onboarding.
- Status progression and the event trail.
- Nightly health scores and overdue / inactive checks, once the cron secrets exist.

**Not yet switched on** (each is one setting or secret away)
- **Sending email.** Welcome and invitation emails are queued but not delivered until an email provider key is set. Until then the operator sends the link by hand.
- **Running automations.** Rules are stored and events recorded, but nothing fires until the background worker has its two secrets.
- **Stripe.** Checkout and webhook handling exist, but no Stripe products or prices have been created, so nothing charges yet.
- **Email confirmation.** The Supabase project currently requires new sign-ups to confirm by email, which adds two steps to the customer journey. Turning it off makes "create login" one step; the personal link already proves the customer owns the email.

---

## 10. Vocabulary, because the words differ by audience

| In the interface | In the code and database | Meaning |
|---|---|---|
| Client, workspace | organization | One paying business and everything it owns |
| Course | program | A sellable learning program |
| Customer | contact + student membership + customer_onboardings row | A buyer of a course |
| Onboarding form | onboarding_forms | The client's custom questions for new buyers |
| Personal link, invitation | invitations | The single-use token a buyer uses to create their login |
| Growth OS team | team_assignments | Operator staff attached to a client |
| Dashboard | Home | The workspace landing page |

---

## 11. Known gaps (as of this date)

- Only 13 workspace screens exist. Roadmap and milestones, Goals, KPI definitions and trends, Content tracker, Coaching calls, Resources and SOPs, Messages, Notifications, Settings, a full automation builder, audit log viewer, health score breakdown, reports and export, dashboards, checkout pages and a contacts CRM all have working data and rules underneath but no screen yet.
- Lesson content types beyond text and video (downloads, images, documents, quizzes and assignments) can be stored and shown but cannot yet be added from the interface.
- The Sales Pipeline screen was removed on purpose: sales are tracked outside the platform. A read-only open-deals tile remains on Home for people with sales access.
- There is no way yet to delete a lesson block or reorder blocks from the interface.
- Courses copied from the operator's template library into a client ("Revenue Accelerator", "Client Onboarding Bootcamp") are marked "from Growth OS" but still appear beside the client's own courses. Under the courses-are-for-customers rule they belong in SOPs or should stop being copied by the default onboarding template; that is a data decision for the operator.
- A customer's onboarding form is chosen when they start it. If the client swaps the course's form afterwards, customers already in progress keep the form they began.
