import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, CircleSlash, Download, Layers, Pencil, Percent, Plus, RefreshCw, Search, Send, Target, Upload, Wallet, X, Zap } from 'lucide-react';
import { ShareDialog } from './FriendsView';
import { useApp, useCurrency, useUnit, useWallet } from '@/lib/app-context';
import { inPeriod, periodBounds, periodGroups, periodLabel } from '@/lib/bet-period';
import { STATUS_LABEL, STATUS_TONE, betProfit, cn, decEs, fmtDate, groupBy, money, odd, pct, summarize, tone, units } from '@/lib/format';
import { madridDay } from '@/lib/route';
import type { Bet, BetStatus, LegStatus } from '@/lib/types';
import { ModelAccuracy } from '@/components/ModelAccuracy';
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Select, Stat, Tabs, td, th } from '@/components/ui';



const APP_NAME: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };

export default function BetsView() {
  const { openBet, toast, app } = useApp();
  const cur = useCurrency();
  // La apuesta que se está pasando a un amigo (diálogo de FriendsView)
  const [sharing, setSharing] = useState<Bet | null>(null);
  const qc = useQueryClient();
  const { data: all = [], isLoading } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  // Cada app ve sus apuestas; las combinadas que mezclan LoL y baloncesto salen en las dos
  const bets = useMemo(() => all.filter(b => (b.sport || 'lol') === app || b.sport === 'mix'), [all, app]);
  const s = useMemo(() => summarize(bets), [bets]);
  // La cartera es común a todas las apps; las estadísticas de abajo son sólo de esta
  const w = useWallet();

  const [checking, setChecking] = useState(false);
  // Tus apuestas, o el acierto de las recomendaciones del modelo (las apostaras o no)
  const [tab, setTab] = useState<'mine' | 'model'>('mine');

  async function quickSettle(b: Bet, status: BetStatus) {
    // En una combinada el estado sale de sus selecciones: "ganada" las marca todas como ganadas
    const legs = b.legs && status === 'won' ? b.legs.map(l => l.status === 'pending' ? { ...l, status: 'won' as LegStatus } : l) : b.legs;
    try { await window.api.bets.save({ ...b, status, legs }); }
    catch (e) { toast('No se ha podido guardar: ' + (e as Error).message); }
    qc.invalidateQueries({ queryKey: ['bets'] });
  }

  if (isLoading) return <Loading />;

  return (
    <>
      <PageHeader title="Mis apuestas" subtitle={`${APP_NAME[app]}: registro, beneficio y rendimiento`}>
        <Button variant="secondary" onClick={async () => {
          try { const n = await window.api.bets.import(); if (n) { toast(`${n} apuestas importadas`); qc.invalidateQueries({ queryKey: ['bets'] }); } }
          catch (e) { toast('Error al importar: ' + (e as Error).message); }
        }}><Upload size={15} />Importar</Button>
        <Button variant="secondary" onClick={async () => { const p = await window.api.bets.export(); if (p) toast('Exportado a ' + p); }}><Download size={15} />Exportar</Button>
        <Button variant="secondary" disabled={checking} title="Mira ya el resultado de los partidos de las pendientes (el servidor también lo hace solo cada 5 minutos)"
          onClick={async () => {
            setChecking(true);
            try {
              const { changed } = await window.api.bets.settle();
              qc.invalidateQueries({ queryKey: ['bets'] });
              toast(changed ? `${changed} apuesta${changed === 1 ? '' : 's'} resuelta${changed === 1 ? '' : 's'} con el resultado` : 'Nada nuevo: los partidos aún no han acabado o hay que resolverlas a mano');
            } catch (e) { toast((e as Error).message); } finally { setChecking(false); }
          }}><RefreshCw size={15} className={cn(checking && 'animate-spin')} /><span>Comprobar<span className="hidden sm:inline"> resultados</span></span></Button>
        <Button className="order-first w-full sm:order-none sm:w-auto" onClick={() => openBet()}><Plus size={16} />Nueva apuesta</Button>
      </PageHeader>

      <div className="mb-5"><Tabs value={tab} onChange={setTab} items={[{ value: 'mine', label: 'Mis apuestas' }, { value: 'model', label: 'Acierto del modelo' }]} /></div>
      {tab === 'model' ? <ModelAccuracy /> : !bets.length ? <FirstBet onNew={() => openBet()} /> : <>

      <Pending bets={bets} onEdit={b => openBet(b)} onSettle={quickSettle} onShare={setSharing} />

      <div className="mb-5 grid grid-cols-2 gap-3 max-md:[&>:last-child:nth-child(odd)]:col-span-2 md:grid-cols-3 2xl:grid-cols-5">
        <Stat label="Cartera (todas las apps)" icon={<Wallet size={15} />} value={money(w.balance, cur)}
          sub={<>{money(w.inPlay, cur)} en juego · beneficio total <ProfitText value={w.profit} /></>} />
        <Stat label={`Beneficio en ${APP_NAME[app].toLowerCase().replace('lol', 'LoL')}`} value={<ProfitText value={s.profit} unitsClass="text-sm" />} valueClass={tone(s.profit)}
          sub={`${s.settled} apuestas resueltas`} />
        <Stat label="ROI / Yield" icon={<Percent size={15} />} value={pct(s.roi)} valueClass={tone(s.roi)}
          sub={s.pendingStake ? `${money(s.staked, cur)} en resueltas · ${money(s.pendingStake, cur)} pendientes` : `Apostado ${money(s.staked, cur)}`} />
        <Stat label="Acierto" icon={<Target size={15} />} value={pct(s.hit)} sub={`${s.won} de ${s.settled} · cuota media ${odd(s.avgOdds)}`} />
        <Stat label="Pendientes" value={s.pendingCount} sub={`${money(s.pendingStake, cur)} en juego · retorno ${money(s.pendingReturn, cur)}`} />
      </div>

      <ProfitChart bets={bets} />

      <div className="my-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <Breakdown title="Por casa de apuestas" bets={bets} keyFn={b => b.bookmaker || 'Sin casa'} />
        <Breakdown title="Por liga" bets={bets} keyFn={b => b.league || 'Sin liga'} />
      </div>

      <History bets={bets} onEdit={b => openBet(b)} onSettle={quickSettle} onShare={setSharing} />
      <ShareDialog bet={sharing} onClose={() => setSharing(null)} />
      </>}
    </>
  );
}

