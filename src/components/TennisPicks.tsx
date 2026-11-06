// Recomendaciones de tenis: la apuesta más fiable de un partido, las más fáciles y las más complicadas, y las mejores del día.
// Todo se calcula en el servicio (server/services/tennis/picks.js); aquí sólo se enseña y se manda al cupón.
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import type { TennisDayPick, TennisMatch, TennisPick, TennisSurface } from '@/lib/types';
import { ReliabilityMeter } from './ValuePanel';
import { Empty, ErrorBox, Loading } from './ui';
import { TvBand, TvFrame, TvHeader, TvStat, surname } from './viz';

const SURFACE: Record<TennisSurface, string> = { Hard: 'Pista dura', Clay: 'Tierra', Grass: 'Hierba' };
const p0 = (v: number) => `${Math.round(v * 100)} %`;
const signed = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')} %`;
const ago = (ms: number) => { const m = Math.round(ms / 60e3); return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

// Sólo se llama valor a lo que lo tiene y además tiene detrás un cálculo fiable
const hasValue = (p: TennisPick) => p.ev >= 0.02 && p.rel.score >= 55;

const restart = (e: unknown) => /No handler registered|is not a function/.test(String(e))
  ? <ErrorBox error="La app tiene que reiniciarse para ver las recomendaciones">Para <code>npm run dev</code> (Ctrl+C) y vuelve a lanzarlo.</ErrorBox>
  : <ErrorBox error={e} />;

function ValueChip({ pick }: { pick: TennisPick }) {
  const good = hasValue(pick);
  return (
    <span title="Valor esperado por cada euro con esta probabilidad y esta cuota. Si es negativo, a la larga gana la casa."
      className={cn('font-score text-[12px] font-semibold tnum', good ? 'text-[var(--tv-mark)]' : 'text-zinc-400')}>{good ? 'Con valor ' : ''}{signed(pick.ev)}</span>
  );
}

function PickRow({ pick, onAdd }: { pick: TennisPick; onAdd: (p: TennisPick) => void }) {
  return (
    <div className="px-3 py-1.5 transition hover:bg-white/[.04]" title={`${pick.market}: ${pick.selection}. Modelo ${p0(pick.pModel)}, casa ${p0(pick.pMarket)}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-zinc-50">{pick.title}</div>
          <div className="truncate text-[11px] text-zinc-400">{pick.why}</div>
        </div>
        <div className="w-14 shrink-0 text-right">
          <div className="font-score text-[20px] font-bold leading-none text-white tnum">{p0(pick.p)}</div>
          <ValueChip pick={pick} />
        </div>
        <button onClick={() => onAdd(pick)} title={`Añadir al cupón: ${pick.book}. Justa: ${odd(pick.fair)}`}
          className="flex h-10 w-[60px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg bg-zinc-800 text-zinc-50 transition hover:bg-zinc-700 hover:text-[var(--tv-mark)]">
          <span className="font-score text-[16px] font-bold leading-none tnum">{odd(pick.price)}</span>
          <span className="text-[9px] leading-tight opacity-75">{pick.book}</span>
        </button>
      </div>
      <div className="mt-1 h-[2px] bg-zinc-800"><div className="h-full bg-[var(--tv-mark)]" style={{ width: `${pick.p * 100}%` }} /></div>
    </div>
  );
}

export function TennisPicksPanel({ m, date, onOdds }: { m: TennisMatch; date: string; onOdds: () => void }) {
  const { addToSlip } = useApp();
  const q = useQuery({
    queryKey: ['tennis', 'picks', m.id], queryFn: () => window.api.tennis.picks(date, m.id), enabled: m.state === 'pre', refetchInterval: 60_000, retry: false
  });
  const add = (p: TennisPick) => addToSlip({ sport: 'tennis', league: m.tournament, event: `${m.a.name} vs ${m.b.name}`, market: p.market, selection: p.selection, bookmaker: p.book, odds: p.price, status: 'pending' });
  if (m.state !== 'pre') return <Empty>Las recomendaciones son para antes de empezar: el modelo no sigue el marcador en directo.</Empty>;
  if (q.isLoading) return <Loading label="Calculando las recomendaciones…" />;
  if (q.error) return restart(q.error);
  const r = q.data;
  if (!r?.ready || !r.match) {
    return r?.reason === 'noodds'
      ? <div className="flex flex-col items-center gap-2"><Empty>Todavía no hay cuotas de este partido, y sin ellas no se puede recomendar nada.</Empty><button onClick={onOdds} className="cursor-pointer text-[13px] text-amber-400 hover:underline">Ir a Cuotas y actualizarlas</button></div>
      : <Empty>Las recomendaciones son para antes de empezar: el modelo no sigue el marcador en directo.</Empty>;
  }
  const f = r.match, top = r.top, fav = f.pFinal >= 0.5 ? m.a : m.b, favP = f.pFinal >= 0.5 ? f.pFinal : 1 - f.pFinal;
  const favModel = f.pFinal >= 0.5 ? f.pModel : 1 - f.pModel;
  const favHouse = f.pMarket == null ? null : f.pFinal >= 0.5 ? f.pMarket : 1 - f.pMarket;
  const place = [r.surface ? SURFACE[r.surface] : 'Superficie sin confirmar', r.indoor ? 'bajo techo' : '', `al mejor de ${r.bestOf}`, r.oddsAge != null ? `cuotas ${ago(r.oddsAge)}` : ''].filter(Boolean).join(' · ');
  return (
    <TvFrame>
      <TvHeader title="Recomendaciones" sub={place}>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <TvStat label={`Gana ${surname(fav.name)}`} value={p0(favP)} sub="estimación final" />
          <TvStat label="Modelo" value={p0(favModel)} sub="sin mirar cuotas" title={`Elo y estadísticas: ${p0(f.pElo)} y ${p0(f.pStats)} para ${m.a.name}`} />
          {favHouse != null && <TvStat label="Casas" value={p0(favHouse)} sub="sin su margen" />}
          <TvStat label="Juegos" value={f.expectedGames.toFixed(1).replace('.', ',')} sub="esperados" />
        </div>
      </TvHeader>

      <TvBand>La más fiable</TvBand>
      {top ? (
        <div className="grid grid-cols-1 items-center gap-x-6 gap-y-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <div className="min-w-0">
            <div className="text-[24px] font-bold leading-tight tracking-tight text-zinc-50">{top.title}</div>
            <div className="mt-1.5 truncate text-[13px] text-zinc-300">{top.why}</div>
          </div>
          <div className="text-center" title={`Modelo ${p0(top.pModel)}, casa ${p0(top.pMarket)}`}>
            <div className="font-mono text-[44px] font-bold leading-[46px] text-[var(--tv-mark)] tnum">{p0(top.p)}</div>
            <div className="font-mono text-xs font-medium text-zinc-400">Probabilidad</div>
          </div>
          <div className="min-w-32">
            <div className="mb-1 flex justify-between font-mono text-xs font-medium text-zinc-400"><span>Fiabilidad</span><span>{top.rel.label}</span></div>
            <ReliabilityMeter rel={top.rel} />
            <div className="mt-1 flex justify-between gap-3 text-[11px] text-zinc-400"><span>Justa <span className="tnum text-zinc-200">{odd(top.fair)}</span></span><ValueChip pick={top} /></div>
          </div>
          <button onClick={() => add(top)} title="Añadir al cupón" className="flex h-[58px] w-[96px] cursor-pointer flex-col items-center justify-center rounded-lg bg-[var(--tv-mark)] text-zinc-950 transition hover:opacity-90">
            <span className="flex items-center gap-1 font-score text-[24px] font-bold leading-none tnum"><Plus size={15} />{odd(top.price)}</span>
            <span className="text-[11px] font-medium">{top.book}</span>
          </button>
        </div>
      ) : (
        <p className="px-4 py-3 text-[13px] text-zinc-300">
          Ninguna llega al nivel en este partido{favHouse != null && Math.abs(favModel - favHouse) >= 0.1 ? `: el modelo da a ${surname(fav.name)} un ${p0(favModel)} y las casas, un ${p0(favHouse)}, y con esa diferencia no hay en qué fiarse.` : '.'}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
        <div><TvBand>Más fáciles</TvBand>{r.easy?.length ? r.easy.map(p => <PickRow key={p.id} pick={p} onAdd={add} />) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}</div>
        <div><TvBand>Más complicadas</TvBand>{r.hard?.length ? r.hard.map(p => <PickRow key={p.id} pick={p} onAdd={add} />) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}</div>
      </div>

      {!!r.warnings?.length && <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-1.5">{r.warnings.map(w => <div key={w} className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle size={12} />{w}</div>)}</div>}
      <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
        Es una estimación, no una garantía: mezcla el modelo con las casas y las casas pesan más. Probado con unos 10.000 partidos de 2025 y 2026: cuando dice 75 %, se cumple cerca del 75 %. Sin cuotas históricas no se ha podido comprobar si a la larga da dinero.
      </p>
    </TvFrame>
  );
}

// Las mejores del día en la lista de partidos
export function TennisDayPicks({ date, onOpen }: { date: string; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['tennis', 'picks-day', date], queryFn: () => window.api.tennis.picksDay(date), enabled: !!window.api.tennis?.picksDay, staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false });
  const list = (q.data ?? []).slice(0, 4);
  if (!list.length) return null;
  // La apuesta arriba y el partido debajo, en dos líneas: en una sola fila el móvil cortaba las dos hasta no leerse
  const row = (d: TennisDayPick) => (
    <button key={d.id} onClick={() => onOpen(d.id)} title={`${d.top.market}: ${d.top.selection}. ${d.top.why}`} className="flex w-full cursor-pointer items-center gap-3 border-b border-zinc-800 px-4 py-2.5 text-left transition last:border-0 hover:bg-zinc-800/40">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-zinc-50">{d.top.title}</span>
        <span className="block truncate text-xs text-zinc-500"><span className="tnum">{esTime(d.date)}</span> · {surname(d.a.name)} - {surname(d.b.name)}</span>
      </span>
      <span className="w-11 shrink-0 text-right"><span className="block text-[15px] font-semibold leading-5 text-[var(--tv-mark)] tnum">{p0(d.top.p)}</span><span className="block text-[11px] text-zinc-500">prob.</span></span>
      <span className="w-11 shrink-0 text-right"><span className="block text-[15px] font-semibold leading-5 text-zinc-50 tnum">{odd(d.top.price)}</span><span className="block text-[11px] text-zinc-500">cuota</span></span>
      <ChevronRight size={14} className="shrink-0 text-zinc-600" />
    </button>
  );
  return <TvFrame><TvBand>Las más fiables del día</TvBand>{list.map(row)}</TvFrame>;
}
