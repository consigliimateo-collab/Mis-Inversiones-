import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, parseYahoo, parseStooq, isSane, reconcile, flagDuplicates, historyOf, dayOf } from '../scripts/update-prices.mjs';
import { applyQuotes, grade, businessDaysBehind, dataChecks, loadHistory, history, markDuplicates, meta } from '../js/prices.js';
import { ASSETS } from '../js/data.js';

const DAY = 86400000;
const rows = (...closes) => closes.map((c, i) => ({ d: 100 + i, close: c, high: c + 1, low: c - 1 }));

test('summarize: cambio diario contra la barra previa; con precio en vivo distinto, contra la última', () => {
  const q = summarize(rows(100, 102, 110), 110);
  assert.deepEqual([q.price, q.change, q.high, q.low], [110, 7.84, 111, 99]);
  assert.equal(summarize(rows(100, 102), 104.04).change, 2);
  assert.throws(() => summarize(rows(100)), /insuficiente/);
});

test('parseYahoo: descarta barras nulas y duplicadas, toma asOf de regularMarketTime', () => {
  const ts = [0, 1, 2, 3].map(i => 1_700_000_000 + i * 86400);
  const json = { chart: { result: [{ meta: { regularMarketPrice: 55, regularMarketTime: ts[3] }, timestamp: [...ts, ts[3] + 100],
    indicators: { quote: [{ close: [50, null, 52, 54, 55], high: [51, null, 53, 55, 56], low: [49, null, 51, 53, 54] }] } }] } };
  const r = parseYahoo(json);
  assert.equal(r.live, 55);
  assert.equal(r.rows.length, 3); // sin la barra nula; la del mismo día pisa a la anterior
  assert.equal(r.rows.at(-1).close, 55);
  assert.equal(r.asOf, new Date(ts[3] * 1000).toISOString());
  assert.throws(() => parseYahoo({}), /vacía/);
});

test('parseStooq: lee CSV, ignora basura y respuestas sin datos', () => {
  const csv = 'Date,Open,High,Low,Close,Volume\n2026-01-02,10,11,9,10,1\nbasura\n2026-01-03,10,12,10,11,1\n2026-01-04,11,12,10,12,1\n';
  const r = parseStooq(csv);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows.at(-1).close, 12);
  assert.throws(() => parseStooq('No data'), /vacía/);
});

test('reconcile: verificado, conflicto, una fuente y sospechoso', () => {
  const now = 103 * DAY;
  const y = { rows: rows(100, 101, 102), live: 102, asOf: '2026-01-01T00:00:00.000Z' };
  const same = { rows: rows(100.2, 101.1, 102.05), asOf: 'x' };
  const off = { rows: rows(100, 104.5, 102), asOf: 'x' }; // día 101: 4,5% de diferencia
  assert.equal(reconcile(y, same, now).quality, 'verified');
  const c = reconcile(y, off, now);
  assert.equal(c.quality, 'conflict');
  assert.ok(c.diffPct > 3);
  const one = reconcile(y, null, now);
  assert.deepEqual([one.quality, one.sources], ['single', ['Yahoo Finance']]);
  assert.equal(reconcile(null, same, now).sources[0], 'Stooq');
  assert.throws(() => reconcile(null, null), /sin datos/);
  assert.equal(reconcile({ rows: rows(100, 300), live: 300, asOf: 'x' }, null, now).quality, 'suspect'); // +200% en un día
});

test('reconcile: la barra del día en curso no genera falsos conflictos', () => {
  const y = { rows: rows(100, 101, 108), live: 108, asOf: 'x' }; // hoy = día 102, aún intradía
  const s = { rows: rows(100, 101, 104), asOf: 'x' };
  assert.equal(reconcile(y, s, 102 * DAY + 3600_000).quality, 'verified');
});

