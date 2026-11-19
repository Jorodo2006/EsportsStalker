// Recomendaciones de los Challenger, del motor aparte (servicio challenger, server/sharpex-tenis/src/picks.js): la probabilidad del
// modelo mezclada con la de la casa, en dos tipos y tres tramos de cuota.
//  - Alta probabilidad: muy probable y sin regalar el margen, pero sin ventaja sobre la casa. Se dice siempre: sin valor, a la
//    larga se pierde de media el margen de la casa.
//  - Valor: no se enseña mientras valorVisible sea false (en la fase 0 el modelo no ganó a la cuota de cierre); se registra igual.
// Salen en la pestaña Recomendaciones de cada Challenger, en la pantalla Recomendaciones del tenis y en las más fiables del día.
// Fase 4: el riesgo de retirada de cada uno y los avisos físicos (retirada reciente, ranking protegido), que quitan la alta probabilidad.
// Las dos se registran para medir su acierto por tipo y tramo (Mis apuestas → Acierto del modelo).
import { useEffect, useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import { challengerPredictions, logPredictions } from '@/lib/predictions';
import type { ChallengerAviso, ChallengerDay, ChallengerMatchPicks, ChallengerPick, TennisSurface } from '@/lib/types';
import { memberOnly } from './MemberOnly';
import { ReliabilityMeter } from './ValuePanel';
import { today } from './sport';
import { Empty, ErrorBox, Loading } from './ui';
import { TvBand, TvFrame, TvHeader, TvStat, surname } from './viz';

const p0 = (v: number) => `${Math.round(v * 100)} %`;
const signed = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')} %`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const SURFACE: Record<TennisSurface, string> = { Hard: 'Pista dura', Clay: 'Tierra batida', Grass: 'Hierba' };
const TRAMO: Record<ChallengerPick['tramo'], string> = { baja: 'cuota baja', media: 'cuota media', alta: 'cuota alta' };
const AVISO: Record<ChallengerAviso, string> = {
  local: 'Juega en casa', pocos_datos: 'Pocos partidos en el histórico', datos_viejos: 'Sin los resultados de la semana anterior',
  ranking_protegido: 'Ranking protegido', retirada_reciente: 'Retirada reciente', tmo_reciente: 'Tiempo muerto médico reciente'
};
const WHY: Record<NonNullable<ChallengerMatchPicks['descartado']>, string> = {
  sin_modelo: 'Uno de los dos no está en el histórico del motor: sin él no hay probabilidad propia.',
  sin_cuotas: 'Todavía no hay cuotas de este partido. El lector las trae el día del partido.',
  pocos_datos: 'Uno de los dos tiene muy pocos partidos en el histórico: el modelo no tiene en qué apoyarse.',
  discrepancia: 'El modelo y las casas no coinciden en quién gana, y con tanta diferencia lo normal es que falte algo (una lesión, una cuota mal leída).',
  ninguna: 'Ninguna llega al nivel: hace falta un 75 % o más, estar de acuerdo con la casa y no regalar su margen.'
};
const PHYSICAL: ChallengerAviso[] = ['retirada_reciente', 'ranking_protegido', 'tmo_reciente'];
const p1 = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
// La etiqueta de un aviso con su jugador ("Retirada reciente: Kwon"); las físicas en rojo
function Tag({ m, a }: { m: ChallengerMatchPicks; a: ChallengerAviso }) {
  const names = (m.quien?.[a] ?? []).map(s => surname(m[s])).join(', ');
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', PHYSICAL.includes(a) ? 'bg-rose-500/10 text-rose-300' : 'bg-zinc-800 text-zinc-300')}>{AVISO[a]}{names ? `: ${names}` : ''}</span>;
}
const RETIRE_NOTE = 'Si uno se retira, Winamax anula la apuesta al ganador y devuelve lo apostado (en los Challenger no hay Garantía Abandono), y Betway también según las comparativas (sin confirmar en su reglamento): el valor esperado ya lo tiene en cuenta.';
const VALUE_NOTE = 'Valor: oculto. En la fase 0 (155 Challengers de noviembre de 2026) lo que el modelo veía como valor no ganó a la cuota de cierre. Se sigue calculando y midiendo en Acierto del modelo.';
const DISCLAIMER = 'Alta probabilidad no es una apuesta segura ni rentable: sin ventaja sobre la casa, a la larga se pierde de media su margen. La probabilidad mezcla el modelo de los Challenger con las casas, y las casas pesan más.';

export const challengerQuery = (date: string) => ({
  queryKey: ['challenger', 'picks', date], queryFn: () => window.api.challenger.picks(date),
  staleTime: 60_000, refetchInterval: 3 * 60e3, retry: false, enabled: date >= today() && !!window.api.challenger
});

// Se registran todas: las que se enseñan con su aviso de recomendación fuerte y las de Valor ocultas sin él
function useLogChallenger(days: (ChallengerDay | undefined)[]) {
  const stamp = days.map(d => d?.fecha ?? '').join() + days.map(d => d?.partidos.length ?? 0).join();
  useEffect(() => {
    const list = days.flatMap(d => d?.partidos ?? []);
    if (!list.length) return;
    logPredictions(list.flatMap(m => challengerPredictions(m, p => p.visible)));
    logPredictions(list.flatMap(m => challengerPredictions(m, p => !p.visible)), { alert: false });
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
}

const usePickAdd = () => {
  const { addToSlip } = useApp();
  return (m: ChallengerMatchPicks, p: ChallengerPick) => addToSlip({
    sport: 'tennis', status: 'pending', league: m.torneo, event: `${m.a} vs ${m.b}`, market: 'Ganador', selection: p.jugador, bookmaker: p.casa, odds: p.cuota
  });
};


// ---------- Una recomendación ----------
function PickRow({ m, p, withMatch, onOpen, onAdd }: { m: ChallengerMatchPicks; p: ChallengerPick; withMatch?: boolean; onOpen?: () => void; onAdd: () => void }) {
  const text = <>
    <span className="block truncate text-[14px] font-semibold text-zinc-50">Gana {p.jugador}</span>
    <span className="block truncate text-[11px] text-zinc-400">
      {withMatch && <span className="text-zinc-300"><span className="tnum">{hhmm(m.fecha)}</span> · {surname(m.a)} - {surname(m.b)} · </span>}
      {p.tipo === 'probabilidad' ? `Alta probabilidad · ${TRAMO[p.tramo]} · sin ventaja sobre la casa` : `Valor · ${TRAMO[p.tramo]}`}
    </span>
  </>;
  const tip = `Modelo ${p0(p.pModelo)}, casa ${p0(p.pCasa)} sin margen. Fiabilidad ${p.fiabilidad}/100`;
  return (
    <div className="flex items-center gap-3 px-3 py-2 transition hover:bg-zinc-800/30">
      {onOpen
        ? <button onClick={onOpen} title={`${tip}. Pulsa para abrir el partido`} className="min-w-0 flex-1 cursor-pointer text-left">{text}</button>
        : <div title={tip} className="min-w-0 flex-1">{text}</div>}
      {!!p.avisos.length && <span className="hidden shrink-0 gap-1 sm:flex">{p.avisos.map(a => <Tag key={a} m={m} a={a} />)}</span>}
      <span className="w-16 shrink-0 text-right">
        <span className="block font-score text-[18px] font-bold leading-5 text-zinc-50 tnum">{p0(p.p)}</span>
        <span className={cn('block font-score text-[11px] tnum', p.valor >= 0.02 ? 'text-[var(--tv-mark)]' : 'text-zinc-400')} title="Valor esperado por cada euro con esta probabilidad y esta cuota">{signed(p.valor)}</span>
      </span>
      <button onClick={onAdd} title={`Añadir al cupón: ${p.casa}`}
        className="flex h-10 w-[60px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg bg-zinc-800 text-zinc-50 transition hover:bg-zinc-700 hover:text-[var(--tv-mark)]">
        <span className="flex items-center gap-0.5 font-score text-[16px] font-bold leading-none tnum"><Plus size={11} />{odd(p.cuota)}</span>
        <span className="text-[9px] leading-tight opacity-75">{p.casa}</span>
      </button>
    </div>
  );
}

// ---------- Pestaña Recomendaciones de un Challenger ----------
function ChallengerPicksPanelInner({ id, date, onOdds }: { id: string; date: string; onOdds: () => void }) {
  const q = useQuery(challengerQuery(date));
  useLogChallenger([q.data]);
  const add = usePickAdd();
  if (q.isLoading) return <Loading label="Calculando las recomendaciones…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const day = q.data;
  const m = day?.partidos.find(x => x.id === id);
  if (!day || !m) return <Empty>Las recomendaciones son para antes de empezar: el motor de los Challenger sólo mira los partidos que no han empezado.</Empty>;
  const shown = m.picks.filter(p => p.visible && (p.tipo === 'probabilidad' || day.valorVisible));
  const alta = shown.filter(p => p.tipo === 'probabilidad'), valor = shown.filter(p => p.tipo === 'valor');
  const aFav = (m.final ?? m.modelo ?? 0.5) >= 0.5;
  const side = (v: number) => (aFav ? v : 1 - v);
  const fav = aFav ? m.a : m.b;
  const sub = [SURFACE[m.superficie] + (m.superficieConocida ? '' : ' (sin confirmar)'), 'motor de los Challenger', `el modelo pesa un ${Math.round(day.peso * 100)} % frente a la casa`].join(' · ');
  return (
    <TvFrame>
      <TvHeader title="Recomendaciones" sub={sub}>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {m.final != null && <TvStat label={`Gana ${surname(fav)}`} value={p0(side(m.final))} sub="estimación final" />}
          {m.modelo != null && <TvStat label="Modelo" value={p0(side(m.modelo))} sub="sin mirar cuotas" />}
          {m.casa != null && <TvStat label="Casas" value={p0(side(m.casa))} sub="sin su margen" />}
          {m.retirada && <TvStat label="Riesgo de retirada" value={p1(m.retirada.total)} sub="de alguno de los dos" title={`${m.a}: ${p1(m.retirada.a)}. ${m.b}: ${p1(m.retirada.b)}. En los Challenger se retira alguno en el 3,7 % de los partidos`} />}
        </div>
      </TvHeader>
      {(m.fiabilidad || !!m.avisos.length) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-800 px-4 py-2.5">
          {m.fiabilidad && <div className="min-w-40"><div className="mb-1 flex justify-between text-xs font-medium text-zinc-400"><span>Fiabilidad del cálculo</span><span>{m.fiabilidad.label}</span></div><ReliabilityMeter rel={m.fiabilidad} /></div>}
          {!!m.avisos.length && <div className="flex flex-wrap gap-1.5">{m.avisos.map(a => <Tag key={a} m={m} a={a} />)}</div>}
        </div>
      )}

      <TvBand>Alta probabilidad</TvBand>
      {alta.length ? alta.map(p => <PickRow key={p.lado + p.tipo} m={m} p={p} onAdd={() => add(m, p)} />) : (
        <div className="px-4 py-3 text-[13px] text-zinc-300">
          {m.descartado && m.descartado !== 'ninguna' ? WHY[m.descartado] : m.avisos.some(a => PHYSICAL.includes(a)) ? 'Con un aviso físico (una retirada reciente o el ranking protegido de uno de los dos) no se da alta probabilidad.' : WHY.ninguna}
          {m.descartado === 'sin_cuotas' && <button onClick={onOdds} className="ml-2 cursor-pointer text-amber-400 hover:underline">Ir a Cuotas</button>}
        </div>
      )}

      <TvBand>Valor</TvBand>
      {day.valorVisible
        ? (valor.length ? valor.map(p => <PickRow key={p.lado + p.tipo} m={m} p={p} onAdd={() => add(m, p)} />) : <p className="px-4 py-3 text-[13px] text-zinc-300">Ninguna con valor en este partido.</p>)
        : <p className="px-4 py-3 text-[13px] text-zinc-400">{VALUE_NOTE}</p>}

      <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400">{DISCLAIMER} {RETIRE_NOTE}</p>
    </TvFrame>
  );
}

// ---------- Pantalla Recomendaciones: la sección de los Challenger ----------
// days: los días que se miran; until: sólo los que empiezan antes (las próximas 24 horas). onOpen: abrir el partido
export function ChallengerBoard({ days, until, onOpen }: { days: string[]; until?: number; onOpen: (id: string, day: string) => void }) {
  const qs = useQueries({ queries: days.map(challengerQuery) });
  const data = qs.map(q => q.data);
  useLogChallenger(data);
  const add = usePickAdd();
  const stamp = qs.map(q => q.dataUpdatedAt).join();
  const r = useMemo(() => {
    const list = data.flatMap(d => (d?.partidos ?? []).map(m => ({ m, day: d!.fecha }))).filter(x => !until || +new Date(x.m.fecha) < until);
    const visible = (p: ChallengerPick) => p.visible && (p.tipo === 'probabilidad' || data.some(d => d?.valorVisible));
    const picks = list.flatMap(x => x.m.picks.filter(visible).map(p => ({ ...x, p }))).sort((a, b) => b.p.p - a.p.p);
    return { list, alta: picks.filter(x => x.p.tipo === 'probabilidad'), valor: picks.filter(x => x.p.tipo === 'valor'), conCuotas: list.filter(x => x.m.casa != null).length };
  }, [stamp, until]); // eslint-disable-line react-hooks/exhaustive-deps
  const valorVisible = data.some(d => d?.valorVisible);
  if (qs.some(q => q.isLoading)) return <Loading label="Calculando las recomendaciones de los Challenger…" />;
  const err = qs.find(q => q.error)?.error;
  if (err) return <ErrorBox error={err} />;
  return (
    <TvFrame>
      <TvHeader title="Challenger" sub={`${r.list.length} partidos sin empezar · ${r.conCuotas} con cuotas · motor de los Challenger`}>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <TvStat label="Alta probabilidad" value={r.alta.length} sub="sin ventaja sobre la casa" />
        </div>
      </TvHeader>
      <TvBand aside={r.alta.length || undefined}>Alta probabilidad</TvBand>
      {r.alta.length
        ? r.alta.map(x => <PickRow key={x.m.id + x.p.lado} m={x.m} p={x.p} withMatch onOpen={() => onOpen(x.m.id, x.day)} onAdd={() => add(x.m, x.p)} />)
        : <p className="px-4 py-3 text-[13px] text-zinc-300">{r.conCuotas ? 'Ninguna llega al nivel: hace falta un 75 % o más, estar de acuerdo con la casa y no regalar su margen.' : 'Todavía no hay cuotas de los Challenger de estos días. El lector las trae el día del partido.'}</p>}
      <TvBand aside={valorVisible ? r.valor.length || undefined : undefined}>Valor</TvBand>
      {valorVisible
        ? (r.valor.length ? r.valor.map(x => <PickRow key={x.m.id + x.p.lado + 'v'} m={x.m} p={x.p} withMatch onOpen={() => onOpen(x.m.id, x.day)} onAdd={() => add(x.m, x.p)} />) : <p className="px-4 py-3 text-[13px] text-zinc-300">Ninguna con valor.</p>)
        : <p className="px-4 py-3 text-[13px] text-zinc-400">{VALUE_NOTE}</p>}
      <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400">{DISCLAIMER}</p>
    </TvFrame>
  );
}

// ---------- Las más fiables del día: las de los Challenger ----------
// Filas para la banda de la lista de partidos: las de alta probabilidad del día, de la más probable a la menos
export function ChallengerBestRows({ date, max = 3, onOpen }: { date: string; max?: number; onOpen: (id: string, day: string) => void }) {
  const q = useQuery(challengerQuery(date));
  useLogChallenger([q.data]);
  const best = (q.data?.partidos ?? []).flatMap(m => m.picks.filter(p => p.visible && p.tipo === 'probabilidad').map(p => ({ m, p })))
    .sort((a, b) => b.p.p - a.p.p).slice(0, max);
  if (!best.length) return null;
  return <>
    <TvBand>Challenger · alta probabilidad</TvBand>
    {best.map(({ m, p }) => (
      <button key={m.id + p.lado} onClick={() => onOpen(m.id, date)} title={`Modelo ${p0(p.pModelo)}, casa ${p0(p.pCasa)}. Sin ventaja sobre la casa`}
        className="flex w-full cursor-pointer items-center gap-3 border-b border-zinc-800 px-4 py-2.5 text-left transition hover:bg-zinc-800/40">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-zinc-50">Gana {p.jugador}</span>
          <span className="block truncate text-xs text-zinc-500"><span className="tnum">{hhmm(m.fecha)}</span> · {surname(m.a)} - {surname(m.b)} · sin ventaja sobre la casa</span>
        </span>
        <span className="w-11 shrink-0 text-right"><span className="block text-[15px] font-semibold leading-5 text-[var(--tv-mark)] tnum">{p0(p.p)}</span><span className="block text-[11px] text-zinc-500">prob.</span></span>
        <span className="w-11 shrink-0 text-right"><span className="block text-[15px] font-semibold leading-5 text-zinc-50 tnum">{odd(p.cuota)}</span><span className="block text-[11px] text-zinc-500">cuota</span></span>
        <ChevronRight size={14} className="shrink-0 text-zinc-600" />
      </button>
    ))}
  </>;
}

// Sin cuenta, en su lugar sale cómo conseguirlas (las recomendaciones piden cuenta: gateway/public.js)
export const ChallengerPicksPanel = memberOnly(ChallengerPicksPanelInner, 'las recomendaciones del modelo');

// La mejor de alta probabilidad de un Challenger, para la columna del partido elegido
export function useChallengerTop(id: string, date: string, enabled: boolean) {
  const q = useQuery({ ...challengerQuery(date), enabled: enabled && date >= today() && !!window.api.challenger });
  const m = q.data?.partidos.find(x => x.id === id);
  const p = m?.picks.filter(x => x.visible && x.tipo === 'probabilidad').sort((a, b) => b.p - a.p)[0] ?? null;
  return p;
}
