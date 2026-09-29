/** Formato numérico (es-AR) y helpers de presentación. */

export function nf(n, decimals = 2) {
  return Number.isFinite(n) ? n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '–';
}

/** Variación porcentual con signo explícito: +1,23% */
export const pct = n => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${nf(n)}%` : '–');

/** Clase CSS según el signo: 'up' | 'dn' | '' */
export const tone = n => (n > 0 ? 'up' : n < 0 ? 'dn' : '');

/** Escapa texto que proviene del usuario antes de insertarlo como HTML. */
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Tiempo transcurrido en texto corto: "hace 12 min". */
export function ago(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'hace instantes';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} días`;
}

/** Día (entero, días desde 1970 UTC) a texto corto: "26 sep 25". */
export const dayLabel = d => new Date(d * 86400000).toLocaleDateString('es-AR', { timeZone: 'UTC', day: '2-digit', month: 'short', year: '2-digit' });

/** Fecha local de hoy en formato ISO (YYYY-MM-DD). */
export function todayISO(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Minigráfico SVG de una serie de cierres. Devuelve un guion si no hay datos. */
export function sparkline(values, width = 64, height = 20) {
  if (!values || values.length < 2) return '<span class="mu">–</span>';
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const points = values.map((v, i) =>
    `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - lo) / span) * (height - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark ${tone(values.at(-1) - values[0])}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
    `<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

/** CSV con separador ; y BOM (Excel en español lo abre bien). Neutraliza inyección de fórmulas. */
export function toCSV(rows) {
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\ufeff' + rows.map(r => r.map(cell).join(';')).join('\n');
}
