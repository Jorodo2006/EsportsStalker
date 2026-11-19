import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { betDates, dayLabel, groupByDay, groupByWeek, latestWeekWithBets, todayStr, weekLabel, weekStart, type DayGroup } from '@/lib/bet-weeks';
import { STATUS_LABEL, cn, money, tone } from '@/lib/format';
import { useCurrency } from '@/lib/app-context';
import type { Bet, BetStatus } from '@/lib/types';
import { Button, Card, Empty, Input, Select } from '@/components/ui';
import { WeekBar } from '@/components/bets/WeekBar';
import { BetRow } from '@/views/bets/BetRow';

type Actions = { onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void; onShare: (b: Bet) => void };

// Historial de apuestas: una semana cada vez (la actual al abrir), con sus días. Con el buscador o el estado puestos, o con
// «Todas las semanas», se mira todo el historial agrupado por semanas, para no perder una apuesta por estar en otra semana
export function History({ bets, ...act }: { bets: Bet[] } & Actions) {
  const cur = useCurrency();
  const today = todayStr();
  const [week, setWeek] = useState<string | null>(() => weekStart(today));
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');

  const filtered = useMemo(() => bets
    .filter(b => !st || b.status === st)
    .filter(b => !q || [b.event, b.selection, b.league, b.bookmaker, b.market, b.notes, ...(b.legs || []).map(l => l.market)].join(' ').toLowerCase().includes(q.toLowerCase())), [bets, q, st]);
  const all = !!q || !!st || week === null;
  const marked = useMemo(() => betDates(bets), [bets]);
  const days = useMemo(() => (all ? [] : groupByDay(filtered.filter(b => weekStart(b.date) === week))), [all, filtered, week]);
  const weeks = useMemo(() => (all ? groupByWeek(filtered) : []), [all, filtered]);
  const weekProfit = days.reduce((s, d) => s + d.profit, 0);
  const last = !all && week ? latestWeekWithBets(filtered, week) : null;

  const dayBlock = (d: DayGroup) => (
    <div key={d.date || 'sin-fecha'}>
      <div className="flex items-center justify-between gap-3 bg-zinc-900/60 px-4 py-2 text-xs text-zinc-400">
        <span className="min-w-0 truncate">{d.date ? dayLabel(d.date) : 'Sin fecha'}</span>
        {d.pending > 0
          ? <span className="shrink-0 tabular-nums">{d.pending} en juego · {money(d.pendingStake, cur)} apostados</span>
          : <span className={cn('shrink-0 font-medium tabular-nums', tone(d.profit))}>{money(d.profit, cur, true)}</span>}
      </div>
      <div className="divide-y divide-zinc-800/70">{d.bets.map(b => <BetRow key={b.id} bet={b} {...act} />)}</div>
    </div>
  );

  return (
    <Card title="Historial" action={
      <div className="flex w-full gap-2 sm:w-auto">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input className="h-8 w-full pl-8 sm:w-48" placeholder="Buscar" aria-label="Buscar en el historial" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Select className="h-8 min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label="Filtrar por estado" value={st} onChange={e => setSt(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
    }>
      <div className="-m-5">
        <div className="border-b border-zinc-800 px-4 py-3">
          <WeekBar week={all ? null : week} today={today} marked={marked} profit={all ? null : weekProfit} onChange={w => { setWeek(w); if (w !== null) { setQ(''); setSt(''); } }} />
        </div>
        <div className="overflow-hidden rounded-b-[10px]">
        {!bets.length ? <Empty>Aún no has registrado apuestas. Pulsa "Nueva apuesta".</Empty>
          : all ? (
            !weeks.length ? <Empty>Ninguna apuesta coincide con el filtro</Empty> : weeks.map(w => (
              <section key={w.start || 'sin-fecha'}>
                <div className="flex items-center justify-between gap-3 border-y border-zinc-800 bg-zinc-800/40 px-4 py-2 text-xs font-medium text-zinc-300">
                  <span className="min-w-0 truncate">{w.start ? weekLabel(w.start) : 'Sin fecha'} <span className="font-normal text-zinc-500">· {w.count} apuesta{w.count === 1 ? '' : 's'}</span></span>
                  <span className={cn('shrink-0 tabular-nums', tone(w.profit))}>{money(w.profit, cur, true)}</span>
                </div>
                {w.days.map(dayBlock)}
              </section>
            ))
          ) : !days.length ? (
            <Empty>
              <span>No hay apuestas esta semana</span>
              {last && <Button className="mt-3" variant="secondary" size="sm" onClick={() => setWeek(last)}>Ir a la última semana con apuestas</Button>}
            </Empty>
          ) : days.map(dayBlock)}
        </div>
      </div>
    </Card>
  );
}
