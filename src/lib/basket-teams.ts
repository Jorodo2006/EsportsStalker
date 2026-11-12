// Puntos de los equipos de baloncesto: medias por tramo, tabla de la liga y proyección del total y de los puntos de cada
// equipo de un partido, con la probabilidad de cualquier línea y el valor frente a la cuota (funciones comunes de value.ts).
import { wmean, wvar } from './basket-model';
import type { BasketLeagueGames, BasketPointSide, MatchOdds } from './types';
import { devig, devigBooks, lineProbs, relCommon, reliability, sideValue, verdict, type SideValue, type ValueData } from './value';

export type PointPeriod = 'game' | 'h1' | 'h2' | 'q1' | 'q2' | 'q3' | 'q4';
// odds: el número de ese tramo en las claves de las cuotas (server/services/odds/odds.js)
export const POINT_PERIODS: { id: PointPeriod; label: string; odds: number }[] = [
  { id: 'game', label: 'Partido', odds: 0 }, { id: 'h1', label: '1.ª mitad', odds: 1 }, { id: 'h2', label: '2.ª mitad', odds: 2 },
  { id: 'q1', label: '1.er cuarto', odds: 11 }, { id: 'q2', label: '2.º cuarto', odds: 12 }, { id: 'q3', label: '3.er cuarto', odds: 13 }, { id: 'q4', label: '4.º cuarto', odds: 14 }
];

// La prórroga cuenta en el partido y en la 2.ª mitad, no en el 4.º cuarto
function partOf(s: BasketPointSide, p: PointPeriod): number | null {
  if (p === 'game') return s.pts;
  if (s.q.length < 4) return null;
  if (p === 'h1') return s.q[0] + s.q[1];
  if (p === 'h2') return s.q.slice(2).reduce((a, b) => a + b, 0);
  return s.q[Number(p[1]) - 1];
}

// ---------- los partidos de un equipo ----------
export interface TeamRow {
  id: string; date: string; season: number; type: 'reg' | 'post'; home: boolean; oppId: string; opp: string; oppName: string; oppLogo: string;
  us: number; them: number; total: number; won: boolean;
}

