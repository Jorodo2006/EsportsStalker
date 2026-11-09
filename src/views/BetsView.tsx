import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, Download, Layers, Pencil, Percent, Plus, RefreshCw, Search, Target, Upload, Wallet, X, Zap } from 'lucide-react';
import { useApp, useCurrency, useWallet } from '@/lib/app-context';
import { STATUS_LABEL, betProfit, cn, fmtDate, groupBy, money, odd, pct, summarize, tone } from '@/lib/format';
import type { Bet, BetStatus, LegStatus } from '@/lib/types';
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Select, Stat, Tabs, td, th } from '@/components/ui';

const STATUS_TONE: Record<BetStatus, 'neutral' | 'success' | 'danger' | 'warning'> = {
  pending: 'neutral', won: 'success', halfwon: 'success', lost: 'danger', halflost: 'danger', void: 'neutral', cashout: 'warning'
};


const APP_NAME: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol' };

export default function BetsView() {
  const { openBet, toast, app } = useApp();
  const cur = useCurrency();
  const qc = useQueryClient();
  const { data: all = [], isLoading } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  // Cada app ve sus apuestas; las combinadas que mezclan LoL y baloncesto salen en las dos
  const bets = useMemo(() => all.filter(b => (b.sport || 'lol') === app || b.sport === 'mix'), [all, app]);
  const s = useMemo(() => summarize(bets), [bets]);
  // La cartera es común a todas las apps; las estadísticas de abajo son sólo de esta
  const w = useWallet();

  const [checking, setChecking] = useState(false);

  async function quickSettle(b: Bet, status: BetStatus) {
    // En una combinada el estado sale de sus selecciones: "ganada" las marca todas como ganadas
    const legs = b.legs && status === 'won' ? b.legs.map(l => l.status === 'pending' ? { ...l, status: 'won' as LegStatus } : l) : b.legs;
    await window.api.bets.save({ ...b, status, legs });
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
          }}><RefreshCw size={15} className={cn(checking && 'animate-spin')} />Comprobar resultados</Button>
        <Button onClick={() => openBet()}><Plus size={16} />Nueva apuesta</Button>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        <Stat label="Cartera (todas las apps)" icon={<Wallet size={15} />} value={money(w.balance, cur)}
          sub={`${money(w.inPlay, cur)} en juego · beneficio total ${money(w.profit, cur, true)}`} />
        <Stat label={`Beneficio en ${APP_NAME[app].toLowerCase().replace('lol', 'LoL')}`} value={money(s.profit, cur, true)} valueClass={tone(s.profit)}
          sub={`${s.settled} apuestas resueltas`} />
        <Stat label="ROI / Yield" icon={<Percent size={15} />} value={pct(s.roi)} valueClass={tone(s.roi)} sub={`Apostado ${money(s.staked, cur)}`} />
        <Stat label="Acierto" icon={<Target size={15} />} value={pct(s.hit)} sub={`${s.won} de ${s.settled} · cuota media ${odd(s.avgOdds)}`} />
        <Stat label="Pendientes" value={s.pendingCount} sub={`${money(s.pendingStake, cur)} en juego · retorno ${money(s.pendingReturn, cur)}`} />
      </div>

      <ProfitChart bets={bets} />

      <div className="my-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <Breakdown title="Por casa de apuestas" bets={bets} keyFn={b => b.bookmaker || 'Sin casa'} />
        <Breakdown title="Por liga" bets={bets} keyFn={b => b.league || 'Sin liga'} />
      </div>

      <History bets={bets} onEdit={b => openBet(b)} onSettle={quickSettle} />
    </>
  );
}

function ProfitChart({ bets }: { bets: Bet[] }) {
  const cur = useCurrency();
  const [range, setRange] = useState<'all' | '30' | '7'>('all');
  const data = useMemo(() => {
    const since = range === 'all' ? '' : new Date(Date.now() - Number(range) * 86400e3).toISOString().slice(0, 10);
    const settled = bets.filter(b => b.status !== 'pending' && b.status !== 'void' && b.date >= since).sort((a, b) => a.date.localeCompare(b.date));
    let acc = 0;
    const points = settled.map(b => ({ date: fmtDate(b.date), event: b.event, profit: +(acc += betProfit(b)).toFixed(2) }));
    return points.length ? [{ date: 'Inicio', event: '', profit: 0 }, ...points] : points;
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
              <XAxis dataKey="date" stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} minTickGap={30} />
              <YAxis stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} width={70} tickFormatter={v => money(v, cur)} />
              <ReferenceLine y={0} stroke="#5e6c68" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }} itemStyle={{ color: '#fafafa', fontWeight: 600 }}
                labelStyle={{ color: '#d4d4d8' }}
                formatter={v => [money(Number(v), cur, true), 'Beneficio acumulado']}
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
                  <td className={td + ' text-right font-semibold tabular-nums ' + (r.settled ? tone(r.profit) : 'text-zinc-500')}>{r.settled ? money(r.profit, cur, true) : '—'}</td>
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

