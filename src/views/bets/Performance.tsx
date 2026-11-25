import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Dices, Flame, Gauge, TrendingDown } from 'lucide-react';
import { useCurrency } from '@/lib/app-context';
import { MIN_LUCK, byMonth, clvOf, combinedSeries, edgeOf, luckOf, runsOf, settledOf } from '@/lib/bet-stats';
import { chip, Card, Empty, Stat } from '@/components/ui';
import { betProfit, cn, decimal, fmtDate, money, pct, tone } from '@/lib/format';
import { profitString, useProfit } from '@/views/bets/Profit';
import type { Bet } from '@/lib/types';

// Lo que dice si apostar sale a cuenta, más allá del beneficio: si se acierta más de lo que piden las cuotas, si eso puede ser
// suerte, cuánto se ha llegado a perder desde el máximo y las rachas. Lógica en src/lib/bet-stats.ts

const GRID = '#2a2a30', AXIS = '#76767f', POS = '#5cc78a', NEG = '#e5776f', TOTAL = '#d0d0d6';
const TIP = {
  contentStyle: { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 },
  itemStyle: { color: '#fafafa', fontWeight: 600 }, labelStyle: { color: '#d4d4d8' }
};
// El acento de cada app (acc-400 de index.css): la línea de un deporte en la gráfica conjunta va con su color
const SPORTS = [
  { id: 'lol', label: 'LoL', color: '#55bfac' }, { id: 'basket', label: 'Baloncesto', color: '#e8955f' },
  { id: 'tennis', label: 'Tenis', color: '#82c56f' }, { id: 'football', label: 'Fútbol', color: '#7d9bd9' },
  { id: 'mma', label: 'MMA', color: '#d27a7a' }
];
const pp = (v: number) => `${v > 0 ? '+' : ''}${decimal(v * 100, 1)} pts`;

export function PerformanceKpis({ bets }: { bets: Bet[] }) {
  const cur = useCurrency();
  const e = useMemo(() => edgeOf(bets), [bets]);
  const l = useMemo(() => luckOf(bets), [bets]);
  const r = useMemo(() => runsOf(bets), [bets]);
  const c = useMemo(() => clvOf(bets), [bets]);
  if (!e.n && !r.peak && !r.maxDrop) return null;

  const luck = l.p === null
    ? { value: '—', cls: 'text-zinc-500', sub: `Hacen falta ${MIN_LUCK} apuestas resueltas para decirlo (llevas ${l.n})` }
    : l.p < 0.05 ? { value: 'Difícil que sea suerte', cls: 'text-emerald-400', sub: `Sin ventaja, ganar esto pasaría un ${pct(l.p)} de las veces` }
    : l.p > 0.5 ? { value: 'Por debajo de lo esperado', cls: 'text-rose-400', sub: `Sin ventaja ninguna, se ganaría más el ${pct(1 - l.p)} de las veces` }
    : { value: 'Aún puede ser suerte', cls: 'text-amber-300', sub: `Sin ventaja, ganar esto pasaría un ${pct(l.p)} de las veces` };
  const streak = r.streak.kind ? `${r.streak.n} ${r.streak.kind === 'won' ? 'ganada' : 'perdida'}${r.streak.n === 1 ? '' : 's'} seguidas` : '—';

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 max-md:[&>:last-child:nth-child(odd)]:col-span-2 md:grid-cols-3 2xl:grid-cols-5">
      <Stat label="CLV (frente al cierre)" icon={<Gauge size={15} />}
        value={c.n ? `${c.weighted > 0 ? '+' : ''}${pct(c.weighted)}` : '—'} valueClass={c.n ? tone(c.weighted) : 'text-zinc-500'}
        sub={c.n ? `Mejor cuota que la de cierre en ${pct(c.beat)} de ${c.n} apuestas`
          : c.withRef ? 'Saldrá cuando empiecen los partidos de tus apuestas' : 'Sólo con apuestas enlazadas a su partido (desde el cupón)'} />
      <Stat label="Acierto frente al necesario" icon={<Activity size={15} />}
        value={e.n ? pp(e.diff) : '—'} valueClass={e.n ? tone(e.diff) : 'text-zinc-500'}
        sub={e.n ? `Aciertas ${pct(e.hit)}; a tus cuotas hace falta ${pct(e.breakEven)} para no perder` : 'Sin apuestas resueltas'} />
      <Stat label="¿Suerte o ventaja?" icon={<Dices size={15} />} value={<span className="text-[17px]">{luck.value}</span>} valueClass={luck.cls} sub={luck.sub} />
      <Stat label="Peor caída" icon={<TrendingDown size={15} />} value={r.maxDrop ? money(-r.maxDrop, cur) : money(0, cur)} valueClass={r.maxDrop ? 'text-rose-400' : ''}
        sub={r.fromPeak > 0.005 ? `Ahora estás ${money(r.fromPeak, cur)} por debajo de tu máximo` : 'Ahora estás en tu máximo'} />
      <Stat label="Racha actual" icon={<Flame size={15} />} value={streak} valueClass={r.streak.kind === 'won' ? 'text-emerald-400' : r.streak.kind === 'lost' ? 'text-rose-400' : ''}
        sub={`Mejor: ${r.bestWin} ganadas · peor: ${r.worstLoss} perdidas`} />
    </div>
  );
}

