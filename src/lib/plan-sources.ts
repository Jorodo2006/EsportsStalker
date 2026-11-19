import type { BasketLeagueId, FootballLineRow, MmaLineRow, TennisBoard, TennisPick } from '@/lib/types';
import type { BasketPick } from '@/lib/basket-picks';
import type { PlanPick, PlanSport } from '@/lib/plan';

// Adaptadores: pasan todas las líneas calculadas de cada deporte (no sólo la más fiable de cada partido) a la forma común del
// plan. Con todas, el plan puede buscar la mejor combinada o sencilla para la cuota pedida, no sólo juntar las de cuota baja

const HALF_DAY = 12 * 3600_000;

// Días (hora de España, AAAA-MM-DD) que hay que pedir a los servicios para cubrir las próximas 48 h. Sin repetir y en orden.
// Se mira cada 12 h: con saltos de 24 h, el día de 23 h del cambio de hora de octubre podía quedarse sin pedir
export function windowDays(now: number): string[] {
  const fmt = (t: number) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  return [...new Set([0, 1, 2, 3, 4].map(i => fmt(now + i * HALF_DAY)))];
}

interface Row { matchId: string; start: string; event: string; league: string; pick: TennisPick }

function adapt(sport: PlanSport, rows: Row[]): PlanPick[] {
  const out = new Map<string, PlanPick>();
  for (const { matchId, start, event, league, pick: pk } of rows) {
    const id = `${sport}:${matchId}:${pk.id}`;
    if (out.has(id)) continue;
    out.set(id, {
      id, sport, match: `${sport}:${matchId}`, event, league, title: pk.title, start, book: pk.book,
      price: pk.price, p: pk.p, ev: pk.ev, rel: pk.rel.score
    });
  }
  return [...out.values()];
}

export const fromTennisBoard = (board: TennisBoard): PlanPick[] =>
  adapt('tennis', board.matches.flatMap(x => x.picks.map(pick => ({
    matchId: x.m.id, start: x.m.date, event: `${x.m.a.name} vs ${x.m.b.name}`, league: x.m.tournament, pick
  }))));

export const fromFootballLines = (rows: FootballLineRow[]): PlanPick[] =>
  adapt('football', rows.map(r => ({ matchId: r.id, start: r.date, event: `${r.home.name} vs ${r.away.name}`, league: r.leagueName, pick: r.pick })));

export const fromMmaLines = (rows: MmaLineRow[]): PlanPick[] =>
  adapt('mma', rows.map(r => ({ matchId: r.id, start: r.date, event: `${r.a.name} vs ${r.b.name}`, league: r.orgName, pick: r.pick })));

const BASKET_LEAGUE: Record<BasketLeagueId, string> = { nba: 'NBA', wnba: 'WNBA', euroleague: 'Euroliga', eurocup: 'EuroCup', nbl: 'NBL' };

// Baloncesto: las recomendaciones que calcula el navegador (useBasketPicks), jugadores y puntos de equipo
export function fromBasket(picks: BasketPick[]): PlanPick[] {
  const out = new Map<string, PlanPick>();
  for (const pk of picks) {
    const g = pk.game;
    const id = `basket:${g.id}:${pk.id}`;
    if (out.has(id)) continue;
    out.set(id, {
      id, sport: 'basket', match: `basket:${g.id}`, event: `${g.away.name} @ ${g.home.name}`, league: BASKET_LEAGUE[g.league] ?? g.league,
      title: pk.title, start: g.date, book: pk.book ?? '', price: pk.price, p: pk.p, ev: pk.ev, rel: pk.rel.score
    });
  }
  return [...out.values()];
}
