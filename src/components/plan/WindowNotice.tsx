import { Clock } from 'lucide-react';
import type { PlanSport, poolStats } from '@/lib/plan';
import { WINDOW_HOURS } from '@/lib/plan';
import type { usePlanPool } from '@/components/plan/usePlanPool';
import { panelCls } from '@/components/ui';

const NAMES: Record<PlanSport, string> = { tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };

// El aviso de las 48 h, siempre arriba: el plan sólo usa partidos que empiezan pronto, que es cuando se leen las cuotas
export function WindowNotice({ stats, sports, updatedAt, now }: {
  stats: ReturnType<typeof poolStats>; sports: ReturnType<typeof usePlanPool>['sports']; updatedAt: number | null; now: number;
}) {
  const line = (s: PlanSport) => {
    const st = sports[s];
    if (st.loading) return 'cargando…';
    if (st.error) return 'no se pudo cargar';
    const x = stats[s];
    if (!x.picks) return 'sin partidos con cuotas';
    return `${x.matches} partido${x.matches === 1 ? '' : 's'} · ${x.picks} apuesta${x.picks === 1 ? '' : 's'}`;
  };
  const mins = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 60_000)) : null;
  return (
    <div className={`${panelCls} flex flex-col gap-2 p-4`} role="note">
      <div className="flex items-start gap-2 text-sm text-zinc-200">
        <Clock size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
        <span>El plan sólo usa partidos que empiezan en las próximas {WINDOW_HOURS} horas: es cuando se leen las cuotas.</span>
      </div>
      <ul className="grid gap-x-6 gap-y-1 text-xs text-zinc-400 sm:grid-cols-2">
        {(Object.keys(NAMES) as PlanSport[]).map(s => <li key={s}><span className="text-zinc-300">{NAMES[s]}:</span> {line(s)}</li>)}
        <li><span className="text-zinc-300">Baloncesto:</span> próximamente</li>
        <li><span className="text-zinc-300">LoL:</span> sin recomendaciones</li>
      </ul>
      {mins !== null && <div className="text-xs text-zinc-500">Recomendaciones calculadas hace {mins} min.</div>}
    </div>
  );
}
