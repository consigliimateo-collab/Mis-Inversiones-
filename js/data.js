/**
 * Catálogo de activos.
 *
 * `price`, `change`, `high` y `low` son la última instantánea conocida de la planilla;
 * data/prices.json las sobrescribe en cada actualización (ver js/prices.js).
 * `ratio` = CEDEARs por acción. `signal`: clave de SIGNALS. `pe` es estático.
 */
export const ASSETS = [
  { tk: 'QQQ', name: 'Invesco QQQ Trust', sector: 'ETFs', price: 736.53, change: -1.07, high: 748.63, low: 555.6, pe: null, ratio: 20, signal: 'C', thesis: 'Crecimiento' },
  { tk: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'ETFs', price: 765.61, change: -0.74, high: 779.37, low: 629.28, pe: null, ratio: 20, signal: 'C', thesis: 'Defensivo' },
  { tk: 'VT', name: 'Vanguard Total World Stock ETF', sector: 'ETFs', price: 158.81, change: -0.76, high: 162.71, low: 133.65, pe: null, ratio: 1, signal: 'C', thesis: 'Defensivo' },
  { tk: 'IBIT', name: 'iShares Bitcoin Trust', sector: 'ETFs', price: 47.21, change: -0.76, high: 71.82, low: 32.84, pe: null, ratio: 1, signal: 'C', thesis: 'Alta beta' },
  { tk: 'OKLO', name: 'Oklo Inc.', sector: 'Energía', price: 37.11, change: -2.44, high: 193.84, low: 34.38, pe: null, ratio: 1, signal: 'B', thesis: 'Alta beta' },
  { tk: 'PAM', name: 'Pampa Energía S.A.', sector: 'Energía', price: 76.55, change: -1.71, high: 94.5, low: 57.14, pe: null, ratio: 1, signal: 'B', thesis: 'Valor' },
  { tk: 'TGS', name: 'Transportadora de Gas del Sur', sector: 'Energía', price: 25.86, change: -2.85, high: 36.35, low: 20.01, pe: 10.78, ratio: 1, signal: 'B', thesis: 'Valor' },
  { tk: 'VIST', name: 'Vista Energy S.A.B. de C.V.', sector: 'Energía', price: 66.91, change: -0.77, high: 81.44, low: 33.45, pe: 8.77, ratio: 1, signal: 'C', thesis: 'Crecimiento' },
  { tk: 'YPF', name: 'YPF Sociedad Anónima', sector: 'Energía', price: 51.37, change: -1.4, high: 57.87, low: 23.02, pe: null, ratio: 1, signal: 'C', thesis: 'Valor' },
  { tk: 'AAPL', name: 'Apple Inc.', sector: 'Big Tech', price: 338.4, change: -0.78, high: 345.34, low: 243.42, pe: 38.79, ratio: 10, signal: 'C', thesis: 'Crecimiento' },
  { tk: 'GOOGL', name: 'Alphabet Inc.', sector: 'Big Tech', price: 342.75, change: -0.34, high: 408.61, low: 235.84, pe: 17.22, ratio: 58, signal: 'C', thesis: 'Crecimiento' },
  { tk: 'MELI', name: 'MercadoLibre Inc.', sector: 'Big Tech', price: 1712.41, change: -2.29, high: 2548.5, low: 1495, pe: 46.59, ratio: 60, signal: 'B', thesis: 'Crecimiento' },
  { tk: 'MSFT', name: 'Microsoft Corporation', sector: 'Big Tech', price: 509.22, change: -1.35, high: 553.72, low: 349.2, pe: 28.38, ratio: 30, signal: 'C', thesis: 'Crecimiento' },
  { tk: 'TSLA', name: 'Tesla Inc.', sector: 'Big Tech', price: 357.45, change: -3.94, high: 498.82, low: 297.38, pe: 332.03, ratio: 15, signal: 'B', thesis: 'Alta beta' },
  { tk: 'AVGO', name: 'Broadcom Inc.', sector: 'Semis', price: 349.57, change: -0.92, high: 495, low: 289.96, pe: 44.63, ratio: 10, signal: 'C', thesis: 'Crecimiento' },
  { tk: 'MU', name: 'Micron Technology Inc.', sector: 'Semis', price: 1053.98, change: -2.61, high: 1255, low: 159.97, pe: 23.86, ratio: 5, signal: 'B', thesis: 'Crecimiento' },
  { tk: 'NVDA', name: 'NVIDIA Corporation', sector: 'Semis', price: 228.86, change: 1.68, high: 236.54, low: 164.27, pe: 28.93, ratio: 24, signal: 'FA', thesis: 'Crecimiento' },
  { tk: 'PLTR', name: 'Palantir Technologies Inc.', sector: 'Semis', price: 187.48, change: -1.15, high: 207.52, low: 106.38, pe: 159.76, ratio: 4, signal: 'C', thesis: 'Alta beta' },
  { tk: 'QCOM', name: 'QUALCOMM Incorporated', sector: 'Semis', price: 187.48, change: -7.17, high: 259.92, low: 121.99, pe: 21.7, ratio: 11, signal: 'B', thesis: 'Valor' },
  { tk: 'TSM', name: 'Taiwan Semiconductor Manufacturing', sector: 'Semis', price: 452.88, change: 0.5, high: 479, low: 266.82, pe: 32.87, ratio: 9, signal: 'A', thesis: 'Crecimiento' },
];

export const SIGNALS = {
  FA: { label: 'Fuerte alcista', tone: 'up', rank: 4 },
  A: { label: 'Alcista', tone: 'up', rank: 3 },
  C: { label: 'Corrección', tone: 'wn', rank: 2 },
  B: { label: 'Bajista', tone: 'dn', rank: 1 },
};

export const SECTORS = [...new Set(ASSETS.map(a => a.sector))];

// Contexto macro y noticias: texto de la planilla, se edita a mano.
export const MACRO = [
  ['Petróleo WTI', '~$77 / barril'],
  ['Breakeven Vaca Muerta', '~$36 / barril'],
  ['Tasa Fed (rango meta)', '3,75% – 4,00%'],
  ['Capex IA big tech', '~$79B en el trimestre'],
];

export const NEWS = [
  [['NVDA'], 'Aceleración de envíos de Blackwell B200 y alta demanda en centros de datos.'],
  [['YPF', 'VIST'], 'Avance del oleoducto Vaca Muerta Sur y récord de productividad en pozos.'],
  [['TSLA'], 'Expansión de flota con conducción autónoma FSD y márgenes en Megapack.'],
  [['PLTR'], 'Más contratos corporativos de IA (AIP) y defensa en EE.UU.'],
  [['MU', 'AVGO'], 'Memorias HBM3E vendidas hasta 2026, impulsadas por aceleradores de IA.'],
  [['IBIT'], 'Flujo institucional récord en el ETF de Bitcoin.'],
];

// Selectores derivados: no se guardan, así nunca quedan desactualizados.
export const bySymbol = tk => ASSETS.find(a => a.tk === tk);
export const rangePos = a => Math.min(100, Math.max(0, ((a.price - a.low) / (a.high - a.low)) * 100));
export const fromHigh = a => (a.price / a.high - 1) * 100;
export const trendPct = a => (a.spark?.length > 1 ? (a.spark.at(-1) / a.spark[0] - 1) * 100 : null);
export const sectorAvg = sector => {
  const list = ASSETS.filter(a => a.sector === sector);
  return list.reduce((sum, a) => sum + a.change, 0) / list.length;
};
