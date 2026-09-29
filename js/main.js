/** Punto de entrada: conecta el DOM con las vistas, valida operaciones y mantiene los datos al día. */
import { ASSETS, SECTORS, bySymbol } from './data.js';
import { state, save, persistence, uid, exportBackup, parseBackup, replaceState } from './store.js';
import { history, loadPrices, loadHistory } from './prices.js';
import { fold, validateTx } from './portfolio.js';
import { nearestIndex } from './chart.js';
import { nf, dayLabel, todayISO, toCSV, esc } from './format.js';
import * as view from './views.js';

const $ = id => document.getElementById(id);
const REFRESH_MS = 5 * 60 * 1000;
const HISTORY_MS = 60 * 60 * 1000;
const RISK_FIELDS = [['r-stop', 'stopPct'], ['r-risk', 'riskPct'], ['r-maxw', 'maxWeightPct'], ['r-maxs', 'maxSectorPct']];

const ui = { tab: 'market', selected: 'NVDA', days: 126, sector: 'Todos', sort: 'change' };
let lastHistoryLoad = 0;
let pendingImport = null;
let pidSignature = '';

const say = (id, text) => { $(id).textContent = text; };

// ---------- renderizado ----------

function paintChrome() {
  $('ixs').innerHTML = view.renderIndexStrip();
  $('status').innerHTML = view.renderStatus() + (persistence.ok ? '' : '<span class="dn">No se pudo guardar en este navegador: descarga un respaldo</span>');
  const n = view.collectAlerts().filter(a => a.level !== 'info').length;
  $('bell').textContent = n ? `${n} alerta${n > 1 ? 's' : ''}` : 'Sin alertas';
  $('bell').className = `bell${n ? ' on' : ''}`;
  $('currency').textContent = state.inARS ? 'ARS' : 'USD';
  const sig = state.portfolios.map(p => `${p.id}:${p.name}`).join('|');
  if (sig !== pidSignature) { // reconstruir selectores solo si cambiaron las carteras
    pidSignature = sig;
    const opts = state.portfolios.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    const keep = $('tx-pid').value;
    $('scope').innerHTML = `<option value="all">Todas las carteras</option>${opts}`;
    $('tx-pid').innerHTML = opts;
    if (state.portfolios.some(p => p.id === keep)) $('tx-pid').value = keep;
  }
  $('scope').value = state.active;
}

const paint = {
  market(keepSide) {
    const a = bySymbol(ui.selected);
    $('rail').innerHTML = view.renderRail({ query: $('q').value, sector: ui.sector, sort: ui.sort, selected: ui.selected });
    $('asset').innerHTML = view.renderAsset(a, ui.days);
    if (!keepSide) $('side').innerHTML = view.renderSide(a);
  },
  portfolio() {
    const p = view.renderPortfolio();
    $('pf-chips').innerHTML = view.renderPortfolioChips();
    $('pf-banners').innerHTML = p.banners;
    $('pf-kpis').innerHTML = p.kpis;
    $('pf-rows').innerHTML = p.rows;
    $('pf-alloc').innerHTML = p.alloc;
    $('pf-txs').innerHTML = p.txRows;
    $('pf-del').disabled = state.active === 'all' || state.portfolios.length < 2;
  },
  risk() {
    const r = view.renderRisk();
    $('risk-alerts').innerHTML = r.alerts;
    $('risk-body').innerHTML = r.body;
  },
  data() {
    const d = view.renderData();
    $('data-res').innerHTML = d.res;
    $('data-rows').innerHTML = d.rows;
    $('data-context').innerHTML = d.context;
  },
};

/** keepSide: no reconstruir el panel lateral mientras el usuario escribe en él. */
function render({ keepSide = false } = {}) {
  paint[ui.tab](keepSide);
  save();
  paintChrome(); // después de guardar, para reflejar si el almacenamiento falló
}

function switchTab(name) {
  ui.tab = name;
  document.querySelectorAll('[data-view]').forEach(s => { s.hidden = s.dataset.view !== name; });
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  render();
}

function select(tk) {
  ui.selected = tk;
  if (ui.tab !== 'market') switchTab('market');
  else render();
}

// ---------- operaciones y carteras ----------

function addTx() {
  const p = state.portfolios.find(x => x.id === $('tx-pid').value);
  const tx = {
    id: uid(), tk: $('tx-tk').value, side: $('tx-side').value, qty: Number($('tx-qty').value),
    price: Number($('tx-price').value), fee: Number($('tx-fee').value || 0), date: $('tx-date').value,
  };
  const err = p ? validateTx(tx, p.txs, tk => Boolean(bySymbol(tk)), todayISO()) : 'Elige una cartera.';
  if (err) return say('tx-msg', err);
  p.txs.push(tx);
  say('tx-msg', '');
  $('tx-qty').value = '';
  return render();
}

function removeTx(key) {
  const [pid, id] = key.split('|');
  const p = state.portfolios.find(x => x.id === pid);
  const rest = p.txs.filter(t => t.id !== id);
  if (fold(rest).errors.length) return say('tx-msg', 'No se puede eliminar: hay ventas posteriores que dependen de esa compra.');
  p.txs = rest;
  say('tx-msg', '');
  return render();
}

