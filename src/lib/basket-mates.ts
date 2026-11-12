// Bajas de los compañeros: quién falta de los que juegan minutos, si la baja es nueva (sus últimos partidos aún fueron con
// él) o viene de antes, y cómo le fue al jugador las veces que jugó sin él. El modelo no las usa para proyectar (no está
// medido cuánto suben los demás): sirven para avisar y para bajar la fiabilidad de los "menos" cuando la baja es nueva,
// que es cuando la proyección, hecha con partidos en los que él sí jugaba, se puede quedar corta.
// Sale todo de los registros de la plantilla (BasketTeamLogs): un partido del equipo que no está en el registro de un
// compañero es un partido que no jugó.
import type { BasketLogGame, BasketTeamLogs } from './types';
import { BASKET_MARKETS, type BasketMarket } from './basket-model';

export interface MateOut {
  id: string; name: string; status: string;
  min: number; // sus minutos en los últimos 10 partidos con el equipo
  key: boolean; // juega minutos de titular o casi
  streak: number; // partidos seguidos del equipo que lleva sin jugar antes de este (0: jugó el último)
  fresh: boolean; // baja nueva: la proyección del jugador sale de partidos con él
}

// Minutos que hacen falta para contar como importante, por duración del partido (NBA 48, WNBA 40)
const KEY_SHARE = 0.42;
// Hasta cuántos partidos fuera la baja cuenta como nueva: con más, sus últimos partidos ya son sin él
export const FRESH_MAX = 3;
const OUT = /out/i;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const season = (d: string) => { const x = new Date(d); return x.getUTCMonth() >= 8 ? x.getUTCFullYear() + 1 : x.getUTCFullYear(); };

// Partidos del equipo (de cualquier jugador de la plantilla) antes de una fecha, del más reciente al más antiguo
function teamGames(data: BasketTeamLogs, teamId: string, before: number) {
  const seen = new Map<string, number>();
  for (const p of data.players) for (const g of p.games) {
    const t = +new Date(g.date);
    if (g.teamId === teamId && g.type !== 'pre' && t < before) seen.set(g.id, t);
  }
  return [...seen].sort((a, b) => b[1] - a[1]);
}

// statusOf: el estado del parte médico de cada jugador (en la NBA, el de ESPN; si no, el de la plantilla)
export function matesOut(data: BasketTeamLogs | undefined, teamId: string | null | undefined, playerId: string, date: string,
  statusOf: (id: string, rosterStatus: string | null | undefined) => string | null | undefined, gameMinutes = 48): MateOut[] {
  if (!data || !teamId) return [];
  const before = +new Date(date);
  const team = teamGames(data, teamId, before);
  const out: MateOut[] = [];
  for (const p of data.players) {
    if (p.id === playerId) continue;
    const status = statusOf(p.id, p.injury) || '';
    if (!OUT.test(status)) continue;
    const own = p.games.filter(g => g.teamId === teamId && g.type !== 'pre' && +new Date(g.date) < before);
    const min = mean(own.slice(0, 10).map(g => g.min)) ?? 0;
    const last = own[0] ? +new Date(own[0].date) : null;
    // Si esta temporada aún no ha jugado con el equipo, lleva fuera toda la temporada
    const sinceSeason = last != null && season(own[0].date) === season(date);
    const streak = sinceSeason ? team.filter(([, t]) => t > last!).length : team.filter(([, t]) => season(new Date(t).toISOString()) === season(date)).length;
    out.push({ id: p.id, name: p.name, status, min, key: min >= KEY_SHARE * gameMinutes, streak, fresh: sinceSeason && streak <= FRESH_MAX });
  }
  return out.sort((a, b) => b.min - a.min);
}

// Las bajas que hacen dudar de un "menos": nuevas y de jugadores importantes
export const freshKeyOuts = (list: MateOut[]) => list.filter(m => m.key && m.fresh);

export interface WithoutSplit { n: number; avg: number | null; min: number | null; hit: number | null; nWith: number; avgWith: number | null; minWith: number | null; hitWith: number | null }

// El jugador con y sin un compañero, esta temporada y la anterior, sólo en los partidos de este equipo y en las temporadas
// en que los dos estaban en él (si no, "sin él" sería "antes de que llegara")
export function withAndWithout(games: BasketLogGame[], data: BasketTeamLogs | undefined, mateId: string, teamId: string, market: BasketMarket, line: number | null): WithoutSplit | null {
  const mate = data?.players.find(p => p.id === mateId);
  if (!mate) return null;
  const f = BASKET_MARKETS[market].f;
  const his = new Set(mate.games.filter(g => g.teamId === teamId).map(g => g.id));
  const seasons = new Set(mate.games.filter(g => g.teamId === teamId && g.type !== 'pre').map(g => g.season));
  const pool = games.filter(g => g.teamId === teamId && g.type !== 'pre' && seasons.has(g.season));
  const sin = pool.filter(g => !his.has(g.id)), con = pool.filter(g => his.has(g.id));
  const hit = (xs: BasketLogGame[]) => (line == null || !xs.length ? null : xs.filter(g => f(g) > line).length / xs.length);
  return {
    n: sin.length, avg: mean(sin.map(f)), min: mean(sin.map(g => g.min)), hit: hit(sin),
    nWith: con.length, avgWith: mean(con.map(f)), minWith: mean(con.map(g => g.min)), hitWith: hit(con)
  };
}
