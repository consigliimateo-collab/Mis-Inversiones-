import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- DOM mínimo para ejecutar main.js sin navegador ----------
const els = new Map();
const docL = {};
let lastBlob = null;
const mk = id => ({
  id, value: '', textContent: '', hidden: false, dataset: {}, className: '', disabled: false, max: '', files: [], L: {}, _html: '',
  addEventListener(t, f) { (this.L[t] ??= []).push(f); },
  setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, querySelector() { return mk('_'); },
  closest() { return null; }, matches() { return false; }, focus() {}, click() {},
  get innerHTML() { return this._html; },
  set innerHTML(v) { this._html = v; const m = /<option(?: value="([^"]*)")?>([^<]*)/.exec(v); if (m && !this.value) this.value = m[1] ?? m[2]; },
});
const $ = id => els.get(id) ?? (els.set(id, mk(id)), els.get(id));
globalThis.document = {
  getElementById: $, querySelectorAll: () => [], activeElement: null, hidden: false,
  addEventListener(t, f) { (docL[t] ??= []).push(f); }, createElement: () => mk('a'),
};
globalThis.window = { addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
globalThis.location = { protocol: 'file:' };
globalThis.setInterval = () => 0;
globalThis.setTimeout = () => 0;
globalThis.fetch = async () => ({ ok: false, status: 404 });
URL.createObjectURL = blob => { lastBlob = blob; return 'blob:test'; };
URL.revokeObjectURL = () => {};

const { state, defaults, replaceState } = await import('../js/store.js');
const { history } = await import('../js/prices.js');
const view = await import('../js/views.js');
await import('../js/main.js');

const click = dataset => docL.click.forEach(f => f({ target: { closest: () => ({ dataset }) } }));
const fire = (id, type, ev = {}) => ($(id).L[type] ?? []).forEach(f => f({ currentTarget: $(id), target: $(id), ...ev }));
const fillTx = o => Object.entries({ 'tx-pid': 'propio', 'tx-side': 'buy', 'tx-tk': 'NVDA', 'tx-qty': '10', 'tx-price': '100', 'tx-fee': '0', 'tx-date': '2026-01-05', ...o }).forEach(([k, v]) => { $(k).value = v; });

test('arranque: la app renderiza el mercado con los 20 activos', () => {
  assert.equal(($('rail').innerHTML.match(/class="row/g) || []).length, 20);
  assert.match($('asset').innerHTML, /NVDA/);
  assert.match($('status').innerHTML, /Sin datos en vivo/);
  assert.match($('tx-tk').value, /^[A-Z]+$/);
});

test('registrar operaciones: válidas, inválidas y ventas que exceden la tenencia', () => {
  fillTx({ 'tx-qty': '0' }); fire('tx-add', 'click');
  assert.match($('tx-msg').textContent, /cantidad/);
  fillTx({ 'tx-date': '2999-01-01' }); fire('tx-add', 'click');
  assert.match($('tx-msg').textContent, /futura/);
  fillTx(); fire('tx-add', 'click');
  assert.equal($('tx-msg').textContent, '');
  assert.equal(state.portfolios[0].txs.length, 1);
  fillTx({ 'tx-side': 'sell', 'tx-qty': '50', 'tx-date': '2026-02-01' }); fire('tx-add', 'click');
  assert.match($('tx-msg').textContent, /supera la tenencia/);
  assert.equal(state.portfolios[0].txs.length, 1);
  fillTx({ 'tx-side': 'sell', 'tx-qty': '4', 'tx-price': '120', 'tx-date': '2026-02-01' }); fire('tx-add', 'click');
  assert.equal(state.portfolios[0].txs.length, 2);
});

test('no se puede borrar una compra de la que dependen ventas posteriores', () => {
  const buy = state.portfolios[0].txs.find(t => t.side === 'buy');
  click({ delTx: `propio|${buy.id}` });
  assert.match($('tx-msg').textContent, /No se puede eliminar/);
  assert.equal(state.portfolios[0].txs.length, 2);
});

test('carteras de terceros: crear, aislar, consolidar y escapar nombres maliciosos', () => {
  $('np-name').value = '<img src=x onerror=alert(1)>'; $('np-kind').value = 'third'; fire('np-add', 'click');
  assert.equal(state.portfolios.length, 2);
  assert.equal(state.active, state.portfolios[1].id);
  fillTx({ 'tx-pid': state.portfolios[1].id, 'tx-tk': 'YPF', 'tx-qty': '100', 'tx-price': '40' }); fire('tx-add', 'click');
  click({ tab: 'portfolio' });
  const chips = $('pf-chips').innerHTML;
  assert.ok(!chips.includes('<img'), 'el nombre debe escaparse');
  assert.match(chips, /&lt;img/);
  assert.equal(view.book(state.portfolios[1].id).rows.length, 1);
  assert.equal(view.book(state.portfolios[0].id).rows.length, 1);
  assert.equal(view.book('all').rows.length, 2);
  fire('np-add', 'click'); // sin nombre
  assert.match($('np-msg').textContent, /nombre/);
  $('np-name').value = state.portfolios[0].name.toUpperCase(); fire('np-add', 'click');
  assert.match($('np-msg').textContent, /Ya existe/);
});

test('vistas con histórico sintético: activo, riesgo, datos y alertas', () => {
  const day0 = 20000;
  const walk = (seed, drift) => { let p = 100; return Array.from({ length: 260 }, (_, i) => { p *= 1 + drift + Math.sin(i * seed) * 0.01; return Math.round(p * 100) / 100; }); };
  for (const [tk, seed, drift] of [['NVDA', 0.7, 0.001], ['YPF', 1.3, 0.0005], ['SPY', 0.4, 0.0004]]) {
    history[tk] = { t: Array.from({ length: 260 }, (_, i) => day0 + i), c: walk(seed, drift) };
  }
  state.active = 'all';
  const a = view.renderAsset(view.book().rows.length ? { tk: 'NVDA', name: 'NVIDIA', price: 228.86, change: 1.68, high: 236.54, low: 164.27, pe: 28.9, ratio: 24, signal: 'FA', thesis: 'x', meta: undefined } : null, 126);
  assert.match(a, /<svg class="chart/);
  assert.match(a, /Volatilidad anual/);
  assert.match(a, /Beta vs SPY/);
  assert.ok(view.getChartModel().c.length === 126);
  const r = view.renderRisk();
  assert.match(r.body, /Volatilidad anual/);
  assert.match(r.body, /class="mx"/);
  assert.doesNotMatch(r.body, /Sin histórico no se puede/);
  assert.match(view.renderData().rows, /NVDA/);
  assert.match(view.renderPortfolio().banners, /requieren revisión/, 'posiciones con datos sin verificar deben advertirse');
  state.portfolios[0].txs.push({ id: 'pltr', tk: 'PLTR', side: 'buy', qty: 1, price: 100, fee: 0, date: '2026-01-05' });
  assert.ok(view.collectAlerts().some(x => x.level === 'bad' && x.tk === 'PLTR'), 'un activo con precio duplicado debe alertar');
  state.portfolios[0].txs.pop();
  const s = view.renderSide({ tk: 'NVDA', name: 'NVIDIA', price: 228.86, change: 1.68, high: 236.54, low: 164.27, pe: 28.9, ratio: 24, signal: 'FA', thesis: 'x', sector: 'Semis' });
  assert.match(s, /Tamaño de posición/);
  assert.match(s, /Cantidad sugerida/);
});

test('respaldo: exporta, valida el archivo importado y exige confirmación', async () => {
  fire('bk-export', 'click');
  const json = await lastBlob.text();
  assert.match(state.lastBackup ?? '', /^\d{4}-/);
  const parsed = JSON.parse(json);
  assert.equal(parsed.app, 'mis-inversiones');
  assert.equal(parsed.data.portfolios.length, 2);

  replaceState(defaults());
  assert.equal(state.portfolios.length, 1);
  $('bk-file').files = [{ text: async () => 'esto no es un respaldo' }]; await $('bk-file').L.change[0]({ target: $('bk-file') });
  assert.match($('bk-msg').textContent, /ilegible/);
  assert.equal($('bk-confirm').hidden, true);
  $('bk-file').files = [{ text: async () => json }]; await $('bk-file').L.change[0]({ target: $('bk-file') });
  assert.match($('bk-msg').textContent, /2 cartera\(s\), 3 operaciones/);
  assert.equal($('bk-confirm').hidden, false);
  assert.equal(state.portfolios.length, 1, 'aún no se reemplaza nada sin confirmar');
  fire('bk-confirm', 'click');
  assert.equal(state.portfolios.length, 2);
});

test('exportaciones CSV: separador, BOM y neutralización de fórmulas', async () => {
  fire('csv-txs', 'click');
  const csv = await lastBlob.text();
  assert.deepEqual([...new Uint8Array(await lastBlob.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf], 'el archivo lleva BOM para Excel');
  assert.ok(csv.startsWith('Cartera;Tipo;Fecha'));
  assert.match(csv, /NVDA;10;100;0/);
  assert.match(csv, /venta;NVDA;4;120/);
  fire('csv-pos', 'click');
  assert.match(await lastBlob.text(), /Ticker;Cantidad;Costo promedio USD/);
});

test('eliminar cartera pide doble confirmación', () => {
  state.active = state.portfolios[1].id;
  const before = state.portfolios.length;
  fire('pf-del', 'click');
  assert.equal(state.portfolios.length, before, 'el primer toque solo arma la acción');
});
