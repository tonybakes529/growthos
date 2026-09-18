# Testing Growth OS from scratch: working notes

For Tony, while setting the platform up by hand to find bugs. The goal is that every problem you hit reaches Claude in a form that can be fixed in one pass, without a back-and-forth.

## 1. How to report something

One line per problem is enough if it has these three things:

```
WHERE   the page or URL              e.g. Courses > 6-Week Program > lesson 2
DID     what you clicked or typed    e.g. pasted a Loom link, pressed Add video
GOT     what happened instead        e.g. red box "Paste a Loom, YouTube or Tella share link"
```

Add **WANTED** only when it is not obvious.

Helpful extras, never required:
- "as client admin" / "as student" when you were not the operator.
- A screenshot for anything about layout.
- The exact words of an error message. Copy and paste beats describing it.

Batch them. Ten one-liners in one message is better than ten messages: fixes that touch the same page get done together.

## 2. Labels that save time

Start a line with one of these and Claude knows how to treat it:

| Label | Means | What happens |
|---|---|---|
| `BUG` | It is broken or wrong | Fixed first, verified in the browser, reported back |
| `CHANGE` | It works but you want it different | Done as asked; Claude only pushes back if it breaks security or data |
| `IDEA` | Not now, do not lose it | Written to the list at the bottom of this file, nothing built |
| `?` | You are not sure if it is a bug | Claude checks and tells you which it is |

## 3. The order to test in

This follows the real journey, so each step sets up the next. Tick as you go.

**Operator**
- [ ] Sign in as tony@bakesmedia.com, land on "All clients"
- [ ] Create a client workspace (try with and without a client admin email)
- [ ] Open the workspace. Home should show the intake questionnaire card and a scorecard that is due
- [ ] SOPs: the "Weekly Scorecard Review" template is there. Add your own with a Loom link. Edit it (new version)
- [ ] Courses: create a course, add a section, module and lesson, paste a Loom / YouTube / Tella link, publish
- [ ] Courses > Onboarding forms: build a form with a few question types, preview it, publish, attach it to the course
- [ ] Customers: add yourself with a second email you own. Copy the link that appears (shown once)

**Customer** (use a private window so you stay signed in as operator in the main one)
- [ ] Open the link: branded welcome, your course named
- [ ] Create the login. Expect a confirmation email first (see Known limits)
- [ ] Land on the onboarding form. Answer two fields, close the tab, reopen: answers should still be there
- [ ] Submit with a required field empty: should name the missing question and keep what you typed
- [ ] Complete it. Thank-you screen, then into the course
- [ ] Home shows one clear next step. Only three links in the sidebar

**Back as operator**
- [ ] Customers: your test customer shows Active / Complete. Open the profile: journey, course progress, answers
- [ ] Tasks: create one, assign it, mark it done
- [ ] Growth: enter and submit a weekly scorecard
- [ ] Team: invite a client admin (your own third email, or a colleague)

**Client admin** (accept that invite in another private window)
- [ ] Sees only their workspace, no "All clients", no health scores
- [ ] Can do everything above inside their workspace

## 4. Known limits, so you do not report them

- **Emails do not send yet.** Invitations and customer links are queued but not delivered until `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are set in Vercel. Copy links by hand for now.
- **Email confirmation is on** in Supabase, so a new login must confirm by email before it can sign in. Turn it off in Supabase > Authentication if you want one-step sign-up.
- **Automations do not run** for the same reason as email. Events are recorded; nothing fires.
- **Stripe is not connected.** "Add customer" is the stand-in for a purchase.
- **Local dev uses the live database.** Anything you create at localhost:3000 is real.
- **The live site is behind the branch.** Everything since the customer onboarding work lives in PR #2 and on localhost. Test on localhost until PR #2 is merged.
- **Not built yet:** goals, content tracker, coaching calls screen, messages, settings, reports, billing pages. They are not missing by accident.

## 5. How Claude works with you

- Leads with what was done and what is needed from you. Reasons only when they change your decision.
- Makes sensible default choices and keeps moving. Asks only when the call is really yours.
- Says "I could not verify X" when that is true.
- Will not create login accounts or type passwords. It will generate the link and do everything after you sign up.
- Will not delete data without showing you what is about to go first.
- Commits to the feature branch and pushes to PR #2. Never pushes to main or deploys without you saying so.

You can interrupt at any time. Redirecting mid-task is cheaper than letting the wrong thing finish.

## 6. Ideas parked for later

(add `IDEA` lines here)

- Task board as kanban with Open, Mine, Overdue, Done columns (requested 2026-09-18, not built yet)
- Decide whether operator coaching content for a client's team should live as SOP templates
