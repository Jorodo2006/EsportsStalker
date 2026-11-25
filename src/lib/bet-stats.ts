import { betProfit } from '@/lib/format';
import type { Bet } from '@/lib/types';

// Cifras de rendimiento de Mis apuestas (BetsView): si se gana de verdad o es suerte, cuánto se ha llegado a perder desde el
// máximo, por mes, por cuota y por tipo de mercado. Todo puro, con pruebas en bet-stats.test.ts.

// Resueltas que mueven dinero (las nulas no cuentan), en orden de fecha
export function settledOf(bets: Bet[]) {
  return bets.filter(b => b.status !== 'pending' && b.status !== 'void').sort((a, b) => a.date.localeCompare(b.date));
}

// Acierto frente al necesario: con cuota 2,00 hay que acertar la mitad para no perder; la media de 1/cuota es el acierto con el
// que se queda a cero. Acertar más que eso es lo que da beneficio a la larga. Los cash out no son acierto ni fallo: fuera.
export function edgeOf(bets: Bet[]) {
  const list = settledOf(bets).filter(b => b.status !== 'cashout' && b.odds > 1);
  const n = list.length;
  const wins = list.filter(b => betProfit(b) > 0).length;
  const breakEven = n ? list.reduce((s, b) => s + 1 / b.odds, 0) / n : 0;
  const hit = n ? wins / n : 0;
  return { n, wins, hit, breakEven, diff: hit - breakEven };
}

// Φ(z), la normal acumulada (Abramowitz y Stegun 7.1.26, error < 1,5e-7)
export function normalCdf(z: number) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// ¿Suerte o ventaja? Si no se tuviera ninguna ventaja (cada apuesta gana con probabilidad 1/cuota), el beneficio esperado es 0
// y su varianza, la suma de importe² × (cuota − 1). p: lo probable que es ganar al menos esto sólo por suerte. No cuenta el
// margen de la casa, que lo haría aún más difícil: es una cota generosa. Por debajo de MIN_LUCK apuestas no se dice nada.
export const MIN_LUCK = 20;
export function luckOf(bets: Bet[]) {
  const list = settledOf(bets).filter(b => b.odds > 1);
  const profit = list.reduce((s, b) => s + betProfit(b), 0);
  const variance = list.reduce((s, b) => s + b.stake * b.stake * (b.odds - 1), 0);
  if (list.length < MIN_LUCK || !variance) return { n: list.length, z: 0, p: null as number | null };
  const z = profit / Math.sqrt(variance);
  return { n: list.length, z, p: 1 - normalCdf(z) };
}

// Peor caída (desde el beneficio más alto hasta el punto más bajo que vino después), lo que se está ahora por debajo del máximo
// y las rachas de ganadas y perdidas (las que quedan a cero, como un cash out por lo apostado, no cortan ni suman)
export function runsOf(bets: Bet[]) {
  let acc = 0, peak = 0, maxDrop = 0, cur = 0, curKind: 'won' | 'lost' | null = null, bestWin = 0, worstLoss = 0;
  for (const b of settledOf(bets)) {
    const p = betProfit(b);
    acc += p;
    peak = Math.max(peak, acc);
    maxDrop = Math.max(maxDrop, peak - acc);
    if (!p) continue;
    const kind = p > 0 ? 'won' : 'lost';
    cur = kind === curKind ? cur + 1 : 1;
    curKind = kind;
    if (kind === 'won') bestWin = Math.max(bestWin, cur); else worstLoss = Math.max(worstLoss, cur);
  }
  return { maxDrop, fromPeak: peak - acc, peak, streak: { kind: curKind, n: cur }, bestWin, worstLoss };
}

// Beneficio de cada mes, del más antiguo al último (los meses sin apuestas resueltas no salen)
export function byMonth(bets: Bet[]) {
  const m = new Map<string, { month: string; profit: number; staked: number; count: number }>();
  for (const b of settledOf(bets)) {
    const month = b.date.slice(0, 7);
    const r = m.get(month) ?? { month, profit: 0, staked: 0, count: 0 };
    r.profit += betProfit(b); r.staked += b.stake; r.count++;
    m.set(month, r);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).map(r => ({
    ...r, profit: Math.round(r.profit * 100) / 100, roi: r.staked ? r.profit / r.staked : 0, label: monthLabel(r.month)
  }));
}
export function monthLabel(month: string) {
  const [y, mo] = month.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }).replace('.', '');
}

