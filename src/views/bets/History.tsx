import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { betDates, dayLabel, groupByDay, groupByWeek, latestWeekWithBets, todayStr, weekLabel, weekStart, type DayGroup } from '@/lib/bet-weeks';
import { inPeriod, periodBounds, periodGroups, periodLabel } from '@/lib/bet-period';
import { STATUS_LABEL, cn, money, pct, summarize, tone } from '@/lib/format';
import { useCurrency } from '@/lib/app-context';
import type { Bet, BetStatus } from '@/lib/types';
import { Button, Card, Empty, Input, Select } from '@/components/ui';
import { WeekBar } from '@/components/bets/WeekBar';
import { BetRow } from '@/views/bets/BetRow';
import { ProfitText } from '@/views/bets/Profit';

type Actions = { onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void; onShare: (b: Bet) => void };

// Historial de apuestas: una semana cada vez (la actual al abrir), con sus días. Con el buscador, el estado o un periodo puestos, o
// con «Todas las semanas», se mira todo el historial agrupado por semanas, para no perder una apuesta por estar en otra semana.
// El periodo (src/lib/bet-period.ts: los últimos 7 o 30 días, un año, un mes o entre dos fechas) es otro filtro más, y con
// cualquier filtro puesto arriba sale lo que suman las que quedan: así se ve cómo fue un mes sin hacer cuentas
// La lista no lleva overflow-hidden: recortaba el menú «⋯» de las últimas filas (BetRow)
export function History({ bets, ...act }: { bets: Bet[] } & Actions) {
  const cur = useCurrency();
  const today = todayStr();
  const [week, setWeek] = useState<string | null>(() => weekStart(today));
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const [period, setPeriod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const groups = useMemo(() => periodGroups(bets.map(b => b.date)), [bets]);
  const bounds = useMemo(() => periodBounds(period, today, from, to), [period, today, from, to]);

  const filtered = useMemo(() => bets
    .filter(b => !st || b.status === st)
    .filter(b => inPeriod(b.date, bounds))
    .filter(b => !q || [b.event, b.selection, b.league, b.bookmaker, b.market, b.notes, ...(b.legs || []).map(l => l.market)].join(' ').toLowerCase().includes(q.toLowerCase())), [bets, q, st, bounds]);
  const filters = !!q || !!st || !!bounds;
  const all = filters || week === null;
  const clear = () => { setQ(''); setSt(''); setPeriod(''); setFrom(''); setTo(''); };
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
          : <span className={cn('shrink-0 font-medium tabular-nums', tone(d.profit))}><ProfitText value={d.profit} /></span>}
      </div>
      <div className="divide-y divide-zinc-800/70">{d.bets.map(b => <BetRow key={b.id} bet={b} {...act} />)}</div>
    </div>
  );

  return (
    <Card title="Historial" action={
      <div className="flex w-full flex-col gap-2 sm:w-auto">
        <div className="grid grid-cols-1 gap-2 sm:flex">
          <div className="relative min-w-0 sm:w-44">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Input className="h-8 w-full pl-8" placeholder="Buscar" aria-label="Buscar en el historial" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Select aria-label="Periodo" className="h-8 min-w-0 sm:w-44" value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="">Todas las fechas</option>
            <option value="d7">Últimos 7 días</option>
            <option value="d30">Últimos 30 días</option>
            {groups.map(g => (
              <optgroup key={g.year} label={g.year}>
                <option value={`y:${g.year}`}>Todo {g.year}</option>
                {g.months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </optgroup>
            ))}
            <option value="range">Entre dos fechas…</option>
          </Select>
          <Select className="h-8 min-w-0 sm:w-48" aria-label="Filtrar por estado" value={st} onChange={e => setSt(e.target.value)}>
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {period === 'range' && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-zinc-400 sm:flex-row sm:items-center sm:gap-2">Desde
              <Input type="date" className="h-8 w-full min-w-0 sm:w-40" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-zinc-400 sm:flex-row sm:items-center sm:gap-2">Hasta
              <Input type="date" className="h-8 w-full min-w-0 sm:w-40" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
            </label>
          </div>
        )}
      </div>
    }>
      <div className="-m-5">
        <div className="border-b border-zinc-800 px-4 py-3">
          <WeekBar week={all ? null : week} today={today} marked={marked} profit={all ? null : weekProfit} onChange={w => { setWeek(w); if (w !== null) clear(); }} />
        </div>
        {filters && !!filtered.length && <FilterSummary list={filtered} label={periodLabel(period, from, to)} onClear={clear} />}
        <div className="rounded-b-[10px]">
        {!bets.length ? <Empty>Aún no has registrado apuestas. Pulsa "Nueva apuesta".</Empty>
          : all ? (
            !weeks.length ? (
              <Empty>
                Ninguna apuesta coincide con el filtro
                {filters && <Button size="sm" variant="secondary" className="mt-3" onClick={clear}>Quitar filtros</Button>}
              </Empty>
            ) : weeks.map(w => (
              <section key={w.start || 'sin-fecha'}>
                <div className="flex items-center justify-between gap-3 border-y border-zinc-800 bg-zinc-800/40 px-4 py-2 text-xs font-medium text-zinc-300">
                  <span className="min-w-0 truncate">{w.start ? weekLabel(w.start) : 'Sin fecha'} <span className="font-normal text-zinc-500">· {w.count} apuesta{w.count === 1 ? '' : 's'}</span></span>
                  <span className={cn('shrink-0 tabular-nums', tone(w.profit))}><ProfitText value={w.profit} /></span>
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

// Con algún filtro puesto, lo que suman las apuestas que quedan
function FilterSummary({ list, label, onClear }: { list: Bet[]; label: string; onClear: () => void }) {
  const cur = useCurrency();
  const s = summarize(list);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800/70 bg-zinc-900/40 px-4 py-2.5 text-xs text-zinc-400">
      {label && <span className="font-medium text-zinc-100">{label}</span>}
      <span className="tnum">{list.length} apuesta{list.length === 1 ? '' : 's'}{s.pendingCount ? ` (${s.pendingCount} en juego)` : ''}</span>
      <span className="tnum">Apostado <b className="font-semibold text-zinc-200">{money(s.staked + s.pendingStake, cur)}</b></span>
      <span className="tnum">Beneficio <b className={cn('font-semibold', s.settled ? tone(s.profit) : 'text-zinc-500')}>{s.settled ? <ProfitText value={s.profit} /> : '—'}</b></span>
      {s.settled > 0 && <span className="tnum">ROI <b className={cn('font-semibold', tone(s.roi))}>{pct(s.roi)}</b></span>}
      <button type="button" onClick={onClear} className="ml-auto cursor-pointer text-zinc-400 underline-offset-2 transition hover:text-zinc-100 hover:underline">Quitar filtros</button>
    </div>
  );
}
