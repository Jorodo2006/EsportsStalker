// «Sin X»: cuando un habitual no juega (parte de ESPN o una noticia, /api/basket/injuries), qué han hecho sus compañeros esta
// temporada en los partidos que él no jugó, frente a los que sí. Es un dato para enseñar junto a la línea de la casa (la tarjeta
// de BasketPicks.tsx): NO cambia la proyección. Las bajas de compañeros no entran en el modelo porque no se ha medido que lo mejoren
// (docs/specs/08-baloncesto.md), y con 3-6 partidos sin él una media sale alta o baja muchas veces por suerte: por eso cada fila
// lleva cuántos partidos son
import { BASKET_MARKETS, type BasketMarket } from './basket-model';
import type { BasketLogGame, BasketTeamLogs } from './types';

// Cuándo se enseña: el que falta tiene que ser importante (juega la mitad de los partidos del equipo y 20 minutos o más); cada
// compañero, de la rotación (18 minutos o más con él o sin él: los de fondo de banquillo pasan de 0 a 2 puntos y parece mucho), con
// al menos 3 partidos sin él y 3 con él; y el cambio, de un 20 % y de una cantidad que se note
export const WITHOUT = { regularShare: 0.5, minMin: 20, minWithout: 3, minWith: 3, minShift: 0.2, rotationMin: 18 };
export const WITHOUT_STATS: BasketMarket[] = ['pts', 'reb', 'ast', 'fg3m'];
const MIN_DIFF: Record<string, number> = { pts: 2, reb: 1, ast: 1, fg3m: 0.7 };
// Lo que es mucho en cada estadística, para ordenar por cuánto cambia (no en proporción: de 0,4 a 2 triples no es lo que más importa)
const SCALE: Record<string, number> = { pts: 4, reb: 2, ast: 1.5, fg3m: 1 };

export interface WithoutRow {
  playerId: string; name: string; market: BasketMarket;
  withAvg: number; withoutAvg: number; nWith: number; nWithout: number; minWith: number; minWithout: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// Los partidos de liga regular de esta temporada antes del partido (los de otras fases o temporadas cambian demasiado)
const thisSeason = (data: BasketTeamLogs, before: string) => (g: BasketLogGame) => g.season === data.currentSeason && g.type === 'reg' && g.date < before;

// ¿Es importante el que falta? Sus partidos jugados de los del equipo y sus minutos de media
export function keyAbsentee(data: BasketTeamLogs | undefined, playerId: string, before: string): { name: string; games: number; teamGames: number; min: number } | null {
  if (!data) return null;
  const inSeason = thisSeason(data, before);
  const teamGames = new Set(data.players.flatMap(p => p.games.filter(inSeason).map(g => g.id)));
  const me = data.players.find(p => p.id === playerId);
  if (!me || !teamGames.size) return null;
  const played = me.games.filter(g => inSeason(g) && g.min > 0);
  const min = avg(played.map(g => g.min));
  if (played.length < teamGames.size * WITHOUT.regularShare || min < WITHOUT.minMin) return null;
  return { name: me.name, games: played.length, teamGames: teamGames.size, min };
}

// Los compañeros que cambian sin él, del que más al que menos. skip: los que tampoco juegan hoy
export function withoutSplits(data: BasketTeamLogs | undefined, outId: string, before: string, skip: (id: string) => boolean = () => false): WithoutRow[] {
  if (!data) return [];
  const inSeason = thisSeason(data, before);
  const out = data.players.find(p => p.id === outId);
  if (!out) return [];
  const outPlayed = new Set(out.games.filter(g => inSeason(g) && g.min > 0).map(g => g.id));
  const rows: (WithoutRow & { shift: number })[] = [];
  for (const p of data.players) {
    if (p.id === outId || skip(p.id)) continue;
    const games = p.games.filter(g => inSeason(g) && g.min > 0);
    const w = games.filter(g => outPlayed.has(g.id)), wo = games.filter(g => !outPlayed.has(g.id));
    if (wo.length < WITHOUT.minWithout || w.length < WITHOUT.minWith) continue;
    if (Math.max(avg(w.map(g => g.min)), avg(wo.map(g => g.min))) < WITHOUT.rotationMin) continue;
    for (const market of WITHOUT_STATS) {
      const f = BASKET_MARKETS[market].f;
      const a = avg(w.map(f)), b = avg(wo.map(f));
      const diff = b - a;
      if (Math.abs(diff) < MIN_DIFF[market] || Math.abs(diff) < WITHOUT.minShift * Math.max(a, 1)) continue;
      rows.push({
        playerId: p.id, name: p.name, market, withAvg: a, withoutAvg: b, nWith: w.length, nWithout: wo.length,
        minWith: avg(w.map(g => g.min)), minWithout: avg(wo.map(g => g.min)), shift: diff / SCALE[market]
      });
    }
  }
  return rows.sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift)).map(({ shift: _, ...r }) => r);
}
