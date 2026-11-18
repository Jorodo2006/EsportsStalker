import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { PlanPick, PlanSport } from '@/lib/plan';
import { fromFootball, fromMma, fromTennis, windowDays } from '@/lib/plan-sources';

export type SportState = { loading: boolean; error: string | null };
const SPORTS: PlanSport[] = ['tennis', 'football', 'mma'];

// Las recomendaciones de tenis, fútbol y MMA de hoy, mañana y pasado (hora de España), juntas y en la forma común del plan.
// Sólo se lee lo que el servidor ya tiene guardado: no se lanzan lecturas de cuotas
export function usePlanPool(): { pool: PlanPick[]; sports: Record<PlanSport, SportState>; updatedAt: number | null } {
  // Los días se fijan al abrir la pantalla; recalcular cada render cambiaría las claves de consulta a medianoche a mitad de uso
  const [days] = useState(() => windowDays(Date.now()));
  const jobs = SPORTS.flatMap(sport => days.map(day => ({ sport, day })));
  const results = useQueries({
    queries: jobs.map(({ sport, day }) => ({
      queryKey: ['plan', sport, day],
      queryFn: async (): Promise<PlanPick[]> => {
        if (sport === 'tennis') return fromTennis(await window.api.tennis.picksDay(day));
        if (sport === 'football') return fromFootball(await window.api.football.picksDay(day));
        return fromMma(await window.api.mma.picksDay(day));
      },
      staleTime: 3 * 60_000, retry: false, refetchOnWindowFocus: false
    }))
  });

  // results cambia de identidad en cada render; las firmas de lo que importa evitan recalcular el reparto sin motivo
  const sig = results.map(r => `${r.dataUpdatedAt}:${r.status}`).join('|');
  return useMemo(() => {
    const pool: PlanPick[] = [];
    const seen = new Set<string>();
    for (const r of results) for (const p of r.data ?? []) if (!seen.has(p.id)) { seen.add(p.id); pool.push(p); }
    const sports = {} as Record<PlanSport, SportState>;
    for (const s of SPORTS) {
      const mine = results.filter((_, i) => jobs[i].sport === s);
      const failed = mine.filter(r => r.isError);
      sports[s] = {
        loading: mine.some(r => r.isLoading),
        error: failed.length === mine.length ? (failed[0].error as Error)?.message || 'error' : null
      };
    }
    const done = results.filter(r => r.dataUpdatedAt > 0).map(r => r.dataUpdatedAt);
    return { pool, sports, updatedAt: done.length ? Math.min(...done) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
