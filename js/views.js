/**
 * Vistas: funciones puras que devuelven HTML y nunca tocan el DOM (se prueban desde Node).
 * Todo texto ingresado por el usuario pasa por esc() antes de insertarse.
 */
import { ASSETS, SIGNALS, MACRO, NEWS, bySymbol, rangePos, fromHigh } from './data.js';
import { state } from './store.js';
import { feed, history, grade, meta, QUALITY, dataChecks } from './prices.js';
import { fold, mergeOpen, valuate, concentration, exposure, positionSize } from './portfolio.js';
import { annualVol, maxDrawdown, periodReturn, returns, beta, align, jumps, portfolioStats, corrMatrix } from './analytics.js';
import { buildChart, donut } from './chart.js';
import { nf, pct, tone, esc } from './format.js';

export const RANGES = [['1M', 21], ['3M', 63], ['6M', 126], ['1A', 252]];
const RANK = { ok: 0, warn: 1, bad: 2 };
const isFav = tk => state.favorites.includes(tk);
const sectorOf = tk => bySymbol(tk)?.sector ?? 'Otros';
const DASH = '<span class="mu">–</span>';

let lastModel = null;
/** Modelo geométrico del último gráfico de activo (lo usa la cruz interactiva). */
export const getChartModel = () => lastModel;

// ---------- helpers de presentación ----------

export function money(usd, signed = false) {
  const v = usd * (state.inARS ? state.ccl : 1);
  const sign = v < 0 ? '-' : signed && v > 0 ? '+' : '';
  return `${sign}${state.inARS ? '$ ' : 'US$ '}${nf(Math.abs(v), 0)}`;
}

const stat = (label, value, cls = '', hint = '') =>
  `<div class="stat"${hint ? ` title="${esc(hint)}"` : ''}><small>${label}</small><b class="n ${cls}">${value}</b></div>`;

const signalBadge = a => {
  const s = SIGNALS[a.signal];
  return `<span class="sg ${s.tone}">${s.tone === 'up' ? '▲' : '▼'} ${s.label}</span>`;
};

function qualityInfo(a) {
  const m = meta(a);
  if (m.dup) return { label: 'Sospechoso', hint: `Precio idéntico al de ${m.dup.join(', ')}: probable error de origen.` };
  return QUALITY[m.quality];
}
const qBadge = a => `<span class="q ${grade(a)}" title="${esc(qualityInfo(a).hint)}">${qualityInfo(a).label}</span>`;
const qDot = a => `<i class="qd ${grade(a)}" title="${esc(qualityInfo(a).label)}"></i>`;

function asOfText(a) {
  const m = meta(a);
  if (!m.asOf) return 'sin fecha (planilla original)';
  const when = new Date(m.asOf).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  return m.sources.length ? `${when}, ${m.sources.join(' + ')}` : when;
}

// ---------- carteras ----------

/** Posiciones valuadas del ámbito seleccionado ('all' o id de cartera). */
export function book(pid = state.active) {
  const list = pid === 'all' ? state.portfolios : state.portfolios.filter(p => p.id === pid);
  const folds = list.map(p => fold(p.txs));
  const { rows, totals } = valuate(mergeOpen(folds.map(f => f.open)).filter(p => bySymbol(p.tk)), tk => bySymbol(tk));
  const realized = folds.reduce((s, f) => s + f.realized, 0);
  const worst = rows.reduce((w, r) => Math.max(w, RANK[grade(bySymbol(r.tk))]), 0);
  return { list, rows, totals: { ...totals, realized }, errors: folds.flatMap(f => f.errors), worst };
}

