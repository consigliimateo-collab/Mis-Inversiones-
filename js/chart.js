/** Gráficos SVG sin dependencias: precio con cruz interactiva, y dona de composición. */
import { nf, dayLabel } from './format.js';

const W = 800;
const H = 300;
const PAD = { l: 8, r: 62, t: 12, b: 24 };

/** Modelo geométrico del gráfico (también lo usa la interacción del mouse). */
export function chartModel(series, days, extra = []) {
  const from = Math.max(0, series.c.length - days);
  const t = series.t.slice(from);
  const c = series.c.slice(from);
  let lo = Math.min(...c, ...extra);
  let hi = Math.max(...c, ...extra);
  const pad = (hi - lo) * 0.05 || hi * 0.01;
  lo -= pad;
  hi += pad;
  const x = i => PAD.l + (c.length > 1 ? i / (c.length - 1) : 0) * (W - PAD.l - PAD.r);
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  return { t, c, lo, hi, x, y, W, H, PAD };
}

/** Índice de la observación más cercana a la coordenada x del viewBox. */
export function nearestIndex(m, vx) {
  const f = (vx - PAD.l) / (W - PAD.l - PAD.r);
  return Math.min(m.c.length - 1, Math.max(0, Math.round(f * (m.c.length - 1))));
}

/** Devuelve { html, model }. lines: [{ label, v, cls, fit }] referencias horizontales; fit:true amplía la escala para incluirlas. */
export function buildChart(series, days, { lines = [], id = 'c' } = {}) {
  const valid = lines.filter(l => Number.isFinite(l.v));
  const m = chartModel(series, days, valid.filter(l => l.fit).map(l => l.v));
  const inRange = valid.filter(l => l.fit || (l.v >= m.lo && l.v <= m.hi));
  const up = m.c.at(-1) >= m.c[0];
  const pts = m.c.map((v, i) => `${m.x(i).toFixed(1)},${m.y(v).toFixed(1)}`);
  const base = (H - PAD.b).toFixed(1);
  const grid = [0, 1, 2, 3, 4].map(k => {
    const v = m.lo + ((m.hi - m.lo) * k) / 4;
    return `<line class="gl" x1="${PAD.l}" x2="${W - PAD.r}" y1="${m.y(v).toFixed(1)}" y2="${m.y(v).toFixed(1)}"/>` +
      `<text class="ax" x="${W - PAD.r + 6}" y="${(m.y(v) + 4).toFixed(1)}">${nf(v, v >= 1000 ? 0 : 2)}</text>`;
  }).join('');
  const ticks = [0, 1 / 3, 2 / 3, 1].map(f => {
    const i = Math.round(f * (m.c.length - 1));
    return `<text class="ax" x="${m.x(i).toFixed(1)}" y="${H - 6}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${dayLabel(m.t[i])}</text>`;
  }).join('');
  const refs = inRange.map(l => `<line class="rl ${l.cls}" x1="${PAD.l}" x2="${W - PAD.r}" y1="${m.y(l.v).toFixed(1)}" y2="${m.y(l.v).toFixed(1)}"/>` +
    `<text class="rt ${l.cls}" x="${PAD.l + 4}" y="${(m.y(l.v) - 4).toFixed(1)}">${l.label} ${nf(l.v)}</text>`).join('');
  const last = m.c.at(-1);
  const html = `<svg class="chart ${up ? 'up' : 'dn'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de precio">` +
    `<defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>` +
    `${grid}${ticks}<polygon fill="url(#g-${id})" points="${m.x(0).toFixed(1)},${base} ${pts.join(' ')} ${m.x(m.c.length - 1).toFixed(1)},${base}"/>` +
    `<polyline class="ln" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" points="${pts.join(' ')}"/>${refs}` +
    `<rect class="tag" x="${W - PAD.r + 1}" y="${(m.y(last) - 9).toFixed(1)}" width="${PAD.r - 2}" height="18" rx="2"/>` +
    `<text class="tagt" x="${W - PAD.r + 6}" y="${(m.y(last) + 4).toFixed(1)}">${nf(last, last >= 1000 ? 0 : 2)}</text>` +
    `<g class="xh" hidden><line class="xv" y1="${PAD.t}" y2="${H - PAD.b}"/><line class="xz" x1="${PAD.l}" x2="${W - PAD.r}"/><circle r="4"/></g>` +
    `<rect class="hit" data-chart x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>`;
  return { html, model: m };
}

/** Dona de composición. items: [{ value }]; el color i usa la variable CSS --c{i+1}. */
export function donut(items) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!(total > 0)) return '';
  const r = 52;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = items.map((it, i) => {
    const len = (it.value / total) * C;
    const arc = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--c${(i % 8) + 1})" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 70 70)"/>`;
    offset += len;
    return arc;
  }).join('');
  return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="Composición de la cartera">${arcs}</svg>`;
}
