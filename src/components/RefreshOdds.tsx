// Actualizar las cuotas de un partido desde una recomendación: lanza el lector para ese partido (como «Actualizar cuotas» de la
// ficha) y, cuando acaba, vuelve a pedir las cuotas y las recomendaciones, que se recalculan con lo nuevo. Uno a uno a propósito:
// leer todos los partidos del día de golpe serían decenas de lecturas seguidas, y las casas pueden bloquear.
// Un partido puede tener muchas recomendaciones, cada una con su botón: todos los del mismo partido comparten la lectura en curso
// (giran a la vez y no se lanza otra). Tarda alrededor de un minuto: espera a que el lector acabe la que está haciendo y lee las dos casas.
import { useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn } from '@/lib/format';
import { jobFailed, jobStage, waitJob } from '@/lib/odds-read';
import type { AutoJob, SlipLive } from '@/lib/types';
import { askLogin, useMember } from './AuthGate';

type Match = SlipLive['match'];
const keyOf = (m: Match) => `${m.a.name}|${m.b.name}`;

// Cuotas y recomendaciones (las de baloncesto salen de las cuotas; las de tenis, fútbol y MMA las calcula el servidor sin caché)
export const reloadOddsAndPicks = (qc: QueryClient) => qc.invalidateQueries({
  predicate: q => q.queryKey[0] === 'odds' || (typeof q.queryKey[1] === 'string' && /picks|board|lines/.test(q.queryKey[1]))
});

// Lecturas en curso por partido, compartidas por todos los botones (null: pedida, sin respuesta todavía)
const running = new Map<string, AutoJob | null>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(f => f());
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function RefreshOdds({ match, className }: { match: Match; className?: string }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const member = useMember();
  const k = keyOf(match);
  const job = useSyncExternalStore(subscribe, () => running.get(k));
  const busy = job !== undefined;

  async function start(e: React.MouseEvent) {
    e.stopPropagation();
    if (!member) { askLogin({ why: 'Leer las cuotas al momento lo hace el lector de Sharpex, y es para usuarios registrados. Sin cuenta ves las de la última lectura automática.' }); return; }
    if (busy) return;
    running.set(k, null); changed();
    toast('Leyendo este partido en Winamax y Betway: tarda alrededor de un minuto');
    try {
      const first = await window.api.odds.auto(match);
      running.set(k, first); changed();
      const end = await waitJob(first, j => { running.set(k, j); changed(); });
      reloadOddsAndPicks(qc);
      toast(!end ? 'La lectura va lenta: las cuotas se pondrán al día solas cuando acabe'
        : jobFailed(end) ? 'No se han podido leer las cuotas de este partido' : 'Cuotas actualizadas: la recomendación ya va con las nuevas');
    } catch (err) { toast((err as Error).message); }
    finally { running.delete(k); changed(); }
  }

  const label = busy ? jobStage(job ?? null) : 'Actualizar las cuotas de este partido (tarda alrededor de un minuto)';
  return (
    <button type="button" onClick={start} aria-busy={busy} title={label} aria-label="Actualizar las cuotas de este partido"
      className={cn('grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md transition',
        busy ? 'cursor-default text-amber-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100', className)}>
      <RefreshCw size={14} className={cn(busy && 'animate-spin')} />
    </button>
  );
}
