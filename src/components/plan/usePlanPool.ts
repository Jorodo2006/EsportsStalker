import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { PlanPick, PlanSport } from '@/lib/plan';
import { fromBasket, fromFootballLines, fromMmaLines, fromTennisBoard, windowDays } from '@/lib/plan-sources';
import { useBasketPicks } from '@/components/BasketPicks';

export type SportState = { loading: boolean; error: string | null; off: boolean };
const SERVER: PlanSport[] = ['tennis', 'football', 'mma'];
const HOUR = 3600_000;

// Todas las líneas calculadas de tenis, fútbol, MMA y baloncesto de hoy, mañana y pasado (hora de España), en la forma común del
// plan. Sólo se lee lo que ya hay guardado: no se lanzan lecturas de cuotas. Sólo se piden los deportes elegidos; el baloncesto,
// que se calcula en el navegador con los partidos de cada jugador, es lo que más pesa
export function usePlanPool(chosen: PlanSport[]): { pool: PlanPick[]; sports: Record<PlanSport, SportState>; updatedAt: number | null } {
  // Los días se fijan al abrir la pantalla; recalcular cada render cambiaría las claves de consulta a medianoche a mitad de uso
  const [days] = useState(() => windowDays(Date.now()));
  const [now] = useState(() => Date.now());
  const on = (s: PlanSport) => chosen.includes(s);
  const jobs = SERVER.flatMap(sport => days.map(day => ({ sport, day })));
  const results = useQueries({
    queries: jobs.map(({ sport, day }) => ({
      queryKey: ['plan', sport, day],
      queryFn: async (): Promise<PlanPick[]> => {
        if (sport === 'tennis') return fromTennisBoard(await window.api.tennis.picksBoard(day));
        if (sport === 'football') return fromFootballLines(await window.api.football.picksLines(day));
        return fromMmaLines(await window.api.mma.picksLines(day));
      },
      enabled: on(sport), staleTime: 3 * 60_000, retry: false, refetchOnWindowFocus: false
    }))
  });

  // Baloncesto: los partidos por empezar de las próximas 48 h y el mismo cálculo que su pantalla de recomendaciones
  const basketOn = on('basket');
  const gamesQ = useQueries({
    queries: days.map(day => ({ queryKey: ['basket', 'games', day], queryFn: () => window.api.basket.games(day), enabled: basketOn, staleTime: 60_000 }))
  });
  const injuriesQ = useQuery({ queryKey: ['basket', 'injuries'], queryFn: () => window.api.basket.injuries(), enabled: basketOn, staleTime: 10 * 60_000 });
  const gamesKey = gamesQ.map(q => q.dataUpdatedAt).join();
  const games = useMemo(() => {
    if (!basketOn) return [];
    const seen = new Set<string>();
    return gamesQ.flatMap(q => q.data ?? []).filter(g => {
      const t = Date.parse(g.date);
      if (g.state !== 'pre' || !(t > now && t < now + 48 * HOUR) || seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
  }, [basketOn, gamesKey, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const basket = useBasketPicks(games, injuriesQ.data ?? []);
  const basketPool = useMemo(() => fromBasket(basket.picks), [basket.picks]);
  const basketLoading = basketOn && (gamesQ.some(q => q.isLoading) || basket.oddsLoading || basket.loaded < basket.total);

  // results cambia de identidad en cada render; las firmas de lo que importa evitan recalcular el reparto sin motivo
  const sig = results.map(r => `${r.dataUpdatedAt}:${r.status}`).join('|');
  return useMemo(() => {
    const pool: PlanPick[] = [];
    const seen = new Set<string>();
    for (const r of results) for (const p of r.data ?? []) if (!seen.has(p.id)) { seen.add(p.id); pool.push(p); }
    if (basketOn) pool.push(...basketPool);
    const sports = {} as Record<PlanSport, SportState>;
    for (const s of SERVER) {
      const mine = results.filter((_, i) => jobs[i].sport === s);
      const failed = mine.filter(r => r.isError);
      sports[s] = {
        off: !on(s), loading: mine.some(r => r.isLoading),
        error: failed.length && failed.length === mine.length ? (failed[0].error as Error)?.message || 'error' : null
      };
    }
    const bErr = gamesQ.find(q => q.isError)?.error ?? basket.failed;
    sports.basket = { off: !basketOn, loading: basketLoading, error: bErr ? (bErr as Error).message || 'error' : null };
    const done = results.filter(r => r.dataUpdatedAt > 0).map(r => r.dataUpdatedAt);
    return { pool, sports, updatedAt: done.length ? Math.min(...done) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, basketPool, basketLoading, basketOn, chosen.join()]);
}
