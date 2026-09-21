import Link from 'next/link';
import { requireOrgPage, can } from '@/lib/auth/context';
import { createOpportunity, moveOpportunity } from '@/modules/sales/actions';
import { getGrowthMetrics } from '@/modules/reports/actions';
import { done } from '@/components/flash';
import { Flash, PageHead, Stat, money } from '@/components/ui';
import { Modal } from '@/components/modal';
import { SubNav, growthTabs } from '@/components/subnav';

export default async function Pipeline({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/pipeline`;
  const org = ctx.organizationId;
  if (!can(ctx, 'sales.read')) return (<><PageHead sub={ctx.name} title="Sales Pipeline" /><div className="card muted">You don't have access to sales.</div></>);

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 2, 1).toISOString().slice(0, 10);
  // One round: stages and deals are read by workspace and narrowed to the default pipeline below, so nothing waits
  // for the pipeline row. Each deal carries its contact's name; this used to download every contact in the workspace.
  const [pipes, stages, opps, metrics] = await Promise.all([
    ctx.sb.from('pipelines').select('id, name').eq('organization_id', org).is('deleted_at', null).order('is_default', { ascending: false }).limit(1),
    ctx.sb.from('pipeline_stages').select('id, pipeline_id, name, stage_type, position').eq('organization_id', org).order('position'),
    ctx.sb.from('opportunities')
      .select('id, pipeline_id, title, stage_id, status, value_cents, cash_collected_cents, contact_id, closed_at, contact:contacts!opportunities_organization_id_contact_id_fkey(first_name, last_name)')
      .eq('organization_id', org).is('deleted_at', null)
      .overrideTypes<{ id: string; pipeline_id: string; title: string; stage_id: string; status: string; value_cents: number; cash_collected_cents: number;
        contact_id: string; closed_at: string | null; contact: { first_name: string | null; last_name: string | null } | null }[], { merge: false }>(),
    can(ctx, 'reports.read') ? getGrowthMetrics({ orgSlug, from, to: today.toISOString().slice(0, 10) }) : null,
  ]);
  const pipe = pipes.data?.[0];
  if (!pipe) return (<><PageHead sub={ctx.name} title="Sales Pipeline" /><div className="card muted">No pipeline yet. Your Growth OS team adds one from a template.</div></>);
  const st = (stages.data ?? []).filter((s) => s.pipeline_id === pipe.id);
  const deals = (opps.data ?? []).filter((o) => o.pipeline_id === pipe.id);
  const contactName = (o: (typeof deals)[number]) => `${o.contact?.first_name ?? ''} ${o.contact?.last_name ?? ''}`.trim();
  const m = metrics?.ok ? metrics.data : [];
  const sum = (k: keyof (typeof m)[number]) => m.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const leads = sum('leads'), showed = sum('appointments_showed'), closes = sum('closes'), spend = sum('marketing_spend_cents');

  async function move(form: FormData) {
    'use server';
    done(path, await moveOpportunity({ orgSlug, opportunityId: String(form.get('id')), stageId: String(form.get('stage')) }), 'Deal moved');
  }
  async function add(form: FormData) {
    'use server';
    done(path, await createOpportunity({ orgSlug, pipelineId: String(form.get('pipeline')), firstName: String(form.get('first')),
      lastName: String(form.get('last') || '') || undefined, email: String(form.get('email') || '') || undefined,
      title: String(form.get('title')), valueCents: Math.round(Number(form.get('value') || 0) * 100) }), 'Deal added');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="Growth · Sales pipeline">
        {can(ctx, 'custom_fields.update') && <Link className="btn" href={`${path}/sheet`}>Edit call sheet</Link>}
        {can(ctx, 'sales.create') && (
          <Modal label="+ New deal" title="New deal" primary open={!!sp.err}>
            <form action={add}>
              <input type="hidden" name="pipeline" value={pipe.id} />
              <label className="f">Deal name<input name="title" required maxLength={160} placeholder="Acme Corp, 6-week program" autoFocus /></label>
              <div className="row"><label className="f" style={{ flex: 1 }}>First name<input name="first" required /></label>
                <label className="f" style={{ flex: 1 }}>Last name<input name="last" /></label></div>
              <label className="f">Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span><input name="email" type="email" /></label>
              <label className="f">Value ($)<input name="value" type="number" min="0" /></label>
              <div><button className="btn primary" type="submit">Add deal</button></div>
            </form>
          </Modal>
        )}
      </PageHead>
      <SubNav items={growthTabs(orgSlug, can(ctx, 'kpis.read'), true)} current="pipeline" />
      <Flash msg={sp.msg} err={sp.err} />
      {!!m.length && (
        <div className="grid g5">
          <Stat k="Leads (3 mo)" v={leads} />
          <Stat k="Show rate" v={`${sum('appointments_booked') ? Math.round((100 * showed) / sum('appointments_booked')) : 0}%`} s={`${showed} of ${sum('appointments_booked')} booked`} />
          <Stat k="Close rate" v={`${showed ? Math.round((100 * closes) / showed) : 0}%`} s={`${closes} closed`} />
          <Stat k="Cash collected" v={money(deals.filter((o) => o.status === 'won').reduce((a, o) => a + o.cash_collected_cents, 0))} s="on won deals" />
          <Stat k="Cost per lead" v={spend && leads ? money(spend / leads) : '—'} s={spend ? `${money(spend)} spend` : 'no spend access'} />
        </div>
      )}
      <div className="kanban">
        {st.map((s) => {
          const inStage = deals.filter((o) => o.stage_id === s.id);
          return (
            <div key={s.id} className="col">
              <div><b>{s.name}</b> <span className="muted">{inStage.length} · {money(inStage.reduce((a, d) => a + d.value_cents, 0))}</span></div>
              {inStage.map((d) => (
                <div key={d.id} className="deal">
                  <Link href={`${path}/${d.id}`}><b>{d.title}</b></Link>
                  <span className="muted">{money(d.value_cents)} · {contactName(d)}</span>
                  {can(ctx, 'sales.update') && (
                    <form action={move} className="row">
                      <input type="hidden" name="id" value={d.id} />
                      <select name="stage" defaultValue={s.id} aria-label={`Stage for ${d.title}`} style={{ flex: 1, minWidth: 0 }}>
                        {st.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <button className="btn small" type="submit">Move</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
