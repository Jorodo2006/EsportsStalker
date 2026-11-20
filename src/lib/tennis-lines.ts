// Las líneas del perfil de un tenista (pestaña Líneas de su ficha, components/TennisLines.tsx): sus mercados, cómo le fue frente a una
// línea en sus partidos de TennisMyLife, y sus líneas de las casas en el próximo partido con el panel de valor. Lo que espera el
// modelo lo calcula el servicio (server/services/tennis/picks.js, playerLines), con el mismo cálculo que las recomendaciones del partido.
// Las líneas son siempre de medio punto: nunca hay nula
import type { TennisLineMarket, TennisLogMatch, TennisPick } from './types';
import { sideValue, verdict, type Side, type SideValue, type ValueData } from './value';

export interface LineMarket {
  label: string; short: string; unit: string;
  value: (g: TennisLogMatch) => number | null; // lo que hizo en un partido
  model: boolean; // si el modelo lo calcula (las dobles faltas, no)
  ou: boolean; // si se apuesta a Más / Menos (el hándicap y los sets se leen de otra forma)
}
export const LINE_MARKETS: Record<TennisLineMarket, LineMarket> = {
  games: { label: 'Juegos ganados', short: 'Juegos', unit: 'juegos', value: g => g.gamesWon, model: true, ou: true },
  total: { label: 'Juegos del partido', short: 'Total', unit: 'juegos', value: g => g.gamesWon + g.gamesLost, model: true, ou: true },
  spread: { label: 'Hándicap de juegos', short: 'Hándicap', unit: 'juegos', value: g => g.gamesWon - g.gamesLost, model: true, ou: false },
  aces: { label: 'Aces', short: 'Aces', unit: 'aces', value: g => g.aces, model: true, ou: true },
  sets: { label: 'Sets ganados', short: 'Sets', unit: 'sets', value: g => g.setsWon, model: true, ou: false },
  df: { label: 'Dobles faltas', short: 'Dobles faltas', unit: 'dobles faltas', value: g => g.df, model: false, ou: true }
};
export const MARKET_ORDER: TennisLineMarket[] = ['games', 'total', 'spread', 'aces', 'sets', 'df'];

const dec = (v: number) => String(v).replace('.', ',');
// Cómo se dice una línea: el hándicap con su signo («+3,5»)
export const lineText = (m: TennisLineMarket, line: number) => (m === 'spread' && line > 0 ? `+${dec(line)}` : dec(line));
// El lado de una línea en palabras: «Más de 12,5 juegos», «+3,5 juegos» (lo cubre) o «gana un set»
export function sideText(m: TennisLineMarket, line: number, side: Side) {
  if (m === 'spread') return side === 'over' ? `${lineText(m, line)} juegos` : `no cubre ${lineText(m, line)}`;
  if (m === 'sets') {
    const k = Math.ceil(line);
    return side === 'over' ? (k === 1 ? 'gana un set' : `gana ${k} sets`) : (k === 1 ? 'no gana ningún set' : `menos de ${k} sets`);
  }
  return `${side === 'over' ? 'Más' : 'Menos'} de ${dec(line)} ${LINE_MARKETS[m].unit}`;
}

// Supera la línea; en el hándicap, la cubre: sus juegos menos los del rival más la línea, por encima de cero
export const covers = (m: TennisLineMarket, v: number, line: number) => (m === 'spread' ? v + line > 0 : v > line);
export const wins = (m: TennisLineMarket, v: number, line: number, side: Side) => (side === 'over' ? covers(m, v, line) : !covers(m, v, line));

// Los partidos que valen para un mercado: los que tienen el dato y no acabaron en retirada (con medio partido, los juegos y los aces
// no dicen nada, y las casas anulan esas apuestas)
export const usable = (list: TennisLogMatch[], m: TennisLineMarket) => list.filter(g => !g.retired && LINE_MARKETS[m].value(g) != null);