// Sin ninguna apuesta de este deporte: en vez de cinco cifras a cero y una gráfica vacía, qué hacer para empezar
function FirstBet({ onNew }: { onNew: () => void }) {
  return (
    <Card>
      <Empty icon={<Wallet size={22} />}>
        <p className="max-w-md text-zinc-300">Aún no has apuntado apuestas de este deporte.</p>
        <p className="mt-1 max-w-md text-xs text-zinc-500">Pulsa una cuota en un partido para añadirla al cupón y apuntarla desde ahí, o apúntala a mano. Aquí verás tu beneficio, el ROI y su evolución.</p>
        <Button className="mt-4" onClick={onNew}><Plus size={16} />Nueva apuesta</Button>
      </Empty>
    </Card>
  );
}

// Lo que está en juego, lo primero: es lo que se viene a mirar justo después de apostar (antes quedaba bajo las cifras y la
// gráfica, al final del historial)
function Pending({ bets, onEdit, onSettle, onShare }: {
  bets: Bet[]; onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void; onShare: (b: Bet) => void;
}) {
  const cur = useCurrency();
  const list = useMemo(() => bets.filter(b => b.status === 'pending').sort((a, b) => b.date.localeCompare(a.date)), [bets]);
  if (!list.length) return null;
  const s = summarize(list);
  return (
    <Card className="mb-5 overflow-hidden" title={<>En juego <span className="text-sm font-normal text-zinc-500 tnum">{list.length}</span></>}
      action={<span className="text-xs text-zinc-500 tnum">{money(s.pendingStake, cur)} apostados · cobro posible {money(s.pendingReturn, cur)}</span>}>
      <div className="-m-5 divide-y divide-zinc-800/70">
        {list.map(b => <BetCard key={b.id} bet={b} onEdit={onEdit} onSettle={onSettle} onShare={onShare} />)}
      </div>
    </Card>
  );
}