function History({ bets, onEdit, onSettle }: {
  bets: Bet[]; onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void;
}) {
  const cur = useCurrency();
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const list = useMemo(() => bets
    .filter(b => !st || b.status === st)
    .filter(b => !q || [b.event, b.selection, b.league, b.bookmaker, b.market, b.notes, ...(b.legs || []).map(l => l.market)].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date)), [bets, q, st]);

  return (
    <Card className="overflow-hidden" title="Historial" action={
      <div className="flex w-full gap-2 sm:w-auto">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input className="h-8 w-full pl-8 sm:w-48" placeholder="Buscar" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Select className="h-8 min-w-0 flex-1 sm:w-44 sm:flex-none" value={st} onChange={e => setSt(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
    }>
      {!list.length ? <Empty>{bets.length ? 'Ninguna apuesta coincide con el filtro' : 'Aún no has registrado apuestas. Pulsa "Nueva apuesta".'}</Empty> : <>
        <div className="-m-5 divide-y divide-zinc-800/70 lg:hidden">
          {list.map(b => <BetCard key={b.id} bet={b} onEdit={onEdit} onSettle={onSettle} />)}
        </div>
        <div className="-m-5 hidden overflow-x-auto lg:block">
          <table className="w-full">
            <thead className="bg-zinc-900/60"><tr>
              {['Fecha', 'Liga', 'Partido', 'Mercado', 'Selección', 'Casa'].map(h => <th key={h} className={th}>{h}</th>)}
              <th className={th + ' text-right'}>Cuota</th><th className={th + ' text-right'}>Stake</th><th className={th}>Estado</th>
              <th className={th + ' text-right'}>Beneficio</th><th className={th}></th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/70">
              {list.map(b => {
                const p = betProfit(b);
                const combo = !!b.legs?.length;
                const done = combo ? b.legs!.filter(l => l.status !== 'pending').length : 0;
                return (
                  <tr key={b.id} className={cn('group hover:bg-zinc-900/40', combo && 'cursor-pointer')} onClick={combo ? () => onEdit(b) : undefined}
                    title={combo ? 'Abrir la combinada para marcar sus selecciones' : undefined}>
                    <td className={td + ' whitespace-nowrap text-zinc-400'}>{fmtDate(b.date)}</td>
                    <td className={td}>{b.league}</td>
                    {combo ? <>
                      <td className={td + ' whitespace-nowrap'}>
                        <span className="flex items-center gap-1.5">
                          <Badge tone="warning"><Layers size={11} className="mr-1 inline" />Combinada ×{b.legs!.length}</Badge>
                        </span>
                      </td>
                      <td className={td + ' whitespace-nowrap text-zinc-400'}>{b.legs!.length} selecciones{done > 0 && <span className="text-zinc-600"> · {done} resueltas</span>}</td>
                      <td className={td + ' font-semibold'}><span className="block max-w-[14rem] truncate" title={b.selection}>{b.selection}</span></td>
                    </> : <>
                      <td className={td + ' font-medium'}>{b.event}</td>
                      <td className={td + ' text-zinc-400'}>{b.market}</td>
                      <td className={td + ' font-semibold'}>{b.selection}</td>
                    </>}
                    <td className={td + ' whitespace-nowrap text-zinc-400'}>{b.bookmaker}</td>
                    <td className={td + ' text-right tabular-nums'}>{odd(b.odds)}</td>
                    <td className={td + ' whitespace-nowrap text-right tabular-nums'}>{money(b.stake, cur)}</td>
                    <td className={td + ' whitespace-nowrap'}>
                      <span className="flex items-center gap-1.5"><Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge><AutoMark bet={b} /></span>
                    </td>
                    <td className={td + ' whitespace-nowrap text-right font-semibold tabular-nums ' + (b.status === 'pending' ? 'text-zinc-500' : tone(p))}>
                      {b.status === 'pending' ? money(b.stake * (b.odds - 1), cur, true) : money(p, cur, true)}
                    </td>
                    <td className={td} onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {b.status === 'pending' && !combo && <>
                          <Button size="icon" variant="success" className="h-7 w-7" title="Ganada" onClick={() => onSettle(b, 'won')}><Check size={14} /></Button>
                          <Button size="icon" variant="danger" className="h-7 w-7" title="Perdida" onClick={() => onSettle(b, 'lost')}><X size={14} /></Button>
                        </>}
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={() => onEdit(b)}><Pencil size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}
    </Card>
  );
}

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

// El historial en el móvil: once columnas no caben, así que cada apuesta es una tarjeta
function BetCard({ bet: b, onEdit, onSettle }: { bet: Bet; onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void }) {
  const cur = useCurrency();
  const p = betProfit(b);
  const combo = !!b.legs?.length;
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{b.selection}</div>
          <div className="truncate text-xs text-zinc-400">{combo ? `Combinada ×${b.legs!.length}` : `${b.event} · ${b.market}`}</div>
        </div>
        <div className={'shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums ' + (b.status === 'pending' ? 'text-zinc-500' : tone(p))}>
          {b.status === 'pending' ? money(b.stake * (b.odds - 1), cur, true) : money(p, cur, true)}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
        <AutoMark bet={b} />
        <span className="min-w-0 truncate tabular-nums">{[fmtDate(b.date), b.bookmaker, `${money(b.stake, cur)} a ${odd(b.odds)}`].filter(Boolean).join(' · ')}</span>
        <div className="ml-auto flex shrink-0 gap-1">
          {b.status === 'pending' && !combo && <>
            <Button size="icon" variant="success" title="Ganada" aria-label="Ganada" onClick={() => onSettle(b, 'won')}><Check size={15} /></Button>
            <Button size="icon" variant="danger" title="Perdida" aria-label="Perdida" onClick={() => onSettle(b, 'lost')}><X size={15} /></Button>
          </>}
          <Button size="icon" variant="ghost" title="Editar" aria-label="Editar" onClick={() => onEdit(b)}><Pencil size={15} /></Button>
        </div>
      </div>
    </div>
  );
}
