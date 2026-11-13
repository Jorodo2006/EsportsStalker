// Recomendaciones de MMA: la apuesta más fiable de un combate, las más fáciles y las más complicadas, y las mejores del día.
// Todo se calcula en el servicio (server/services/mma/picks.js: Elo de los luchadores + cuotas); aquí sólo se enseña y se manda
// al cupón. Las piezas de cada fila son las de tenis y fútbol.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { odd } from '@/lib/format';
import { logPredictions, mmaPredictions } from '@/lib/predictions';
import type { MmaDayPick, MmaFight, MmaPick, MmaPred } from '@/lib/types';
import { esTime, madridDay, surname } from './mma';
import { PickRow, ValueChip } from './TennisPicks';
import { ReliabilityMeter } from './ValuePanel';
import { Empty, ErrorBox, Loading } from './ui';
import { TvBand, TvFrame, TvHeader, TvStat } from './viz';

const p0 = (v: number) => `${Math.round(v * 100)} %`;

// Al cupón con su ref (combate, clave del mercado y selección): el servidor la resolverá sola cuando acabe el combate
export function useMmaAdd() {
  const { addToSlip } = useApp();
  return (m: { id: string; date: string; orgName: string; a: { name: string }; b: { name: string } }, p: MmaPick) => {
    const [key, out] = p.id.split('#');
    addToSlip({
      sport: 'mma', league: m.orgName, event: `${m.a.name} vs ${m.b.name}`, market: p.market, selection: p.selection, bookmaker: p.book, odds: p.price, status: 'pending',
      ref: { sport: 'mma', match: m.id, key, out, start: m.date }
    });
  };
}

export const usePicks = (m: MmaFight) => useQuery({
  queryKey: ['mma', 'picks', m.id], queryFn: () => window.api.mma.picks(madridDay(m.date), m.id),
  enabled: m.state === 'pre' && !m.cancelled, refetchInterval: 60_000, retry: false
});

// Lo que dice el modelo sin mirar las cuotas: quién gana, cómo y cuánto dura
export function PredBlock({ m, pred }: { m: MmaFight; pred: MmaPred }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <TvStat label={surname(m.a.name)} value={p0(pred.pA)} sub="gana · modelo" />
      <TvStat label={surname(m.b.name)} value={p0(pred.pB)} sub="gana · modelo" />
      <TvStat label="KO/TKO" value={p0(pred.method.ko)} sub="del combate" />
      <TvStat label="Sumisión" value={p0(pred.method.sub)} sub="del combate" />
      <TvStat label="Decisión" value={p0(pred.method.dec)} sub="llega al final" />
    </div>
  );
}

export function MmaPicksPanel({ m, onOdds }: { m: MmaFight; onOdds: () => void }) {
  const addPick = useMmaAdd();
  const pre = m.state === 'pre' && !m.cancelled;
  const q = usePicks(m);
  // Se registran para medir después si el modelo acierta
  useEffect(() => {
    const r = q.data;
    if (r?.ready) logPredictions(mmaPredictions(m, [r.top, ...(r.easy ?? []), ...(r.hard ?? [])]));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (p: MmaPick) => addPick(m, p);
  if (!pre) return <Empty>Las recomendaciones son para antes de empezar: el modelo no sigue el combate en directo.</Empty>;
  if (q.isLoading) return <Loading label="Calculando las recomendaciones…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data;
  if (!r?.ready || !r.match) {
    return (
      <div className="flex flex-col items-center gap-3">
        {r?.pred && <TvFrame><TvHeader title="Lo que dice el modelo" sub="sin cuotas todavía"><PredBlock m={m} pred={r.pred} /></TvHeader></TvFrame>}
        {r?.reason === 'noodds'
          ? <><Empty>Todavía no hay cuotas de este combate, y sin ellas no se puede recomendar nada.</Empty><button onClick={onOdds} className="cursor-pointer text-[13px] text-amber-400 hover:underline">Ir a Cuotas y actualizarlas</button></>
          : <Empty>Las recomendaciones son para antes de empezar: el modelo no sigue el combate en directo.</Empty>}
      </div>
    );
  }
  const top = r.top, f = r.match;
  return (
    <TvFrame>
      <TvHeader title="Recomendaciones" sub={[`fiabilidad del modelo: ${r.pred?.reliability ?? '–'}`, r.considered ? `${r.considered} selecciones` : ''].filter(Boolean).join(' · ')}>
        {r.pred && <PredBlock m={m} pred={r.pred} />}
        {f.pMarket != null && <div className="mt-1 text-[11px] text-zinc-400">Las casas dan {p0(f.pMarket)} a {surname(m.a.name)} (sin margen); el modelo pesa un {p0(f.weight)} en la mezcla.</div>}
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
          Ninguna llega al nivel en este combate{f.pMarket != null && Math.abs(f.pModel - f.pMarket) >= 0.1 ? `: el modelo da a ${surname(m.a.name)} un ${p0(f.pModel)} y las casas, un ${p0(f.pMarket)}, y con esa diferencia no hay en qué fiarse.` : '.'}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
        <div><TvBand>Más fáciles</TvBand>{r.easy?.length ? r.easy.map(p => <PickRow key={p.id} pick={p} onAdd={add} />) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}</div>
        <div><TvBand>Más complicadas</TvBand>{r.hard?.length ? r.hard.map(p => <PickRow key={p.id} pick={p} onAdd={add} />) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}</div>
      </div>

      {!!r.warnings?.length && <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-1.5">{r.warnings.map(w => <div key={w} className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle size={12} />{w}</div>)}</div>}
      <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
        Es una estimación, no una garantía: el modelo es un Elo calculado con los combates de UFC, PFL y WOW. En la prueba con unos 1.800 combates acertó un 57 % de los ganadores (las casas, bastante más) y salió bien calibrado, así que
        pesa poco frente a las casas. Con poco historial de un luchador pesa casi todo la casa. Sin cuotas históricas no se ha podido comprobar si a la larga da dinero.
      </p>
    </TvFrame>
  );
}

// Las mejores del día en la lista de combates: cinco, y el resto al pulsar
export function MmaDayPicks({ date, onOpen }: { date: string; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['mma', 'picks-day', date], queryFn: () => window.api.mma.picksDay(date), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false });
  const data = q.data ?? [];
  if (!data.length) return null;
  const list = all ? data : data.slice(0, 5);
  const row = (d: MmaDayPick) => (
    <button key={d.id} onClick={() => onOpen(d.id)} title={`${d.top.market}: ${d.top.selection}. ${d.top.why}`} className="flex w-full cursor-pointer items-center gap-3 border-b border-zinc-800 px-4 py-2.5 text-left transition last:border-0 hover:bg-zinc-800/40">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-zinc-50">{d.top.title}</span>
        <span className="block truncate text-xs text-zinc-500"><span className="tnum">{esTime(d.date)}</span> · {surname(d.a.name)} - {surname(d.b.name)} · {d.orgName}</span>
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
    </TvFrame>
  );
}
