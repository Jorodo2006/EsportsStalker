// Recomendaciones de baloncesto: cruza cada línea real de las casas con el modelo (el de jugadores y el de puntos de equipo) y las
// separa por perfil de riesgo. Dentro de cada perfil manda el valor, no la probabilidad: una cuota de 1,11 muy probable no da dinero.
// Funciones puras: components/BasketPicks.tsx pide los datos y lo enseña. Es una estimación: no hay cuotas históricas de baloncesto
// con las que comprobar si a la larga se gana dinero.
import { BASKET_MARKETS, fmtLine, missedByPlayer, playerLines, playerOut, scanLine, type BasketMarket } from './basket-model';
import { POINT_PERIODS, analyzePoints, pointLines, projectGame, type PointKind, type PointPeriod } from './basket-teams';
import { gameCtx, teamGamesOf } from './basket-context';
import { freshKeyOuts, matesOut } from './basket-mates';
import type { BasketGame, BasketInjury, BasketLeagueGames, BasketTeamLogs, MatchOdds } from './types';
import { SIDE_LABEL, tooFar, verdictOf, type Reliability, type Side } from './value';

export type PickGroup = 'pts' | 'reb' | 'ast' | 'fg3m' | 'combo' | 'def' | 'team';
export const PICK_GROUPS: { value: PickGroup | 'all'; label: string; title?: string }[] = [
  { value: 'all', label: 'Todo' }, { value: 'pts', label: 'Puntos' }, { value: 'reb', label: 'Rebotes' }, { value: 'ast', label: 'Asistencias' }, { value: 'fg3m', label: 'Triples' },
  { value: 'combo', label: 'Combinados', title: 'Pts + Reb + Ast y parecidos' }, { value: 'def', label: 'Defensa', title: 'Robos, tapones y pérdidas' }, { value: 'team', label: 'Equipos', title: 'Totales y puntos de cada equipo' }
];
const GROUP_OF: Record<string, PickGroup> = { pts: 'pts', reb: 'reb', ast: 'ast', fg3m: 'fg3m', pra: 'combo', pr: 'combo', pa: 'combo', ra: 'combo', stl: 'def', blk: 'def', sb: 'def', tov: 'def' };

export interface BasketPick {
  id: string; kind: 'player' | 'team'; game: BasketGame; group: PickGroup; side: Side; line: number;
  title: string; // cómo se lee la apuesta: "Jokić: más de 9,5 asistencias"
  market: string; selection: string; // lo que se apunta en el cupón
  who: { id: string; name: string; headshot?: string; teamId: string } | null; marketKey: BasketMarket | null; // para abrir su análisis
  period: PointPeriod | null; pointKind: PointKind | null; // para abrir los puntos del partido
  book?: string; price: number; p: number; pModel: number; pMarket: number | null; fair: number; ev: number; rel: Reliability;
  why: string; injury: string | null;
}

const MIN_PLAYED = 3, MIN_MINUTES = 15; // los mismos filtros del escáner
const MIN_PRICE = 1.2; // por debajo se arriesga mucho para ganar casi nada
const MAX_PRICE = 15;
const MIN_REL = 40, MIN_EV = -0.12;
const dec = (v: number) => v.toFixed(1).replace('.', ',');
const sur = (name: string) => name.split(' ').slice(1).join(' ') || name;
const word = (s: Side) => SIDE_LABEL[s].toLowerCase();