// El beneficio en dinero y, entre paréntesis, en unidades, como lo cuentan los tipsters que no quieren enseñar cuánto apuestan.
// La unidad es la de Tu cuenta o el 1 % de la banca inicial (useUnit); sin ninguna de las dos, sólo el dinero
function useProfit() {
  const cur = useCurrency(), unit = useUnit();
  return (v: number) => ({ money: money(v, cur, true), units: unit > 0 ? units(v / unit) : '' });
}
const profitString = (p: { money: string; units: string }) => (p.units ? `${p.money} (${p.units})` : p.money);

// stacked: las unidades en su línea, debajo (en la tabla del historial, donde no cabe todo en una)
function ProfitText({ value, unitsClass, stacked }: { value: number; unitsClass?: string; stacked?: boolean }) {
  const p = useProfit()(value);
  return <><span className="whitespace-nowrap">{p.money}</span>{p.units && <> <span className={cn('whitespace-nowrap text-[0.85em] font-normal opacity-75', stacked && 'block text-[11px]', unitsClass)}>({p.units})</span></>}</>;
}

function ProfitChart({ bets }: { bets: Bet[] }) {
  const cur = useCurrency();
  const profit = useProfit();
  const [range, setRange] = useState<'all' | '30' | '7'>('all');
  const data = useMemo(() => {
    const since = range === 'all' ? '' : new Date(Date.now() - Number(range) * 86400e3).toISOString().slice(0, 10);
    const settled = bets.filter(b => b.status !== 'pending' && b.status !== 'void' && b.date >= since).sort((a, b) => a.date.localeCompare(b.date));
    let acc = 0;
    const points = settled.map(b => ({ date: fmtDate(b.date), event: b.event, profit: +(acc += betProfit(b)).toFixed(2) }));
    // k: clave única de cada punto. Con la fecha como clave, dos apuestas del mismo día enseñaban en el tooltip la primera
    return (points.length ? [{ date: 'Inicio', event: '', profit: 0 }, ...points] : points).map((p, k) => ({ ...p, k }));
  }, [bets, range]);
  const last = data.at(-1)?.profit ?? 0;
  const color = last >= 0 ? '#55f28c' : '#ff8a7f';

  return (
    <Card title="Evolución del beneficio" action={<Tabs value={range} onChange={setRange} items={[{ value: 'all', label: 'Todo' }, { value: '30', label: '30 días' }, { value: '7', label: '7 días' }]} />}>
      {data.length < 3 ? <Empty>Registra y resuelve al menos 2 apuestas para ver la gráfica</Empty> : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2b3034" vertical={false} />
              <XAxis dataKey="k" tickFormatter={k => data[k]?.date ?? ''} stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} minTickGap={30} />
              <YAxis stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} width={70} tickFormatter={v => money(v, cur)} />
              <ReferenceLine y={0} stroke="#5e6c68" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }} itemStyle={{ color: '#fafafa', fontWeight: 600 }}
                labelStyle={{ color: '#d4d4d8' }}
                formatter={v => [profitString(profit(Number(v))), 'Beneficio acumulado']}
                labelFormatter={(_, p) => p?.[0] ? `${p[0].payload.date} · ${p[0].payload.event}` : ''} />
              <Area type="monotone" dataKey="profit" stroke={color} strokeWidth={2} fill="url(#pg)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// Apostado cuenta también lo pendiente; beneficio y ROI sólo las resueltas (con todo pendiente se ve "—", no 0)