function prefillTx(tk) {
  switchTab('portfolio');
  $('tx-tk').value = tk;
  $('tx-price').value = bySymbol(tk).price;
  if (state.active !== 'all') $('tx-pid').value = state.active;
  $('tx-qty').focus();
}

/** Botón de dos toques para acciones destructivas (evita confirm(), que algunos visores bloquean). */
function armed(btn, idle, ask, action) {
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    btn.textContent = idle;
    action();
  } else {
    btn.dataset.armed = '1';
    btn.textContent = ask;
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = idle; }, 4000);
  }
}

// ---------- respaldos y exportaciones ----------

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cnum = n => String(Math.round(n * 1e6) / 1e6).replace('.', ',');

function exportTxsCSV() {
  const rows = [['Cartera', 'Tipo', 'Fecha', 'Operación', 'Ticker', 'Cantidad', 'Precio USD', 'Comisión USD']];
  for (const p of state.portfolios) {
    for (const t of p.txs) rows.push([p.name, p.kind === 'own' ? 'propio' : 'terceros', t.date, t.side === 'buy' ? 'compra' : 'venta', t.tk, cnum(t.qty), cnum(t.price), cnum(t.fee)]);
  }
  download(`operaciones-${todayISO()}.csv`, toCSV(rows), 'text/csv');
}

function exportPositionsCSV() {
  const rows = [['Ticker', 'Cantidad', 'Costo promedio USD', 'Precio USD', 'Valor USD', 'Peso %', 'No realizado USD', 'Resultado %', 'Fuentes', 'Fecha del dato']];
  for (const r of view.book().rows) {
    const m = bySymbol(r.tk).meta ?? {};
    rows.push([r.tk, cnum(r.qty), cnum(r.avg), cnum(r.price), cnum(r.value), cnum(r.weight), cnum(r.unrealized), cnum(r.plPct), (m.sources ?? []).join(' + '), m.asOf ?? '']);
  }
  download(`posiciones-${todayISO()}.csv`, toCSV(rows), 'text/csv');
}

async function chooseBackup(file) {
  pendingImport = null;
  $('bk-confirm').hidden = true;
  if (!file) return;
  try {
    const parsed = parseBackup(await file.text());
    const ops = parsed.state.portfolios.reduce((s, p) => s + p.txs.length, 0);
    pendingImport = parsed;
    say('bk-msg', `Respaldo válido: ${parsed.state.portfolios.length} cartera(s), ${ops} operaciones${parsed.dropped ? `; se descartaron ${parsed.dropped} operaciones inválidas` : ''}. Al confirmar se reemplazan los datos actuales de este dispositivo.`);
    $('bk-confirm').hidden = false;
  } catch (err) {
    say('bk-msg', err.message);
  }
}

// ---------- eventos ----------

