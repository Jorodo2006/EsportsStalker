// Resumen del partido de fútbol: goles, tarjetas y cambios minuto a minuto.
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/format';
import type { FootballDetail, FootballEvent } from '@/lib/types';
import { FootballIcon } from '@/components/football';
import { Empty, seg, segWrap } from '@/components/ui';
import { Panel } from '@/components/viz';
import { stateOf } from './shared';
import { Card, EVENT_TEXT, goalNote, isGoal, scoreLine, shortName } from './MatchHeader';




// ---------- resumen ----------
// Goles, tarjetas y cambios en orden, con el minuto en un eje central: los del local a la izquierda y los del visitante a
// la derecha. Los goles destacan con el marcador de ese momento; los cambios son una línea fina (entra / sale).
// Separadores en el descanso, al final del tiempo reglamentario si hay prórroga y al final
const PHASE_END: Record<number, string> = { 1: 'Descanso', 2: 'Final del tiempo reglamentario', 3: 'Final de la prórroga' };

export function Timeline({ d }: { d: FootballDetail }) {
  const [only, setOnly] = useState(false);
  const { match: m, timeline } = d;
  if (!timeline.length) return <Empty>{m.state === 'pre' ? 'El partido aún no ha empezado.' : 'Todavía no hay goles, tarjetas ni cambios.'}</Empty>;
  const st = stateOf(m);
  const { after, phases } = scoreLine(m, timeline);
  const rows: ReactNode[] = [];

  const divider = (key: string, label: string, score: [number, number]) => (
    <div key={key} className="flex items-center gap-3 px-4 py-2">
      <span className="h-px flex-1 bg-zinc-800" />
      <span className="relative z-10 bg-surface px-2 text-xs font-medium text-zinc-400">{label} <span className="ml-1 font-semibold text-zinc-200 tnum">{score[0]}-{score[1]}</span></span>
      <span className="h-px flex-1 bg-zinc-800" />
    </div>
  );

  const cell = (e: FootballEvent, right: boolean) => {
    const goal = isGoal(e);
    const box = cn('flex min-w-0 items-start gap-2', right ? '' : 'flex-row-reverse text-right');
    if (e.kind === 'sub') {
      return (
        <div className={cn('flex min-w-0 flex-col gap-0.5 text-[13px]', right ? 'items-start' : 'items-end text-right')} title="Cambio">
          <span className={cn('flex min-w-0 max-w-full items-center gap-1.5 text-zinc-200', !right && 'flex-row-reverse')}><ArrowUp size={12} className="shrink-0 text-emerald-400" /><span className="truncate">{e.player}</span></span>
          {e.other && <span className={cn('flex min-w-0 max-w-full items-center gap-1.5 text-xs text-zinc-500', !right && 'flex-row-reverse')}><ArrowDown size={12} className="shrink-0 text-zinc-500" /><span className="truncate">{e.other}</span></span>}
        </div>
      );
    }
    return (
      <div className={box} title={EVENT_TEXT[e.kind]}>
        <span className="mt-0.5 shrink-0">
          {e.kind === 'yellow' || e.kind === 'red' ? <Card red={e.kind === 'red'} />
            : <span className={e.kind === 'missed' ? 'text-zinc-500' : 'text-zinc-100'}><FootballIcon size={14} /></span>}
        </span>
        <div className="min-w-0">
          <div className={cn('flex min-w-0 items-center gap-2', !right && 'flex-row-reverse')}>
            <span className={cn('truncate', goal ? 'text-sm font-semibold text-zinc-50' : 'text-[13px] text-zinc-200')} title={e.player}>
              {e.player ? <><span className="sm:hidden">{shortName(e.player)}</span><span className="hidden sm:inline">{e.player}</span></> : EVENT_TEXT[e.kind]}{goalNote(e)}
            </span>
          </div>
          {(e.kind === 'missed' || (goal && e.other)) && <div className="truncate text-xs text-zinc-500">{e.kind === 'missed' ? 'Penalti fallado' : `Asistencia de ${e.other}`}</div>}
        </div>
      </div>
    );
  };

  let score: [number, number] = [0, 0];
  timeline.forEach((e, i) => {
    if (after[i]) score = after[i]!;
    const show = !only || e.kind !== 'sub';
    if (show) {
      const goal = isGoal(e);
      const home = e.team === m.home.id;
      rows.push(
        <div key={i} className={cn('grid grid-cols-[minmax(0,1fr)_3.25rem_minmax(0,1fr)] items-center gap-2 px-3 sm:px-4', goal ? 'bg-zinc-900 py-2.5' : 'py-1.5')}>
          {home ? cell(e, false) : <span />}
          {goal && after[i]
            ? (
              <span className="relative z-10 mx-auto flex flex-col items-center gap-0.5 rounded-md bg-zinc-900 px-1 tnum">
                <span className="text-[11px] font-medium text-zinc-400">{e.minute}</span>
                <span className="rounded bg-zinc-700 px-1.5 text-xs font-semibold text-zinc-50">{after[i]![0]}-{after[i]![1]}</span>
              </span>
            )
            : <span className="relative z-10 mx-auto rounded-md bg-surface px-1.5 text-center text-xs font-medium text-zinc-400 tnum">{e.minute}</span>}
          {!home ? cell(e, true) : <span />}
        </div>
      );
    }
    // Separador al cambiar de parte (o al final, si ya acabó)
    const next = phases[i + 1];
    const ends = next != null ? next > phases[i] : st === 'post' || (phases[i] === 1 && /descanso/i.test(m.status));
    if (ends && (next != null || phases[i] < 3 || st === 'post')) {
      const label = next == null && st === 'post' ? 'Final' : PHASE_END[phases[i]] ?? 'Final';
      rows.push(divider(`d${i}`, label, score));
    }
  });

  return (
    <Panel title={
      <span className="flex items-center justify-between gap-2">
        Resumen
        <span className={segWrap}>
          <button onClick={() => setOnly(false)} className={seg(!only)}>Todo</button>
          <button onClick={() => setOnly(true)} className={seg(only)}>Goles y tarjetas</button>
        </span>
      </span>
    }>
      <div className="relative py-1">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-800" />
        {rows}
      </div>
    </Panel>
  );
}