// Tramos de cuota: en cuáles se gana y en cuáles se pierde. El orden de la lista es el de la tabla
export const ODDS_BANDS = [
  { max: 1.5, label: 'Hasta 1,50' },
  { max: 2, label: '1,51 a 2,00' },
  { max: 3, label: '2,01 a 3,00' },
  { max: 5, label: '3,01 a 5,00' },
  { max: Infinity, label: 'Más de 5,00' }
];
export const oddsBand = (odds: number) => (ODDS_BANDS.find(x => odds <= x.max) ?? ODDS_BANDS[ODDS_BANDS.length - 1]).label;
export const oddsBandOrder = (label: string) => ODDS_BANDS.findIndex(x => x.label === label);

// Tipo de mercado, de la clave del comparador que lleva la apuesta enlazada (ref.key: «tipo|periodo|…», las mismas que lee
// settle.js). Las combinadas aparte; las que no están enlazadas a su partido no se pueden clasificar con seguridad.
const KIND: Record<string, string> = {
  moneyline: 'Ganador', spread: 'Hándicap', total: 'Totales', team_total: 'Total de un equipo', player: 'Jugador',
  btts: 'Ambos marcan', double: 'Doble oportunidad', dnb: 'Empate no válido', corners: 'Córners', cards: 'Tarjetas',
  cards_both: 'Tarjetas', method: 'Método de victoria', distance: 'Llega al final', total_rounds: 'Asaltos', wmx: 'Especiales'
};
export function marketKind(b: Bet) {
  if (b.legs?.length) return 'Combinada';
  const type = b.ref?.key?.split('|')[0];
  if (!type) return 'Sin enlazar al partido';
  return KIND[type] ?? 'Otros';
}

// Beneficio acumulado de todas las apps juntas y, si se elige, el de un deporte, punto a punto (una apuesta resuelta cada uno).
// sport: la parte de ese deporte (las combinadas que mezclan deportes, «mix», sólo van al total)
export function combinedSeries(bets: Bet[], sport: string | null) {
  let total = 0, part = 0;
  const rows = settledOf(bets).map(b => {
    const p = betProfit(b);
    total += p;
    if (sport && (b.sport || 'lol') === sport) part += p;
    return { date: b.date, event: b.event, total: round(total), part: round(part) };
  });
  return rows.length ? [{ date: '', event: '', total: 0, part: 0 }, ...rows] : rows;
}
const round = (v: number) => Math.round(v * 100) / 100;

// CLV (closing line value): la cuota a la que se apostó frente a la de cierre de la casa (la última antes de empezar). Apostar a
// 2,10 lo que cerró a 1,90 es un +10,5 %: quien gana a la cuota de cierre de forma constante gana a la larga, y se sabe en cuanto
// empieza el partido, sin esperar a cientos de resultados. Las combinadas, con el producto de sus selecciones (todas con cierre;
// las nulas no cuentan). Cuentan también las pendientes ya empezadas.
export function closeOdds(b: Bet): number | null {
  if (b.legs?.length) {
    const legs = b.legs.filter(l => l.status !== 'void');
    if (!legs.length || legs.some(l => !(l.close?.price && l.close.price > 1))) return null;
    return legs.reduce((p, l) => p * l.close!.price!, 1);
  }
  return b.close?.price && b.close.price > 1 ? b.close.price : null;
}
export function clvOf(bets: Bet[]) {
  const list = bets.filter(b => b.status !== 'void' && b.odds > 1).map(b => ({ b, close: closeOdds(b) })).filter(x => x.close) as { b: Bet; close: number }[];
  const n = list.length;
  const clv = list.map(x => x.b.odds / x.close - 1);
  // Con importe: lo que se gana a la cuota de cierre por cada euro apostado, como el ROI
  const staked = list.reduce((s, x) => s + x.b.stake, 0);
  return {
    n,
    // Las que podrían tenerla (con partido enlazado) y aún no: la interfaz lo dice para que no parezca que falta algo
    withRef: bets.filter(b => b.status !== 'void' && (b.ref || b.legs?.some(l => l.ref))).length,
    avg: n ? clv.reduce((s, v) => s + v, 0) / n : 0,
    weighted: staked ? list.reduce((s, x, i) => s + x.b.stake * clv[i], 0) / staked : 0,
    beat: n ? clv.filter(v => v > 0).length / n : 0
  };
}
