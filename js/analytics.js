/**
 * Analítica de riesgo sobre series de cierres diarios. Funciones puras.
 * Convenciones: retornos simples diarios, 252 ruedas por año, desvío muestral (n-1),
 * resultados en porcentaje. Devuelven null / NaN cuando no hay datos suficientes.
 */
const TRADING_DAYS = 252;

export const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

export function stdev(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

export const returns = closes => closes.slice(1).map((c, i) => c / closes[i] - 1);

/** Volatilidad anualizada (%). */
export const annualVol = closes => (closes.length > 2 ? stdev(returns(closes)) * Math.sqrt(TRADING_DAYS) * 100 : null);

/** Máxima caída pico-valle (%), negativa. */
export function maxDrawdown(closes) {
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    worst = Math.min(worst, c / peak - 1);
  }
  return worst * 100;
}

/** Retorno de las últimas n ruedas (%), o null si no hay historia suficiente. */
export const periodReturn = (closes, n) => (closes.length > n ? (closes.at(-1) / closes.at(-1 - n) - 1) * 100 : null);

export function covariance(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return NaN;
  const a = x.slice(-n);
  const b = y.slice(-n);
  const ma = mean(a);
  const mb = mean(b);
  return a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (n - 1);
}

export function correlation(x, y) {
  const d = stdev(x) * stdev(y);
  return d ? covariance(x, y) / d : NaN;
}

/** Beta de un activo contra un benchmark, a partir de retornos alineados. */
export function beta(rx, rb) {
  const v = covariance(rb, rb);
  return v ? covariance(rx, rb) / v : NaN;
}

/** Concentración de Herfindahl (pesos en 0..1). */
export const hhi = weights => weights.reduce((s, w) => s + w * w, 0);

/** Índices donde el retorno diario supera el umbral (posible split o dato erróneo). */
export const jumps = (closes, threshold = 0.35) => returns(closes).flatMap((r, i) => (Math.abs(r) > threshold ? [i + 1] : []));

/** Alinea series {t, c} por fecha común. Devuelve { t, closes: { tk: [...] } }. */
export function align(seriesByTk, tks) {
  const usable = tks.filter(tk => seriesByTk[tk]?.t?.length > 1);
  if (!usable.length) return { t: [], closes: {} };
  let common = new Set(seriesByTk[usable[0]].t);
  for (const tk of usable.slice(1)) {
    const s = new Set(seriesByTk[tk].t);
    common = new Set([...common].filter(d => s.has(d)));
  }
  const t = [...common].sort((a, b) => a - b);
  const closes = {};
  for (const tk of usable) {
    const byDay = new Map(seriesByTk[tk].t.map((d, i) => [d, seriesByTk[tk].c[i]]));
    closes[tk] = t.map(d => byDay.get(d));
  }
  return { t, closes };
}

/**
 * Cartera hipotética con pesos constantes (rebalanceo diario) sobre la historia común.
 * weights: { tk: peso }. Devuelve null si no hay historia suficiente.
 * `coverage` es la fracción del peso total con historia disponible.
 */
export function portfolioStats(weights, seriesByTk) {
  const { t, closes } = align(seriesByTk, Object.keys(weights));
  const used = Object.keys(closes);
  if (t.length < 3 || !used.length) return null;
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const covered = used.reduce((s, tk) => s + weights[tk], 0);
  const rets = used.map(tk => returns(closes[tk]));
  const daily = rets[0].map((_, i) => used.reduce((s, tk, k) => s + (weights[tk] / covered) * rets[k][i], 0));
  const nav = [100];
  for (const r of daily) nav.push(nav.at(-1) * (1 + r));
  return { t, nav, used, coverage: covered / total, vol: stdev(daily) * Math.sqrt(TRADING_DAYS) * 100, maxDD: maxDrawdown(nav) };
}

/** Matriz de correlación de retornos diarios entre los tickers con historia común. */
export function corrMatrix(tks, seriesByTk) {
  const { closes } = align(seriesByTk, tks);
  const used = Object.keys(closes);
  const r = Object.fromEntries(used.map(tk => [tk, returns(closes[tk])]));
  return { tks: used, m: used.map(a => used.map(b => (a === b ? 1 : correlation(r[a], r[b])))) };
}
