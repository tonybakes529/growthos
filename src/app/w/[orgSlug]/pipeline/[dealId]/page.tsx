import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrgPage, can } from '@/lib/auth/context';
import { CALL_OUTCOMES, CALL_OUTCOME_LABEL, NOTE_TYPES, createOffer, getDeal, logSalesCall, moveOpportunity, saveCallSheet, updateDeal } from '@/modules/sales/actions';
import { SheetSections, sheetValuesFromForm } from '@/modules/sales/sheet';
import { CALCULATOR_KEYS } from '@/modules/sales/calculator';
import { RevenueCalculator } from '@/components/revenue-calculator';
import { parseVideoUrl } from '@/modules/programs/embeds';
import { done } from '@/components/flash';
import { Modal } from '@/components/modal';
import { Flash, PageHead, Pill, dayTime, money } from '@/components/ui';

const NOTE_LABEL: Record<(typeof NOTE_TYPES)[number], string> = {
  pain: 'Pain / problem', budget: 'Budget', decision_maker: 'Decision maker', objection: 'Objections', next_step: 'Next step', general: 'Other notes',
};
const dollars = (v: FormDataEntryValue | null) => Math.round(Number(v || 0) * 100);
const orNull = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null;

/** One deal: the editable card, the call sheet the rep fills in, and the log of sales calls. */
export default async function Deal({ params, searchParams }: { params: Promise<{ orgSlug: string; dealId: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug, dealId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  if (!can(ctx, 'sales.read')) notFound();
  const res = await getDeal({ orgSlug, dealId });
  if (!res.ok) notFound();
  const { deal, contact, stages, offers, fields, values, calls, notes, config } = res.data;
  const board = `/w/${orgSlug}/pipeline`;
  const path = `${board}/${dealId}`;
  const edit = can(ctx, 'sales.update');
  const stage = stages.find((s) => s.id === deal.stage_id);
  const offerName = (id: string | null) => offers.find((o) => o.id === id)?.name ?? null;
  const answered = fields.filter((f) => values[f.id] != null).length;
  const sheetFields = fields.map((f) => ({ id: f.id, field_type: f.field_type }));
  const idOf = (key: string) => fields.find((f) => f.key === key)?.id;
  const calc = config.calculator?.enabled ? config.calculator : null;
  const calcInputs = { leadsPerMonth: idOf(CALCULATOR_KEYS.leadsPerMonth), closeRate: idOf(CALCULATOR_KEYS.closeRate), avgJob: idOf(CALCULATOR_KEYS.avgJob), hoursPerWeek: idOf(CALCULATOR_KEYS.hoursPerWeek) };
  // if the workspace has no section flagged for it, show the calculator after the sheet instead of hiding it
  const roiName = contact?.company || deal.title;
  const calcPlaced = config.sections.some((s) => s.calculator);

  async function save(f: FormData) {
    'use server';
    done(path, await updateDeal({
      orgSlug, dealId, title: String(f.get('title') ?? ''), valueCents: dollars(f.get('value')), cashCollectedCents: dollars(f.get('cash')),
      offerId: orNull(f.get('offer')), expectedCloseOn: orNull(f.get('close')),
      contact: { firstName: String(f.get('first') ?? ''), lastName: String(f.get('last') ?? ''), email: String(f.get('email') ?? ''), phone: String(f.get('phone') ?? ''), company: String(f.get('company') ?? '') },
    }), 'Deal saved');
  }
  async function move(f: FormData) {
    'use server';
    done(path, await moveOpportunity({ orgSlug, opportunityId: dealId, stageId: String(f.get('stage')) }), 'Stage updated');
  }
  async function sheet(f: FormData) {
    'use server';
    done(path, await saveCallSheet({ orgSlug, dealId, values: sheetValuesFromForm(f, sheetFields) }), 'Call sheet saved');
  }
  async function addOffer(f: FormData) {
    'use server';
    done(path, await createOffer({ orgSlug, name: String(f.get('name') ?? '') }), 'Offer added. Pick it on the deal.');
  }
  async function logCall(f: FormData) {
    'use server';
    const when = String(f.get('when') || '');
    const amount = String(f.get('amount') ?? '').trim();
    const mins = String(f.get('minutes') ?? '').trim();
    const score = String(f.get('score') ?? '').trim();
    const noteList = NOTE_TYPES.map((t) => ({ type: t, body: String(f.get(`note_${t}`) ?? '').trim() })).filter((n) => n.body);
    done(path, await logSalesCall({
      orgSlug, dealId, occurredAt: (when ? new Date(when) : new Date()).toISOString(), durationMinutes: mins ? Number(mins) : null,
      outcome: String(f.get('outcome')) as 'follow_up', offerPitchedId: orNull(f.get('pitched')), amountCents: amount ? dollars(amount) : null,
      recordingUrl: orNull(f.get('recording')), callScore: score ? Number(score) : null, notes: noteList,
    }), 'Call logged');
  }

  return (
    <>
      <Link href={board}>← Sales pipeline</Link>
      <PageHead sub={`${ctx.name} · ${stage?.name ?? 'Deal'}`} title={deal.title}>
        <Pill value={deal.status} />
        <span style={{ fontWeight: 700, fontSize: 18 }}>{money(deal.value_cents)}</span>
        {can(ctx, 'sales.create') && (
          <Modal label="+ Log a call" title="Log a sales call" primary open={!!sp.err}>
            <form action={logCall}>
              <div className="row"><label className="f" style={{ flex: 1 }}>When<input name="when" type="datetime-local" /></label>
                <label className="f" style={{ width: 110 }}>Minutes<input name="minutes" type="number" min="0" max="600" /></label></div>
              <div className="row"><label className="f" style={{ flex: 1 }}>Outcome
                  <select name="outcome" required defaultValue="follow_up">{CALL_OUTCOMES.map((o) => <option key={o} value={o}>{CALL_OUTCOME_LABEL[o]}</option>)}</select></label>
                <label className="f" style={{ flex: 1 }}>Offer pitched
                  <select name="pitched" defaultValue={deal.offer_id ?? ''}><option value="">None</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
              <div className="row"><label className="f" style={{ flex: 1 }}>Amount ($) <span className="muted" style={{ fontWeight: 400 }}>if closed or deposit</span><input name="amount" type="number" min="0" step="any" /></label>
                <label className="f" style={{ width: 110 }}>Score 1-10<input name="score" type="number" min="1" max="10" /></label></div>
              <label className="f">Recording link <span className="muted" style={{ fontWeight: 400 }}>(Loom, Zoom, anything)</span><input name="recording" type="url" placeholder="https://" /></label>
              {NOTE_TYPES.map((t) => <label className="f" key={t}>{NOTE_LABEL[t]}<textarea name={`note_${t}`} rows={2} style={{ minHeight: 0 }} /></label>)}
              <div><button className="btn primary" type="submit">Save call</button></div>
            </form>
          </Modal>
        )}
      </PageHead>
      <Flash msg={sp.msg} err={sp.err} />

      <div className="grid builder">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form id="callsheet" action={sheet} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Call sheet {fields.length > 0 && <span className="muted" style={{ fontWeight: 400 }}>({answered} of {fields.length} filled)</span>}</h2>
              {can(ctx, 'custom_fields.update') && <Link href={`${board}/sheet`}>Edit call sheet</Link>}
            </div>
            {!fields.length ? (
              <p className="card empty">No call sheet yet. {can(ctx, 'custom_fields.create') ? <><Link href={`${board}/sheet`}>Set it up</Link>: load the discovery call template or write your own questions.</> : 'Your admin sets up the questions reps answer on every deal.'}</p>
            ) : (<>
              <SheetSections fields={fields} sections={config.sections} values={values} disabled={!edit}
                calculator={calc && <RevenueCalculator formId="callsheet" inputs={calcInputs} presets={calc} name={roiName} />} />
              {calc && !calcPlaced && <RevenueCalculator formId="callsheet" inputs={calcInputs} presets={calc} name={roiName} />}
              {edit && <div className="savebar"><button className="btn primary" type="submit">Save call sheet</button><span className="muted">Saves every answer, including the four calculator numbers.</span></div>}
            </>)}
          </form>

          <div className="card">
            <h2>Sales calls ({calls.length})</h2>
            {!calls.length && <p className="empty">No calls logged yet. Use &quot;Log a call&quot; after each conversation.</p>}
            {calls.map((c) => {
              const embed = c.recording_url ? parseVideoUrl(c.recording_url) : null;
              const callNotes = notes.filter((n) => n.sales_call_id === c.id);
              return (
                <div className="answer" key={c.id}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b>{dayTime(c.occurred_at)}{c.duration_minutes ? ` · ${c.duration_minutes} min` : ''}</b>
                    <span className="row"><Pill value={c.outcome === 'closed' || c.outcome === 'deposit' ? 'won' : c.outcome === 'lost' || c.outcome === 'not_qualified' ? 'lost' : 'pending'} label={CALL_OUTCOME_LABEL[c.outcome as 'closed']} />
                      {c.call_score && <Pill value="none" label={`${c.call_score}/10`} />}</span>
                  </div>
                  <div className="muted">{[offerName(c.offer_pitched_id) && `Pitched ${offerName(c.offer_pitched_id)}`, c.amount_cents != null && money(c.amount_cents)].filter(Boolean).join(' · ')}</div>
                  {embed ? <div className="video" style={{ marginTop: 8 }}><iframe src={embed.embed_url} title="Call recording" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" loading="lazy" /></div>
                    : c.recording_url && <div><a href={c.recording_url} target="_blank" rel="noreferrer">Open recording</a></div>}
                  {callNotes.map((n) => <div key={n.id} style={{ marginTop: 6 }}><span className="muted" style={{ fontSize: 12 }}>{NOTE_LABEL[n.note_type as 'pain']}</span><div className="a" style={{ marginTop: 0 }}>{n.body}</div></div>)}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {edit && (
            <form className="card row" action={move} style={{ alignItems: 'end' }}>
              <label className="f" style={{ flex: 1 }}>Stage<select name="stage" defaultValue={deal.stage_id}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <button className="btn" type="submit">Move</button>
            </form>
          )}
          <form className="card" action={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0 }}>Deal</h2>
            <fieldset disabled={!edit} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <label className="f">Deal name<input name="title" required maxLength={160} defaultValue={deal.title} /></label>
              <label className="f">Offer
                <select name="offer" defaultValue={deal.offer_id ?? ''}><option value="">No offer yet</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <div className="row"><label className="f" style={{ flex: 1 }}>Value ($)<input name="value" type="number" min="0" step="any" defaultValue={deal.value_cents / 100} /></label>
                <label className="f" style={{ flex: 1 }}>Cash collected ($)<input name="cash" type="number" min="0" step="any" defaultValue={deal.cash_collected_cents / 100} /></label></div>
              <label className="f">Expected close<input name="close" type="date" defaultValue={deal.expected_close_on ?? ''} /></label>
              <h3 style={{ margin: '6px 0 0' }}>Contact</h3>
              <div className="row"><label className="f" style={{ flex: 1 }}>First name<input name="first" defaultValue={contact?.first_name ?? ''} /></label>
                <label className="f" style={{ flex: 1 }}>Last name<input name="last" defaultValue={contact?.last_name ?? ''} /></label></div>
              <label className="f">Email<input name="email" type="email" defaultValue={contact?.email ?? ''} /></label>
              <div className="row"><label className="f" style={{ flex: 1 }}>Phone<input name="phone" type="tel" defaultValue={contact?.phone ?? ''} /></label>
                <label className="f" style={{ flex: 1 }}>Company<input name="company" defaultValue={contact?.company ?? ''} /></label></div>
              {edit && <div><button className="btn primary" type="submit">Save deal</button></div>}
            </fieldset>
          </form>
          {can(ctx, 'offers.create') && (
            <form className="card row" action={addOffer} style={{ alignItems: 'end' }}>
              <label className="f" style={{ flex: 1 }}>Add an offer <span className="muted" style={{ fontWeight: 400 }}>(what this business sells)</span><input name="name" required maxLength={160} placeholder="6-Week Business Growth Program" /></label>
              <button className="btn" type="submit">Add</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
