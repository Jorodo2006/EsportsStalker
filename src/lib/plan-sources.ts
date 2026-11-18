import type { FootballDayPick, MmaDayPick, TennisDayPick, TennisPick } from '@/lib/types';
import type { PlanPick, PlanSport } from '@/lib/plan';

// Adaptadores: pasan las recomendaciones del día de cada deporte (que comparten la forma de TennisPick) a la forma común del plan

const HALF_DAY = 12 * 3600_000;

// Días (hora de España, AAAA-MM-DD) que hay que pedir a los servicios para cubrir las próximas 48 h. Sin repetir y en orden.
// Se mira cada 12 h: con saltos de 24 h, el día de 23 h del cambio de hora de octubre podía quedarse sin pedir
export function windowDays(now: number): string[] {
  const fmt = (t: number) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  return [...new Set([0, 1, 2, 3, 4].map(i => fmt(now + i * HALF_DAY)))];
}

interface DayItem { id: string; date: string; top: TennisPick; hard: TennisPick | null }

function adapt(sport: PlanSport, list: DayItem[], label: (m: never) => { event: string; league: string }): PlanPick[] {
  const out = new Map<string, PlanPick>();
  for (const m of list) {
    const { event, league } = label(m as never);
    for (const pk of [m.top, m.hard]) {
      if (!pk) continue;
      const id = `${sport}:${m.id}:${pk.id}`;
      if (out.has(id)) continue;
      out.set(id, {
        id, sport, match: `${sport}:${m.id}`, event, league, title: pk.title, start: m.date, book: pk.book,
        price: pk.price, p: pk.p, ev: pk.ev, rel: pk.rel.score
      });
    }
  }
  return [...out.values()];
}

export const fromTennis = (list: TennisDayPick[]): PlanPick[] =>
  adapt('tennis', list, (m: TennisDayPick) => ({ event: `${m.a.name} vs ${m.b.name}`, league: m.tournament }));

export const fromFootball = (list: FootballDayPick[]): PlanPick[] =>
  adapt('football', list, (m: FootballDayPick) => ({ event: `${m.home.name} vs ${m.away.name}`, league: m.leagueName }));

export const fromMma = (list: MmaDayPick[]): PlanPick[] =>
  adapt('mma', list, (m: MmaDayPick) => ({ event: `${m.a.name} vs ${m.b.name}`, league: m.orgName }));
