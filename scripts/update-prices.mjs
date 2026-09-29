#!/usr/bin/env node
/**
 * Descarga cotizaciones e histórico y reescribe data/prices.json (y data/history.json con --history).
 *
 * Cada activo se consulta en DOS fuentes independientes (Yahoo Finance y Stooq) y se contrastan
 * sus últimos cierres completos: coinciden -> "verified"; difieren más de 1% -> "conflict".
 * Nunca se inventa ni se rellena un dato: si ambas fuentes fallan, se conserva el anterior
 * marcado como "stale" con su fecha original. Dólar CCL: dolarapi.com. Sin dependencias (Node >= 18).
 *
 * Uso: node scripts/update-prices.mjs [--history]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PRICES = new URL('../data/prices.json', import.meta.url);
const HISTORY = new URL('../data/history.json', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; inversiones-bot/2.0)';
const TOLERANCE_PCT = 1; // diferencia máxima aceptable entre fuentes
const MAX_DAILY_MOVE_PCT = 40; // más que esto en un día se considera dato sospechoso
const DAY = 86400000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const dayOf = ms => Math.floor(ms / DAY);

/** Una barra por día (la última gana) y en orden ascendente. */
function normalize(rows) {
  const byDay = new Map();
  for (const r of rows) if (Number.isFinite(r.close) && r.close > 0) byDay.set(r.d, r);
  return [...byDay.values()].sort((a, b) => a.d - b.d);
}

/** Resume barras diarias (aprox. 1 año) en una cotización. `live` = precio en tiempo real, si existe. */
export function summarize(rows, live) {
  if (rows.length < 2) throw new Error('historial insuficiente');
  const closes = rows.map(r => r.close);
  const last = closes.at(-1);
  const price = live > 0 ? live : last;
  // Si la última barra ya refleja el precio actual, el día anterior es la barra previa.
  const prev = Math.abs(last - price) / price < 1e-4 ? closes.at(-2) : last;
  return {
    price: round(price),
    change: round((price / prev - 1) * 100),
    high: round(Math.max(...rows.map(r => r.high ?? r.close), price)),
    low: round(Math.min(...rows.map(r => r.low ?? r.close), price)),
  };
}

export function parseYahoo(json) {
  const result = json?.chart?.result?.[0];
  if (!result?.timestamp) throw new Error('respuesta vacía de Yahoo');
  const q = result.indicators.quote[0];
  const rows = normalize(result.timestamp.map((ts, i) => ({ d: dayOf(ts * 1000), close: q.close[i], high: q.high[i], low: q.low[i] })));
  const t = result.meta?.regularMarketTime;
  return { rows, live: result.meta?.regularMarketPrice, asOf: new Date(t ? t * 1000 : rows.at(-1).d * DAY).toISOString() };
}

/** CSV de Stooq: Date,Open,High,Low,Close,Volume (ascendente). */
export function parseStooq(csv) {
  const rows = normalize(csv.trim().split('\n').slice(1).map(line => line.split(','))
    .filter(c => c.length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(c[0]))
    .map(c => ({ d: dayOf(Date.parse(`${c[0]}T00:00:00Z`)), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]) }))).slice(-260);
  if (rows.length < 2) throw new Error('respuesta vacía de Stooq');
  return { rows, asOf: new Date(rows.at(-1).d * DAY).toISOString() };
}

/** Descarta datos evidentemente erróneos. */
export function isSane(q) {
  return Number.isFinite(q?.price) && q.price > 0 && Math.abs(q.change) < MAX_DAILY_MOVE_PCT &&
    q.price >= q.low * 0.999 && q.price <= q.high * 1.001;
}

/**
 * Combina las dos fuentes en una cotización con procedencia. La verificación compara el
 * últimos cierres completos comunes (antes del día en curso, para no confundir demoras intradía con errores).
 */
export function reconcile(y, s, now = Date.now()) {
  const main = y ?? s;
  if (!main) throw new Error('sin datos');
  const q = { ...summarize(main.rows, main.live), asOf: main.asOf, sources: [y && 'Yahoo Finance', s && 'Stooq'].filter(Boolean), quality: 'single', diffPct: null };
  if (y && s) {
    const other = new Map(s.rows.map(r => [r.d, r.close]));
    // Se comparan hasta los últimos 5 cierres completos comunes y se toma la mayor diferencia.
    const diffs = y.rows.filter(r => r.d < dayOf(now) && other.has(r.d)).slice(-5)
      .map(r => Math.abs(r.close / other.get(r.d) - 1) * 100);
    if (diffs.length) {
      q.diffPct = round(Math.max(...diffs));
      q.quality = q.diffPct <= TOLERANCE_PCT ? 'verified' : 'conflict';
    }
  }
  if (!isSane(q)) q.quality = 'suspect';
  return q;
}