function Breakdown({ title, bets, keyFn }: { title: string; bets: Bet[]; keyFn: (b: Bet) => string }) {
  const cur = useCurrency();
  const rows = useMemo(() => [...groupBy(bets, keyFn)].map(([k, l]) => ({ k, ...summarize(l) })).sort((a, b) => b.profit - a.profit), [bets, keyFn]);
  return (
    <Card title={title} className="overflow-hidden">
      {!rows.length ? <Empty>Sin datos todavía</Empty> : (
        <div className="-m-5 overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead className="bg-zinc-900/60"><tr>
              <th className={th}></th><th className={th + ' text-right'}>Apuestas</th><th className={th + ' text-right'}>Apostado</th>
              <th className={th + ' text-right'}>En juego</th><th className={th + ' text-right'}>Beneficio</th><th className={th + ' text-right'}>ROI</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map(r => (
                <tr key={r.k}>
                  <td className={td + ' font-medium'}>{r.k}</td><td className={td + ' text-right tabular-nums'}>{r.count}</td>
                  <td className={td + ' text-right tabular-nums'}>{money(r.staked + r.pendingStake, cur)}</td>
                  <td className={td + ' text-right tabular-nums text-zinc-400'}>{r.pendingStake ? money(r.pendingStake, cur) : '—'}</td>
                  <td className={td + ' whitespace-nowrap text-right font-semibold tabular-nums ' + (r.settled ? tone(r.profit) : 'text-zinc-500')}>{r.settled ? <ProfitText value={r.profit} /> : '—'}</td>
                  <td className={td + ' text-right tabular-nums ' + (r.settled ? tone(r.roi) : 'text-zinc-500')}>{r.settled ? pct(r.roi) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function History({ bets, onEdit, onSettle, onShare }: {
  bets: Bet[]; onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void; onShare: (b: Bet) => void;
}) {
  const cur = useCurrency();
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  // Periodo: '' (todas las fechas), 'd7', 'd30', 'y:2026', 'm:2026-11' o 'range' con las dos fechas (src/lib/bet-period.ts)
  const [period, setPeriod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const groups = useMemo(() => periodGroups(bets.map(b => b.date)), [bets]);
  const bounds = useMemo(() => periodBounds(period, madridDay(new Date().toISOString()), from, to), [period, from, to]);
  const list = useMemo(() => bets
    .filter(b => !st || b.status === st)
    .filter(b => inPeriod(b.date, bounds))
    .filter(b => !q || [b.event, b.selection, b.league, b.bookmaker, b.market, b.notes, ...(b.legs || []).map(l => l.market)].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date)), [bets, q, st, bounds]);
  const filtered = !!(q || st || bounds);
  const clear = () => { setQ(''); setSt(''); setPeriod(''); setFrom(''); setTo(''); };

  return (
    <Card className="overflow-hidden" title="Historial" action={
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
          <Select aria-label="Estado" className="h-8 min-w-0 sm:w-48" value={st} onChange={e => setSt(e.target.value)}>
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
      {!list.length ? (
        <Empty>
          {bets.length ? 'Ninguna apuesta coincide con el filtro' : 'Aún no has registrado apuestas. Pulsa "Nueva apuesta".'}
          {filtered && <Button size="sm" variant="secondary" className="mt-3" onClick={clear}>Quitar filtros</Button>}
        </Empty>
      ) : <div className="-m-5">
        {filtered && <FilterSummary list={list} label={periodLabel(period, from, to)} onClear={clear} />}
        <div className="divide-y divide-zinc-800/70 lg:hidden">
          {list.map(b => <BetCard key={b.id} bet={b} onEdit={onEdit} onSettle={onSettle} onShare={onShare} />)}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full">
            <thead className="bg-zinc-900/60"><tr>
              {['Fecha', 'Liga', 'Partido', 'Selección', 'Casa'].map(h => <th key={h} className={th}>{h}</th>)}
              <th className={th + ' text-right'}>Cuota</th><th className={th + ' text-right'}>Stake</th><th className={th}>Estado</th>
              <th className={th + ' text-right'}>Beneficio</th><th className={th}></th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/70">
              {list.map(b => {
                const p = betProfit(b);
                const combo = !!b.legs?.length;
                const done = combo ? b.legs!.filter(l => l.status !== 'pending').length : 0;
                // El mercado va debajo del partido, como en la tarjeta del móvil, y las unidades debajo del beneficio: en una
                // línea no cabían los tres botones de resolver (la tabla se salía por la derecha a 1440 px)
                return (
                  <tr key={b.id} className={cn('group hover:bg-zinc-900/40', combo && 'cursor-pointer')} onClick={combo ? () => onEdit(b) : undefined}
                    title={combo ? 'Abrir la combinada para marcar sus selecciones' : undefined}>
                    <td className={td + ' whitespace-nowrap text-zinc-400'}>{fmtDate(b.date)}</td>
                    <td className={td}>{b.league}</td>
                    {combo ? <>
                      <td className={td}>
                        <Badge tone="warning"><Layers size={11} className="mr-1 inline" />Combinada ×{b.legs!.length}</Badge>
                        <div className="mt-0.5 whitespace-nowrap text-xs text-zinc-500">{b.legs!.length} selecciones{done > 0 && <span className="text-zinc-600"> · {done} resueltas</span>}</div>
                      </td>
                      <td className={td + ' font-semibold'}><span className="block max-w-[14rem] truncate" title={decEs(b.selection)}>{decEs(b.selection)}</span></td>
                    </> : <>
                      <td className={td}>
                        <div className="font-medium">{b.event}</div>
                        <div className="text-xs text-zinc-500">{decEs(b.market)}</div>
                      </td>
                      <td className={td + ' font-semibold'}>{decEs(b.selection)}</td>
                    </>}
                    <td className={td + ' whitespace-nowrap text-zinc-400'}>{b.bookmaker}</td>
                    <td className={td + ' text-right tabular-nums'}>{odd(b.odds)}</td>
                    <td className={td + ' whitespace-nowrap text-right tabular-nums'}>{money(b.stake, cur)}</td>
                    <td className={td + ' whitespace-nowrap'}>
                      <span className="flex items-center gap-1.5"><Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge><AutoMark bet={b} /></span>
                    </td>
                    <td className={td + ' whitespace-nowrap text-right font-semibold tabular-nums ' + (b.status === 'pending' ? 'text-zinc-500' : tone(p))}>
                      <ProfitText value={b.status === 'pending' ? b.stake * (b.odds - 1) : p} stacked />
                    </td>
                    <td className={cn(td, 'px-2')} onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {b.status === 'pending' && !combo && SETTLE.map(x => (
                          <Button key={x.status} size="icon" variant={x.variant} className="h-7 w-7" title={x.title} aria-label={x.title} onClick={() => onSettle(b, x.status)}><x.Icon size={14} /></Button>
                        ))}
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Pasar a un amigo" aria-label="Pasar a un amigo" onClick={() => onShare(b)}><Send size={14} /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" aria-label="Editar" onClick={() => onEdit(b)}><Pencil size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>}
    </Card>
  );
}

// Con algún filtro puesto, lo que suman las apuestas que quedan: así se ve cómo fue un mes sin hacer cuentas
function FilterSummary({ list, label, onClear }: { list: Bet[]; label: string; onClear: () => void }) {
  const cur = useCurrency();
  const s = summarize(list);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800/70 bg-zinc-900/40 px-4 py-2.5 text-xs text-zinc-400 sm:px-5">
      {label && <span className="font-medium text-zinc-100">{label}</span>}
      <span className="tnum">{list.length} apuesta{list.length === 1 ? '' : 's'}{s.pendingCount ? ` (${s.pendingCount} en juego)` : ''}</span>
      <span className="tnum">Apostado <b className="font-semibold text-zinc-200">{money(s.staked + s.pendingStake, cur)}</b></span>
      <span className="tnum">Beneficio <b className={cn('font-semibold', s.settled ? tone(s.profit) : 'text-zinc-500')}>{s.settled ? <ProfitText value={s.profit} /> : '—'}</b></span>
      {s.settled > 0 && <span className="tnum">ROI <b className={cn('font-semibold', tone(s.roi))}>{pct(s.roi)}</b></span>}
      <button type="button" onClick={onClear} className="ml-auto cursor-pointer text-zinc-400 underline-offset-2 transition hover:text-zinc-100 hover:underline">Quitar filtros</button>
    </div>
  );
}

// Resolver a mano desde la lista, sin abrir el formulario. La nula (se devuelve lo apostado) sólo estaba dentro de Editar y
// no se veía; va en azul, como su etiqueta
const SETTLE = [
  { status: 'won', label: 'Ganada', title: 'Ganada', variant: 'success', Icon: Check },
  { status: 'lost', label: 'Perdida', title: 'Perdida', variant: 'danger', Icon: X },
  { status: 'void', label: 'Nula', title: 'Nula: se devuelve lo apostado', variant: 'info', Icon: CircleSlash }
] as const;

// Si la apuesta se resuelve sola (sabe su partido y mercado) o ya se resolvió, con lo que pasó en el partido al pasar el ratón.
// En una combinada puede que sólo algunas selecciones lo sean: las demás se marcan a mano
function AutoMark({ bet: b }: { bet: Bet }) {
  const items = b.legs?.length ? b.legs : [b];
  const auto = items.filter(i => i.ref);
  if (!auto.length) return null;
  const texts = items.map(i => i.ref?.settled?.text).filter(Boolean) as string[];
  const settled = texts.length > 0 && b.status !== 'pending';
  const title = [
    settled ? 'Resuelta sola con el resultado del partido' : 'Se resolverá sola cuando acabe el partido',
    ...texts,
    auto.length < items.length ? `${items.length - auto.length} selección(es) hay que marcarla(s) a mano` : ''
  ].filter(Boolean).join('\n');
  return (
    <span title={title} className="inline-flex shrink-0 items-center gap-1 text-[11px] text-zinc-500">
      <Zap size={11} className={settled ? 'text-amber-400' : ''} />
      {settled ? 'resuelta sola' : auto.length < items.length ? `${auto.length} de ${items.length} automáticas` : 'se resuelve sola'}
    </span>
  );
}

// El historial en el móvil (once columnas no caben) y las que están en juego: cada apuesta es una tarjeta. En el móvil los
// botones de resolver van en su fila y con su nombre: con cinco iconos en la de la fecha no cabía nada más
function BetCard({ bet: b, onEdit, onSettle, onShare }: { bet: Bet; onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void; onShare: (b: Bet) => void }) {
  const cur = useCurrency();
  const p = betProfit(b);
  const combo = !!b.legs?.length;
  const settle = b.status === 'pending' && !combo;
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{decEs(b.selection)}</div>
          <div className="truncate text-xs text-zinc-400">{combo ? `Combinada ×${b.legs!.length}` : `${b.event} · ${decEs(b.market)}`}</div>
        </div>
        <div className={'shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums ' + (b.status === 'pending' ? 'text-zinc-500' : tone(p))}>
          <ProfitText value={b.status === 'pending' ? b.stake * (b.odds - 1) : p} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
        <AutoMark bet={b} />
        <span className="min-w-0 truncate tabular-nums">{[fmtDate(b.date), b.bookmaker, `${money(b.stake, cur)} a ${odd(b.odds)}`].filter(Boolean).join(' · ')}</span>
        <div className="ml-auto flex shrink-0 gap-1">
          {settle && SETTLE.map(x => (
            <Button key={x.status} size="icon" variant={x.variant} className="hidden sm:inline-flex" title={x.title} aria-label={x.title} onClick={() => onSettle(b, x.status)}><x.Icon size={15} /></Button>
          ))}
          <Button size="icon" variant="ghost" title="Pasar a un amigo" aria-label="Pasar a un amigo" onClick={() => onShare(b)}><Send size={15} /></Button>
          <Button size="icon" variant="ghost" title="Editar" aria-label="Editar" onClick={() => onEdit(b)}><Pencil size={15} /></Button>
        </div>
      </div>
      {settle && (
        <div className="mt-2.5 grid grid-cols-3 gap-2 sm:hidden">
          {SETTLE.map(x => (
            <Button key={x.status} size="sm" variant={x.variant} className="h-9" title={x.title} onClick={() => onSettle(b, x.status)}><x.Icon size={14} />{x.label}</Button>
          ))}
        </div>
      )}
    </div>
  );
}