export function hitRate(list: TennisLogMatch[], m: TennisLineMarket, line: number, side: Side) {
  const xs = usable(list, m);
  const hits = xs.filter(g => wins(m, LINE_MARKETS[m].value(g)!, line, side)).length;
  const avg = xs.length ? xs.reduce((t, g) => t + LINE_MARKETS[m].value(g)!, 0) / xs.length : null;
  return { n: xs.length, hits, rate: xs.length ? hits / xs.length : null, avg };
}

// Fecha de hace un año (los partidos llevan el lunes de su torneo)
const yearAgo = (today: string) => new Date(Date.parse(`${today}T12:00:00Z`) - 364 * 864e5).toISOString().slice(0, 10);

// Tramos: cómo le fue en cada situación frente a la misma línea. Salvo los últimos 10, sobre las últimas 52 semanas
export function splits(list: TennisLogMatch[], m: TennisLineMarket, line: number, side: Side, o: { today: string; surface?: string | null; surfaceLabel?: string }) {
  const base = usable(list, m), cut = yearAgo(o.today), year = base.filter(g => g.date >= cut);
  const top20 = (g: TennisLogMatch) => g.oppRank != null && g.oppRank <= 20;
  const rows: [string, TennisLogMatch[]][] = [
    ['Últimos 10', base.slice(0, 10)],
    ['52 semanas', year],
    ...(o.surface ? [[`En ${o.surfaceLabel ?? o.surface}`, year.filter(g => g.surface === o.surface)] as [string, TennisLogMatch[]]] : []),
    ['Contra el top 20', year.filter(top20)],
    ['Contra el resto', year.filter(g => !top20(g))],
    ['Cuando gana', year.filter(g => g.win)],
    ['Cuando pierde', year.filter(g => !g.win)],
    ...(base.some(g => g.bestOf === 5) ? [['A cinco sets (todos)', base.filter(g => g.bestOf === 5)] as [string, TennisLogMatch[]]] : [])
  ];
  return rows.map(([label, xs]) => ({ label, ...hitRate(xs, m, line, side) }));
}

// La línea de medio punto más cercana a lo que se espera (del modelo, o la media de sus últimos 10 sin él). En el hándicap, la que
// deja la apuesta igualada: con 3 juegos de ventaja esperados, −2,5
export function suggestedLine(m: TennisLineMarket, expected: number | null | undefined, list: TennisLogMatch[]) {
  const recent = usable(list, m).slice(0, 10);
  const mean = expected ?? (recent.length ? recent.reduce((t, g) => t + LINE_MARKETS[m].value(g)!, 0) / recent.length : null);
  if (mean == null) return m === 'spread' ? -0.5 : m === 'sets' ? 0.5 : m === 'aces' ? 4.5 : m === 'df' ? 2.5 : m === 'total' ? 21.5 : 10.5;
  if (m === 'sets') return mean >= 1.5 ? 1.5 : 0.5;
  const x = m === 'spread' ? -mean : mean;
  return Math.max(m === 'spread' ? -20.5 : 0.5, Math.floor(x) + 0.5);
}

// ---------- Las líneas de las casas de un mercado, desde el jugador ----------
export type BookSides = { over?: TennisPick; under?: TennisPick };
const numIn = (s: string) => { const x = String(s).match(/[-+]?\d+(?:[.,]\d+)?/); return x ? Number(x[0].replace(',', '.')) : null; };

