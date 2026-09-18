// Revenue calculator spec, as a test. Run: npm run test:calc
import { calculate, cleanPresets, DEFAULT_PRESETS } from '../src/modules/sales/calculator';

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${String(got)}, wanted ${String(want)}`}`);
  if (!ok) failed++;
};

// The worked example from the spec: 40 leads, 25% close, $500 average job, 50 hours a week.
const r = calculate({ leadsPerMonth: 40, closeRate: 25, avgJob: 500, hoursPerWeek: 50 }, DEFAULT_PRESETS);
eq('jobs now', r.jobsNow, 10); eq('jobs with presets', r.ourJobs, 30);
eq('revenue now', r.revenueNow, 5000); eq('revenue with presets', r.ourRevenue, 32000);
eq('leak 1: close rate', r.lostToCloseRate, 10000);
eq('leak 2: underpricing', r.lostToUnderpricing, 12000);
eq('leak 3: big jobs', r.addedFromBigJobs, 5000);
eq('left on the table, monthly', r.monthly, 27000);
eq('the three leaks add up to the total', r.lostToCloseRate + r.lostToUnderpricing + r.addedFromBigJobs, r.monthly);
eq('yearly', r.yearly, 324000);
eq('cost of waiting 3 / 6 / 12', `${r.waiting.m3}/${r.waiting.m6}/${r.waiting.m12}`, '81000/162000/324000');
eq('their pay per hour', r.payPerHour, Math.round(5000 / (50 * 4.33)));
eq('big job pay per hour', r.bigJobPayPerHour, Math.round(5000 / 16));

// Guardrails: our side never looks worse than what they already do.
const g = calculate({ leadsPerMonth: 20, closeRate: 90, avgJob: 1500, hoursPerWeek: 40 }, DEFAULT_PRESETS);
eq('keeps their close rate when it beats the preset', g.ourCloseRate, 90);
eq('keeps their average job when it beats the preset', g.ourAvgJob, 1500);
eq('no negative leaks', g.lostToCloseRate >= 0 && g.lostToUnderpricing >= 0, true);
eq('then only big jobs are added', g.monthly, 5000);

// Build notes: blank or negative -> 0, close rates capped at 100%, no divide by zero.
const b = calculate({ leadsPerMonth: -5, closeRate: 250, avgJob: undefined, hoursPerWeek: undefined }, DEFAULT_PRESETS);
eq('blank and negative inputs become 0', b.revenueNow, 0);
eq('zero hours does not divide by zero', b.payPerHour, 0);
eq('close rate capped at 100%', calculate({ leadsPerMonth: 10, closeRate: 250, avgJob: 100, hoursPerWeek: 10 }, DEFAULT_PRESETS).jobsNow, 10);
const d = calculate({ leadsPerMonth: 33, closeRate: 33, avgJob: 333, hoursPerWeek: 40 }, DEFAULT_PRESETS);
eq('awkward numbers: leaks match the total within $1 of rounding', Math.abs(d.lostToCloseRate + d.lostToUnderpricing + d.addedFromBigJobs - d.monthly) <= 1, true);
eq('jobs rounded to 1 decimal', d.jobsNow, 10.9);
eq('bad presets are cleaned', cleanPresets({ closeRate: 400, avgJob: -3 }).closeRate + cleanPresets({ avgJob: -3 }).avgJob, 100);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\ncalculator ok');
