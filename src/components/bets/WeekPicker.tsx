import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, monthGrid, weekDays, weekStart } from '@/lib/bet-weeks';
import { cn } from '@/lib/format';
import { Button } from '@/components/ui';

const HEAD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const monthName = (y: number, m: number) => {
  const s = new Date(Date.UTC(y, m, 1)).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const full = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Calendario del mes para elegir una semana: pulsar un día elige su semana entera. Los días con apuestas llevan un punto
export function WeekPicker({ week, marked, today, onPick, onAll, onThisWeek, onClose }: {
  week: string | null; marked: Set<string>; today: string;
  onPick: (start: string) => void; onAll: () => void; onThisWeek: () => void; onClose: () => void;
}) {
  const ref0 = week ?? today;
  const [view, setView] = useState({ y: Number(ref0.slice(0, 4)), m: Number(ref0.slice(5, 7)) - 1 });
  const grid = useRef<HTMLDivElement>(null);
  const rows = monthGrid(view.y, view.m);
  const chosen = new Set(week ? weekDays(week) : []);

  const step = (n: number) => setView(v => { const t = new Date(Date.UTC(v.y, v.m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; });
  const focusDay = (d: string) => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${d}"]`)?.focus();

  // Al abrir, el foco va al día elegido (o a hoy)
  useEffect(() => { focusDay(week ? week : today); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const cur = (document.activeElement as HTMLElement | null)?.dataset.date;
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!cur || move === undefined) return;
    e.preventDefault();
    const next = addDays(cur, move);
    // Si el día queda fuera del mes que se ve, se cambia de mes y se enfoca al pintarse
    if (!rows.some(r => r.includes(next))) {
      setView({ y: Number(next.slice(0, 4)), m: Number(next.slice(5, 7)) - 1 });
      setTimeout(() => focusDay(next), 0);
    } else focusDay(next);
  }

  return (
    <div role="dialog" aria-label="Elegir semana" className="absolute left-0 top-full z-30 mt-2 w-[17.5rem] rounded-[10px] border border-zinc-700 bg-surface p-3 shadow-xl shadow-black/40">
      <div className="mb-2 flex items-center justify-between">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Mes anterior" onClick={() => step(-1)}><ChevronLeft size={16} /></Button>
        <span className="text-sm font-semibold">{monthName(view.y, view.m)}</span>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Mes siguiente" onClick={() => step(1)}><ChevronRight size={16} /></Button>
      </div>
      <div ref={grid} onKeyDown={onKey} className="grid grid-cols-7 text-center text-xs">
        {HEAD.map(h => <span key={h} className="py-1 text-[11px] font-medium text-zinc-500">{h}</span>)}
        {rows.flat().map((d, i) => {
          const inMonth = Number(d.slice(5, 7)) - 1 === view.m;
          const on = chosen.has(d), first = i % 7 === 0, lastCol = i % 7 === 6;
          return (
            <button key={d} type="button" data-date={d} aria-label={full(d)} aria-pressed={on}
              onClick={() => { onPick(weekStart(d)); onClose(); }}
              className={cn('relative h-8 cursor-pointer text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-400',
                inMonth ? 'text-zinc-200' : 'text-zinc-600', d === today && 'font-bold text-zinc-50',
                on ? cn('bg-zinc-700', first && 'rounded-l-md', lastCol && 'rounded-r-md') : 'rounded-md hover:bg-zinc-800')}>
              {Number(d.slice(8))}
              {marked.has(d) && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-500" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2 border-t border-zinc-800 pt-3">
        <Button type="button" size="sm" variant="secondary" onClick={() => { onThisWeek(); onClose(); }}>Esta semana</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => { onAll(); onClose(); }}>Todas las semanas</Button>
      </div>
      <p className="mt-2 text-xs text-zinc-500"><span className="text-amber-500">●</span> días con apuestas</p>
    </div>
  );
}
