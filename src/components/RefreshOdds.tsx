// Actualizar las cuotas de un partido desde una recomendación: lanza el lector para ese partido (como «Actualizar cuotas» de la
// ficha) y, cuando acaba, vuelve a pedir las cuotas y las recomendaciones, que se recalculan con lo nuevo. Uno a uno a propósito:
// leer todos los partidos del día de golpe serían decenas de lecturas seguidas, y las casas pueden bloquear
import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { AutoJob, SlipLive } from '@/lib/types';
import { askLogin, useMember } from './AuthGate';

type Match = SlipLive['match'];
const sameMatch = (j: AutoJob, m: Match) => j.match.a.name === m.a.name && j.match.b.name === m.b.name;

// Cuotas y recomendaciones (las de baloncesto salen de las cuotas; las de tenis, fútbol y MMA las calcula el servidor sin caché)
export const reloadOddsAndPicks = (qc: QueryClient) => qc.invalidateQueries({
  predicate: q => q.queryKey[0] === 'odds' || (typeof q.queryKey[1] === 'string' && /picks|board/.test(q.queryKey[1]))
});

export function RefreshOdds({ match, className }: { match: Match; className?: string }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const member = useMember();
  const [job, setJob] = useState<AutoJob | null>(null);
  const running = !!job && !job.done;
  useEffect(() => window.api.onOddsAuto(j => setJob(cur => {
    if (!cur || !sameMatch(j, match)) return cur;
    if (j.done) {
      reloadOddsAndPicks(qc);
      const failed = Object.values(j.steps ?? {}).every(s => s?.estado === 'error');
      toast(failed ? 'No se han podido leer las cuotas de este partido' : 'Cuotas actualizadas: la recomendación ya va con las nuevas');
    }
    return j;
    // Por los nombres: el partido llega como objeto nuevo en cada pintado
  })), [match.a.name, match.b.name, qc, toast]);

  async function start(e: React.MouseEvent) {
    e.stopPropagation();
    if (!member) { askLogin({ why: 'Leer las cuotas al momento lo hace el lector de Sharpex, y es para usuarios registrados. Sin cuenta ves las de la última lectura automática.' }); return; }
    try {
      const j = await window.api.odds.auto(match);
      setJob(j);
      if (j.done) reloadOddsAndPicks(qc);
    } catch (err) { toast((err as Error).message); }
  }

  return (
    <button type="button" onClick={start} disabled={running}
      title={running ? 'Leyendo las cuotas de este partido…' : 'Actualizar las cuotas de este partido (tarda un minuto)'}
      aria-label="Actualizar las cuotas de este partido"
      className={cn('grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-default disabled:text-amber-400 disabled:hover:bg-transparent', className)}>
      <RefreshCw size={14} className={cn(running && 'animate-spin')} />
    </button>
  );
}
