import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/analytics.js';
import * as P from '../js/portfolio.js';
import { nf, pct, esc, toCSV, ago, todayISO } from '../js/format.js';
import { chartModel, nearestIndex, buildChart, donut } from '../js/chart.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// ---------- analítica (valores calculados a mano) ----------
test('volatilidad anual: [100,110,99] -> desvío muestral 14,142% diario x raíz(252)', () => {
  near(A.annualVol([100, 110, 99]), 224.4994, 1e-3);
  assert.equal(A.annualVol([100, 101]), null);
});
test('drawdown máximo pico-valle', () => {
  near(A.maxDrawdown([100, 120, 90, 110]), -25);
  assert.equal(Math.abs(A.maxDrawdown([1, 2, 3])), 0);
});
test('retorno por período', () => {
  near(A.periodReturn([100, 110, 121], 2), 21);
  assert.equal(A.periodReturn([1, 2], 5), null);
});
test('covarianza, correlación y beta', () => {
  near(A.covariance([1, 2, 3, 4], [1, 2, 3, 4]), 5 / 3);
  near(A.correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  near(A.correlation([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  const rb = [0.01, -0.02, 0.03, 0];
  near(A.beta(rb.map(r => 2 * r), rb), 2);
  assert.ok(Number.isNaN(A.beta([1, 2], [1, 1])));
});
test('herfindahl y saltos', () => {
  near(A.hhi([0.5, 0.5]), 0.5);
  assert.deepEqual(A.jumps([100, 101, 50, 51]), [2]);
});
test('alineación por fecha común', () => {
  const r = A.align({ A: { t: [1, 2, 3, 4], c: [10, 11, 12, 13] }, B: { t: [2, 3, 4, 5], c: [20, 21, 22, 23] } }, ['A', 'B']);
  assert.deepEqual(r.t, [2, 3, 4]);
  assert.deepEqual(r.closes, { A: [11, 12, 13], B: [20, 21, 22] });
});
test('cartera hipotética: un solo activo replica al activo; cobertura parcial', () => {
  const c = [100, 110, 99, 108.9];
  const s = { A: { t: [1, 2, 3, 4], c }, B: { t: [1, 2, 3, 4], c } };
  const one = A.portfolioStats({ A: 1 }, s);
  near(one.nav.at(-1), 108.9);
  near(one.vol, A.annualVol(c), 1e-9);
  near(one.maxDD, A.maxDrawdown(c), 1e-9);
  const two = A.portfolioStats({ A: 0.5, B: 0.5 }, s);
  near(two.vol, one.vol, 1e-9);
  near(A.portfolioStats({ A: 0.5, Z: 0.5 }, s).coverage, 0.5);
  assert.equal(A.portfolioStats({ Z: 1 }, s), null);
});
test('matriz de correlación: diagonal 1 y simétrica', () => {
  const s = { A: { t: [1, 2, 3, 4, 5], c: [10, 12, 11, 14, 13] }, B: { t: [1, 2, 3, 4, 5], c: [20, 23, 21, 27, 25] } };
  const { m } = A.corrMatrix(['A', 'B'], s);
  assert.equal(m[0][0], 1);
  near(m[0][1], m[1][0]);
  assert.ok(m[0][1] > 0.9);
});

// ---------- cartera ----------
const tx = (o) => ({ id: Math.random().toString(), tk: 'AAA', side: 'buy', qty: 1, price: 1, fee: 0, date: '2026-01-01', ...o });
test('costo promedio con comisiones y ganancia realizada', () => {
  const r = P.fold([
    tx({ qty: 10, price: 100, fee: 10, date: '2026-01-01' }),
    tx({ qty: 10, price: 120, date: '2026-01-02' }),
    tx({ side: 'sell', qty: 5, price: 130, fee: 5, date: '2026-01-03' }),
  ]);
  const p = r.open[0];
  near(p.qty, 15);
  near(p.basis, 1657.5); // 2210 - 5 * 110,5
  near(r.realized, 92.5); // 650 - 5 - 552,5
  assert.deepEqual(r.errors, []);
});
test('cierre total conserva lo realizado; venta excedida se rechaza', () => {
  const closed = P.fold([tx({ qty: 2, price: 10 }), tx({ side: 'sell', qty: 2, price: 15, date: '2026-01-02' })]);
  assert.equal(closed.open.length, 0);
  near(closed.realized, 10);
  const bad = P.fold([tx({ qty: 1 }), tx({ side: 'sell', qty: 2, date: '2026-01-02' })]);
  assert.equal(bad.errors.length, 1);
  near(bad.open[0].qty, 1);
});
test('mismo día: las compras se procesan antes que las ventas', () => {
  const r = P.fold([tx({ side: 'sell', qty: 1, price: 12 }), tx({ qty: 1, price: 10 })]);
  assert.deepEqual(r.errors, []);
  near(r.realized, 2);
});
test('validación de operaciones', () => {
  const known = tk => tk === 'AAA';
  const ok = tx({ qty: 1, price: 5 });
  assert.equal(P.validateTx(ok, [], known, '2026-06-01'), null);
  assert.match(P.validateTx({ ...ok, qty: 0 }, [], known, '2026-06-01'), /cantidad/);
  assert.match(P.validateTx({ ...ok, price: -1 }, [], known, '2026-06-01'), /precio/);
  assert.match(P.validateTx({ ...ok, fee: -1 }, [], known, '2026-06-01'), /comisiones/);
  assert.match(P.validateTx({ ...ok, date: '2026-13-40' }, [], known, '2026-06-01'), /Fecha/);
  assert.match(P.validateTx({ ...ok, date: '2027-01-01' }, [], known, '2026-06-01'), /futura/);
  assert.match(P.validateTx({ ...ok, tk: 'ZZZ' }, [], known, '2026-06-01'), /desconocido/);
  assert.match(P.validateTx({ ...ok, qty: NaN }, [], known, '2026-06-01'), /cantidad/);
  assert.match(P.validateTx({ ...ok, side: 'sell', qty: 5 }, [ok], known, '2026-06-01'), /supera la tenencia/);
});
test('valuación, pesos y variación del día', () => {
  const { rows, totals } = P.valuate(
    [{ tk: 'A', qty: 10, basis: 900 }, { tk: 'B', qty: 5, basis: 500 }],
    tk => (tk === 'A' ? { price: 110, change: 10 } : { price: 100, change: 0 }));
  assert.equal(rows[0].tk, 'A');
  near(rows[0].value, 1100);
  near(rows[0].dayPL, 100); // 1100 - 1100/1,1
  near(rows[0].unrealized, 200);
  near(rows[0].weight + rows[1].weight, 100);
  near(totals.value, 1600);
  near(totals.unrealized, 200);
});
test('concentración, exposición y unión de carteras', () => {
  const c = P.concentration([{ weight: 50 }, { weight: 30 }, { weight: 20 }]);
  near(c.top1, 50); near(c.top3, 100); near(c.hhi, 0.38); near(c.effectiveN, 2.631578, 1e-5);
  assert.deepEqual(P.exposure([{ tk: 'A', weight: 60 }, { tk: 'B', weight: 40 }, { tk: 'C', weight: 10 }], t => (t === 'C' ? 'X' : 'S')), { S: 100, X: 10 });
  const m = P.mergeOpen([[{ tk: 'A', qty: 1, basis: 10 }], [{ tk: 'A', qty: 2, basis: 30 }, { tk: 'B', qty: 1, basis: 5 }]]);
  assert.equal(m.find(p => p.tk === 'A').qty, 3);
  assert.equal(m.find(p => p.tk === 'A').basis, 40);
});
test('tamaño de posición por riesgo y tope de peso', () => {
  const a = P.positionSize({ equity: 100000, price: 50, stopPct: 8, riskPct: 1, maxWeightPct: 25 });
  near(a.qty, 250); near(a.weight, 12.5); near(a.maxLoss, 1000); assert.equal(a.capped, false);
  const b = P.positionSize({ equity: 100000, price: 50, stopPct: 8, riskPct: 3, maxWeightPct: 25 });
  near(b.qty, 500); assert.equal(b.capped, true); near(b.maxLoss, 2000);
  assert.equal(P.positionSize({ equity: 0, price: 50, stopPct: 8, riskPct: 1, maxWeightPct: 25 }), null);
});

// ---------- formato y gráficos ----------
test('formato, escape y CSV seguro', () => {
  assert.equal(nf(1234.5), '1.234,50');
  assert.equal(nf(NaN), '–');
  assert.equal(pct(-0.5), '-0,50%');
  assert.equal(esc('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
  assert.equal(toCSV([['=HYPERLINK("x")', -5, 'a;b']]), '\ufeff"\'=HYPERLINK(""x"")";-5;"a;b"');
  assert.equal(ago('2026-01-01T10:00:00Z', Date.parse('2026-01-01T10:12:00Z')), 'hace 12 min');
  assert.equal(todayISO(new Date(2026, 0, 5)), '2026-01-05');
});
test('geometría del gráfico e índice más cercano', () => {
  const m = chartModel({ t: [1, 2, 3, 4, 5], c: [10, 20, 30, 40, 50] }, 5);
  near(m.x(0), 8); near(m.x(4), 738);
  near(m.y(m.hi), 12); near(m.y(m.lo), 276);
  assert.equal(nearestIndex(m, 8), 0); assert.equal(nearestIndex(m, 738), 4); assert.equal(nearestIndex(m, 373), 2);
  assert.equal(nearestIndex(m, -100), 0); assert.equal(nearestIndex(m, 5000), 4);
  const { html, model } = buildChart({ t: [1, 2, 3], c: [5, 6, 7] }, 2, { lines: [{ label: 'Costo', v: 100, cls: 'cost', fit: true }, { label: 'x', v: NaN, cls: 'y' }, { label: 'lejos', v: 5000, cls: 'z' }] });
  assert.equal(model.c.length, 2);
  assert.ok(model.hi > 100, 'las líneas fit amplían la escala');
  assert.match(html, /class="chart up"/);
  assert.equal((html.match(/class="rl /g) || []).length, 1);
  assert.equal(donut([{ value: 0 }]), '');
  assert.equal((donut([{ value: 1 }, { value: 3 }]).match(/<circle/g) || []).length, 2);
});
