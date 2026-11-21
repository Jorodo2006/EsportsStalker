// Partidos de los dos jugadores en la ficha del partido de tenis (pestaña Forma de los jugadores), como en las apps de resultados:
// un selector con cada jugador y su cara a cara en medio; los partidos, agrupados por torneo (circuito, superficie y ciudad en la
// cabecera) y, en cada fila, la fecha y la ronda, los dos jugadores con su bandera (el ganador en negrita), los juegos de cada
// set, los sets ganados y si lo ganó o lo perdió el jugador elegido. Salen de su perfil (ESPN o, en los Challenger,
// TennisMyLife), la misma consulta que su ficha; el cara a cara, de los tres últimos años de TennisMyLife más lo de los dos
// perfiles (lo de esta semana, que TennisMyLife aún no tiene).
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/format';
import { sized, fallbackTo } from '@/lib/img';
import type { SheetTour, TennisPlayer, TennisProfile, TennisResult, TennisSurface } from '@/lib/types';
import { CircuitBadge, CIRCUIT_NAME, type Circuit } from './tennis-logos';
import { SURFACE } from './TennisList';
import { surname } from './viz';
import { Loading, panelCls, seg, segWrap } from './ui';

type View = 'a' | 'h2h' | 'b';
interface Who { id: string; name: string; flag: string }
interface SetScore { top: number; bottom: number; tb: number | null }
interface Row {
  id: string; date: string; tournament: string; round: string; city: string; note: string; circuit: Circuit; major: boolean;
  surface: TennisSurface | null; top: Who; bottom: Who; topWon: boolean; sets: SetScore[];
}

const PAGE = 5;
const FORM_N = 10;

// El marcador llega desde el jugador del perfil ("6-4 3-6 7-6(5)"; el tie-break entre paréntesis son los puntos del que lo perdió)
const SET = /^(\d+)-(\d+)(?:\((\d+)\))?$/;
const setsOf = (score: string): SetScore[] => score.split(/\s+/).flatMap(t => {
  const x = t.match(SET);
  return x ? [{ top: +x[1], bottom: +x[2], tb: x[3] != null ? +x[3] : null }] : [];
});
// Un set cuenta si está acabado (6 o más juegos con dos de ventaja, o 7-6): el que quedó a medias en una retirada, no
const finished = (w: number, l: number) => w > l && w >= 6 && (w - l >= 2 || w === 7);
const setsWon = (r: Row, side: 'top' | 'bottom') => r.sets.filter(s => (side === 'top' ? finished(s.top, s.bottom) : finished(s.bottom, s.top))).length;

// TennisMyLife da el nivel de cada torneo: en la ficha de un Challenger también salen los de la ATP que jugó
const circuitOf = (x: TennisResult, tour: SheetTour): Circuit => (tour !== 'challenger' ? tour : !x.level || x.level === 'C' ? 'challenger' : 'atp');
const rowOf = (x: TennisResult, me: Who, tour: SheetTour): Row => ({
  id: x.id, date: x.date, tournament: x.tournament, round: x.round, city: x.city, note: x.note, circuit: circuitOf(x, tour), major: x.major,
  surface: x.surface ?? null, top: me, bottom: { id: x.opponent.id, name: x.opponent.name, flag: x.opponent.flag }, topWon: x.win, sets: setsOf(x.score)
});
// El mismo partido de dos fuentes (ESPN con su día, TennisMyLife con el lunes de la semana del torneo): mismo marcador y fechas cercanas
const sameMatch = (x: Row, y: Row) => x.topWon === y.topWon && Math.abs(+new Date(x.date) - +new Date(y.date)) <= 16 * 864e5 &&
  x.sets.length === y.sets.length && x.sets.every((s, i) => s.top === y.sets[i].top && s.bottom === y.sets[i].bottom);
const flip = (r: Row): Row => ({ ...r, top: r.bottom, bottom: r.top, topWon: !r.topWon, sets: r.sets.map(s => ({ top: s.bottom, bottom: s.top, tb: s.tb })) });

// El mismo jugador escrito por dos fuentes: LiveScore «Inaki Montes» y TennisMyLife «Inaki Montes De La Torre»
const words = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
const samePlayer = (x: string, y: string) => { const a = words(x), b = words(y); return !!a.length && !!b.length && (a.every(w => b.includes(w)) || b.every(w => a.includes(w))); };
// ¿Es este partido contra p? En ESPN, por su id; en los Challenger (TennisMyLife), por el nombre
const against = (x: TennisResult, p: TennisPlayer, prof: TennisProfile | undefined, tour: SheetTour) =>
  tour === 'challenger' ? (!!prof && samePlayer(x.opponent.name, prof.name)) || samePlayer(x.opponent.name, p.name) : x.opponent.id === p.id;