/** Alertas consolidadas: datos dudosos en posiciones, límites de riesgo, stop y alertas de precio. */
export function collectAlerts(pid = state.active) {
  const out = [];
  const b = book(pid);
  const { stopPct, maxWeightPct, maxSectorPct } = state.risk;
  for (const r of b.rows) {
    const a = bySymbol(r.tk);
    if (grade(a) === 'bad') out.push({ level: 'bad', tk: r.tk, text: `${r.tk}: dato de mercado no confiable (${qualityInfo(a).label.toLowerCase()}); la valuación puede ser incorrecta` });
    if (stopPct && r.plPct <= -stopPct) out.push({ level: 'bad', tk: r.tk, text: `${r.tk}: pierde ${nf(-r.plPct, 1)}% sobre su costo, más que el stop de ${stopPct}%` });
    if (maxWeightPct && r.weight > maxWeightPct) out.push({ level: 'warn', tk: r.tk, text: `${r.tk}: pesa ${nf(r.weight, 1)}% de la cartera (máximo ${maxWeightPct}%)` });
  }
  for (const [sector, w] of Object.entries(exposure(b.rows, sectorOf))) {
    if (maxSectorPct && w > maxSectorPct) out.push({ level: 'warn', text: `Sector ${sector}: ${nf(w, 1)}% de la cartera (máximo ${maxSectorPct}%)` });
  }
  for (const al of state.alerts) {
    const a = bySymbol(al.tk);
    if (a && (al.dir === '>' ? a.price >= al.value : a.price <= al.value)) {
      out.push({ level: 'info', tk: al.tk, text: `Alerta: ${al.tk} ${al.dir === '>' ? 'llegó a' : 'bajó a'} ${nf(a.price)} (objetivo ${nf(al.value)})` });
    }
  }
  b.errors.forEach(text => out.push({ level: 'bad', text }));
  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

// ---------- barra superior y estado ----------

export function renderIndexStrip() {
  return ['SPY', 'QQQ', 'VT', 'IBIT'].map(tk => {
    const a = bySymbol(tk);
    return `<button class="ix" data-ticker="${tk}"><b>${tk}</b><span class="n">${nf(a.price)}</span><span class="n ${tone(a.change)}">${pct(a.change)}</span></button>`;
  }).join('');
}

export function renderStatus(now = Date.now()) {
  const counts = { ok: 0, warn: 0, bad: 0 };
  ASSETS.forEach(a => { counts[grade(a, now)]++; });
  const when = feed.updatedAt ? new Date(feed.updatedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const live = feed.status === 'offline' ? '<b class="dn">Sin conexión</b>' : feed.updatedAt ? '<b class="up">Datos en vivo</b>' : '<b class="wn">Sin datos en vivo</b>';
  const src = feed.updatedAt ? `${esc(feed.source)}, ${when}` : 'planilla original';
  const ccl = state.cclManual ? ' (manual)' : feed.ccl.source ? ` (${esc(feed.ccl.source)})` : ' (sin fuente)';
  return `<span>${live} ${src}</span>` +
    `<span>Calidad: <b class="up">${counts.ok} verificados</b> <b class="wn">${counts.warn} con reservas</b> <b class="dn">${counts.bad} no confiables</b></span>` +
    `<span>Dólar CCL ${nf(state.ccl)}${ccl}</span>`;
}

// ---------- mercado ----------

export function renderRail({ query, sector, sort, selected }) {
  const q = query.trim().toLowerCase();
  const key = { change: a => -a.change, tk: a => a.tk, pos: a => -rangePos(a) }[sort];
  const inSector = a => sector === 'Todos' || (sector === 'Favoritos' ? isFav(a.tk) : a.sector === sector);
  const list = ASSETS.filter(a => inSector(a) && `${a.tk} ${a.name}`.toLowerCase().includes(q))
    .sort((a, b) => (typeof key(a) === 'string' ? key(a).localeCompare(key(b)) : key(a) - key(b)));
  return list.map(a => `<div class="row${a.tk === selected ? ' on' : ''}" data-ticker="${a.tk}" role="button" tabindex="0">` +
    `<button class="st${isFav(a.tk) ? ' on' : ''}" data-fav="${a.tk}" aria-label="Favorito">${isFav(a.tk) ? '★' : '☆'}</button>` +
    `<span class="rk">${a.tk}</span><span class="rn n">${nf(a.price)}</span><span class="rc n ${tone(a.change)}">${pct(a.change)}</span>${qDot(a)}</div>`).join('') ||
    '<div class="empty">Ningún activo coincide.</div>';
}

export function renderAsset(a, days) {
  const h = history[a.tk];
  const mine = book().rows.find(r => r.tk === a.tk);
  const chart = h && buildChart(h, days, {
    id: 'asset',
    lines: [
      { label: 'Máx 52S', v: a.high, cls: 'hi' },
      { label: 'Mín 52S', v: a.low, cls: 'lo' },
      ...(mine ? [{ label: 'Costo prom.', v: mine.avg, cls: 'cost', fit: true }] : []),
    ],
  });
  lastModel = chart?.model ?? null;

  let b = null;
  if (h && history.SPY && a.tk !== 'SPY') {
    const al = align({ [a.tk]: h, SPY: history.SPY }, [a.tk, 'SPY']);
    if (al.t.length > 30) b = beta(returns(al.closes[a.tk]), returns(al.closes.SPY));
  }
  const c = h?.c;
  const ret = (label, n) => {
    const r = c ? periodReturn(c, n) : null;
    return stat(label, r === null ? DASH : pct(r), tone(r), r === null ? 'Historia insuficiente' : '');
  };
  const vol = c ? annualVol(c) : null;
  const dd = c ? maxDrawdown(c) : null;
  const m = meta(a);

  return `<div class="ah"><div><span class="at">${a.tk}</span><span class="an">${esc(a.name)}</span> ${signalBadge(a)} ${qBadge(a)}</div>
  <div class="ap"><b class="n">${nf(a.price)}</b><span class="n ${tone(a.change)}">${pct(a.change)}</span></div></div>
<div class="src">Dato: ${asOfText(a)}${m.diffPct !== null ? `; diferencia entre fuentes ${nf(m.diffPct)}%` : ''}</div>
${c && jumps(c).length ? '<div class="banner warn">El histórico tiene un salto mayor a 35% en un día: puede ser un split o un dato erróneo. Verifica antes de usar retornos y riesgo.</div>' : ''}
<div class="rng">${RANGES.map(([l, d]) => `<button class="chip${d === days ? ' on' : ''}" data-range="${d}">${l}</button>`).join('')}<span class="mu" id="readout"></span></div>
<div id="chart-box">${chart ? chart.html : '<div class="empty">Sin histórico todavía. Ejecuta "Actualizar precios" en GitHub Actions (README, paso 5).</div>'}</div>
<div class="stats">${ret('Retorno 1M', 21)}${ret('Retorno 3M', 63)}${ret('Retorno 1A', 252)}
${stat('Volatilidad anual', vol === null ? DASH : `${nf(vol, 1)}%`, '', 'Desvío de retornos diarios por raíz de 252')}
${stat('Caída máx. 1A', dd === null ? DASH : pct(dd), tone(dd), 'Mayor caída pico-valle en el período')}
${stat('Beta vs SPY', b === null || Number.isNaN(b) ? DASH : nf(b), '', 'Sensibilidad frente al S&P 500')}
${stat('Rango 52S', `${nf(rangePos(a), 0)}%`, '', `${nf(a.low)} a ${nf(a.high)}`)}
${stat('Desde el máximo', pct(fromHigh(a)), tone(fromHigh(a)))}
${stat('P/E', a.pe ? nf(a.pe, 1) : DASH, '', 'Dato estático de la planilla')}
${stat(`CEDEAR (ARS, ${a.ratio}:1)`, nf((a.price * state.ccl) / a.ratio, 0), '', 'Precio teórico con el dólar CCL vigente')}</div>`;
}

export function renderSide(a) {
  const scope = book();
  const mine = scope.rows.find(r => r.tk === a.tk);
  const size = positionSize({ equity: scope.totals.value, price: a.price, ...state.risk });
  const alerts = state.alerts.map((al, i) => ({ al, i })).filter(x => x.al.tk === a.tk);
  const same = ASSETS.filter(o => o.sector === a.sector && o !== a);
  const position = mine
    ? `<div class="kv"><span>Cantidad</span><span class="n">${nf(mine.qty, 4)}</span><span>Costo promedio</span><span class="n">${nf(mine.avg)}</span>` +
      `<span>Valor</span><span class="n">${money(mine.value)}</span><span>Peso</span><span class="n">${nf(mine.weight, 1)}%</span>` +
      `<span>No realizado</span><span class="n ${tone(mine.unrealized)}">${money(mine.unrealized, true)} (${pct(mine.plPct)})</span></div>`
    : '<p class="mu">Sin posición en este ámbito.</p>';
  const sizing = size
    ? `<div class="kv"><span>Cantidad sugerida</span><span class="n">${nf(size.qty)}</span><span>Monto</span><span class="n">${money(size.amount)}</span>` +
      `<span>Peso resultante</span><span class="n">${nf(size.weight, 1)}%</span><span>Pérdida máx. al stop</span><span class="n dn">${money(-size.maxLoss)}</span></div>` +
      `<p class="mu">Arriesga ${state.risk.riskPct}% del patrimonio con stop de ${state.risk.stopPct}%${size.capped ? `; limitado por el peso máximo de ${state.risk.maxWeightPct}%` : ''}. Los parámetros se editan en Riesgo.</p>`
    : '<p class="mu">Requiere una cartera valuada y los parámetros de riesgo cargados.</p>';
  return `<h3>Mi posición</h3>${position}
<p><button class="btn" data-to-portfolio="${a.tk}">${mine ? 'Registrar otra operación' : 'Registrar operación'}</button></p>
<h3>Tamaño de posición</h3>${sizing}
<h3>Alertas de precio</h3>
${alerts.map(({ al, i }) => `<div class="li"><span>${al.dir === '>' ? 'Avisar si sube a' : 'Avisar si baja a'} <b class="n">${nf(al.value)}</b></span><button class="x" data-del-alert="${i}" aria-label="Quitar alerta">✕</button></div>`).join('')}
<div class="frm"><select id="alert-dir"><option value=">">Sube a</option><option value="<">Baja a</option></select>
<input id="alert-value" type="number" step="any" value="${(a.price * 1.05).toFixed(2)}"><button class="btn on" data-add-alert>Crear</button></div>
<h3>Mismo sector</h3><div class="peers">${same.map(o => `<button class="lk" data-ticker="${o.tk}">${o.tk} <span class="${tone(o.change)}">${pct(o.change)}</span></button>`).join('')}</div>`;
}

// ---------- cartera ----------

export function renderPortfolioChips() {
  const chip = (id, label) => `<button class="chip${state.active === id ? ' on' : ''}" data-pf="${esc(id)}">${label}</button>`;
  return chip('all', 'Todas') + state.portfolios.map(p => chip(p.id, `${esc(p.name)} <small>${p.kind === 'own' ? 'propio' : 'terceros'}</small>`)).join('');
}

export function renderPortfolio() {
  const b = book();
  const t = b.totals;
  const review = b.rows.filter(r => grade(bySymbol(r.tk)) !== 'ok');
  const backupAge = state.lastBackup ? (Date.now() - Date.parse(state.lastBackup)) / 86400000 : Infinity;
  const hasTxs = state.portfolios.some(p => p.txs.length);
  const banners = [
    review.length ? `<div class="banner ${b.worst === 2 ? 'bad' : 'warn'}">Valuación con datos que requieren revisión: ${review.map(r => `${r.tk} (${qualityInfo(bySymbol(r.tk)).label.toLowerCase()})`).join(', ')}. Verifica esos precios con tu broker antes de decidir.</div>` : '',
    b.errors.map(e => `<div class="banner bad">${esc(e)}</div>`).join(''),
    hasTxs && backupAge > 7 ? '<div class="banner warn">Estos datos viven solo en este dispositivo. Descarga un respaldo desde la pestaña Datos.</div>' : '',
  ].join('');
  const kpis = [
    stat('Patrimonio', money(t.value)),
    stat('Costo', money(t.basis)),
    stat('No realizado', `${money(t.unrealized, true)} (${pct(t.basis ? (t.value / t.basis - 1) * 100 : 0)})`, tone(t.unrealized)),
    stat('Realizado', money(t.realized, true), tone(t.realized), 'Resultado de ventas ya ejecutadas (costo promedio)'),
    stat('Hoy (estimado)', money(t.dayPL, true), tone(t.dayPL)),
  ].join('');
  const rows = b.rows.map(r => {
    const a = bySymbol(r.tk);
    return `<tr data-ticker="${r.tk}"><td><b class="rk">${r.tk}</b><small>${esc(a.name)}</small></td><td class="r n">${nf(r.qty, 4)}</td><td class="r n">${nf(r.avg)}</td>` +
      `<td class="r n">${nf(r.price)}</td><td class="r n">${money(r.value)}</td><td class="r n">${nf(r.weight, 1)}%</td>` +
      `<td class="r n ${tone(r.unrealized)}">${money(r.unrealized, true)}<small>${pct(r.plPct)}</small></td><td class="r n ${tone(r.dayPL)}">${money(r.dayPL, true)}</td><td>${qDot(a)}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">Todavía no hay posiciones. Registra tu primera operación abajo.</td></tr>';
  const exp = Object.entries(exposure(b.rows, sectorOf)).sort((x, y) => y[1] - x[1]);
  const alloc = b.rows.length
    ? `<div class="alloc">${donut(b.rows.map(r => ({ value: r.value })))}<div class="legend">${b.rows.slice(0, 8).map((r, i) => `<div><i style="background:var(--c${i + 1})"></i>${r.tk}<span class="n">${nf(r.weight, 1)}%</span></div>`).join('')}</div></div>` +
      exp.map(([s, w]) => `<div class="bar"><span>${s}</span><div><i style="width:${Math.min(100, w)}%"></i></div><span class="n">${nf(w, 1)}%</span></div>`).join('')
    : '<div class="empty">La composición aparece al cargar posiciones.</div>';
  const nameOf = id => esc(state.portfolios.find(p => p.id === id)?.name ?? '');
  const txs = b.list.flatMap(p => p.txs.map(x => ({ ...x, pid: p.id }))).sort((x, y) => y.date.localeCompare(x.date));
  const txRows = txs.map(x => `<tr><td class="n">${x.date}</td><td>${nameOf(x.pid)}</td><td class="${x.side === 'buy' ? 'up' : 'dn'}">${x.side === 'buy' ? 'Compra' : 'Venta'}</td><td><b class="rk">${esc(x.tk)}</b></td>` +
    `<td class="r n">${nf(x.qty, 4)}</td><td class="r n">${nf(x.price)}</td><td class="r n">${nf(x.fee)}</td><td><button class="x" data-del-tx="${esc(x.pid)}|${esc(x.id)}" aria-label="Eliminar">✕</button></td></tr>`).join('') ||
    '<tr><td colspan="8" class="empty">Sin operaciones.</td></tr>';
  return { banners, kpis, rows, alloc, txRows };
}

// ---------- riesgo ----------

export function renderAlerts() {
  const list = collectAlerts();
  if (!list.length) return '<div class="banner ok">Sin alertas: no hay incumplimientos de límites ni datos dudosos en las posiciones.</div>';
  return list.map(x => `<div class="banner ${x.level}">${x.tk ? `<button class="lk" data-ticker="${x.tk}">${x.tk}</button> ` : ''}${esc(x.text)}</div>`).join('');
}

export function renderRisk() {
  const b = book();
  if (!b.rows.length) return { body: '<div class="empty">Carga posiciones en la pestaña Cartera para ver su riesgo.</div>', alerts: renderAlerts() };
  const stats = portfolioStats(Object.fromEntries(b.rows.map(r => [r.tk, r.weight])), history);
  const conc = concentration(b.rows);
  const nav = stats && buildChart({ t: stats.t, c: stats.nav }, 252, { id: 'nav' });
  const cm = corrMatrix(b.rows.slice(0, 8).map(r => r.tk), history);
  const heat = v => `background:color-mix(in srgb,var(--${v >= 0 ? 'dn' : 'up'}) ${Math.round(Math.abs(v) * 70)}%,transparent)`;
  const matrix = cm.tks.length > 1
    ? `<div class="tw"><table class="mx"><tr><th></th>${cm.tks.map(t => `<th>${t}</th>`).join('')}</tr>${cm.tks.map((t, i) => `<tr><th>${t}</th>${cm.m[i].map(v => `<td class="n" style="${heat(v)}">${nf(v)}</td>`).join('')}</tr>`).join('')}</table></div>`
    : '<div class="empty">La matriz necesita histórico de al menos dos posiciones.</div>';
  const partial = stats && stats.coverage < 0.999;
  const body = `<div class="stats">
${stat('Volatilidad anual', stats ? `${nf(stats.vol, 1)}%` : DASH, '', 'Cartera hipotética: pesos actuales constantes sobre la historia común')}
${stat('Caída máx. hipotética', stats ? pct(stats.maxDD) : DASH, tone(stats?.maxDD), 'Con los pesos actuales, en el último año')}
${stat('Mayor posición', `${nf(conc.top1, 1)}%`)}${stat('3 mayores', `${nf(conc.top3, 1)}%`)}
${stat('Activos efectivos', nf(conc.effectiveN, 1), '', '1 / Herfindahl: cuántas posiciones iguales equivalen a tu concentración')}
${stat('Cobertura de histórico', stats ? `${nf(stats.coverage * 100, 0)}%` : DASH, partial ? 'wn' : '', 'Parte de la cartera con historia para estas métricas')}</div>
${partial ? '<div class="banner warn">Las métricas cubren solo una parte de la cartera: faltan datos históricos de algunas posiciones.</div>' : ''}
${stats ? '' : '<div class="banner warn">Sin histórico no se puede estimar volatilidad ni caídas. Ejecuta la actualización de datos.</div>'}
<div class="cols"><div><h3>Retrospectiva con los pesos actuales (base 100)</h3>${nav ? nav.html : '<div class="empty">Sin datos.</div>'}<p class="mu">Ejercicio hipotético: no es el rendimiento real de tu cartera ni predice el futuro.</p></div>
<div><h3>Correlación entre tus mayores posiciones</h3>${matrix}<p class="mu">Cerca de 1 (rojo): se mueven juntas y diversifican poco. Negativa (verde): se compensan.</p></div></div>`;
  return { body, alerts: renderAlerts() };
}

// ---------- datos y auditoría ----------

export function renderData() {
  const checks = dataChecks();
  const res = checks.length
    ? checks.map(c => `<div class="banner ${c.level}">${esc(c.text)}</div>`).join('')
    : '<div class="banner ok">Todos los controles de coherencia pasaron.</div>';
  const rows = ASSETS.map(a => {
    const m = meta(a);
    return `<tr data-ticker="${a.tk}"><td><b class="rk">${a.tk}</b></td><td class="r n">${nf(a.price)}</td><td>${m.sources.join(' + ') || '–'}</td><td>${qBadge(a)}</td>` +
      `<td class="r n">${m.diffPct === null ? '–' : `${nf(m.diffPct)}%`}</td><td class="n">${m.asOf ? new Date(m.asOf).toLocaleDateString('es-AR') : '–'}</td>` +
      `<td class="r n">${history[a.tk] ? history[a.tk].c.length : '–'}</td></tr>`;
  }).join('');
  const news = NEWS.map(([tks, text]) => `<li>${tks.map(t => `<button class="lk" data-ticker="${t}"><b>${t}</b></button>`).join(' ')} ${esc(text)}</li>`).join('');
  const macro = MACRO.map(([k, v]) => `<span class="mu">${k}</span><span>${v}</span>`).join('');
  return { res, rows, context: `<div class="cols"><div><h3>Macro</h3><div class="kv">${macro}</div></div><div><h3>Noticias</h3><ul class="news">${news}</ul></div></div>` };
}
