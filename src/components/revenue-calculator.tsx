'use client';

import { useEffect, useState } from 'react';
import { Anton, Barlow } from 'next/font/google';
import { calculate, type CalculatorPresets } from '@/modules/sales/calculator';
import { renderRoiPng } from './roi-image';

// Only used by the downloadable ROI image. preload off: nothing is fetched until someone presses Download.
const anton = Anton({ subsets: ['latin'], weight: '400', display: 'swap', preload: false });
const barlow = Barlow({ subsets: ['latin'], weight: ['500', '600', '700'], display: 'swap', preload: false });

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

/**
 * Live revenue-gap calculator for a sales call. It does not own the four prospect inputs: they are ordinary
 * call sheet questions in the same form, so they are saved with the deal. This component just listens to them.
 * Presets can be nudged during a call; that does not change the workspace's saved presets.
 */
export function RevenueCalculator({ formId, inputs, presets: saved, name }: {
  formId: string;
  /** who the numbers are for; printed on the downloaded image and used in its file name */
  name?: string;
  /** field id of each prospect input, plus whether the field stores money (shown in dollars) */
  inputs: { leadsPerMonth?: string; closeRate?: string; avgJob?: string; hoursPerWeek?: string };
  presets: CalculatorPresets;
}) {
  const [vals, setVals] = useState({ leadsPerMonth: 0, closeRate: 0, avgJob: 0, hoursPerWeek: 0 });
  const [presets, setPresets] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const read = () => {
      const get = (id?: string) => (id ? Number((form.querySelector(`[name="f_${id}"]`) as HTMLInputElement | null)?.value || 0) : 0);
      setVals({ leadsPerMonth: get(inputs.leadsPerMonth), closeRate: get(inputs.closeRate), avgJob: get(inputs.avgJob), hoursPerWeek: get(inputs.hoursPerWeek) });
    };
    read();
    form.addEventListener('input', read);
    return () => form.removeEventListener('input', read);
  }, [formId, inputs.leadsPerMonth, inputs.closeRate, inputs.avgJob, inputs.hoursPerWeek]);

  const r = calculate(vals, presets);
  const L = presets.label;

  async function download() {
    setBusy(true); setError(null);
    try {
      const blob = await renderRoiPng({ name, inputs: vals, presets, result: r, fonts: { display: anton.style.fontFamily, body: barlow.style.fontFamily } });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ROI${name ? ` - ${name.replace(/[^\w .&-]+/g, '').trim()}` : ''}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the image'); }
    setBusy(false);
  }
  const preset = (k: keyof CalculatorPresets, label: string, prefix = '', suffix = '') => (
    <label className="f" style={{ flex: '1 1 120px', fontWeight: 400, fontSize: 12 }}>{label}
      <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>{prefix}
        <input type="number" min="0" step="any" value={presets[k] as number} style={{ width: '100%', minWidth: 0 }}
               onChange={(e) => setPresets({ ...presets, [k]: Number(e.target.value) })} />{suffix}</span>
    </label>
  );

  return (
    <div className="calc" aria-live="polite">
      <div className="calc-hero">
        <div className="k">Left on the table every month</div>
        <div className="v">{r.hasInputs ? usd(r.monthly) : '—'}</div>
        <div className="s">{r.hasInputs ? `${usd(r.yearly)} a year` : 'Fill in the four numbers above'}</div>
      </div>

      <div className="calc-row">
        <div><div className="k">Revenue now</div><div className="n">{usd(r.revenueNow)}</div><div className="s">{r.jobsNow} jobs a month</div></div>
        <div><div className="k">Revenue with {L}</div><div className="n good">{usd(r.ourRevenue)}</div><div className="s">{r.ourJobs} jobs a month</div></div>
      </div>

      <div className="calc-leaks">
        <div className="leak"><b>1. Close rate</b>
          <span>{r.jobsNow} jobs now vs {r.ourJobs} at {r.ourCloseRate}%</span><span className="amt">{usd(r.lostToCloseRate)} lost</span></div>
        <div className="leak"><b>2. Underpricing</b>
          <span>{r.ourJobs} jobs: {usd(r.revenueAtTheirPrice)} at their price vs {usd(r.revenueAtOurPrice)} at {usd(r.ourAvgJob)}</span><span className="amt">{usd(r.lostToUnderpricing)} lost</span></div>
        <div className="leak"><b>3. Big jobs</b>
          <span>{usd(r.payPerHour)}/hr now vs {usd(r.bigJobPayPerHour)}/hr on a big job</span><span className="amt good">{usd(r.addedFromBigJobs)} added</span></div>
      </div>

      <div className="calc-row three">
        <div><div className="k">Cost of waiting 3 months</div><div className="n bad">{usd(r.waiting.m3)}</div></div>
        <div><div className="k">6 months</div><div className="n bad">{usd(r.waiting.m6)}</div></div>
        <div><div className="k">12 months</div><div className="n bad">{usd(r.waiting.m12)}</div></div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12 }}>{error ?? 'Downloads a picture of these numbers to share on screen.'}</span>
        <button className="btn primary" type="button" onClick={download} disabled={!r.hasInputs || busy}>{busy ? 'Preparing…' : 'Download ROI image'}</button>
      </div>

      <details className="edit"><summary>Adjust the {L} numbers for this call</summary>
        <div className="row" style={{ marginTop: 8, alignItems: 'end' }}>
          {preset('closeRate', `${L} close rate`, '', '%')}{preset('avgJob', `${L} average job`, '$')}
          {preset('bigJobsPerMonth', 'Big jobs / month')}{preset('bigJobValue', 'Big job value', '$')}{preset('daysPerBigJob', 'Days per big job')}
        </div>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Only for this screen. Saved presets are changed under Edit call sheet.</p>
      </details>
    </div>
  );
}
