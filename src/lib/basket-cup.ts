// Cómo reparte los minutos cada entrenador en la NBA Cup frente a la liga, con los partidos de esta temporada de su equipo. Se
// enseña en los partidos de la Cup (BasketCupRotation.tsx) como dato: NO entra en la probabilidad. Medido en toda la NBA con
// scripts/backtest-basket.ts (26-11-2026, dos temporadas): en la fase de grupos las estrellas juegan un 3,6 % más de minutos pero no
// producen más, y el banquillo produce menos que en la liga; un factor para el banquillo mejoraba 26-27 y empeoraba 25-26, así que
// no se usa. En la eliminatoria se acorta la rotación (−17 % de minutos para la rotación y el banquillo), con sólo 9 partidos
import type { BasketTeamLogs } from './types';

export interface CupPlayer { id: string; name: string; league: number; cup: number | null; nCup: number }
export interface CupTeam { cupGames: number; players: CupPlayer[]; top2: number | null; bench: number | null; rotLeague: number; rotCup: number | null }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// teamId: el equipo (los registros traen también los partidos de cada jugador con su equipo anterior); before: el día del partido
// (sólo cuenta lo jugado antes); season: la temporada (de entrada, ésta; la pasada sirve para ver cómo suele rotar ese equipo)
export function cupRotation(data: BasketTeamLogs | undefined, teamId: string, before: string, season = data?.currentSeason ?? 0): CupTeam | null {
  if (!data) return null;
  const inSeason = (g: { season: number; type: string; date: string; teamId: string | null }) => g.season === season && g.type === 'reg' && g.date < before && g.teamId === teamId;
  const cupIds = new Set(data.players.flatMap(p => p.games.filter(g => inSeason(g) && g.cup).map(g => g.id)));
  const leagueIds = new Set(data.players.flatMap(p => p.games.filter(g => inSeason(g) && !g.cup).map(g => g.id)));
  if (!leagueIds.size) return null;
  // Minutos de media en los partidos que jugó, de liga y de Cup: así el cambio es cuánto le da el entrenador cuando lo tiene, no
  // las lesiones (con los partidos que se perdió como 0, quien volvía de baja salía con +10 en la Cup). Cuántos rotan va aparte (rot)
  const players: CupPlayer[] = data.players.map(p => {
    const played = p.games.filter(g => inSeason(g) && g.min > 0);
    const lg = played.filter(g => !g.cup), cp = played.filter(g => g.cup);
    return { id: p.id, name: p.name, league: avg(lg.map(g => g.min)), cup: cp.length ? avg(cp.map(g => g.min)) : null, nCup: cp.length };
  }).filter(p => p.league >= 8 || (p.cup ?? 0) >= 8).sort((a, b) => b.league - a.league);
  const both = (xs: CupPlayer[]) => xs.filter(p => p.cup != null && p.league > 0);
  const delta = (xs: CupPlayer[]) => (cupIds.size && both(xs).length ? avg(both(xs).map(p => p.cup! - p.league)) : null);
  // Jugadores con 10 minutos o más por partido, de media
  const rot = (ids: Set<string>) => avg([...ids].map(id => data.players.filter(p => (p.games.find(g => g.id === id)?.min ?? 0) >= 10).length));
  return {
    cupGames: cupIds.size, players: players.slice(0, 10),
    top2: delta(players.slice(0, 2)), bench: delta(players.filter(p => p.league < 18)),
    rotLeague: rot(leagueIds), rotCup: cupIds.size ? rot(cupIds) : null
  };
}
