// Revenue gap calculator shown on a sales call. Pure and dependency-free so the same code runs on the
// server, in the browser while the rep types, and in tests.

export type CalculatorPresets = {
  /** Short name used in the output, e.g. "JT" -> "Revenue with JT". */
  label: string;
  closeRate: number;      // percent, 0-100
  avgJob: number;         // dollars
  bigJobsPerMonth: number;
  bigJobValue: number;    // dollars
  daysPerBigJob: number;
};

export const DEFAULT_PRESETS: CalculatorPresets = { label: 'JT', closeRate: 75, avgJob: 900, bigJobsPerMonth: 1, bigJobValue: 5000, daysPerBigJob: 2 };

export type ProspectInputs = { leadsPerMonth: number; closeRate: number; avgJob: number; hoursPerWeek: number };

/** The four call sheet questions the calculator reads. Keys are fixed so the numbers can be found again on a follow-up call. */
export const CALCULATOR_KEYS = { leadsPerMonth: 'leads_per_month', closeRate: 'close_rate', avgJob: 'average_job_price', hoursPerWeek: 'hours_per_week' } as const;

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };   // blank or negative -> 0
const pct = (v: unknown) => Math.min(n(v), 100) / 100;                                            // close rates cap at 100%
const dollars = (v: number) => Math.round(v);
const jobs = (v: number) => Math.round(v * 10) / 10;

export function cleanPresets(p: Partial<CalculatorPresets> | null | undefined): CalculatorPresets {
  return {
    label: (p?.label ?? DEFAULT_PRESETS.label).toString().trim().slice(0, 40) || DEFAULT_PRESETS.label,
    closeRate: p?.closeRate == null ? DEFAULT_PRESETS.closeRate : Math.min(n(p.closeRate), 100),
    avgJob: p?.avgJob == null ? DEFAULT_PRESETS.avgJob : n(p.avgJob),
    bigJobsPerMonth: p?.bigJobsPerMonth == null ? DEFAULT_PRESETS.bigJobsPerMonth : n(p.bigJobsPerMonth),
    bigJobValue: p?.bigJobValue == null ? DEFAULT_PRESETS.bigJobValue : n(p.bigJobValue),
    daysPerBigJob: p?.daysPerBigJob == null ? DEFAULT_PRESETS.daysPerBigJob : n(p.daysPerBigJob),
  };
}

export function calculate(input: Partial<ProspectInputs>, presets: CalculatorPresets) {
  const leads = n(input.leadsPerMonth), avg = n(input.avgJob), hours = n(input.hoursPerWeek);
  const close = pct(input.closeRate);
  // guardrails: our side never shows worse than what they already do
  const ourClose = Math.max(close, pct(presets.closeRate));
  const ourAvg = Math.max(avg, n(presets.avgJob));

  const jobsNow = leads * close;
  const revenueNow = jobsNow * avg;
  const ourJobs = leads * ourClose;
  const bigJobRevenue = n(presets.bigJobsPerMonth) * n(presets.bigJobValue);
  const ourRevenue = ourJobs * ourAvg + bigJobRevenue;

  const lostToCloseRate = (ourJobs - jobsNow) * avg;
  const lostToUnderpricing = ourJobs * (ourAvg - avg);
  const monthly = ourRevenue - revenueNow;                 // always = the three leaks added together

  const monthlyHours = hours * 4.33;
  const bigJobHours = n(presets.daysPerBigJob) * 8;

  return {
    ourCloseRate: Math.round(ourClose * 100), ourAvgJob: dollars(ourAvg),
    jobsNow: jobs(jobsNow), ourJobs: jobs(ourJobs),
    revenueNow: dollars(revenueNow), ourRevenue: dollars(ourRevenue),
    lostToCloseRate: dollars(lostToCloseRate), lostToUnderpricing: dollars(lostToUnderpricing), addedFromBigJobs: dollars(bigJobRevenue),
    revenueAtTheirPrice: dollars(ourJobs * avg), revenueAtOurPrice: dollars(ourJobs * ourAvg),
    monthly: dollars(monthly), yearly: dollars(monthly * 12),
    waiting: { m3: dollars(monthly * 3), m6: dollars(monthly * 6), m12: dollars(monthly * 12) },
    payPerHour: monthlyHours ? dollars(revenueNow / monthlyHours) : 0,
    bigJobPayPerHour: bigJobHours ? dollars(n(presets.bigJobValue) / bigJobHours) : 0,
    hasInputs: leads > 0 || avg > 0,
  };
}