test('isSane, duplicados e histórico', () => {
  assert.equal(isSane({ price: 10, change: 1, high: 11, low: 9 }), true);
  assert.equal(isSane({ price: 12, change: 1, high: 11, low: 9 }), false);
  assert.equal(isSane({ price: 10, change: 50, high: 11, low: 9 }), false);
  assert.equal(isSane(null), false);
  const q = flagDuplicates({ A: { price: 5, quality: 'verified' }, B: { price: 5, quality: 'verified' }, C: { price: 6, quality: 'verified' } });
  assert.deepEqual([q.A.quality, q.B.quality, q.C.quality], ['suspect', 'suspect', 'verified']);
  const h = historyOf(Array.from({ length: 300 }, (_, i) => ({ d: i, close: 10 + i })));
  assert.equal(h.t.length, 260);
  assert.equal(h.c.at(-1), 309);
  assert.equal(dayOf(DAY * 5 + 1), 5);
});

test('la planilla original trae un error real: PLTR y QCOM con el mismo precio', () => {
  markDuplicates(ASSETS);
  assert.deepEqual(meta(ASSETS.find(a => a.tk === 'QCOM')).dup, ['PLTR']);
  assert.equal(grade(ASSETS.find(a => a.tk === 'QCOM')), 'bad');
  assert.ok(dataChecks(ASSETS).some(c => c.level === 'bad' && /PLTR y QCOM|QCOM y PLTR/.test(c.text)));
});

test('applyQuotes: procedencia, calidad y protección ante datos inválidos', () => {
  const assets = [{ tk: 'A', price: 1, change: 0, high: 2, low: 1 }, { tk: 'B', price: 5, change: 0, high: 6, low: 4 }];
  const n = applyQuotes({ updatedAt: 'U', quotes: {
    A: { price: 3, change: 1.5, high: 4, low: 1, quality: 'verified', sources: ['Yahoo Finance', 'Stooq'], asOf: '2026-01-02T00:00:00Z', diffPct: 0.2 },
    B: { price: -4, change: 0 } } }, assets);
  assert.equal(n, 1);
  assert.deepEqual([assets[0].price, assets[0].meta.quality, assets[0].meta.diffPct], [3, 'verified', 0.2]);
  assert.equal(assets[1].price, 5);
  assert.equal(applyQuotes(null, assets), 0);
  applyQuotes({ quotes: { A: { price: 3, quality: 'inventada' } } }, assets);
  assert.equal(assets[0].meta.quality, 'single');
});

test('frescura: fines de semana no cuentan, tres ruedas sin datos es grave', () => {
  const fri = '2026-09-25T20:00:00Z';
  const at = s => Date.parse(s);
  assert.equal(businessDaysBehind(fri, at('2026-09-28T12:00:00Z')), 0); // lunes
  assert.equal(businessDaysBehind(fri, at('2026-09-30T12:00:00Z')), 2); // miércoles: faltan lun y mar
  const a = { tk: 'A', price: 1, change: 0, high: 2, low: 1, meta: { quality: 'verified', asOf: fri, sources: [], dup: false } };
  assert.equal(grade(a, at('2026-09-28T12:00:00Z')), 'ok');
  assert.equal(grade(a, at('2026-09-30T12:00:00Z')), 'warn');
  assert.equal(grade(a, at('2026-10-01T12:00:00Z')), 'bad');
  assert.equal(grade({ ...a, meta: { ...a.meta, quality: 'single' } }, at('2026-09-28T12:00:00Z')), 'warn');
  assert.equal(grade({ ...a, meta: { ...a.meta, quality: 'conflict' } }, at('2026-09-28T12:00:00Z')), 'bad');
});

test('histórico: las series corruptas se descartan', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ updatedAt: 'U', series: {
    GOOD: { t: [1, 2, 3], c: [10, 11, 12] },
    NEG: { t: [1, 2], c: [10, -1] },
    UNORDERED: { t: [2, 1], c: [10, 11] },
    SHORT: { t: [1], c: [10] },
    MISMATCH: { t: [1, 2, 3], c: [10, 11] },
    NAN: { t: [1, 2], c: [10, null] } } }) });
  assert.equal(await loadHistory(), 1);
  assert.deepEqual(Object.keys(history), ['GOOD']);
});