/** Activos distintos con exactamente el mismo precio: se marcan sospechosos (síntoma de error de origen). */
export function flagDuplicates(quotes) {
  const groups = new Map();
  for (const [tk, q] of Object.entries(quotes)) groups.set(q.price.toFixed(2), [...(groups.get(q.price.toFixed(2)) ?? []), tk]);
  for (const tks of groups.values()) if (tks.length > 1) for (const tk of tks) quotes[tk].quality = 'suspect';
  return quotes;
}

/** Serie para el histórico: días (desde 1970) y cierres, últimas 260 ruedas. */
export function historyOf(rows) {
  const last = rows.slice(-260);
  return { t: last.map(r => r.d), c: last.map(r => round(r.close)) };
}

async function get(url, type = 'json') {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${new URL(url).hostname})`);
  return type === 'json' ? res.json() : res.text();
}

const fetchYahoo = async tk => parseYahoo(await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?range=1y&interval=1d`));
const fetchStooq = async tk => parseStooq(await get(`https://stooq.com/q/d/l/?s=${tk.toLowerCase()}.us&i=d`, 'text'));

async function attempt(tk, name, fn) {
  try {
    return await fn(tk);
  } catch (err) {
    console.warn(`[${tk}] ${name}: ${err.message}`);
    return null;
  }
}

async function fetchCCL(now = new Date()) {
  const json = await get('https://dolarapi.com/v1/dolares/contadoconliqui');
  if (!(json.venta > 100 && json.venta < 100000)) throw new Error('valor fuera de rango');
  const stamp = new Date(json.fechaActualizacion);
  return { value: json.venta, source: 'dolarapi.com', asOf: (Number.isNaN(+stamp) ? now : stamp).toISOString() };
}

const readJson = async (url, fallback) => {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; }
};

async function main() {
  const withHistory = process.argv.includes('--history');
  const prev = await readJson(PRICES, null);
  if (!prev?.quotes) throw new Error('falta data/prices.json de partida');
  const tickers = Object.keys(prev.quotes);
  const oldHistory = await readJson(HISTORY, { series: {} });
  const quotes = {};
  const series = { ...oldHistory.series };
  const failed = [];

  for (const tk of tickers) {
    const [y, s] = await Promise.all([attempt(tk, 'Yahoo Finance', fetchYahoo), attempt(tk, 'Stooq', fetchStooq)]);
    if (!y && !s) {
      quotes[tk] = { ...prev.quotes[tk], quality: 'stale' }; // se conserva con su fecha original
      failed.push(tk);
    } else {
      quotes[tk] = reconcile(y, s);
      if (withHistory) series[tk] = historyOf((y ?? s).rows);
    }
    await sleep(300); // trato amable con las fuentes
  }
  // Si no se actualizó nada, falla el job: así se nota y no se publica un dato viejo como nuevo.
  if (failed.length === tickers.length) throw new Error('no se pudo actualizar ningún activo');
  flagDuplicates(quotes);

  let ccl = prev.ccl && typeof prev.ccl === 'object' ? prev.ccl : { value: prev.ccl, source: 'Planilla original', asOf: null };
  try {
    ccl = await fetchCCL();
  } catch (err) {
    console.warn(`[CCL] ${err.message}; se conserva ${ccl.value}`);
  }

  const now = new Date().toISOString();
  const used = [...new Set(Object.values(quotes).flatMap(q => q.sources ?? []))];
  await writeFile(PRICES, JSON.stringify({ schema: 2, updatedAt: now, source: used.join(' + '), ccl, quotes }, null, 2) + '\n');
  if (withHistory) await writeFile(HISTORY, JSON.stringify({ schema: 2, updatedAt: now, series }) + '\n');

  const count = q => Object.values(quotes).filter(x => x.quality === q).length;
  console.log(`OK: ${tickers.length - failed.length}/${tickers.length} actualizados | verificados ${count('verified')}, una fuente ${count('single')}, ` +
    `conflicto ${count('conflict')}, sospechosos ${count('suspect')}, sin actualizar ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
