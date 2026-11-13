// Recomendaciones de tenis: el servicio (server/services/tennis/picks.js) calcula la probabilidad de cada línea de las casas con el
// modelo y la mezcla con la de la casa; aquí se filtran y se separan por perfil de riesgo, como en el baloncesto (basket-picks.ts).
// Funciones puras: components/TennisPicks.tsx pide los datos y lo enseña. Es una estimación: no hay cuotas históricas de tenis con
// las que comprobar si a la larga se gana dinero.
import type { TennisBoardMatch, TennisPick } from './types';
import { verdictOf } from './value';

export type TennisGroup = 'win' | 'hcp' | 'games' | 'sets' | 'serve' | 'aces' | 'other';
export const TENNIS_GROUPS: { value: TennisGroup | 'all'; label: string; title?: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'win', label: 'Ganador', title: 'Del partido y de cada set' },
  { value: 'hcp', label: 'Hándicap de juegos', title: 'Del partido y del 1.er set' },
  { value: 'games', label: 'Total de juegos', title: 'Del partido, de cada set y de cada jugador' },
  { value: 'sets', label: 'Sets', title: 'Hándicap de sets, número de sets, resultado en sets, ganar un set y set a cero' },
  { value: 'serve', label: 'Saque y primeros juegos', title: 'Primer juego al saque de cada uno y su marcador, cómo van tras 2, 4 o 6 juegos y quién rompe primero' },
  { value: 'aces', label: 'Aces', title: 'De cada jugador y entre los dos (sólo en los partidos en que las casas los dan)' },
  { value: 'other', label: 'Otras', title: 'Tie-break, resultado del 1.er set, par o impar y combinadas' }
];
export type TennisScope = 'all' | 'match' | 'set';
export const TENNIS_SCOPES: { value: TennisScope; label: string; title?: string }[] = [
  { value: 'all', label: 'Partido y sets' }, { value: 'match', label: 'Partido entero' }, { value: 'set', label: 'Un set', title: '1.er o 2.º set' }
];
export type TennisOrder = 'p' | 'value';

export interface TennisBoardPick extends TennisPick {
  match: TennisBoardMatch; group: TennisGroup; scope: 'match' | 'set';
  fav: boolean | null; // a favor del favorito, en contra o de ninguno de los dos (totales, tie-break)
  warn: string | null; // lo que le falta al modelo en ese partido
}

const groupOf = (f: string): TennisGroup =>
  /aces/i.test(f) ? 'aces' : /saque|^Tras \d|^Primer break$/.test(f) ? 'serve'
    : /(^|· )Ganador$/.test(f) ? 'win' : /Hándicap de juegos/.test(f) ? 'hcp' : /Total de juegos|Juegos de /.test(f) ? 'games'
      : /^(Hándicap de sets|Número de sets|Gana un set|Resultado en sets|Set a cero)$/.test(f) ? 'sets' : 'other';
const scopeOf = (f: string) => (/^(1\.er|2\.º) set · /.test(f) ? 'set' as const : 'match' as const);

// Las líneas de un partido con lo que hace falta para filtrarlas
export function boardPicks(x: TennisBoardMatch): TennisBoardPick[] {
  const fav = x.summary.pFinal >= 0.5 ? 'a' : 'b';
  const missing = x.warnings.map(w => w.match(/^Sin histórico de (.+?) en el circuito/)?.[1]).filter(Boolean);
  const warn = missing.length ? `Sin histórico de ${missing.join(' ni de ')}` : null;
  return x.picks.map(p => ({ ...p, match: x, group: groupOf(p.family), scope: scopeOf(p.family), fav: p.side ? p.side === fav : null, warn }));
}

const EASY = 0.6, MID = 0.45, HARD_MIN_PRICE = 2.2;

// Sólo se llama valor a lo que lo tiene y además tiene detrás un cálculo fiable (lo mismo que en baloncesto)
export const hasValue = (x: TennisPick) => verdictOf(x.ev, x.rel.score) === 'BET';
// El margen de la casa se come algo siempre, pero no se recomienda lo que se lo come todo
const decent = (x: TennisBoardPick) => x.ev >= -0.1 && x.rel.score >= 40;
// La más fiable: probable, sin regalar margen y con un cálculo en el que se pueda confiar. Puede no haber ninguna
const worthTop = (x: TennisBoardPick) => x.p >= EASY && decent(x) && x.rel.score >= 50 && x.ev >= -0.07;
// Un set suelto cuenta menos que el partido: tiene más azar y la casa cobra más margen
const score = (x: TennisBoardPick) => x.p + x.ev + 0.05 * (x.rel.score / 100) - (x.scope === 'set' ? 0.03 : 0);
// Las complicadas pagan de verdad, y contra el favorito sólo si hay valor
const hardOk = (x: TennisBoardPick) => x.price >= HARD_MIN_PRICE && (x.fav !== false || x.ev >= 0.03);

export interface TennisFilters { group: TennisGroup | 'all'; scope: TennisScope; minOdds: number; onlyValue: boolean; order: TennisOrder }

// Con "Todo", una línea por tipo de apuesta y partido: cinco hándicaps seguidos del mismo partido no son cinco ideas. Con un tipo
// elegido salen todas sus líneas para comparar. Con varios partidos, como mucho dos de cada uno por lista
function diversify(list: TennisBoardPick[], oneMatch: boolean, group: TennisFilters['group']) {
  const families = new Set<string>(), perMatch = new Map<string, number>();
  return list.filter(x => {
    const id = x.match.m.id, family = `${id}|${x.family}`, n = perMatch.get(id) ?? 0;
    if ((group === 'all' && families.has(family)) || (!oneMatch && n >= 2)) return false;
    families.add(family); perMatch.set(id, n + 1);
    return true;
  });
}

export function arrangeTennis(all: TennisBoardPick[], f: TennisFilters, oneMatch: boolean) {
  const shown = all.filter(x => x.price >= f.minOdds && (f.group === 'all' || x.group === f.group) && (f.scope === 'all' || x.scope === f.scope) && (!f.onlyValue || hasValue(x)));
  // Si ninguna llega al nivel se dice, en vez de presentar como buena la que menos pierde
  const top = shown.filter(worthTop).sort((a, b) => score(b) - score(a))[0] ?? null;
  const by = f.order === 'p' ? (a: TennisBoardPick, b: TennisBoardPick) => b.p - a.p || b.ev - a.ev : (a: TennisBoardPick, b: TennisBoardPick) => b.ev - a.ev || b.p - a.p;
  const rest = shown.filter(x => x !== top).sort(by);
  const d = (l: TennisBoardPick[]) => diversify(l, oneMatch, f.group);
  return {
    top,
    easy: d(rest.filter(x => x.p >= EASY && decent(x))),
    mid: d(rest.filter(x => x.p >= MID && x.p < EASY && decent(x))),
    hard: d(rest.filter(x => x.p < MID && hardOk(x))),
    count: shown.length, withValue: shown.filter(hasValue).length, bestEv: shown.length ? Math.max(...shown.map(x => x.ev)) : null
  };
}

// La más fiable de cada partido, de más a menos probable: la banda de la lista de partidos
export const dayBest = (matches: TennisBoardMatch[], minOdds: number, n: number) =>
  matches.flatMap(x => boardPicks(x).filter(p => p.price >= minOdds && worthTop(p)).sort((a, b) => score(b) - score(a)).slice(0, 1))
    .sort((a, b) => b.p - a.p).slice(0, n);
