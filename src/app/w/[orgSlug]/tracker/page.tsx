import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgPage, can } from '@/lib/auth/context';
import { deleteLead, getTracker, installStudentTracker, saveLead, saveTrackerValue } from '@/modules/tracker/actions';
import { done } from '@/components/flash';
import { TrackerView, leadFromForm } from '@/components/tracker-view';
import { Flash, PageHead } from '@/components/ui';

export const metadata = { title: 'My numbers' };

/** A student's own week. Nothing here needs a kpis.* permission, which is what keeps them a learner. */
export default async function MyTracker({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>; searchParams: Promise<{ week?: string; msg?: string; err?: string }>;
}) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/tracker`;
  const res = await getTracker({ orgSlug, week: sp.week });
  if (!res.ok) return (<><PageHead sub={ctx.name} title="My numbers" /><Flash err={res.error.message} /></>);
  if (!res.data) return (<><PageHead sub={ctx.name} title="My numbers" /><div className="card muted">No tracker here.</div></>);

  async function saveValues(form: FormData) {
    'use server';
    const week = String(form.get('week'));
    // every typed cell is named v_<kpiId>_<YYYY-MM-DD>, one per day
    for (const [k, v] of [...form.entries()].filter(([k]) => k.startsWith('v_'))) {
      const day = k.slice(-10);
      const value = String(v).trim();
      const r = await saveTrackerValue({ kpiId: k.slice(2, -11), day, value: value === '' ? null : Number(value) });
      if (!r.ok) { revalidatePath(path); redirect(`${path}?week=${week}&err=${encodeURIComponent(r.error.message)}`); }
    }
    revalidatePath(path);
    redirect(`${path}?week=${week}&msg=${encodeURIComponent('Saved')}`);
  }
  async function addOrEditLead(form: FormData) {
    'use server';
    done(path, await saveLead({ orgSlug, lead: leadFromForm(form) }), 'Lead saved');
  }
  async function removeLead(form: FormData) {
    'use server';
    done(path, await deleteLead({ leadId: String(form.get('id')) }), 'Lead removed');
  }
  async function install() {
    'use server';
    done(path, await installStudentTracker({ orgSlug }), 'Tracker set up. Log your first lead below.');
  }

  return (
    <TrackerView
      data={res.data}
      path={path}
      title="My numbers"
      sub={ctx.name}
      mine
      canEdit
      canInstall={can(ctx, 'kpis.create')}
      flash={{ msg: sp.msg, err: sp.err }}
      actions={{ saveValues, saveLead: addOrEditLead, removeLead, install }}
    />
  );
}
