/**
 * Motor de cartera. Método de costo promedio ponderado; comisiones capitalizadas en compras
 * y descontadas en ventas. Todo en USD. Funciones puras: no leen estado global.
 */
const EPS = 1e-9;

const byDate = (a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1);

/** Procesa operaciones en orden cronológico (compras antes que ventas el mismo día). */
export function fold(txs) {
  const map = new Map();
  const errors = [];
  for (const t of [...txs].sort(byDate)) {
    const p = map.get(t.tk) ?? { tk: t.tk, qty: 0, basis: 0, realized: 0 };
    if (t.side === 'buy') {
      p.qty += t.qty;
      p.basis += t.qty * t.price + t.fee;
    } else if (t.qty > p.qty + EPS) {
      errors.push(`La venta de ${t.qty} ${t.tk} supera la tenencia (${p.qty}) al ${t.date}`);
      continue;
    } else {
      const avg = p.basis / p.qty;
      p.realized += t.qty * t.price - t.fee - t.qty * avg;
      p.basis -= t.qty * avg;
      p.qty -= t.qty;
      if (p.qty < EPS) { p.qty = 0; p.basis = 0; }
    }
    map.set(t.tk, p);
  }
  const all = [...map.values()];
  return { open: all.filter(p => p.qty > 0), realized: all.reduce((s, p) => s + p.realized, 0), errors };
}

/** Devuelve un mensaje de error, o null si la operación es válida. */
export function validateTx(tx, prior, known, today) {
  if (!['buy', 'sell'].includes(tx.side)) return 'Operación inválida.';
  if (!known(tx.tk)) return 'Activo desconocido.';
  if (!(Number.isFinite(tx.qty) && tx.qty > 0)) return 'La cantidad debe ser mayor a cero.';
  if (!(Number.isFinite(tx.price) && tx.price > 0)) return 'El precio debe ser mayor a cero.';
  if (!(Number.isFinite(tx.fee) && tx.fee >= 0)) return 'Las comisiones no pueden ser negativas.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date) || Number.isNaN(Date.parse(tx.date))) return 'Fecha inválida.';
  if (tx.date > today) return 'La fecha no puede ser futura.';
  const { errors } = fold([...prior, tx]);
  return errors[0] ?? null;
}

/** Suma posiciones abiertas de varias carteras (mismo ticker: suma cantidad y costo). */
export function mergeOpen(lists) {
  const map = new Map();
  for (const p of lists.flat()) {
    const m = map.get(p.tk) ?? { tk: p.tk, qty: 0, basis: 0 };
    m.qty += p.qty;
    m.basis += p.basis;
    map.set(p.tk, m);
  }
  return [...map.values()];
}

/** Valúa posiciones. quote(tk) -> { price, change } (change = % del día). */
export function valuate(open, quote) {
  const rows = open.map(p => {
    const q = quote(p.tk);
    const value = p.qty * q.price;
    return {
      tk: p.tk, qty: p.qty, basis: p.basis, avg: p.basis / p.qty, price: q.price, value,
      unrealized: value - p.basis,
      plPct: p.basis ? (value / p.basis - 1) * 100 : 0,
      dayPL: value - value / (1 + q.change / 100),
    };
  });
  const value = rows.reduce((s, r) => s + r.value, 0);
  for (const r of rows) r.weight = value ? (r.value / value) * 100 : 0;
  const basis = rows.reduce((s, r) => s + r.basis, 0);
  return {
    rows: rows.sort((a, b) => b.value - a.value),
    totals: { value, basis, unrealized: value - basis, dayPL: rows.reduce((s, r) => s + r.dayPL, 0) },
  };
}

/** Concentración: peso del mayor, de los 3 mayores, índice de Herfindahl y N efectivo. */
export function concentration(rows) {
  const w = rows.map(r => r.weight / 100).sort((a, b) => b - a);
  const h = w.reduce((s, x) => s + x * x, 0);
  return { top1: (w[0] ?? 0) * 100, top3: w.slice(0, 3).reduce((s, x) => s + x, 0) * 100, hhi: h, effectiveN: h ? 1 / h : 0 };
}

/** Exposición por sector (% del total). */
export function exposure(rows, sectorOf) {
  const out = {};
  for (const r of rows) out[sectorOf(r.tk)] = (out[sectorOf(r.tk)] ?? 0) + r.weight;
  return out;
}

/**
 * Tamaño de posición por riesgo: arriesga riskPct% del patrimonio hasta el stop,
 * limitado por el peso máximo permitido. Devuelve null si faltan datos.
 */
export function positionSize({ equity, price, stopPct, riskPct, maxWeightPct }) {
  if (!(equity > 0 && price > 0 && stopPct > 0 && riskPct > 0)) return null;
  const byRisk = (equity * riskPct / 100) / (price * stopPct / 100);
  const byCap = maxWeightPct > 0 ? (equity * maxWeightPct / 100) / price : Infinity;
  const qty = Math.min(byRisk, byCap);
  return { qty, byRisk, byCap, amount: qty * price, weight: (qty * price / equity) * 100, capped: byCap < byRisk, maxLoss: qty * price * stopPct / 100 };
}