// Una barra por mes: verde si ese mes se ganó, roja si se perdió. Dice si el beneficio es constante o sale de un mes suelto
export function MonthlyChart({ bets }: { bets: Bet[] }) {
  const cur = useCurrency();
  const profit = useProfit();
  const data = useMemo(() => byMonth(bets), [bets]);
  const up = data.filter(m => m.profit > 0).length;
  return (
    <Card title="Beneficio por mes" action={data.length ? <span className="text-xs text-zinc-500 tnum">{up} de {data.length} meses en positivo</span> : undefined}>
      {!data.length ? <Empty>Resuelve alguna apuesta para ver los meses</Empty> : (
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={70} tickFormatter={v => money(v, cur)} />
              <ReferenceLine y={0} stroke="#5e6c68" />
              <Tooltip {...TIP} cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                formatter={(v, _n, p) => [`${profitString(profit(Number(v)))} · ROI ${pct(p.payload.roi)} · ${p.payload.count} apuestas`, 'Beneficio']} />
              <Bar dataKey="profit" maxBarSize={36} radius={[4, 4, 4, 4]}>
                {data.map(m => <Cell key={m.month} fill={m.profit >= 0 ? POS : NEG} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// Todas las apps juntas: el beneficio acumulado de la cartera entera y, al lado, la parte de un deporte para compararlo. Una
// línea por cada deporte a la vez no se distinguía (los acentos de LoL y tenis se confunden), así que se elige uno.
export function CombinedChart({ all, app }: { all: Bet[]; app: string }) {
  const cur = useCurrency();
  const profit = useProfit();
  const used = useMemo(() => SPORTS.filter(s => all.some(b => (b.sport || 'lol') === s.id && b.status !== 'pending')), [all]);
  const [pick, setPick] = useState<string | null>(app);
  const sport = used.find(s => s.id === pick) ?? null;
  const data = useMemo(() => combinedSeries(all, sport?.id ?? null).map((p, k) => ({ ...p, k })), [all, sport]);

  return (
    <Card title="Todas las apps juntas" action={used.length > 1 ? (
      <div className="flex flex-wrap gap-1.5">
        {used.map(s => (
          <button key={s.id} type="button" className={chip(sport?.id === s.id)} onClick={() => setPick(sport?.id === s.id ? null : s.id)}>
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
          </button>
        ))}
      </div>
    ) : undefined}>
      {data.length < 3 ? <Empty>Resuelve al menos 2 apuestas para ver la gráfica</Empty> : <>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: TOTAL }} />Total de la cartera</span>
          {sport && <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: sport.color }} />{sport.label}</span>}
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="k" tickFormatter={k => data[k]?.date ? fmtDate(data[k].date) : ''} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} minTickGap={30} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={70} tickFormatter={v => money(v, cur)} />
              <ReferenceLine y={0} stroke="#5e6c68" strokeDasharray="4 4" />
              <Tooltip {...TIP}
                formatter={(v, name) => [profitString(profit(Number(v))), name === 'total' ? 'Total' : sport?.label ?? '']}
                labelFormatter={(_, p) => p?.[0]?.payload.date ? `${fmtDate(p[0].payload.date)} · ${p[0].payload.event}` : 'Inicio'} />
              <Line type="monotone" dataKey="total" stroke={TOTAL} strokeWidth={2} dot={false} isAnimationActive={false} />
              {sport && <Line type="monotone" dataKey="part" stroke={sport.color} strokeWidth={2} dot={false} isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </>}
      <SportsTable all={all} />
    </Card>
  );
}

// La tabla de la gráfica conjunta: cada deporte con lo que lleva, y el total
function SportsTable({ all }: { all: Bet[] }) {
  const cur = useCurrency();
  const profit = useProfit();
  const rows = useMemo(() => {
    const of = (list: Bet[]) => {
      const s = settledOf(list), staked = s.reduce((a, b) => a + b.stake, 0);
      const p = s.reduce((a, b) => a + betProfit(b), 0);
      return { n: s.length, staked, profit: p, roi: staked ? p / staked : 0, edge: edgeOf(list) };
    };
    const per = [...SPORTS, { id: 'mix', label: 'Combinadas de varios', color: '' }]
      .map(s => ({ ...s, ...of(all.filter(b => (b.sport || 'lol') === s.id)) })).filter(r => r.n);
    return per.length > 1 ? [...per, { id: 'all', label: 'Total', color: '', ...of(all) }] : per;
  }, [all]);
  if (!rows.length) return null;
  return (
    <div className="-mx-5 -mb-5 mt-4 overflow-x-auto border-t border-zinc-800">
      <table className="w-full min-w-[520px] text-[13px]">
        <thead><tr className="text-xs text-zinc-500">
          <th className="px-3 py-2 text-left font-medium">Deporte</th><th className="px-3 py-2 text-right font-medium">Resueltas</th>
          <th className="px-3 py-2 text-right font-medium">Acierto / necesario</th><th className="px-3 py-2 text-right font-medium">Beneficio</th>
          <th className="px-3 py-2 text-right font-medium">ROI</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-800/70">
          {rows.map(r => (
            <tr key={r.id} className={cn(r.id === 'all' && 'font-semibold')}>
              <td className="px-3 py-2"><span className="inline-flex items-center gap-2">{r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}{r.label}</span></td>
              <td className="px-3 py-2 text-right tnum">{r.n}</td>
              <td className={cn('px-3 py-2 text-right tnum', r.edge.n ? tone(r.edge.diff) : 'text-zinc-500')}>{r.edge.n ? `${pct(r.edge.hit)} / ${pct(r.edge.breakEven)}` : '—'}</td>
              <td className={cn('whitespace-nowrap px-3 py-2 text-right tnum', tone(r.profit))}>{profitString(profit(r.profit))}</td>
              <td className={cn('px-3 py-2 text-right tnum', tone(r.roi))}>{pct(r.roi)}<span className="sr-only"> de {money(r.staked, cur)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
