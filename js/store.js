/**
 * Estado del usuario en localStorage (por dispositivo). Esquema versionado,
 * migración desde v1 y validación estricta de respaldos importados.
 */
export const SCHEMA = 2;
const KEY = 'inversiones:estado:v2';
const LEGACY_KEY = 'inversiones:estado:v1';

export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const defaults = () => ({
  schema: SCHEMA,
  portfolios: [{ id: 'propio', name: 'Propio', kind: 'own', txs: [] }], // kind: 'own' | 'third'
  active: 'all',
  favorites: [],
  alerts: [], // { tk, dir: '>' | '<', value }
  ccl: 1280,
  cclManual: false,
  inARS: false,
  risk: { stopPct: 8, riskPct: 1, maxWeightPct: 25, maxSectorPct: 50 },
  lastBackup: null,
});

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Sanea un objeto de estado arbitrario. Descarta lo inválido y cuenta lo descartado. */
export function sanitize(raw) {
  const out = defaults();
  let dropped = 0;
  const r = raw && typeof raw === 'object' ? raw : {};
  if (Array.isArray(r.portfolios) && r.portfolios.length) {
    out.portfolios = r.portfolios.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({
      id: p.id, name: p.name.slice(0, 40), kind: p.kind === 'third' ? 'third' : 'own',
      txs: (Array.isArray(p.txs) ? p.txs : []).filter(t => {
        const ok = t && typeof t.tk === 'string' && ['buy', 'sell'].includes(t.side) && num(t.qty, 0) > 0 && num(t.price, 0) > 0 && num(t.fee, 0) >= 0 && isDate(t.date);
        if (!ok) dropped++;
        return ok;
      }).map(t => ({ id: String(t.id ?? uid()), tk: t.tk, side: t.side, qty: Number(t.qty), price: Number(t.price), fee: num(t.fee, 0), date: t.date })),
    }));
    if (!out.portfolios.length) out.portfolios = defaults().portfolios;
  }
  out.active = out.portfolios.some(p => p.id === r.active) ? r.active : 'all';
  out.favorites = Array.isArray(r.favorites) ? r.favorites.filter(x => typeof x === 'string') : [];
  out.alerts = (Array.isArray(r.alerts) ? r.alerts : []).filter(a => a && typeof a.tk === 'string' && ['>', '<'].includes(a.dir) && num(a.value, 0) > 0)
    .map(a => ({ tk: a.tk, dir: a.dir, value: Number(a.value) }));
  out.ccl = num(r.ccl, out.ccl) > 0 ? Number(r.ccl) : out.ccl;
  out.cclManual = r.cclManual === true;
  out.inARS = r.inARS === true;
  out.lastBackup = isDate(String(r.lastBackup ?? '').slice(0, 10)) ? r.lastBackup : null;
  for (const [k, d] of Object.entries(out.risk)) out.risk[k] = num(r.risk?.[k], d) >= 0 ? num(r.risk?.[k], d) : d;
  return { state: out, dropped };
}

function readStored() {
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) return sanitize(JSON.parse(cur)).state;
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null'); // migración v1: posiciones -> compras
    if (old?.positions?.length) {
      const s = defaults();
      const today = new Date().toISOString().slice(0, 10);
      s.portfolios[0].txs = old.positions.map(p => ({ id: uid(), tk: p.tk, side: 'buy', qty: p.qty, price: p.cost, fee: 0, date: today }));
      s.favorites = old.favorites ?? [];
      return sanitize(s).state;
    }
  } catch { /* JSON corrupto o sin almacenamiento */ }
  return defaults();
}

export const state = readStored();

export const persistence = { ok: true };

/** Guarda el estado. Si falla (almacenamiento lleno o bloqueado) lo registra para avisar al usuario. */
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    persistence.ok = true;
  } catch {
    persistence.ok = false;
  }
  return persistence.ok;
}

export function exportBackup(now = new Date()) {
  return JSON.stringify({ app: 'mis-inversiones', schema: SCHEMA, exportedAt: now.toISOString(), data: state }, null, 2);
}

/** Valida y devuelve el estado de un respaldo; lanza Error con mensaje claro si no sirve. */
export function parseBackup(text) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('El archivo no es un respaldo válido (JSON ilegible).'); }
  if (json?.app !== 'mis-inversiones' || !json.data) throw new Error('El archivo no corresponde a esta aplicación.');
  if (!(json.schema <= SCHEMA)) throw new Error('El respaldo es de una versión más nueva de la aplicación.');
  return sanitize(json.data);
}

export function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
}