// Las rondas, cortas para la columna de la fecha
const shortRound = (r: string) => r
  .replace(/^Previa,.*$/, 'Previa').replace(/ de final$/, '').replace(/^Semifinales$/, 'Semis').replace(/^Fase de grupos$/, 'Grupos').replace(/^Dieciseisavos$/, '1/16');
const day = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });

// Los partidos seguidos del mismo torneo van bajo una cabecera (con tres semanas de margen: el mismo torneo de otro año, aparte)
function groupsOf(rows: Row[]) {
  const out: { key: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const g = out[out.length - 1];
    if (g && g.rows[0].tournament === r.tournament && Math.abs(+new Date(g.rows[0].date) - +new Date(r.date)) < 21 * 864e5) g.rows.push(r);
    else out.push({ key: r.id, rows: [r] });
  }
  return out;
}

function FlagImg({ src }: { src: string }) {
  return src
    ? <img src={sized(src, 24)} onError={fallbackTo(src)} alt="" loading="lazy" decoding="async" className="h-3 w-[18px] shrink-0 rounded-[2px] object-cover" />
    : <span aria-hidden className="h-3 w-[18px] shrink-0" />;
}

export function TennisRecent({ tour, a, b, current, onPlayer }: {
  tour: SheetTour; a: TennisPlayer; b: TennisPlayer; current: string; onPlayer: (id: string) => void;
}) {
  const qa = useQuery({ queryKey: ['tennis', 'profile', tour, a.id], queryFn: () => window.api.tennis.profile(tour, a.id), staleTime: 30 * 60e3, retry: false });
  const qb = useQuery({ queryKey: ['tennis', 'profile', tour, b.id], queryFn: () => window.api.tennis.profile(tour, b.id), staleTime: 30 * 60e3, retry: false });
  const qh = useQuery({ queryKey: ['tennis', 'h2h', tour, a.name, b.name], queryFn: () => window.api.tennis.h2h(tour, a.name, b.name), staleTime: 6 * 3600e3, retry: false });
  const [view, setView] = useState<View | null>(null);
  const [page, setPage] = useState(0);
  const meA: Who = { id: a.id, name: a.name, flag: a.flag || qa.data?.flag || '' };
  const meB: Who = { id: b.id, name: b.name, flag: b.flag || qb.data?.flag || '' };

  const own = (list: TennisResult[] | undefined, me: Who) => (list ?? []).filter(x => x.id !== current).map(x => rowOf(x, me, tour));
  // Cara a cara: primero lo de los perfiles (cada uno trae sólo sus últimos torneos, pero con el día y la ciudad) y luego los tres
  // años de TennisMyLife, sin repetir el mismo partido. Siempre con los dos como en el marcador de este partido
  const h2h: Row[] = [];
  const put = (r: Row) => { if (r.id !== current && !h2h.some(x => x.id === r.id || sameMatch(x, r))) h2h.push({ ...r, top: meA, bottom: meB }); };
  for (const x of qa.data?.matches ?? []) if (against(x, b, qb.data, tour)) put(rowOf(x, meA, tour));
  for (const x of qb.data?.matches ?? []) if (against(x, a, qa.data, tour)) put(flip(rowOf(x, meB, tour)));
  for (const x of qh.data?.matches ?? []) put(rowOf(x, meA, tour));
  const lists: Record<View, Row[]> = { a: own(qa.data?.matches, meA), b: own(qb.data?.matches, meB), h2h: h2h.sort((x, y) => +new Date(y.date) - +new Date(x.date)) };

  // De entrada, el cara a cara si se han enfrentado; si no, el primer jugador
  const settled = !qa.isLoading && !qb.isLoading && !qh.isLoading;
  const shown: View = view ?? (lists.h2h.length || !settled ? 'h2h' : 'a');
  const choose = (v: View) => { setView(v); setPage(0); };
  const q = shown === 'a' ? qa : shown === 'b' ? qb : null;
  const loading = q ? q.isLoading : !settled;
  const rows = lists[shown];
  const from = page * PAGE, slice = rows.slice(from, from + PAGE);
  const src = tour === 'challenger' ? 'TennisMyLife' : 'ESPN';
  const aWins = lists.h2h.filter(r => r.topWon).length;

  const tab = (v: View, label: ReactNode, title: string) => (
    <button type="button" role="tab" aria-selected={shown === v} title={title} onClick={() => choose(v)}
      className={cn(seg(shown === v), 'flex min-w-0 flex-1 shrink items-center justify-center gap-1.5 px-2')}>{label}</button>
  );
  const player = (p: TennisPlayer, me: Who) => <><FlagImg src={me.flag} /><span className="truncate">{surname(p.name)}</span></>;

  return (
    <section className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex flex-col gap-2.5 border-b border-zinc-800 px-3.5 py-2.5 sm:flex-row sm:items-center">
        <h3 className="flex-1 text-[14px] font-semibold text-zinc-50">Últimos partidos</h3>
        <div className={cn(segWrap, 'flex w-full sm:w-[420px]')} role="tablist">
          {tab('a', player(a, meA), `Partidos de ${a.name}`)}
          {tab('h2h', <>H2H{settled && <span className="text-zinc-400 tnum">{aWins}-{lists.h2h.length - aWins}</span>}</>, 'Cara a cara: los partidos entre los dos')}
          {tab('b', player(b, meB), `Partidos de ${b.name}`)}
        </div>
      </div>

      {loading ? <div className="px-4"><Loading /></div> : <>
        {shown === 'h2h' ? <H2HHead a={a} b={b} aWins={aWins} bWins={lists.h2h.length - aWins} since={qh.data?.since} />
          : <FormHead p={shown === 'a' ? a : b} me={shown === 'a' ? meA : meB} rows={rows} onPlayer={onPlayer} />}
        {!rows.length ? (
          <p className="border-t border-zinc-800 px-3.5 py-3 text-[13px] text-zinc-400">
            {shown === 'h2h' ? `No se han enfrentado${qh.data?.since ? ` desde ${qh.data.since}` : ' en sus últimos torneos'}.` : q?.error ? `${src} no tiene sus partidos anteriores.` : 'Sin partidos anteriores.'}
          </p>
        ) : groupsOf(slice).map(g => <Group key={g.key} rows={g.rows} mark={shown !== 'h2h'} weekOnly={tour === 'challenger'} onPlayer={onPlayer} />)}
        {rows.length > PAGE && (
          <div className="flex items-center justify-end gap-1 border-t border-zinc-800 px-2 py-1 text-xs text-zinc-400">
            <span className="mr-1 tnum">{from + 1}-{Math.min(from + PAGE, rows.length)} de {rows.length}</span>
            <button type="button" aria-label="Más recientes" disabled={!page} onClick={() => setPage(page - 1)} className={pager}><ChevronLeft size={16} /></button>
            <button type="button" aria-label="Más antiguos" disabled={from + PAGE >= rows.length} onClick={() => setPage(page + 1)} className={pager}><ChevronRight size={16} /></button>
          </div>
        )}
      </>}
    </section>
  );
}
const pager = 'grid h-8 w-8 cursor-pointer place-items-center rounded-md text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-50 disabled:cursor-default disabled:text-zinc-700 disabled:hover:bg-transparent';