// Las líneas de jugador de un equipo que tienen las casas, a los dos lados
export function playerPicks(game: BasketGame, side: 'home' | 'away', data: BasketTeamLogs, odds: MatchOdds, injuries: BasketInjury[]): BasketPick[] {
  const team = game[side], opp = game[side === 'home' ? 'away' : 'home'];
  const missed = missedByPlayer(data);
  const sched = teamGamesOf(data, team.id); // calendario de su equipo: el mismo contexto (B2B, vuelta de baja) que el analizador
  // Compañeros importantes de baja desde hace poco: bajan la fiabilidad de los "menos" de los demás
  const statusOf = (id: string, roster: string | null | undefined) => (game.league === 'nba' ? injuries.find(x => x.playerId === id)?.status : null) || roster;
  const fresh = freshKeyOuts(matesOut(data, team.id, '', game.date, statusOf, game.league === 'wnba' ? 40 : 48));
  const out: BasketPick[] = [];
  for (const p of data.players) {
    const lines = playerLines(odds, p.name);
    if (!Object.keys(lines).length) continue;
    const injury = statusOf(p.id, p.injury) ?? null;
    if (playerOut(injury, missed.get(p.id) ?? 0)) continue;
    const mates = fresh.filter(m => m.id !== p.id).map(m => m.name);
    const ctx = { currentSeason: data.currentSeason, home: side === 'home', opp: opp.abbr, injury, matesOut: mates, ...gameCtx(p.games, sched, game.date, team.id) };
    for (const k of Object.keys(BASKET_MARKETS) as BasketMarket[]) {
      const M = BASKET_MARKETS[k];
      for (const l of lines[M.label] ?? []) {
        for (const s of ['over', 'under'] as Side[]) {
          // Lo que nunca se va a recomendar no se calcula: una jornada son miles de líneas y esto corre en el móvil
          if ((s === 'over' ? l.over ?? 0 : l.under ?? 0) < MIN_PRICE) continue;
          const r = scanLine(p.games, k, l.line, s, ctx, { over: l.over, under: l.under, books: Object.values(l.books) });
          const v = r?.value;
          if (!r || !v || r.played < MIN_PLAYED || r.projMin < MIN_MINUTES) continue;
          out.push({
            id: `${game.id}:${p.id}:${k}:${l.line}:${s}`, kind: 'player', game, group: GROUP_OF[k], side: s, line: l.line,
            title: `${sur(p.name)}: ${word(s)} de ${fmtLine(l.line)} ${M.label.toLowerCase()}`,
            market: `${M.label} · ${p.name}`, selection: `${SIDE_LABEL[s]} de ${l.line}`,
            who: { id: p.id, name: p.name, headshot: p.headshot, teamId: team.id }, marketKey: k, period: null, pointKind: null,
            book: s === 'over' ? l.overBook : l.underBook, price: v.price, p: v.p, pModel: v.pModel, pMarket: v.gap == null ? null : v.pModel - v.gap, fair: (1 - r.push) / v.p, ev: v.ev, rel: r.rel,
            why: `Proyecta ${dec(r.mu)} · ${r.last10.won}/${r.last10.n} últimos · ${Math.round(r.projMin)} min`, injury
          });
        }
      }
    }
  }
  return out;
}

// Totales y puntos de cada equipo, del partido, las mitades y los cuartos
export function teamPicks(game: BasketGame, d: BasketLeagueGames, odds: MatchOdds): BasketPick[] {
  const out: BasketPick[] = [];
  for (const per of POINT_PERIODS) {
    const P = projectGame(d, game.away.id, game.home.id, per.id, game.date);
    if (!P) continue;
    const pre = per.id === 'game' ? '' : `${per.label}: `;
    for (const kind of ['total', 'away', 'home'] as PointKind[]) {
      const name = kind === 'total' ? 'Total' : game[kind].abbr;
      for (const l of pointLines(odds, kind, per.id)) {
        const A = analyzePoints(P, kind, l.line, l);
        for (const v of A.sides) {
          const market = `${per.id === 'game' ? '' : `${per.label} · `}${kind === 'total' ? 'Total de puntos' : `Puntos de ${name}`}`;
          out.push({
            id: `${game.id}:${per.id}:${kind}:${l.line}:${v.side}`, kind: 'team', game, group: 'team', side: v.side, line: l.line,
            title: `${pre}${name}, ${word(v.side)} de ${fmtLine(l.line)} puntos`, market, selection: `${SIDE_LABEL[v.side]} de ${l.line}`,
            who: null, marketKey: null, period: per.id, pointKind: kind,
            book: v.book, price: v.price, p: v.p, pModel: v.pModel, pMarket: v.gap == null ? null : v.pModel - v.gap, fair: (1 - A.pPush) / v.p, ev: v.ev, rel: A.rel,
            why: `Proyecta ${dec(A.mu)} (entre ${Math.round(A.mu - 1.2816 * A.sd)} y ${Math.round(A.mu + 1.2816 * A.sd)})`, injury: null
          });
        }
      }
    }
  }
  return out;
}

