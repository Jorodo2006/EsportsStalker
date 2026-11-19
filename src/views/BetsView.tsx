import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, Download, Pencil, Percent, Plus, RefreshCw, Send, Target, Upload, Wallet, X } from 'lucide-react';
import { ShareDialog } from './FriendsView';
import { History } from '@/views/bets/History';
import { AutoMark } from '@/views/bets/AutoMark';
import { useApp, useCurrency, useWallet } from '@/lib/app-context';
import { STATUS_LABEL, STATUS_TONE, betProfit, cn, decEs, fmtDate, groupBy, money, odd, pct, summarize, tone } from '@/lib/format';
import type { Bet, BetStatus, LegStatus } from '@/lib/types';
import { Badge, Button, Card, Empty, Loading, PageHeader, Stat, Tabs, td, th } from '@/components/ui';



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
          }}><RefreshCw size={15} className={cn(checking && 'animate-spin')} /><span>Comprobar<span className="hidden sm:inline"> resultados</span></span></Button>
        <Button className="order-first w-full sm:order-none sm:w-auto" onClick={() => openBet()}><Plus size={16} />Nueva apuesta</Button>
      </PageHeader>

      {!bets.length ? <FirstBet onNew={() => openBet()} /> : <>

      <Pending bets={bets} onEdit={b => openBet(b)} onSettle={quickSettle} onShare={setSharing} />

      <div className="mb-5 grid grid-cols-2 gap-3 max-md:[&>:last-child:nth-child(odd)]:col-span-2 md:grid-cols-3 2xl:grid-cols-5">
        <Stat label="Cartera (todas las apps)" icon={<Wallet size={15} />} value={money(w.balance, cur)}
          sub={`${money(w.inPlay, cur)} en juego · beneficio total ${money(w.profit, cur, true)}`} />
        <Stat label={`Beneficio en ${APP_NAME[app].toLowerCase().replace('lol', 'LoL')}`} value={money(s.profit, cur, true)} valueClass={tone(s.profit)}
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

function ProfitChart({ bets }: { bets: Bet[] }) {
  const cur = useCurrency();
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

// Cada apuesta de «En juego» es una tarjeta
function BetCard({ bet: b, onEdit, onSettle, onShare }: { bet: Bet; onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void; onShare: (b: Bet) => void }) {
  const cur = useCurrency();
  const p = betProfit(b);
  const combo = !!b.legs?.length;
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{decEs(b.selection)}</div>
          <div className="truncate text-xs text-zinc-400">{combo ? `Combinada ×${b.legs!.length}` : `${b.event} · ${decEs(b.market)}`}</div>
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
          <Button size="icon" variant="ghost" title="Pasar a un amigo" aria-label="Pasar a un amigo" onClick={() => onShare(b)}><Send size={15} /></Button>
          <Button size="icon" variant="ghost" title="Editar" aria-label="Editar" onClick={() => onEdit(b)}><Pencil size={15} /></Button>
        </div>
      </div>
    </div>
  );
}