// De más reciente a más antiguo. before: sólo lo anterior a esa fecha (para no contar el propio partido)
export function teamRows(d: BasketLeagueGames, teamId: string, period: PointPeriod = 'game', before?: string): TeamRow[] {
  const limit = before ? Date.parse(before) : Infinity;
  const out: TeamRow[] = [];
  for (const g of d.games) {
    const home = g.home.id === teamId;
    if (!home && g.away.id !== teamId) continue;
    if (Date.parse(g.date) >= limit) continue;
    const me = home ? g.home : g.away, opp = home ? g.away : g.home;
    const us = partOf(me, period), them = partOf(opp, period);
    if (us == null || them == null) continue;
    const t = d.teams[opp.id];
    out.push({ id: g.id, date: g.date, season: g.season, type: g.type, home, oppId: opp.id, opp: t?.abbr ?? '?', oppName: t?.name ?? '', oppLogo: t?.logo ?? '', us, them, total: us + them, won: me.pts > opp.pts });
  }
  return out;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export interface PointSplit { label: string; rows: TeamRow[]; n: number; us: number | null; them: number | null; total: number | null; diff: number | null; win: number | null; maxTotal: number | null; minTotal: number | null }
function split(label: string, rows: TeamRow[]): PointSplit {
  const totals = rows.map(r => r.total);
  return {
    label, rows, n: rows.length, us: mean(rows.map(r => r.us)), them: mean(rows.map(r => r.them)), total: mean(totals), diff: mean(rows.map(r => r.us - r.them)),
    win: mean(rows.map(r => (r.won ? 1 : 0))), maxTotal: rows.length ? Math.max(...totals) : null, minTotal: rows.length ? Math.min(...totals) : null
  };
}

export function pointSplits(rows: TeamRow[], currentSeason: number): PointSplit[] {
  const cur = rows.filter(r => r.season === currentSeason);
  return [
    split('Esta temporada', cur), split('En casa', cur.filter(r => r.home)), split('Fuera', cur.filter(r => !r.home)),
    split('Últimos 5', rows.slice(0, 5)), split('Últimos 10', rows.slice(0, 10)), split('Últimos 20', rows.slice(0, 20)),
    split('Temporada pasada', rows.filter(r => r.season === currentSeason - 1))
  ];
}

// Media de cada cuarto y mitad en la temporada, anotados y encajados. Sin partidos todavía, la anterior.
export function periodAverages(d: BasketLeagueGames, teamId: string) {
  return POINT_PERIODS.filter(p => p.id !== 'game').map(p => {
    const all = teamRows(d, teamId, p.id);
    const cur = all.filter(r => r.season === d.currentSeason);
    const rows = cur.length ? cur : all.filter(r => r.season === d.currentSeason - 1);
    return { id: p.id, label: p.label, n: rows.length, us: mean(rows.map(r => r.us)), them: mean(rows.map(r => r.them)), total: mean(rows.map(r => r.total)) };
  });
}

// Frecuencia con la que el valor superó la línea
export const overRate = (values: number[], line: number) => (values.length ? values.filter(v => v > line).length / values.length : null);

// ---------- tabla de la liga ----------
export type TableWindow = 'season' | 'home' | 'away' | 'last10' | 'last5';
export const TABLE_WINDOWS: { id: TableWindow; label: string }[] = [
  { id: 'season', label: 'Temporada' }, { id: 'home', label: 'En casa' }, { id: 'away', label: 'Fuera' }, { id: 'last10', label: 'Últimos 10' }, { id: 'last5', label: 'Últimos 5' }
];
export interface TableRow extends PointSplit { id: string; abbr: string; name: string; logo: string; overTotal: number | null; overTeam: number | null }

export function leagueTable(d: BasketLeagueGames, win: TableWindow, period: PointPeriod, lineTotal: number | null, lineTeam: number | null): TableRow[] {
  const ids = new Set(d.games.filter(g => g.season === d.currentSeason).flatMap(g => [g.home.id, g.away.id]));
  return [...ids].flatMap(id => {
    const t = d.teams[id];
    if (!t) return [];
    const all = teamRows(d, id, period), cur = all.filter(r => r.season === d.currentSeason);
    const rows = win === 'home' ? cur.filter(r => r.home) : win === 'away' ? cur.filter(r => !r.home) : win === 'last10' ? all.slice(0, 10) : win === 'last5' ? all.slice(0, 5) : cur;
    return [{
      ...split(t.name, rows), id, abbr: t.abbr, name: t.name, logo: t.logo,
      overTotal: lineTotal == null ? null : overRate(rows.map(r => r.total), lineTotal),
      overTeam: lineTeam == null ? null : overRate(rows.map(r => r.us), lineTeam)
    }];
  });
}

// ---------- proyección de un partido ----------
// Vida media de los partidos, peso de esta temporada, cuántos partidos «vale» el modelo frente a la frecuencia histórica,
// corrección de la dispersión y cuánto se cree lo que un equipo se aparta de la media (con pocos partidos, buena parte es ruido).
// Ajustados con la NBA 24-25 y evaluados con 25-26 y 26-27 (docs/specs/08-baloncesto.md). El peso de esta temporada no se pudo
// ajustar (24-25 no tenía temporada anterior en la muestra): es el mismo del modelo de jugadores.
export const POINT_PARAMS = { halfLife: 15, thisSeason: 1.6, modelWeight: 80, sdScale: 0.9, effect: 0.8 };
// A partir de qué ventaja sobre la casa el modelo deja de ser creíble: sabe menos que ella (bajas, descanso, alineaciones)
const TOO_FAR = 0.12;
// Peso del modelo frente a la casa al calcular el valor: un total se ajusta mucho más que una línea de jugador. Es una
// decisión, no una medida (no hay cuotas históricas)
const MODEL_WEIGHT = 0.25;

function sample(rows: TeamRow[], season: number) {
  const pool = rows.slice(0, 60);
  const weights = pool.map((r, i) => Math.pow(0.5, i / POINT_PARAMS.halfLife) * (r.season === season ? POINT_PARAMS.thisSeason : 1) * (r.type === 'post' ? 0.85 : 1));
  const W = weights.reduce((s, w) => s + w, 0), W2 = weights.reduce((s, w) => s + w * w, 0);
  return { pool, weights, neff: W2 ? (W * W) / W2 : 0, cur: pool.filter(r => r.season === season).length };
}
type Sample = ReturnType<typeof sample>;

// Media de la liga y ventaja de jugar en casa, con los últimos 300 partidos de ese tramo. Sin playoffs: se anota menos y, al
// restarla al principio de temporada, inflaría las proyecciones
function leagueBase(d: BasketLeagueGames, period: PointPeriod, before?: string) {
  const limit = before ? Date.parse(before) : Infinity;
  let n = 0, home = 0, away = 0;
  for (const g of d.games) {
    if (Date.parse(g.date) >= limit || g.type === 'post') continue;
    const h = partOf(g.home, period), a = partOf(g.away, period);
    if (h == null || a == null) continue;
    home += h; away += a;
    if (++n >= 300) break;
  }
  return n ? { avg: (home + away) / (2 * n), hca: (home - away) / n } : null;
}

export type PointKind = 'total' | 'away' | 'home';
export interface PointProjection {
  period: PointPeriod; lgAvg: number; hca: number;
  away: { mu: number; sd: number }; home: { mu: number; sd: number }; total: { mu: number; sd: number };
  a: Sample; b: Sample; rowsAway: TeamRow[]; rowsHome: TeamRow[];
}

const widen = (variance: number, neff: number) => POINT_PARAMS.sdScale * Math.sqrt(variance * (1 + 2 / Math.max(neff, 1)));

// La media de la liga más lo que el equipo anota por encima de ella y lo que el rival encaja por encima de ella, y la ventaja de
// jugar en casa a medias entre los dos. Devuelve null si alguno no tiene partidos.
export function projectGame(d: BasketLeagueGames, awayId: string, homeId: string, period: PointPeriod = 'game', before?: string, season = d.currentSeason): PointProjection | null {
  const base = leagueBase(d, period, before);
  const rowsAway = teamRows(d, awayId, period, before), rowsHome = teamRows(d, homeId, period, before);
  if (!base || !rowsAway.length || !rowsHome.length) return null;
  const a = sample(rowsAway, season), b = sample(rowsHome, season);
  const usA = a.pool.map(r => r.us), themA = a.pool.map(r => r.them), usB = b.pool.map(r => r.us), themB = b.pool.map(r => r.them);
  const pull = POINT_PARAMS.effect;
  const muA = base.avg + pull * (wmean(usA, a.weights) - base.avg) + pull * (wmean(themB, b.weights) - base.avg) - base.hca / 2;
  const muB = base.avg + pull * (wmean(usB, b.weights) - base.avg) + pull * (wmean(themA, a.weights) - base.avg) + base.hca / 2;
  const neff = Math.min(a.neff, b.neff);
  const sdOf = (x: number[], wx: number[], y: number[], wy: number[]) => widen((wvar(x, wx) + wvar(y, wy)) / 2, neff);
  return {
    period, lgAvg: base.avg, hca: base.hca, a, b, rowsAway, rowsHome,
    away: { mu: muA, sd: sdOf(usA, a.weights, themB, b.weights) },
    home: { mu: muB, sd: sdOf(usB, b.weights, themA, a.weights) },
    total: { mu: muA + muB, sd: sdOf(a.pool.map(r => r.total), a.weights, b.pool.map(r => r.total), b.weights) }
  };
}

// Qué mirar de cada equipo según el mercado: en los puntos de uno, lo que anota él y lo que encaja su rival
export function pointValues(kind: PointKind) {
  if (kind === 'total') return { a: (r: TeamRow) => r.total, b: (r: TeamRow) => r.total };
  return kind === 'away' ? { a: (r: TeamRow) => r.us, b: (r: TeamRow) => r.them } : { a: (r: TeamRow) => r.them, b: (r: TeamRow) => r.us };
}

export interface PointAnalysis extends ValueData { mu: number; sd: number; modelOver: number; histOver: number }

export function analyzePoints(P: PointProjection, kind: PointKind, line: number, odds: { over?: number | null; under?: number | null; overBook?: string; underBook?: string; books?: { over?: number | null; under?: number | null }[] } = {}): PointAnalysis {
  const { mu, sd } = P[kind];
  const model = lineProbs(mu, sd, line);
  const f = pointValues(kind);
  const rows = [...P.a.pool.map((r, i) => ({ v: f.a(r), w: P.a.weights[i] })), ...P.b.pool.map((r, i) => ({ v: f.b(r), w: P.b.weights[i] }))];
  const W = rows.reduce((s, r) => s + r.w, 0) || 1;
  const histOver = rows.reduce((s, r) => s + (r.v > line ? r.w : 0), 0) / W, histUnder = rows.reduce((s, r) => s + (r.v < line ? r.w : 0), 0) / W;
  const neff = P.a.neff + P.b.neff;
  // La frecuencia no sabe contra quién juega: pesa menos que en las líneas de jugador
  const K = POINT_PARAMS.modelWeight;
  let pOver = (neff * histOver + K * model.over) / (neff + K);
  let pUnder = (neff * histUnder + K * model.under) / (neff + K);
  const pPush = model.push, norm = (pOver + pUnder) / Math.max(1e-9, 1 - pPush);
  pOver = Math.min(0.98, Math.max(0.02, pOver / norm));
  pUnder = Math.min(0.98, Math.max(0.02, pUnder / norm));

  const mk = odds.books?.length ? devigBooks(odds.books) : devig(odds.over, odds.under);
  const sides: SideValue[] = [];
  if (odds.over && odds.over > 1) sides.push(sideValue('over', pOver, pPush, odds.over, mk.over, odds.overBook, MODEL_WEIGHT));
  if (odds.under && odds.under > 1) sides.push(sideValue('under', pUnder, pPush, odds.under, mk.under, odds.underBook, MODEL_WEIGHT));
  const cur = Math.min(P.a.cur, P.b.cur), all = Math.min(P.a.pool.length, P.b.pool.length);
  const gap = Math.max(0, ...sides.map(s => Math.abs(s.gap ?? 0)));
  const rel = reliability([
    { label: 'Muestra esta temporada', value01: cur / 15, max: 30, note: `${cur} partido${cur === 1 ? '' : 's'} del equipo con menos` },
    { label: 'Historial total', value01: all / 40, max: 15, note: `${all} partidos analizados del equipo con menos` },
    relCommon.distance(mu, sd, line),
    relCommon.agreement(model.over, histOver)
  ], gap >= TOO_FAR ? [{ pts: 25, warning: `El modelo se aleja mucho de la casa (${Math.round(gap * 100)} puntos de probabilidad): lo normal es que ella sepa algo que él no` }] : []);
  return {
    line, pOver, pUnder, pPush, fairOver: (1 - pPush) / pOver, fairUnder: (1 - pPush) / pUnder, margin: mk.margin, exact: mk.exact, sides, rel,
    verdict: verdict(sides, rel.score, line, pOver >= pUnder ? 'over' : 'under'), mu, sd, modelOver: model.over, histOver
  };
}

// ---------- líneas de las casas ----------
export interface BookLine { line: number; over?: number; under?: number; overBook?: string; underBook?: string; books?: { over?: number; under?: number }[] }

export function pointLines(odds: MatchOdds | undefined, kind: PointKind, period: PointPeriod): BookLine[] {
  const n = POINT_PERIODS.find(p => p.id === period)!.odds;
  const prefix = kind === 'total' ? `total|${n}||` : `team_total|${n}|${kind === 'away' ? 'a' : 'b'}|`;
  const best = (prices: Record<string, number> | undefined) => Object.entries(prices ?? {}).sort((x, y) => y[1] - x[1])[0] ?? [];
  return (odds?.markets ?? []).filter(m => m.key.startsWith(prefix) && m.line != null).map(m => {
    const po = m.outcomes.find(o => o.id === 'over')?.prices ?? {}, pu = m.outcomes.find(o => o.id === 'under')?.prices ?? {};
    const [overBook, over] = best(po);
    const [underBook, under] = best(pu);
    // Las dos cuotas de cada casa, para quitarle a cada una su margen (devigBooks)
    const books = [...new Set([...Object.keys(po), ...Object.keys(pu)])].map(b => ({ over: po[b], under: pu[b] }));
    return { line: m.line!, over, under, overBook, underBook, books };
  }).sort((a, b) => a.line - b.line);
}

// La línea principal de la casa es la más igualada
export const mainLine = (lines: BookLine[]) => lines.slice().sort((x, y) => Math.abs((x.over ?? 9) - (x.under ?? 0)) - Math.abs((y.over ?? 9) - (y.under ?? 0)))[0];