// El jugador elegido: su ranking y cómo le han ido los últimos (el más reciente a la derecha)
function FormHead({ p, me, rows, onPlayer }: { p: TennisPlayer; me: Who; rows: Row[]; onPlayer: (id: string) => void }) {
  const last = rows.slice(0, FORM_N), wins = last.filter(r => r.topWon).length;
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2">
      <FlagImg src={me.flag} />
      <button onClick={() => onPlayer(p.id)} title="Ver su ficha" className="min-w-0 cursor-pointer truncate text-[13px] font-semibold text-zinc-100 hover:text-amber-400">{p.name}</button>
      {p.rank && <span className="shrink-0 text-xs text-zinc-500 tnum">n.º {p.rank}</span>}
      {!!last.length && (
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-zinc-400">
          <span className="max-sm:hidden">Últimos {last.length}:</span><span className="font-semibold text-zinc-200 tnum">{wins}-{last.length - wins}</span>
          <span className="flex gap-0.5" aria-hidden>{last.slice().reverse().map(r => <span key={r.id} className={cn('h-2.5 w-1.5 rounded-[1px]', r.topWon ? 'bg-emerald-500' : 'bg-rose-500')} />)}</span>
        </span>
      )}
    </div>
  );
}

function H2HHead({ a, b, aWins, bWins, since }: { a: TennisPlayer; b: TennisPlayer; aWins: number; bWins: number; since?: string }) {
  return (
    <div className="px-3.5 py-2.5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="truncate text-right text-[13px] font-medium text-zinc-200" title={a.name}>{a.name}</span>
        <span className="font-score text-xl font-bold leading-6 tnum">
          <span className={aWins > bWins ? 'text-zinc-50' : 'text-zinc-500'}>{aWins}</span>
          <span className="mx-1.5 text-zinc-700">–</span>
          <span className={bWins > aWins ? 'text-zinc-50' : 'text-zinc-500'}>{bWins}</span>
        </span>
        <span className="truncate text-[13px] font-medium text-zinc-200" title={b.name}>{b.name}</span>
      </div>
      <p className="mt-1 text-center text-[11px] text-zinc-500">{since ? `Partidos desde ${since}` : 'En sus últimos torneos'}</p>
    </div>
  );
}

