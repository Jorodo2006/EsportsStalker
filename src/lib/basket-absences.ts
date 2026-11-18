// Bajas y vueltas en los puntos de un equipo. La proyección de puntos (basket-teams.ts) sale de sus marcadores recientes y no sabe
// quién juega: si falta el que más anota (Curry en GS), proyecta como si estuviera. Aquí se cuenta, para cada jugador de la
// plantilla, cuánto anota y en qué parte de la muestra de la proyección estaba (share, con los mismos pesos). Lo que se aparta de
// la muestra es lo que cambia: si estaba en casi todos y hoy no juega, se pierden sus puntos; si la muestra ya es sin él (baja de
// semanas), no cambia nada; si vuelve tras faltar, suma.
//   delta = Σ puntos por partido × (juega hoy − share)
// Lo que de verdad cambia el marcador es muy poco: los compañeros absorben casi todos los tiros. Medido con
// scripts/backtest-puntos.ts (NBA 25-26 y 26-27, docs/specs/08-baloncesto.md): sólo las bajas grandes de habituales (20 puntos o
// más de su muestra) se notan, unos 1-4 puntos de media, y lo que mejora la proyección en los dos periodos es restar el 5 % de lo
// que falta. Restar en proporción a cualquier baja, o más, la empeoraba con los partidos que no se habían usado para ajustar.
import type { BasketLogGame, BasketTeamLogs } from './types';
import type { PointProjection, TeamRow } from './basket-teams';

// k: parte de los puntos que faltan que se resta; big: desde qué baja (puntos por partido × parte de la muestra); regular: partidos
// de los 10 últimos del equipo esta temporada para contar como habitual
export const ABSENCE = { k: 0.05, big: 20, recent: 10, minPpg: 2, regular: 5 };

// Probabilidad de que juegue según el parte médico (ESPN en la NBA; si no, el estado de la plantilla). Es una decisión: no hay
// partes antiguos con los que medirla
export function playChance(status: string | null | undefined): number {
  const s = String(status || '').toLowerCase();
  if (!s) return 1;
  if (/out|baja|suspend/.test(s)) return 0;
  if (/doubtful|dudoso/.test(s)) return 0.25;
  if (/questionable|duda/.test(s)) return 0.5;
  if (/day-to-day|day to day/.test(s)) return 0.7;
  if (/probable/.test(s)) return 0.9;
  return 1;
}

export interface LineupChange { id: string; name: string; ppg: number; share: number; play: number; delta: number }

type Player = { id: string; name: string; games: Pick<BasketLogGame, 'id' | 'date' | 'teamId' | 'min' | 'pts' | 'type'>[] };

// pool y weights: los partidos y pesos de la muestra de la proyección del equipo (sample en basket-teams.ts). play: probabilidad de
// que cada jugador juegue hoy. before: la fecha del partido (sólo cuenta lo anterior)
export function lineupDelta(players: Player[], teamId: string, pool: { id: string }[], weights: number[], play: (id: string) => number, before: string | number) {
  const limit = typeof before === 'number' ? before : Date.parse(before);
  const W = weights.reduce((s, w) => s + w, 0);
  const index = new Map(pool.map((r, i) => [r.id, i]));
  const changes: LineupChange[] = [];
  if (!W) return { delta: 0, changes };
  for (const p of players) {
    const own = p.games.filter(g => g.teamId === teamId && g.type !== 'pre' && g.min > 0 && Date.parse(g.date) < limit)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    if (!own.length) continue;
    const recent = own.slice(0, ABSENCE.recent);
    const ppg = recent.reduce((s, g) => s + g.pts, 0) / recent.length;
    if (ppg < ABSENCE.minPpg) continue;
    let inPool = 0;
    for (const g of own) { const i = index.get(g.id); if (i != null) inPool += weights[i]; }
    const share = inPool / W, now = play(p.id), delta = ppg * (now - share);
    if (Math.abs(delta) >= 0.5) changes.push({ id: p.id, name: p.name, ppg, share, play: now, delta });
  }
  changes.sort((a, b) => a.delta - b.delta);
  return { delta: changes.reduce((s, c) => s + c.delta, 0), changes };
}

// ---------- Para un partido por jugar ----------
export interface TeamOuts { delta: number; shift: number; big: boolean; outs: LineupChange[] }
export const NO_OUTS: TeamOuts = { delta: 0, shift: 0, big: false, outs: [] };

// Bajas de habituales de un equipo (lo mismo que mide el backtest): jugadores que han jugado al menos 5 de los 10 últimos partidos
// del equipo esta temporada y que el parte da como baja o en duda. sample: la muestra de la proyección de ese equipo (P.a o P.b).
// statusOf: el estado de cada jugador (en la NBA, el parte de ESPN; si no, el de la plantilla)
export function teamOuts(data: BasketTeamLogs | undefined, teamId: string, sample: { pool: TeamRow[]; weights: number[] }, before: string,
  statusOf: (id: string, roster: string | null | undefined) => string | null | undefined): TeamOuts {
  if (!data?.players.length) return NO_OUTS;
  const last = sample.pool.filter(r => r.season === data.currentSeason).slice(0, 10).map(r => r.id);
  if (last.length < ABSENCE.regular) return NO_OUTS;
  const regular = new Set(data.players.filter(p => last.filter(id => p.games.some(g => g.id === id && g.min > 0)).length >= ABSENCE.regular).map(p => p.id));
  const status = new Map(data.players.map(p => [p.id, statusOf(p.id, p.injury)]));
  const res = lineupDelta(data.players, teamId, sample.pool, sample.weights, id => playChance(status.get(id)), before);
  // Sólo lo que resta: un jugador en duda que apenas estaba en la muestra (lleva semanas fuera) sumaría como si volviera
  const outs = res.changes.filter(c => c.play < 1 && c.delta < 0 && regular.has(c.id));
  const delta = outs.reduce((s, c) => s + c.delta, 0);
  const big = delta <= -ABSENCE.big;
  return { delta, shift: big ? ABSENCE.k * delta : 0, big, outs };
}

// La proyección con las bajas: el partido entero lo medido; una mitad, la mitad; un cuarto, la cuarta parte
export function withOuts(P: PointProjection, away: TeamOuts, home: TeamOuts): PointProjection {
  if (!away.shift && !home.shift) return P;
  const f = P.period === 'game' ? 1 : P.period.startsWith('h') ? 0.5 : 0.25;
  const a = f * away.shift, b = f * home.shift;
  return { ...P, away: { ...P.away, mu: P.away.mu + a }, home: { ...P.home, mu: P.home.mu + b }, total: { ...P.total, mu: P.total.mu + a + b } };
}

// "Stephen Curry (27,3)" de las bajas más importantes
const dec1 = (v: number) => v.toFixed(1).replace('.', ',');
export const outsText = (o: TeamOuts, n = 3) => o.outs.slice(0, n).map(c => `${c.name}${c.play > 0 ? ' (duda)' : ''} (${dec1(c.ppg)})`).join(', ');