document.addEventListener('click', e => {
  const el = e.target.closest('[data-fav],[data-ticker],[data-range],[data-pf],[data-del-alert],[data-add-alert],[data-to-portfolio],[data-del-tx],[data-tab]');
  if (!el) return;
  const d = el.dataset;
  if ('fav' in d) {
    const i = state.favorites.indexOf(d.fav);
    if (i < 0) state.favorites.push(d.fav); else state.favorites.splice(i, 1);
    render();
  } else if ('range' in d) { ui.days = Number(d.range); render(); }
  else if ('pf' in d) { state.active = d.pf; render(); }
  else if ('delAlert' in d) { state.alerts.splice(Number(d.delAlert), 1); render(); }
  else if ('addAlert' in d) {
    const value = Number($('alert-value').value);
    if (value > 0) { state.alerts.push({ tk: ui.selected, dir: $('alert-dir').value, value }); render(); }
  } else if ('toPortfolio' in d) prefillTx(d.toPortfolio);
  else if ('delTx' in d) removeTx(d.delTx);
  else if ('tab' in d) switchTab(d.tab);
  else select(d.ticker);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('[role=button]')) e.target.click();
  if (e.target.matches('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey || ui.tab !== 'market') return;
  if (e.key === '/') { e.preventDefault(); $('q').focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const list = [...document.querySelectorAll('#rail .row')].map(r => r.dataset.ticker);
    const next = list[list.indexOf(ui.selected) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) select(next);
  }
});

// Cruz interactiva del gráfico de precio
$('asset').addEventListener('pointermove', e => {
  const hit = e.target.closest('[data-chart]');
  const model = view.getChartModel();
  if (!hit || !model) return;
  const box = hit.ownerSVGElement.getBoundingClientRect();
  const i = nearestIndex(model, ((e.clientX - box.left) / box.width) * model.W);
  const g = hit.ownerSVGElement.querySelector('.xh');
  const set = (sel, attrs) => Object.entries(attrs).forEach(([k, v]) => g.querySelector(sel).setAttribute(k, v));
  g.removeAttribute('hidden');
  set('.xv', { x1: model.x(i), x2: model.x(i) });
  set('.xz', { y1: model.y(model.c[i]), y2: model.y(model.c[i]) });
  set('circle', { cx: model.x(i), cy: model.y(model.c[i]) });
  say('readout', `${dayLabel(model.t[i])}   cierre ${nf(model.c[i])}`);
});
$('asset').addEventListener('pointerleave', () => {
  $('asset').querySelector('.xh')?.setAttribute('hidden', '');
  say('readout', '');
});

$('q').addEventListener('input', () => render());
$('sector').addEventListener('change', () => { ui.sector = $('sector').value; render(); });
$('sort').addEventListener('change', () => { ui.sort = $('sort').value; render(); });
$('scope').addEventListener('change', () => { state.active = $('scope').value; render(); });
$('currency').addEventListener('click', () => { state.inARS = !state.inARS; render(); });
$('ccl').addEventListener('input', () => {
  const v = Number($('ccl').value);
  if (v > 0) state.ccl = v;
  state.cclManual = $('ccl').value !== ''; // vacío = volver al dólar automático
  render();
});

$('tx-add').addEventListener('click', addTx);
$('tx-tk').addEventListener('change', () => { $('tx-price').value = bySymbol($('tx-tk').value).price; });
$('np-add').addEventListener('click', () => {
  const name = $('np-name').value.trim().slice(0, 40);
  if (!name) return say('np-msg', 'Escribe un nombre para la cartera.');
  if (state.portfolios.some(p => p.name.toLowerCase() === name.toLowerCase())) return say('np-msg', 'Ya existe una cartera con ese nombre.');
  const p = { id: uid(), name, kind: $('np-kind').value, txs: [] };
  state.portfolios.push(p);
  state.active = p.id;
  $('np-name').value = '';
  say('np-msg', '');
  return render();
});
$('pf-del').addEventListener('click', e => {
  const p = state.portfolios.find(x => x.id === state.active);
  if (!p) return;
  armed(e.currentTarget, 'Eliminar cartera', `¿Eliminar "${p.name}" y sus ${p.txs.length} operaciones? Toca de nuevo`, () => {
    state.portfolios = state.portfolios.filter(x => x.id !== p.id);
    state.active = 'all';
    render();
  });
});

RISK_FIELDS.forEach(([id, key]) => {
  $(id).value = state.risk[key];
  $(id).addEventListener('input', () => { state.risk[key] = Math.max(0, Number($(id).value) || 0); render(); });
});

$('bk-export').addEventListener('click', () => {
  state.lastBackup = new Date().toISOString();
  save();
  download(`respaldo-inversiones-${todayISO()}.json`, exportBackup(), 'application/json');
  say('bk-msg', 'Respaldo descargado. Guárdalo en un lugar seguro: contiene tus carteras.');
  render();
});
$('bk-file').addEventListener('change', e => chooseBackup(e.target.files[0]));
$('bk-confirm').addEventListener('click', () => {
  if (!pendingImport) return;
  replaceState(pendingImport.state);
  pendingImport = null;
  $('bk-confirm').hidden = true;
  $('bk-file').value = '';
  say('bk-msg', 'Respaldo importado.');
  RISK_FIELDS.forEach(([id, key]) => { $(id).value = state.risk[key]; });
  $('ccl').value = state.ccl;
  pidSignature = '';
  render();
});
$('csv-txs').addEventListener('click', exportTxsCSV);
$('csv-pos').addEventListener('click', exportPositionsCSV);

// ---------- datos en vivo ----------

async function refresh() {
  $('refresh').disabled = true;
  await loadPrices();
  if (!Object.keys(history).length || Date.now() - lastHistoryLoad > HISTORY_MS) {
    await loadHistory();
    lastHistoryLoad = Date.now();
  }
  $('refresh').disabled = false;
  if (document.activeElement !== $('ccl')) $('ccl').value = state.ccl;
  const typingSide = document.activeElement?.closest?.('#side') && document.activeElement.matches('input,select');
  render({ keepSide: Boolean(typingSide) });
}

$('refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(refresh, REFRESH_MS);
setInterval(paintChrome, 60 * 1000);

// ---------- instalación como app (PWA) ----------

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('install').hidden = false; });
$('install').addEventListener('click', async () => {
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; $('install-ios').hidden = true; });
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone) {
  $('install-ios').hidden = false;
  $('install-ios').addEventListener('click', e => { e.currentTarget.textContent = 'Compartir, luego Añadir a pantalla de inicio'; });
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin service worker la app funciona igual, solo online */ });
}

// ---------- arranque ----------

$('tx-tk').innerHTML = [...ASSETS].sort((a, b) => a.tk.localeCompare(b.tk)).map(a => `<option>${a.tk}</option>`).join('');
$('tx-price').value = bySymbol($('tx-tk').value).price;
$('tx-date').value = todayISO();
$('tx-date').max = todayISO();
$('sector').innerHTML = ['Todos', 'Favoritos', ...SECTORS].map(s => `<option>${s}</option>`).join('');
$('sort').innerHTML = '<option value="change">Mayor variación</option><option value="pos">Rango 52S</option><option value="tk">Ticker</option>';
$('ccl').value = state.ccl;

switchTab('market');
refresh();
