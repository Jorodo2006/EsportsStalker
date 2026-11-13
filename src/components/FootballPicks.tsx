// Recomendaciones de fútbol: la apuesta más fiable de un partido, las más fáciles y las más complicadas, y las mejores del
// día. Todo se calcula en el servicio (server/services/football/picks.js, modelo de goles + cuotas); aquí sólo se enseña y
// se manda al cupón. Las piezas de cada fila son las de tenis.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import { footballPredictions, logPredictions } from '@/lib/predictions';
import { verdictOf } from '@/lib/value';
import type { FootballDayPick, FootballMatch, FootballPick } from '@/lib/types';
import { PickRow, ValueChip } from './TennisPicks';
import { ReliabilityMeter } from './ValuePanel';
import { Empty, ErrorBox, Loading } from './ui';
import { TvBand, TvFrame, TvHeader, TvStat } from './viz';

const p0 = (v: number) => `${Math.round(v * 100)} %`;
const g1 = (v: number) => v.toFixed(1).replace('.', ',');
const ago = (ms: number) => { const m = Math.round(ms / 60e3); return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
// El día del partido en España: con él busca el servicio el partido
export const madridDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

export function useFootballAdd() {
  const { addToSlip } = useApp();
  return (m: { leagueName: string; home: { name: string }; away: { name: string } }, p: FootballPick) =>
    addToSlip({ sport: 'football', league: m.leagueName, event: `${m.home.name} - ${m.away.name}`, market: p.market, selection: p.selection, bookmaker: p.book, odds: p.price, status: 'pending' });
}

export function FootballPicksPanel({ m, onOdds }: { m: FootballMatch; onOdds: () => void }) {
  const addPick = useFootballAdd();
  const pre = m.state === 'pre' && !m.off;
  const q = useQuery({
    queryKey: ['football', 'picks', m.id], queryFn: () => window.api.football.picks(madridDay(m.date), m.id), enabled: pre, refetchInterval: 60_000, retry: false
  });
  // Se registran para medir después si el modelo acierta
  useEffect(() => {
    const r = q.data;
    if (r?.ready) logPredictions(footballPredictions(m, [r.top, ...(r.easy ?? []), ...(r.hard ?? [])]));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (p: FootballPick) => addPick(m, p);
  if (!pre) return <Empty>Las recomendaciones son para antes de empezar: el modelo no sigue el marcador en directo.</Empty>;
  if (q.isLoading) return <Loading label="Calculando las recomendaciones…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data;
  if (!r?.ready || !r.match) {
    return r?.reason === 'noodds'
      ? <div className="flex flex-col items-center gap-2"><Empty>Todavía no hay cuotas de este partido, y sin ellas no se puede recomendar nada.</Empty><button onClick={onOdds} className="cursor-pointer text-[13px] text-amber-400 hover:underline">Ir a Cuotas y actualizarlas</button></div>
      : <Empty>{r?.reason === 'nomodel' ? 'El modelo no cubre esta competición.' : 'Las recomendaciones son para antes de empezar: el modelo no sigue el marcador en directo.'}</Empty>;
  }
  const f = r.match, top = r.top;
  const sub = [`${g1(f.goalsHome)} - ${g1(f.goalsAway)} goles esperados`, r.oddsAge != null ? `cuotas ${ago(r.oddsAge)}` : ''].filter(Boolean).join(' · ');
  return (
    <TvFrame>
      <TvHeader title="Recomendaciones" sub={sub}>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <TvStat label={m.home.short || m.home.name} value={p0(f.home)} sub="modelo" />
          <TvStat label="Empate" value={p0(f.draw)} sub="modelo" />
          <TvStat label={m.away.short || m.away.name} value={p0(f.away)} sub="modelo" />
          {f.pMarketHome != null && <TvStat label="Casas" value={p0(f.pMarketHome)} sub="gana el local, sin margen" />}
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
          Ninguna llega al nivel en este partido{f.pMarketHome != null && Math.abs(f.home - f.pMarketHome) >= 0.1 ? `: el modelo da al ${m.home.name} un ${p0(f.home)} y las casas, un ${p0(f.pMarketHome)}, y con esa diferencia no hay en qué fiarse.` : '.'}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
        <div><TvBand>Más fáciles</TvBand>{r.easy?.length ? r.easy.map(p => <PickRow key={p.id} pick={p} onAdd={add} />) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}</div>
        <div><TvBand>Más complicadas</TvBand>{r.hard?.length ? r.hard.map(p => <PickRow key={p.id} pick={p} onAdd={add} />) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}</div>
      </div>

      {!!r.warnings?.length && <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-1.5">{r.warnings.map(w => <div key={w} className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle size={12} />{w}</div>)}</div>}
      <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
        Es una estimación, no una garantía: mezcla un modelo de goles (ataque y defensa de cada equipo) con las casas, y las casas pesan más. Probado con unos 2.800 partidos de 2025 y 2026: en el 1X2 sale bien calibrado; en los goles acierta poco más que la casa. Sin cuotas históricas no se ha podido comprobar si a la larga da dinero.
      </p>
    </TvFrame>
  );
}

// ---------- Pantalla Recomendaciones ----------
// Los partidos de un día con cuotas: la más fiable de cada uno (de la más probable a la menos) y, aparte, la más complicada
// de cada uno (de la de más valor a la de menos). Al pulsar una, se abre su partido; la cuota la manda al cupón
function BoardRow({ d, p, onOpen, onAdd }: { d: FootballDayPick; p: FootballPick; onOpen: (id: string) => void; onAdd: (d: FootballDayPick, p: FootballPick) => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 transition hover:bg-zinc-800/30">
      <button onClick={() => onOpen(d.id)} title={`${p.market}: ${p.selection}. ${p.why}. Pulsa para abrir el partido`} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className="block truncate text-[14px] font-semibold text-zinc-50">{p.title}</span>
        <span className="block truncate text-[11px] text-zinc-400"><span className="tnum">{esTime(d.date)}</span> · {d.home.short || d.home.name} - {d.away.short || d.away.name} · {d.leagueName}</span>
      </button>
      <span className="w-14 shrink-0 text-right">
        <span className="block font-score text-[18px] font-bold leading-5 text-zinc-50 tnum">{p0(p.p)}</span>
        <ValueChip pick={p} />
      </span>
      <button onClick={() => onAdd(d, p)} title={`Añadir al cupón: ${p.book}. Justa: ${odd(p.fair)}`}
        className="flex h-10 w-[60px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg bg-zinc-800 text-zinc-50 transition hover:bg-zinc-700 hover:text-[var(--tv-mark)]">
        <span className="font-score text-[16px] font-bold leading-none tnum">{odd(p.price)}</span>
        <span className="text-[9px] leading-tight opacity-75">{p.book}</span>
      </button>
    </div>
  );
}

export function FootballPicksPage({ days, onOpen }: { days: { value: string; label: string }[]; onOpen: (id: string) => void }) {
  const [date, setDate] = useState(days[0].value);
  const addPick = useFootballAdd();
  const q = useQuery({ queryKey: ['football', 'picks-day', date], queryFn: () => window.api.football.picksDay(date), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false });
  const data = q.data ?? [];
  const tops = data.slice().sort((x, y) => y.top.p - x.top.p);
  const hard = data.filter(d => d.hard).sort((x, y) => y.hard!.ev - x.hard!.ev);
  const add = (d: FootballDayPick, p: FootballPick) => addPick(d, p);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        {days.map(d => (
          <button key={d.value} onClick={() => setDate(d.value)} aria-pressed={date === d.value}
            className={cn('h-8 cursor-pointer rounded-md px-3 text-[13px] font-medium transition', date === d.value ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}>
            {d.label}
          </button>
        ))}
      </div>
      {q.isLoading ? <Loading label="Calculando las recomendaciones…" /> : q.error ? <ErrorBox error={q.error} /> : !data.length
        ? <Empty>Ese día no hay partidos con cuotas leídas todavía, y sin ellas no se puede recomendar nada. El lector las trae unas horas antes de cada partido.</Empty>
        : (
          <TvFrame>
            <TvHeader title="Recomendaciones" sub={`${data.length} ${data.length === 1 ? 'partido' : 'partidos'} con cuotas`}>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <TvStat label="Con valor" value={[...tops.map(d => d.top), ...hard.map(d => d.hard!)].filter(p => verdictOf(p.ev, p.rel.score) === 'BET').length} sub="valor 2 % o más" />
              </div>
            </TvHeader>
            <div className="grid grid-cols-1 divide-y divide-zinc-800 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
              <div className="min-w-0">
                <TvBand aside={tops.length}>La más fiable de cada partido</TvBand>
                {tops.map(d => <BoardRow key={d.id} d={d} p={d.top} onOpen={onOpen} onAdd={add} />)}
              </div>
              <div className="min-w-0">
                <TvBand aside={hard.length || undefined}>Más complicadas</TvBand>
                {hard.length ? hard.map(d => <BoardRow key={d.id} d={d} p={d.hard!} onOpen={onOpen} onAdd={add} />) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}
              </div>
            </div>
            <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
              Es una estimación, no una garantía: mezcla un modelo de goles con las casas, y las casas pesan más. En la ficha de cada partido están todas sus recomendaciones.
            </p>
          </TvFrame>
        )}
    </div>
  );
}

// Las mejores del día, al lado de la lista de partidos: cinco, el resto al pulsar y el enlace a la pantalla Recomendaciones
export function FootballDayPicks({ date, onOpen, onAll }: { date: string; onOpen: (id: string) => void; onAll?: () => void }) {
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['football', 'picks-day', date], queryFn: () => window.api.football.picksDay(date), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false });
  const data = q.data ?? [];
  if (!data.length) return null;
  const list = all ? data : data.slice(0, 5);
  const row = (d: FootballDayPick) => (
    <button key={d.id} onClick={() => onOpen(d.id)} title={`${d.top.market}: ${d.top.selection}. ${d.top.why}`} className="flex w-full cursor-pointer items-center gap-3 border-b border-zinc-800 px-4 py-2.5 text-left transition last:border-0 hover:bg-zinc-800/40">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-zinc-50">{d.top.title}</span>
        <span className="block truncate text-xs text-zinc-500"><span className="tnum">{esTime(d.date)}</span> · {d.home.short || d.home.name} - {d.away.short || d.away.name} · {d.leagueName}</span>
      </span>
      <span className="w-11 shrink-0 text-right"><span className="block text-[15px] font-semibold leading-5 text-[var(--tv-mark)] tnum">{p0(d.top.p)}</span><span className="block text-[11px] text-zinc-500">prob.</span></span>
      <span className="w-11 shrink-0 text-right"><span className="block text-[15px] font-semibold leading-5 text-zinc-50 tnum">{odd(d.top.price)}</span><span className="block text-[11px] text-zinc-500">cuota</span></span>
      <ChevronRight size={14} className="shrink-0 text-zinc-600" />
    </button>
  );
  return (
    <TvFrame>
      <TvBand>Recomendaciones del día</TvBand>
      {list.map(row)}
      {data.length > 5 && (
        <button onClick={() => setAll(v => !v)} className="w-full cursor-pointer border-t border-zinc-800 px-4 py-2 text-left text-[13px] text-amber-400 hover:underline">
          {all ? 'Ver menos' : `Ver las ${data.length}`}
        </button>
      )}
      {onAll && <button onClick={onAll} className="w-full cursor-pointer border-t border-zinc-800 py-2 text-xs text-zinc-400 transition hover:text-zinc-100">Ver todas las recomendaciones</button>}
    </TvFrame>
  );
}
