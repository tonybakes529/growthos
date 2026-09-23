import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgPage, can } from '@/lib/auth/context';
import { getStudent } from '@/modules/students/actions';
import { deleteLead, getTracker, installStudentTracker, saveLead, saveTrackerValue } from '@/modules/tracker/actions';
import { done } from '@/components/flash';
import { TrackerView, leadFromForm, leadsFromDayForm } from '@/components/tracker-view';
import { Flash, PageHead } from '@/components/ui';

/** The same week, seen by a coach or client admin. Editing needs kpis.update; reading needs kpis.read. */
export default async function StudentTracker({ params, searchParams }: {
  params: Promise<{ orgSlug: string; studentId: string }>; searchParams: Promise<{ week?: string; chart?: string; msg?: string; err?: string }>;
}) {
  const [{ orgSlug, studentId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  if (!can(ctx, 'kpis.read')) notFound();
  const student = await getStudent({ orgSlug, onboardingId: studentId });
  if (!student.ok) notFound();
  const userId = student.data.record.user_id;
  const path = `/w/${orgSlug}/students/${studentId}/tracker`;
  const back = { href: `/w/${orgSlug}/students/${studentId}`, label: student.data.name };

  if (!userId) {
    return (<><PageHead sub={ctx.name} title={`${student.data.name} · numbers`} />
      <div className="card muted">They have not created their login yet, so there is nothing to track.</div></>);
  }
  const res = await getTracker({ orgSlug, week: sp.week, userId });
  if (!res.ok) return (<><PageHead sub={ctx.name} title={`${student.data.name} · numbers`} /><Flash err={res.error.message} /></>);
  if (!res.data) notFound();
  const editable = can(ctx, 'kpis.update');

  async function saveValues(form: FormData) {
    'use server';
    const week = String(form.get('week'));
    // every typed cell is named v_<kpiId>_<YYYY-MM-DD>, one per day
    for (const [k, v] of [...form.entries()].filter(([k]) => k.startsWith('v_'))) {
      const day = k.slice(-10);
      const value = String(v).trim();
      const r = await saveTrackerValue({ kpiId: k.slice(2, -11), day, value: value === '' ? null : Number(value), userId: userId! });
      if (!r.ok) { revalidatePath(path); redirect(`${path}?week=${week}&err=${encodeURIComponent(r.error.message)}`); }
    }
    revalidatePath(path);
    redirect(`${path}?week=${week}&msg=${encodeURIComponent('Saved')}`);
  }
  /** The whole day in one submit: what was spent, and everyone who came in. */
  async function logDay(form: FormData) {
    'use server';
    const day = String(form.get('day') ?? '');
    const week = String(form.get('week') ?? day);
    const fail = (m: string) => redirect(`${path}?week=${week}&err=${encodeURIComponent(m)}`);

    for (const [k, v] of [...form.entries()].filter(([k]) => k.startsWith('spend_'))) {
      const value = String(v).trim();
      if (value === '') continue;
      const r = await saveTrackerValue({ kpiId: k.slice(6), day, value: Number(value), userId: userId! });
      if (!r.ok) { revalidatePath(path); fail(r.error.message); }
    }
    const leads = leadsFromDayForm(form);
    let saved = 0;
    for (const lead of leads) {
      const r = await saveLead({ orgSlug, lead: { ...lead, captured_on: day }, userId: userId! });
      if (!r.ok) { revalidatePath(path); fail(`${r.error.message} (saved ${saved} of ${leads.length} leads)`); }
      saved++;
    }
    revalidatePath(path);
    redirect(`${path}?week=${week}&msg=${encodeURIComponent(
      saved ? `Day logged, ${saved} lead${saved === 1 ? '' : 's'} added.` : 'Day logged.')}`);
  }
  async function addOrEditLead(form: FormData) {
    'use server';
    done(path, await saveLead({ orgSlug, lead: leadFromForm(form), userId: userId! }), 'Lead saved');
  }
  async function removeLead(form: FormData) {
    'use server';
    done(path, await deleteLead({ leadId: String(form.get('id')) }), 'Lead removed');
  }
  async function install() {
    'use server';
    done(path, await installStudentTracker({ orgSlug }), 'Tracker set up for this workspace.');
  }

  return (
    <TrackerView
      data={res.data}
      path={path}
      title={`${student.data.name} · numbers`}
      sub={ctx.name}
      mine={false}
      chartKey={sp.chart}
      back={back}
      canEdit={editable}
      canInstall={can(ctx, 'kpis.create')}
      flash={{ msg: sp.msg, err: sp.err }}
      actions={{ saveValues, logDay, saveLead: addOrEditLead, removeLead, install }}
    />
  );
}
