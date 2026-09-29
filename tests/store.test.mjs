import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { if (mem.__full) throw new Error('quota'); mem[k] = v; } };
mem['inversiones:estado:v1'] = JSON.stringify({ positions: [{ tk: 'NVDA', qty: 3, cost: 150 }], favorites: ['YPF'] });
const S = await import('../js/store.js');

test('migración v1: las posiciones pasan a ser compras en la cartera propia', () => {
  const tx = S.state.portfolios[0].txs;
  assert.equal(tx.length, 1);
  assert.deepEqual([tx[0].tk, tx[0].side, tx[0].qty, tx[0].price], ['NVDA', 'buy', 3, 150]);
  assert.deepEqual(S.state.favorites, ['YPF']);
});

test('sanitize descarta operaciones inválidas y cuenta lo descartado', () => {
  const good = { id: 'a', tk: 'X', side: 'buy', qty: 1, price: 2, fee: 0, date: '2026-01-01' };
  const { state, dropped } = S.sanitize({ portfolios: [{ id: 'p', name: 'Cliente <b>', kind: 'third', txs: [good,
    { ...good, qty: -1 }, { ...good, price: 'abc' }, { ...good, date: '2026-99-99' }, { ...good, side: 'short' }, null] }],
    active: 'no-existe', ccl: -5, risk: { stopPct: -3, riskPct: 2 }, alerts: [{ tk: 'X', dir: '>', value: 5 }, { tk: 'X', dir: '?', value: 5 }] });
  assert.equal(dropped, 5);
  assert.equal(state.portfolios[0].txs.length, 1);
  assert.equal(state.portfolios[0].kind, 'third');
  assert.equal(state.active, 'all');
  assert.equal(state.ccl, 1280);
  assert.equal(state.risk.stopPct, 8); // negativo -> valor por defecto
  assert.equal(state.risk.riskPct, 2);
  assert.equal(state.alerts.length, 1);
  assert.equal(S.sanitize('basura').state.portfolios.length, 1);
});

test('respaldo: exportar e importar conserva los datos; rechaza archivos ajenos o rotos', () => {
  const json = S.exportBackup(new Date('2026-05-01T00:00:00Z'));
  const back = S.parseBackup(json);
  assert.equal(back.state.portfolios[0].txs[0].tk, 'NVDA');
  assert.equal(back.dropped, 0);
  assert.throws(() => S.parseBackup('no es json'), /ilegible/);
  assert.throws(() => S.parseBackup('{"app":"otra","data":{}}'), /no corresponde/);
  assert.throws(() => S.parseBackup(JSON.stringify({ app: 'mis-inversiones', schema: 99, data: {} })), /más nueva/);
});

test('reemplazo de estado y aviso cuando el almacenamiento falla', () => {
  S.replaceState(S.defaults());
  assert.equal(S.state.portfolios[0].txs.length, 0);
  assert.equal(S.save(), true);
  mem.__full = true;
  assert.equal(S.save(), false);
  assert.equal(S.persistence.ok, false);
});
