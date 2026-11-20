import { useCallback, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { addWeeks, weekLabel, weekStart } from '@/lib/bet-weeks';
import { tone } from '@/lib/format';
import { Button } from '@/components/ui';
import { WeekPicker } from '@/components/bets/WeekPicker';
import { ProfitText } from '@/views/bets/Profit';
import { useDismiss } from '@/components/bets/useDismiss';

// Barra de semana del historial: flechas, botón con el calendario y el beneficio de la semana. week null = todas las semanas
export function WeekBar({ week, today, marked, profit, onChange }: {
  week: string | null; today: string; marked: Set<string>; profit: number | null; onChange: (w: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box);
  const thisWeek = weekStart(today);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" size="icon" aria-label="Semana anterior" disabled={week === null} onClick={() => week && onChange(addWeeks(week, -1))}><ChevronLeft size={16} /></Button>
      <div ref={box} className="relative">
        <Button type="button" variant="secondary" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <CalendarDays size={15} />{week ? weekLabel(week) : 'Todas las semanas'}<ChevronDown size={14} className="text-zinc-500" />
        </Button>
        {open && <WeekPicker week={week} marked={marked} today={today} onClose={close} onPick={onChange} onAll={() => onChange(null)} onThisWeek={() => onChange(thisWeek)} />}
      </div>
      <Button type="button" variant="secondary" size="icon" aria-label="Semana siguiente" disabled={week === null} onClick={() => week && onChange(addWeeks(week, 1))}><ChevronRight size={16} /></Button>
      {week !== thisWeek && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(thisWeek)}>Esta semana</Button>}
      {profit !== null && (
        <div className="ml-auto basis-full text-right sm:basis-auto">
          <div className="text-xs text-zinc-500">Beneficio de la semana</div>
          <div className={`text-sm font-semibold tabular-nums ${tone(profit)}`}><ProfitText value={profit} /></div>
        </div>
      )}
    </div>
  );
}
