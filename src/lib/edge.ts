// Valor de las líneas de jugador: probabilidad estimada con las últimas partidas (Leaguepedia) frente a la cuota.
// Modelo: binomial negativa (los kills varían más que una Poisson) con la media de las partidas recientes, pesando
// más las últimas, y mezclando la forma en victoria y en derrota según la probabilidad de ganar el mapa que dan las
// propias casas (un jugador hace muchos más kills cuando gana).
import type { FormGame, MarketLine, TeamForm } from './types';
import { devig, relCommon, reliability, sideValue, verdict, type SideValue, type ValueData } from './value';

export type StatKey = 'k' | 'd' | 'a';
export const MIN_GAMES = 5;
const DECAY = 0.93; // peso de cada partida respecto a la siguiente más reciente
const SHRINK = 3; // partidas "ficticias" con la media general al separar victorias y derrotas

// "Kills · Mapa 1" → { stat: 'k', map: 1 }; sin mapa es la serie entera y no se estima
export function parseStat(s: string): { stat: StatKey; map: number } | null {
  const stat: StatKey | null = /asist/i.test(s) ? 'a' : /muerte/i.test(s) ? 'd' : /kill/i.test(s) ? 'k' : null;
  const map = s.match(/Mapa (\d)/);
  return stat && map ? { stat, map: Number(map[1]) } : null;
}