// De las recomendaciones de su partido (las del servicio, con su probabilidad, valor y fiabilidad), las de este mercado por línea.
// me: su lado en el partido; name: su nombre; bestOf: para leer el ganador como «más de 1,5 sets» (2,5 a cinco sets)
export function bookLines(picks: TennisPick[], m: TennisLineMarket, me: 'a' | 'b', name: string, bestOf = 3) {
  const out = new Map<number, BookSides>();
  const put = (line: number, side: Side, p: TennisPick) => { const cur = out.get(line) ?? {}; if (!cur[side] || p.ev > cur[side]!.ev) cur[side] = p; out.set(line, cur); };
  for (const p of picks) {
    const [key, oc] = p.id.split('#');
    const [type, period, who, raw] = key.split('|');
    if (period !== '0' && type !== 'wmx' && type !== 'betway') continue;
    const L = raw != null && raw !== '' ? Number(raw) : null;
    if (m === 'games' && type === 'team_total' && who === me && L != null) put(L, oc === 'over' ? 'over' : 'under', p);
    else if (m === 'total' && type === 'total' && L != null) put(L, oc === 'over' ? 'over' : 'under', p);
    // El hándicap de la casa va desde el jugador a: el de él es el mismo o el contrario, y la apuesta del rival es «no cubrirlo»
    else if (m === 'spread' && type === 'spread' && L != null) put(me === 'a' ? L : -L, oc === me ? 'over' : 'under', p);
    else if (m === 'aces' && p.family === `Aces de ${name}`) {
      const k = numIn(p.selection);
      if (k == null) continue;
      if (/o m[aá]s/i.test(p.selection)) put(Math.ceil(k) - 0.5, 'over', p);
      else put(k, /^(m[aá]s|over)/i.test(p.selection) ? 'over' : 'under', p);
    } else if (m === 'sets' && p.family === 'Gana un set' && p.side === me) put(0.5, 'over', p);
    else if (m === 'sets' && type === 'moneyline' && period === '0' && oc === me) put(bestOf === 5 ? 2.5 : 1.5, 'over', p);
  }
  return out;
}

// La línea principal de las casas en un mercado: la más igualada (la probabilidad de Más más cerca del 50 %). Vale aunque sólo llegue
// un lado: del hándicap sólo llegan las apuestas a favor de este jugador, y buscar las que tienen los dos lados cogía la primera (−5,5)
export function mainLine(books: Map<number, BookSides>): number | null {
  let best: number | null = null, gap = Infinity;
  for (const [line, b] of books) {
    const p = b.over ? b.over.p : b.under ? 1 - b.under.p : null;
    if (p == null) continue;
    const d = Math.abs(p - 0.5);
    if (d < gap - 1e-9) { gap = d; best = line; }
  }
  return best;
}

// El panel de valor de una línea de las casas, con las cifras del servicio (las mismas que la recomendación) y el veredicto común
// de value.ts. null si la casa no la da
export function valueOf(m: TennisLineMarket, line: number, b: BookSides | undefined): ValueData | null {
  if (!b || (!b.over && !b.under)) return null;
  const pOver = b.over ? b.over.p : 1 - b.under!.p, pUnder = b.under ? b.under.p : 1 - b.over!.p;
  const one = (side: Side, p: TennisPick): SideValue => ({
    side, price: p.price, book: p.book, p: p.p, pModel: p.pModel, ev: p.ev, edge: p.p - p.pMarket, gap: p.pModel - p.pMarket,
    kelly: sideValue(side, p.p, 0, p.price, null).kelly
  });
  const sides = [b.over && one('over', b.over), b.under && one('under', b.under)].filter(Boolean) as SideValue[];
  // La fiabilidad del lado que más paga para lo que se espera (en una misma línea casi no cambia)
  const rel = (sides.slice().sort((x, y) => y.ev - x.ev)[0].side === 'over' ? b.over ?? b.under : b.under ?? b.over)!.rel;
  const margin = b.over && b.under ? 1 / b.over.price + 1 / b.under.price - 1 : null;
  const v = verdict(sides, rel.score, line, pOver >= 0.5 ? 'over' : 'under');
  // El veredicto dice «Más de 12.5»: en el hándicap y los sets, cómo se apuesta de verdad
  const named = !LINE_MARKETS[m].ou && v.best && (v.code === 'BET' || v.code === 'LEAN') ? { ...v, title: `${sideText(m, line, v.best.side)}${v.code === 'LEAN' ? ' (valor ligero)' : ''}` } : v;
  return { line, pOver, pUnder, pPush: 0, fairOver: 1 / pOver, fairUnder: 1 / pUnder, margin, exact: !!(b.over && b.under), sides, rel, verdict: named };
}
