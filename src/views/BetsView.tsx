import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, CircleSlash, Download, Pencil, Percent, Plus, RefreshCw, Send, Target, Upload, Wallet, X } from 'lucide-react';
import { ShareDialog } from './FriendsView';
import { TicketUpload } from '@/components/TicketScan';
import { History } from '@/views/bets/History';
import { AutoMark } from '@/views/bets/AutoMark';
import { CombinedChart, MonthlyChart, PerformanceKpis } from '@/views/bets/Performance';
import { Breakdown } from '@/views/bets/Breakdown';
import { ProfitText, profitString, useProfit } from '@/views/bets/Profit';
import { useApp, useCurrency, useWallet } from '@/lib/app-context';
import { STATUS_LABEL, STATUS_TONE, betProfit, cn, decEs, fmtDate, money, odd, pct, summarize, tone } from '@/lib/format';
import type { Bet, BetStatus, LegStatus } from '@/lib/types';
import { Badge, Button, Card, Empty, Loading, PageHeader, Stat, Tabs } from '@/components/ui';



const APP_NAME: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };

export default function BetsView() {
  const { openBet, toast, app } = useApp();
  const cur = useCurrency();
  // La apuesta que se está pasando a un amigo (diálogo de FriendsView)
  const [sharing, setSharing] = useState<Bet | null>(null);
  const qc = useQueryClient();
  const { data: all = [], isLoading } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  // Cada app ve sus apuestas (las combinadas que mezclan deportes salen en todas) o, con «Todo», las de los cinco juntas. Se
  // recuerda la elección en localStorage
  const [scope, setScopeState] = useState<'app' | 'all'>(() => { try { return localStorage.getItem('bets-scope') === 'all' ? 'all' : 'app'; } catch { return 'app'; } });
  const setScope = (v: 'app' | 'all') => { setScopeState(v); try { localStorage.setItem('bets-scope', v); } catch { /* sin localStorage */ } };
  const everything = scope === 'all';
  const bets = useMemo(() => everything ? all : all.filter(b => (b.sport || 'lol') === app || b.sport === 'mix'), [all, app, everything]);
  const s = useMemo(() => summarize(bets), [bets]);
  // La cartera es común a todas las apps; las estadísticas de abajo son sólo de esta
  const w = useWallet();

  const [checking, setChecking] = useState(false);

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
      <PageHeader title="Mis apuestas" subtitle={`${everything ? 'Todos los deportes' : APP_NAME[app]}: registro, beneficio y rendimiento`}>
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
        <TicketUpload />
        <Button className="order-first w-full sm:order-none sm:w-auto" onClick={() => openBet()}><Plus size={16} />Nueva apuesta</Button>
      </PageHeader>

      <div className="-mt-2 mb-5">
        <Tabs value={scope} onChange={setScope} items={[{ value: 'app', label: APP_NAME[app] }, { value: 'all', label: 'Todo' }]} />
      </div>

      {!bets.length ? <FirstBet onNew={() => openBet()} /> : <>

      <Pending bets={bets} onEdit={b => openBet(b)} onSettle={quickSettle} onShare={setSharing} />

      <div className="mb-5 grid grid-cols-2 gap-3 max-md:[&>:last-child:nth-child(odd)]:col-span-2 md:grid-cols-3 2xl:grid-cols-5">
        <Stat label="Cartera (todas las apps)" icon={<Wallet size={15} />} value={money(w.balance, cur)}
          sub={<>{money(w.inPlay, cur)} en juego · beneficio total <ProfitText value={w.profit} /></>} />
        <Stat label={everything ? 'Beneficio de todo' : `Beneficio en ${APP_NAME[app].toLowerCase().replace('lol', 'LoL')}`} value={<ProfitText value={s.profit} unitsClass="text-sm" />} valueClass={tone(s.profit)}
          sub={`${s.settled} apuestas resueltas`} />
        <Stat label="ROI / Yield" icon={<Percent size={15} />} value={pct(s.roi)} valueClass={tone(s.roi)}
          sub={s.pendingStake ? `${money(s.staked, cur)} en resueltas · ${money(s.pendingStake, cur)} pendientes` : `Apostado ${money(s.staked, cur)}`} />
        <Stat label="Acierto" icon={<Target size={15} />} value={pct(s.hit)} sub={`${s.won} de ${s.settled} · cuota media ${odd(s.avgOdds)}`} />
        <Stat label="Pendientes" value={s.pendingCount} sub={`${money(s.pendingStake, cur)} en juego · retorno ${money(s.pendingReturn, cur)}`} />
      </div>

      <PerformanceKpis bets={bets} />

      <ProfitChart bets={bets} />

      <div className="my-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <MonthlyChart bets={bets} />
        <CombinedChart all={all} app={app} />
      </div>

      <Breakdown bets={bets} bySport={everything} />

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

// Resolver a mano desde la lista, sin abrir el formulario. La nula (se devuelve lo apostado) sólo estaba dentro de Editar y
// no se veía; va en azul, como su etiqueta
const SETTLE = [
  { status: 'won', label: 'Ganada', title: 'Ganada', variant: 'success', Icon: Check },
  { status: 'lost', label: 'Perdida', title: 'Perdida', variant: 'danger', Icon: X },
  { status: 'void', label: 'Nula', title: 'Nula: se devuelve lo apostado', variant: 'info', Icon: CircleSlash }
] as const;

// Cada apuesta de «En juego» es una tarjeta. En el móvil los botones de resolver van en su fila y con su nombre: con cinco iconos
// en la de la fecha no cabía nada más
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