export const normName = (s: string) => s.replace(/\(.*?\)/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Busca al jugador de la casa en la forma de los dos equipos
export function findPlayer(name: string, forms: (TeamForm | undefined)[]) {
  const n = normName(name);
  if (!n) return null;
  for (let side = 0; side < forms.length; side++) {
    const p = forms[side]?.players.find(x => normName(x.name) === n || normName(x.link) === n);
    if (p) return { player: p, side };
  }
  return null;
}

function weighted(games: FormGame[], stat: StatKey) {
  let w = 0, s = 0, s2 = 0;
  games.forEach((g, i) => { const wi = DECAY ** i, v = g[stat]; w += wi; s += wi * v; s2 += wi * v * v; });
  const mean = w ? s / w : 0;
  return { mean, variance: w ? Math.max(0, s2 / w - mean * mean) : 0, n: games.length };
}

// P(X <= x) de una binomial negativa con media m y varianza m·phi (phi = 1 es Poisson)
function cdf(x: number, m: number, phi: number) {
  if (x < 0) return 0;
  if (m <= 0) return 1;
  let p0: number, next: (k: number, pk: number) => number;
  if (phi <= 1.02) {
    p0 = Math.exp(-m);
    next = (k, pk) => (pk * m) / (k + 1);
  } else {
    const r = m / (phi - 1), q = 1 / phi; // q = probabilidad de "éxito" de la binomial negativa
    p0 = q ** r;
    next = (k, pk) => (pk * (k + r) * (1 - q)) / (k + 1);
  }
  let pk = p0, acc = p0;
  for (let k = 0; k < Math.floor(x); k++) { pk = next(k, pk); acc += pk; }
  return Math.min(1, acc);
}

// Probabilidad de Más / Menos / nula (línea entera) para un jugador
export function estimate(games: FormGame[], stat: StatKey, line: number, pWin: number | null) {
  const all = weighted(games, stat);
  const phi = all.mean > 0 ? Math.max(1, all.variance / all.mean) : 1;
  const sub = (win: boolean) => {
    const w = weighted(games.filter(g => g.win === win), stat);
    return (w.n * w.mean + SHRINK * all.mean) / (w.n + SHRINK);
  };
  const parts: [number, number][] = pWin == null ? [[1, all.mean]] : [[pWin, sub(true)], [1 - pWin, sub(false)]];
  let under = 0, push = 0;
  for (const [w, m] of parts) {
    const below = cdf(Math.ceil(line) - 1, m, phi); // X < línea
    under += w * below;
    if (Number.isInteger(line)) push += w * (cdf(line, m, phi) - below);
  }
  const hits = games.filter(g => g[stat] > line).length;
  return { over: 1 - under - push, under, push, mean: all.mean, sd: Math.sqrt(all.variance), n: games.length, hits };
}

// Análisis completo de una línea con las piezas comunes a la NBA (value.ts): la mejor cuota de cada lado,
// el margen de esa casa, la fiabilidad y el veredicto
export function analyzeLine(games: FormGame[], stat: StatKey, line: number, pWin: number | null,
  prices: { over: Record<string, number>; under: Record<string, number> }, books: string[]): ValueData {
  const e = estimate(games, stat, line, pWin);
  const sides: SideValue[] = [];
  for (const side of ['over', 'under'] as const) {
    let best: SideValue | null = null;
    for (const bk of books) {
      const price = prices[side][bk];
      if (!price) continue;
      const v = sideValue(side, side === 'over' ? e.over : e.under, e.push, price, devig(prices.over[bk], prices.under[bk])[side], bk);
      if (!best || v.ev > best.ev) best = v;
    }
    if (best) sides.push(best);
  }
  const days = games[0]?.date ? (Date.now() - new Date(games[0].date).getTime()) / 864e5 : null;
  const rel = reliability([
    { label: 'Partidas con su equipo', value01: e.n / 20, max: 25, note: `${e.n} partidas recientes` },
    relCommon.consistency(e.mean, e.sd),
    relCommon.distance(e.mean, e.sd, line),
    relCommon.agreement(e.over, e.n ? e.hits / e.n : 0),
    pWin == null
      ? { label: 'Ajuste por ganador', value01: 0, max: 15, note: 'sin cuota de ganador: no se ajusta por la probabilidad de ganar el mapa' }
      : { label: 'Ajuste por ganador', value01: 1, max: 15, note: `su equipo gana el mapa un ${(pWin * 100).toFixed(0)} % (cuotas sin margen)` },
    { label: 'Forma reciente', value01: days == null ? 0 : 1 - (days - 14) / 46, max: 15, note: days == null ? 'sin fecha' : `última partida hace ${Math.round(days)} días` }
  ]);
  const top = sides.slice().sort((a, b) => b.ev - a.ev)[0];
  const mk = top?.book ? devig(prices.over[top.book], prices.under[top.book]) : { margin: null, exact: false };
  const fair = (p: number) => (p > 0 ? (1 - e.push) / p : Infinity);
  return {
    line, pOver: e.over, pUnder: e.under, pPush: e.push, fairOver: fair(e.over), fairUnder: fair(e.under),
    margin: mk.margin, exact: mk.exact, sides, rel, verdict: verdict(sides, rel.score, line, e.over >= e.under ? 'over' : 'under')
  };
}

// Probabilidad sin margen de que gane el equipo A, con la mejor cuota de cada lado
function noVigA(m?: MarketLine) {
  const best = (id: string) => Math.max(0, ...Object.values(m?.outcomes.find(o => o.id === id)?.prices ?? {}));
  const a = best('a'), b = best('b');
  return a > 1 && b > 1 ? (1 / a) / (1 / a + 1 / b) : null;
}

// Probabilidad de ganar un mapa a partir de la de ganar la serie (Bo3 / Bo5), por bisección
function mapFromSeries(p: number, bestOf: number) {
  const need = Math.ceil(bestOf / 2);
  const series = (q: number) => {
    let s = 0; // gana `need` mapas antes de perder `need`
    for (let l = 0; l < need; l++) s += binom(need - 1 + l, l) * q ** need * (1 - q) ** l;
    return s;
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (series(mid) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
const binom = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i; return r; };

// Probabilidad de que el equipo A gane el mapa: la del mapa si hay cuotas; si no, la de la serie convertida
export function mapWinA(markets: MarketLine[], map: number, bestOf: number | null) {
  const byMap = noVigA(markets.find(m => m.key === `moneyline|${map}||`));
  if (byMap != null) return byMap;
  const series = noVigA(markets.find(m => m.key === 'moneyline|0||'));
  if (series == null) return null;
  return bestOf && bestOf > 1 ? mapFromSeries(series, bestOf) : series;
}

// Valor esperado por unidad apostada: p·cuota − 1, devolviendo la apuesta si es nula
export const ev = (p: number, push: number, price: number) => p * price + push - 1;
