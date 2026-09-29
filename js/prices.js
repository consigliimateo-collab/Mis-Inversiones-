/**
 * Cotizaciones e histórico. Un proceso programado (scripts/update-prices.mjs, en GitHub Actions)
 * escribe data/prices.json y data/history.json; acá solo se leen, se validan y se aplican.
 * Cada dato conserva su procedencia (fuentes, fecha, verificación cruzada) para que la
 * interfaz nunca presente como confiable algo que no lo es.
 */
import { ASSETS } from './data.js';
import { state } from './store.js';

const DAY = 86400000;

export const QUALITY = {
  verified: { label: '2 fuentes', hint: 'Yahoo Finance y Stooq coinciden en el último cierre completo (diferencia menor al 1%).' },
  single: { label: '1 fuente', hint: 'Respondió una sola fuente: sin verificación cruzada.' },
  conflict: { label: 'Discrepan', hint: 'Las dos fuentes difieren más del 1%. No operar sin verificar con tu broker.' },
  suspect: { label: 'Sospechoso', hint: 'El dato no pasó los controles de coherencia.' },
  stale: { label: 'Desactualizado', hint: 'No se pudo actualizar: se conserva el último dato conocido.' },
  snapshot: { label: 'Sin verificar', hint: 'Dato de la planilla original, sin fuente en vivo.' },
};

export const history = {}; // tk -> { t: [días desde 1970], c: [cierres] }
export const feed = { updatedAt: null, source: null, status: 'snapshot', ccl: { value: null, source: null, asOf: null }, historyAt: null };

export const meta = a => (a.meta ??= { quality: 'snapshot', asOf: null, sources: ['Planilla original'], diffPct: null, dup: false });

/** Marca activos distintos con exactamente el mismo precio (síntoma típico de un error de origen). */
export function markDuplicates(assets = ASSETS) {
  const groups = new Map();
  for (const a of assets) {
    const k = a.price.toFixed(2);
    groups.set(k, [...(groups.get(k) ?? []), a.tk]);
  }
  for (const a of assets) {
    const same = groups.get(a.price.toFixed(2)).filter(t => t !== a.tk);
    meta(a).dup = same.length ? same : false;
  }
}

/** Ruedas hábiles (lun-vie) transcurridas desde asOf sin contar el día en curso. 0 = al día. */
export function businessDaysBehind(asOf, now = Date.now()) {
  let n = 0;
  for (let d = Math.floor(Date.parse(asOf) / DAY) + 1; d <= Math.floor(now / DAY) - 1; d++) {
    const wd = new Date(d * DAY).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** 'ok' | 'warn' | 'bad': qué tan confiable es el dato de un activo para decidir. */
export function grade(a, now = Date.now()) {
  const m = meta(a);
  if (m.dup || ['conflict', 'suspect', 'stale'].includes(m.quality)) return 'bad';
  if (m.quality === 'snapshot' || !m.asOf) return 'warn';
  const behind = businessDaysBehind(m.asOf, now);
  if (behind >= 3) return 'bad';
  return m.quality === 'single' || behind >= 1 ? 'warn' : 'ok';
}

/** Aplica un payload de prices.json al catálogo. Devuelve cuántos activos se actualizaron. */
export function applyQuotes(payload, assets = ASSETS) {
  let updated = 0;
  for (const a of assets) {
    const q = payload?.quotes?.[a.tk];
    if (!q || !(q.price > 0)) continue;
    a.price = q.price;
    if (Number.isFinite(q.change)) a.change = q.change;
    if (q.high > 0 && q.low > 0) { a.high = q.high; a.low = q.low; }
    Object.assign(meta(a), {
      quality: QUALITY[q.quality] ? q.quality : 'single',
      asOf: q.asOf ?? payload.updatedAt ?? null,
      sources: q.sources ?? [],
      diffPct: q.diffPct ?? null,
    });
    updated++;
  }
  markDuplicates(assets);
  return updated;
}

const validSeries = s =>
  Array.isArray(s?.t) && Array.isArray(s?.c) && s.t.length === s.c.length && s.c.length > 1 &&
  s.c.every(v => Number.isFinite(v) && v > 0) && s.t.every((d, i) => i === 0 || d > s.t[i - 1]);

export async function loadPrices(url = 'data/prices.json') {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (applyQuotes(payload) === 0) throw new Error('el archivo no trae cotizaciones válidas');
    const c = typeof payload.ccl === 'object' && payload.ccl ? payload.ccl : { value: payload.ccl };
    if (c.value > 100 && c.value < 100000) {
      feed.ccl = { value: c.value, source: c.source ?? null, asOf: c.asOf ?? null };
      if (!state.cclManual) state.ccl = c.value;
    }
    Object.assign(feed, { updatedAt: payload.updatedAt, source: payload.source, status: 'live' });
  } catch (err) {
    feed.status = feed.updatedAt ? 'offline' : 'snapshot';
    console.warn('[precios]', err.message);
  }
  return feed;
}

/** Histórico diario. Las series inválidas se descartan en vez de graficarse. */
export async function loadHistory(url = 'data/history.json') {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    for (const [tk, s] of Object.entries(j.series ?? {})) {
      if (validSeries(s)) history[tk] = s;
      else delete history[tk];
    }
    feed.historyAt = j.updatedAt ?? null;
  } catch (err) {
    console.warn('[histórico]', err.message);
  }
  return Object.keys(history).length;
}

/** Controles de coherencia sobre todos los datos. Cada hallazgo: { level, tk?, text }. */
export function dataChecks(assets = ASSETS, now = Date.now()) {
  const out = [];
  const seen = new Set();
  for (const a of assets) {
    const m = meta(a);
    if (a.price < a.low * 0.999 || a.price > a.high * 1.001) out.push({ level: 'bad', tk: a.tk, text: `${a.tk}: el precio está fuera del rango de 52 semanas` });
    if (Math.abs(a.change) > 40) out.push({ level: 'bad', tk: a.tk, text: `${a.tk}: variación diaria de ${a.change}%, poco creíble` });
    if (m.dup && !seen.has(a.tk)) {
      [a.tk, ...m.dup].forEach(t => seen.add(t));
      out.push({ level: 'bad', tk: a.tk, text: `Precio idéntico (${a.price}) en ${[a.tk, ...m.dup].join(' y ')}: probable error de origen` });
    }
    if (m.quality === 'conflict') out.push({ level: 'bad', tk: a.tk, text: `${a.tk}: las fuentes difieren ${m.diffPct}%` });
    const h = history[a.tk];
    if (h && Math.abs(h.c.at(-1) / a.price - 1) > 0.08) out.push({ level: 'warn', tk: a.tk, text: `${a.tk}: el histórico cierra lejos del precio actual` });
  }
  const behind = assets.filter(a => grade(a, now) === 'bad' && meta(a).quality !== 'snapshot' && !meta(a).dup);
  if (behind.length) out.push({ level: 'bad', text: `${behind.length} activo(s) con datos desactualizados o en conflicto: ${behind.map(a => a.tk).join(', ')}` });
  const noHist = assets.filter(a => !history[a.tk]);
  if (noHist.length) out.push({ level: 'warn', text: `Sin histórico para ${noHist.length} activo(s): los gráficos y el riesgo quedan incompletos` });
  if (!feed.ccl.value) out.push({ level: 'warn', text: 'Dólar CCL sin fuente en vivo: las conversiones a pesos son solo referenciales' });
  else if (feed.ccl.asOf && businessDaysBehind(feed.ccl.asOf, now) >= 3) out.push({ level: 'warn', text: 'Dólar CCL desactualizado' });
  return out;
}

markDuplicates();