// Lo que no se recomienda nunca: una discrepancia enorme con la casa suele ser un error del modelo, no una oportunidad
export const saneLine = (x: BasketPick) => x.price >= MIN_PRICE && x.price <= MAX_PRICE && x.rel.score >= MIN_REL && x.ev >= MIN_EV && (x.pMarket == null || !tooFar(x.pModel, x.pMarket));

// Sólo se llama valor a lo que lo tiene y además tiene detrás un cálculo fiable (lo mismo que en tenis)
export const hasValue = (x: BasketPick) => verdictOf(x.ev, x.rel.score) === 'BET';
// El mismo veredicto que el análisis del jugador (value.ts): Apostar, Valor ligero o No apostar
export const pickVerdict = (x: BasketPick) => verdictOf(x.ev, x.rel.score);

export interface PickFilters { group: PickGroup | 'all'; side: Side | 'all'; line: number | null; minOdds: number; onlyValue: boolean }

const score = (x: BasketPick) => x.ev + 0.1 * (x.rel.score / 100) + 0.1 * x.p;
// Para destacar una: que salga rentable y sea de fiar. Robos y tapones son lo que peor calibra el modelo (docs/specs/08-baloncesto.md):
// salen en las listas, pero no como la mejor opción salvo que se pidan
// Lo que el análisis llamaría «No apostar» no se destaca nunca
const worthTop = (x: BasketPick, group?: PickGroup | 'all') => pickVerdict(x) !== 'PASS' && x.p >= 0.3 && (x.group !== 'def' || group === 'def');
const ownerOf = (x: BasketPick) => x.who?.id ?? `${x.game.id}:${x.period}:${x.pointKind}`;

// Dos líneas del mismo mercado de un jugador no son dos ideas distintas, ni cinco apuestas del mismo jugador son cinco opciones
function diversify(list: BasketPick[], perOwner = 2) {
  const markets = new Set<string>(), owners = new Map<string, number>();
  return list.filter(x => {
    const owner = ownerOf(x), market = `${owner}|${x.marketKey}`, n = owners.get(owner) ?? 0;
    if (markets.has(market) || n >= perOwner) return false;
    markets.add(market); owners.set(owner, n + 1);
    return true;
  });
}

const EASY = 0.58, MID = 0.42, HARD = 0.15;
export function arrangePicks(all: BasketPick[], f: PickFilters) {
  const shown = all.filter(x => x.price >= f.minOdds && (f.group === 'all' || x.group === f.group) && (f.side === 'all' || x.side === f.side) && (f.line == null || x.line === f.line) && (!f.onlyValue || hasValue(x)));
  // Si ninguna sale rentable se dice, en vez de presentar como buena la que menos pierde
  const top = shown.filter(x => worthTop(x, f.group)).sort((a, b) => score(b) - score(a))[0] ?? null;
  const rest = shown.filter(x => x !== top).sort((a, b) => b.ev - a.ev || b.p - a.p);
  return {
    top,
    easy: diversify(rest.filter(x => x.p >= EASY)),
    mid: diversify(rest.filter(x => x.p >= MID && x.p < EASY)),
    hard: diversify(rest.filter(x => x.p >= HARD && x.p < MID)),
    count: shown.length, withValue: shown.filter(hasValue).length, bestEv: shown.length ? Math.max(...shown.map(x => x.ev)) : null
  };
}

// Las mejores de todos los partidos, para la banda de la lista: sólo las que salen rentables y sin repetir jugador
export const bestPicks = (all: BasketPick[], minOdds: number, n: number) =>
  diversify(all.filter(x => x.price >= minOdds && worthTop(x)).sort((a, b) => score(b) - score(a)), 1).slice(0, n);