// Un torneo: su cabecera y sus partidos. mark: la G o la P del jugador elegido (el de arriba en cada fila)
function Group({ rows, mark, weekOnly, onPlayer }: { rows: Row[]; mark: boolean; weekOnly: boolean; onPlayer: (id: string) => void }) {
  const r0 = rows[0];
  const surface = r0.surface ? SURFACE[r0.surface] : null;
  const circuit = r0.major ? `Grand Slam · ${CIRCUIT_NAME[r0.circuit]}` : CIRCUIT_NAME[r0.circuit];
  return (
    <div className="border-t border-zinc-800">
      <div className="flex items-center gap-2.5 bg-zinc-900/50 px-3.5 py-1.5">
        <CircuitBadge circuit={r0.circuit} size="sm" title={circuit} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-5 text-zinc-100">{r0.tournament}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-zinc-500">
            <span className="shrink-0">{circuit}</span>
            {surface && <><span className="text-zinc-700">·</span><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: surface.color }} /><span className="shrink-0">{surface.label}</span></>}
            {r0.city && <><span className="text-zinc-700">·</span><span className="truncate">{r0.city}</span></>}
          </div>
        </div>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {rows.map(r => <MatchLine key={r.id} r={r} mark={mark} weekOnly={weekOnly} onPlayer={onPlayer} />)}
      </div>
    </div>
  );
}

function MatchLine({ r, mark, weekOnly, onPlayer }: { r: Row; mark: boolean; weekOnly: boolean; onPlayer: (id: string) => void }) {
  const n = r.sets.length;
  const line = (w: Who, side: 'top' | 'bottom') => {
    const won = side === 'top' ? r.topWon : !r.topWon;
    return (
      <div className="flex h-6 min-w-0 items-center gap-2">
        <FlagImg src={w.flag} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1">
          {w.id ? (
            <button onClick={() => onPlayer(w.id)} title={`Ver la ficha de ${w.name}`}
              className={cn('min-w-0 cursor-pointer truncate text-left text-[13px] hover:text-amber-400', won ? 'font-semibold text-zinc-50' : 'text-zinc-400')}>{w.name}</button>
          ) : <span className={cn('min-w-0 truncate text-[13px]', won ? 'font-semibold text-zinc-50' : 'text-zinc-400')}>{w.name}</span>}
          {!won && r.note && <span className="shrink-0 text-[10px] text-zinc-500">{r.note === 'Retirada' ? 'ret.' : r.note}</span>}
        </span>
        {r.sets.map((s, i) => {
          const mine = side === 'top' ? s.top : s.bottom, theirs = side === 'top' ? s.bottom : s.top;
          return (
            <span key={i} className={cn('w-4 shrink-0 text-center font-score text-xs tnum', mine > theirs ? 'text-zinc-200' : 'text-zinc-500', n > 3 && 'max-[400px]:hidden')}>
              {mine}{s.tb != null && mine < theirs && <sup className="text-[8px] text-zinc-500">{s.tb}</sup>}
            </span>
          );
        })}
        <span className={cn('w-5 shrink-0 text-right font-score text-[13px] font-semibold tnum', won ? 'text-zinc-50' : 'text-zinc-500')}>{setsWon(r, side)}</span>
      </div>
    );
  };
  return (
    <div className="flex items-center gap-3 px-3.5 py-1.5">
      <div className="w-[60px] shrink-0 border-r border-zinc-800 pr-2 text-[11px] leading-4 text-zinc-500" title={weekOnly ? 'Semana del torneo: TennisMyLife no da el día' : undefined}>
        <div className="tnum">{day(r.date)}</div>
        <div className="truncate">{shortRound(r.round)}</div>
      </div>
      <div className="min-w-0 flex-1">{line(r.top, 'top')}{line(r.bottom, 'bottom')}</div>
      {mark && (
        <span title={r.topWon ? 'Ganado' : 'Perdido'}
          className={cn('grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-semibold', r.topWon ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>
          {r.topWon ? 'G' : 'P'}
        </span>
      )}
    </div>
  );
}
