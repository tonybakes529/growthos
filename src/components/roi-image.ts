import type { calculate, CalculatorPresets, ProspectInputs } from '@/modules/sales/calculator';

// Draws the ROI summary a closer shares on screen. Plain canvas, no dependency: the layout is a handful of boxes.

export type RoiImageData = {
  name?: string;
  inputs: ProspectInputs;
  presets: CalculatorPresets;
  result: ReturnType<typeof calculate>;
  fonts: { display: string; body: string };
};

const C = { bg: '#14110f', panel: '#1e1c19', line: '#34312c', box: '#292520', orange: '#dc9349', onOrange: '#17110a', ink: '#f3eee6', soft: '#cfc8bd', amber: '#e3a566' };
const W = 1200, PAD = 40, GAP = 20, SCALE = 2;
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const num = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');

type Box = { label: string; sub?: string; value: string; hot?: boolean };

function draw(ctx: CanvasRenderingContext2D, d: RoiImageData): number {
  const { result: r, inputs: i, presets: p, fonts } = d;
  const L = p.label;
  const body = (size: number, weight = 500) => `${weight} ${size}px ${fonts.body}`;
  const display = (size: number) => `400 ${size}px ${fonts.display}`;
  const text = (s: string, x: number, y: number, font: string, color: string) => { ctx.font = font; ctx.fillStyle = color; ctx.fillText(s, x, y); return ctx.measureText(s).width; };
  const rect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => {
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
  };
  /** Shrinks a display number until it fits its box. */
  const fit = (s: string, size: number, max: number) => { ctx.font = display(size); const w = ctx.measureText(s).width; return w > max ? Math.floor(size * max / w) : size; };
  const boxes = (items: Box[], x: number, y: number, w: number, h: number) => {
    const bw = (w - GAP * (items.length - 1)) / items.length;
    items.forEach((b, n) => {
      const bx = x + n * (bw + GAP), fg = b.hot ? C.onOrange : C.ink;
      rect(bx, y, bw, h, b.hot ? C.orange : C.box);
      text(b.label, bx + 24, y + 42, body(19, 700), fg);
      if (b.sub) text(b.sub, bx + 24, y + 74, body(19), b.hot ? C.onOrange : C.soft);
      text(b.value, bx + 24, y + h - 26, display(fit(b.value, 62, bw - 48)), fg);
    });
  };
  const section = (title: string, y: number, items: Box[], boxH: number, foot?: [string, string]) => {
    const h = 28 + 44 + 18 + boxH + (foot ? 50 : 0) + 28;
    rect(PAD, y, W - PAD * 2, h, C.panel, C.line);
    text(title.toUpperCase(), PAD + 32, y + 28 + 38, display(42), C.ink);
    boxes(items, PAD + 32, y + 28 + 44 + 18, W - PAD * 2 - 64, boxH);
    if (foot) { const fy = y + h - 34; const w = text(`${foot[0]} `, PAD + 32, fy, body(23, 700), C.ink); text(foot[1], PAD + 32 + w, fy, body(23, 700), C.amber); }
    return y + h + GAP;
  };

  ctx.textBaseline = 'alphabetic';
  let y = PAD;
  if (d.name) { text(`Prepared for ${d.name}`, PAD, y + 18, body(20, 600), C.soft); y += 40; }

  // hero
  const heroH = 330;
  rect(PAD, y, W - PAD * 2, heroH, C.orange);
  text('Left on the table every month', PAD + 40, y + 64, body(24, 700), C.onOrange);
  const big = usd(r.monthly);
  text(big, PAD + 36, y + 262, display(fit(big, 200, W - PAD * 2 - 80)), C.onOrange);
  text(`${usd(r.yearly)} a year`, PAD + 40, y + 304, body(23, 600), C.onOrange);
  y += heroH + GAP;

  boxes([{ label: 'Your monthly revenue now', value: usd(r.revenueNow) }, { label: `With the ${L} system`, value: usd(r.ourRevenue), hot: true }], PAD, y, W - PAD * 2, 140);
  y += 140 + GAP;

  y = section('No system: leads slipping through', y, [
    { label: 'Right now', sub: `${num(i.leadsPerMonth)} leads at ${num(Math.min(i.closeRate, 100))}% close`, value: `${num(r.jobsNow)} jobs` },
    { label: `${L} system`, sub: `${num(i.leadsPerMonth)} leads at ${r.ourCloseRate}% close`, value: `${num(r.ourJobs)} jobs`, hot: true },
  ], 180, ['Lost to low close rate:', `${usd(r.lostToCloseRate)}/mo`]);

  y = section('Underpricing: working for less', y, [
    { label: 'Your price', sub: `${num(r.ourJobs)} jobs at ${usd(i.avgJob)}`, value: usd(r.revenueAtTheirPrice) },
    { label: `${L} pricing`, sub: `${num(r.ourJobs)} jobs at ${usd(r.ourAvgJob)}`, value: usd(r.revenueAtOurPrice), hot: true },
  ], 180, ['Lost to underpricing:', `${usd(r.lostToUnderpricing)}/mo`]);

  const days = p.daysPerBigJob;
  y = section("Big jobs: the ones you're missing", y, [
    { label: 'Your pay per hour now', sub: `${usd(r.revenueNow)} over ${num(Math.round(i.hoursPerWeek * 4.33))} hrs a month`, value: `${usd(r.payPerHour)}/hr` },
    { label: 'One big job', sub: `${usd(p.bigJobValue)} over ${num(days)} day${days === 1 ? '' : 's'} on one site`, value: `${usd(r.bigJobPayPerHour)}/hr`, hot: true },
  ], 180, ['Added from big jobs:', `${usd(r.addedFromBigJobs)}/mo`]);

  y = section('Waiting: what it costs to wait', y, [
    { label: 'Wait 3 months', value: usd(r.waiting.m3) }, { label: 'Wait 6 months', value: usd(r.waiting.m6) }, { label: 'Wait 12 months', value: usd(r.waiting.m12), hot: true },
  ], 140);

  text('Estimates based on the numbers entered. Actual results depend on your market and execution.', PAD, y + 12, body(17), C.soft);
  return y + 12 + PAD;
}

/** Renders the ROI summary to a PNG. Fonts must be declared on the page (next/font does that); they are loaded here before drawing. */
export async function renderRoiPng(d: RoiImageData): Promise<Blob> {
  await Promise.all([document.fonts.load(`400 60px ${d.fonts.display}`), ...[500, 600, 700].map((w) => document.fonts.load(`${w} 20px ${d.fonts.body}`))]).catch(() => undefined);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the image');
  const height = draw(ctx, d);   // dry run to measure
  canvas.width = W * SCALE; canvas.height = Math.ceil(height) * SCALE;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, height);
  draw(ctx, d);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'));
}
