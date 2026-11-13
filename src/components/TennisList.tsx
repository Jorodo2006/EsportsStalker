// Lista de partidos de tenis por torneo, como en las apps de resultados: cada torneo en su panel, con el circuito, la superficie
// y la ciudad en la cabecera, y dentro sus rondas y sus partidos en filas. Los que están en juego se quedan en su torneo, arriba.
// En cada fila: la hora y el estado, los dos jugadores, los juegos de cada set, los sets ganados y la cuota de cada uno.
// Al lado, en pantallas anchas, el partido elegido (TennisSpotlight) con las cuotas, lo que dan las casas y la más fiable.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { cn, odd } from '@/lib/format';
import type { TennisMatch, TennisPlayer, TennisSurface } from '@/lib/types';
import { sized, fallbackTo } from '@/lib/img';
import { LiveDot } from './sport';
import { AtpLogo, ChallengerLogo, WtaLogo } from './tennis-logos';
import { panelCls } from './ui';

type Odds = { a: number; b: number } | null | undefined;
type St = 'pre' | 'live' | 'post';
const stOf = (m: TennisMatch): St => (m.state === 'in' ? 'live' : m.state);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const setsWon = (p: TennisPlayer) => p.setWins.filter(Boolean).length;
const pct = (v: number) => `${Math.round(v * 100)} %`;

export const SURFACE: Record<TennisSurface, { label: string; color: string }> = {
  Hard: { label: 'Pista dura', color: '#5f84cc' }, Clay: { label: 'Tierra batida', color: '#c8743f' }, Grass: { label: 'Hierba', color: '#67ad53' }
};
// Circuito del torneo: su logo en una placa a la izquierda de la cabecera, y su nombre. El del Challenger es apaisado y,
// entero, a este tamaño no se lee: se enseña sólo su placa verde con "ATP" (el nombre del circuito ya va al lado)
const circuitOf = (m: TennisMatch) => (m.level ? 'ATP Challenger' : m.major ? `Grand Slam · ${m.tour.toUpperCase()}` : m.tour.toUpperCase());
function TourBadge({ m, small }: { m: TennisMatch; small?: boolean }) {
  return (
    <span title={circuitOf(m)} className={cn('grid shrink-0 place-items-center rounded-md bg-zinc-900 ring-1 ring-inset ring-zinc-800', small ? 'h-6 w-10' : 'h-8 w-[52px]')}>
      {m.level ? <ChallengerLogo className={cn('rounded object-cover object-[4%_50%]', small ? 'h-[22px] w-[34px]' : 'h-[30px] w-[46px]')} />
        : m.tour === 'wta' ? <WtaLogo className={cn('text-zinc-50', small ? 'h-2.5' : 'h-3.5')} />
          : <AtpLogo className={cn('text-zinc-50', small ? 'h-2.5' : 'h-3.5')} />}
    </span>
  );
}

// La superficie del torneo sale de TennisMyLife (la misma consulta que la ficha del partido). Los Challenger no la tienen
export function useSurface(m: TennisMatch) {
  const q = useQuery({
    queryKey: ['tennis', 'surface', m.tour, m.tournament, m.city], queryFn: () => window.api.tennis.surface(m.tour, m.tournament, m.city),
    staleTime: 6 * 3600e3, retry: false, enabled: !m.level
  });
  return q.data ? SURFACE[q.data] : null;
}

// Sin bandera (los Challenger de LiveScore no la traen) queda el hueco, para que los nombres sigan alineados
function Flag({ p, big }: { p: TennisPlayer; big?: boolean }) {
  const cls = big ? 'h-4 w-6' : 'h-3 w-[18px]';
  if (!p.flag) return <span aria-hidden className={cn('shrink-0', cls)} />;
  return <img src={sized(p.flag, 24)} onError={fallbackTo(p.flag)} alt="" loading="lazy" decoding="async" className={cn('shrink-0 rounded-[2px] object-cover', cls)} />;
}

// ---------- Torneo ----------
// Las rondas en el orden en que se juegan (la que empieza antes, arriba) y, dentro, primero las que están en juego
function roundsOf(list: TennisMatch[]) {
  const by = new Map<string, TennisMatch[]>();
  for (const m of list) by.set(m.round || '', [...(by.get(m.round || '') ?? []), m]);
  const first = (l: TennisMatch[]) => Math.min(...l.map(m => +new Date(m.date)));
  return [...by.entries()]
    .map(([round, l]) => [round, l.slice().sort((x, y) => Number(y.state === 'in') - Number(x.state === 'in') || +new Date(x.date) - +new Date(y.date))] as const)
    .sort((x, y) => first(x[1]) - first(y[1]));
}

export function TournamentGroup({ id, matches, open, onToggle, odds, selected, onPick }: {
  id: string; matches: TennisMatch[]; open: boolean; onToggle: () => void; odds?: Record<string, Odds>; selected?: string | null; onPick: (m: TennisMatch) => void;
}) {
  const m0 = matches[0];
  const surface = useSurface(m0);
  const live = matches.filter(x => x.state === 'in').length;
  const rounds = useMemo(() => roundsOf(matches), [matches]);
  const where = m0.level ? '' : m0.city;
  return (
    <section id={id} className={cn(panelCls, 'scroll-mt-4 overflow-hidden')}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-zinc-900/60">
        <TourBadge m={m0} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-5 text-zinc-50">{m0.tournament}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-zinc-500">
            <span className="shrink-0">{circuitOf(m0)}</span>
            {surface && <><span className="text-zinc-700">·</span><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: surface.color }} /><span className="shrink-0">{surface.label}</span></>}
            {where && <><span className="text-zinc-700">·</span><span className="truncate">{where}</span></>}
          </span>
        </span>
        {!!live && <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-rose-300"><LiveDot />{live} en juego</span>}
        <span className="w-5 shrink-0 text-right text-xs text-zinc-500 tnum">{matches.length}</span>
        <ChevronDown size={16} className={cn('shrink-0 text-zinc-500 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && rounds.map(([round, list]) => (
        <div key={round}>
          {round && <div className="border-t border-zinc-800 bg-zinc-900/50 px-3.5 py-1 text-[11px] font-medium text-zinc-400">{round}</div>}
          <div className="divide-y divide-zinc-800/70 border-t border-zinc-800">
            {list.map(m => <MatchRow key={m.id} m={m} odds={odds?.[m.id]} active={selected === m.id} onClick={() => onPick(m)} />)}
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------- Partido en la lista ----------
function MatchRow({ m, odds, active, onClick }: { m: TennisMatch; odds: Odds; active: boolean; onClick: () => void }) {
  const st = stOf(m);
  const n = Math.max(m.a.sets.length, m.b.sets.length);
  const pts = st === 'live' ? m.points ?? null : null;
  const fav = odds && odds.a && odds.b ? (odds.a <= odds.b ? 'a' : 'b') : null;
  const line = (p: TennisPlayer, o: TennisPlayer, side: 'a' | 'b') => {
    const lost = st === 'post' && !p.winner;
    return (
      <div className="flex h-[22px] min-w-0 items-center gap-2">
        <Flag p={p} />
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', p.winner ? 'font-semibold text-zinc-50' : lost ? 'text-zinc-500' : 'text-zinc-100')} title={p.name}>
          {p.name}{p.seed ? <span className="ml-1 text-[11px] text-zinc-500">({p.seed})</span> : null}
        </span>
        {pts?.server === side && <span title="Saca" aria-label="Saca" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
        {st !== 'pre' && Array.from({ length: n }, (_, i) => (
          <span key={i} className={cn('w-5 shrink-0 text-center font-score text-[13px] tnum',
            st === 'live' && i === n - 1 ? 'font-semibold text-zinc-50' : p.setWins[i] ? 'text-zinc-200' : o.setWins[i] ? 'text-zinc-500' : 'text-zinc-300')}>
            {p.sets[i] ?? ''}{p.tiebreaks[i] != null && <sup className="text-[9px] text-zinc-500">{p.tiebreaks[i]}</sup>}
          </span>
        ))}
        {pts && <span title="Puntos del juego" className="w-7 shrink-0 rounded bg-amber-500/10 text-center font-score text-[12px] font-semibold leading-[18px] text-amber-300 tnum">{pts[side]}</span>}
        {st !== 'pre' && <span title="Sets" className={cn('w-6 shrink-0 border-l border-zinc-800 text-right font-score text-[14px] font-bold tnum', lost ? 'text-zinc-500' : 'text-zinc-50')}>{setsWon(p)}</span>}
        {odds && <span className={cn('w-10 shrink-0 text-right font-score text-[12px] tnum', fav === side ? 'font-semibold text-amber-300' : 'text-zinc-400')}>{odd(odds[side])}</span>}
      </div>
    );
  };
  return (
    <button onClick={onClick} aria-current={active}
      className={cn('relative flex w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left transition', active ? 'bg-zinc-800/60' : 'hover:bg-zinc-900/70')}>
      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-amber-500" />}
      <span className="flex w-12 shrink-0 flex-col text-[12px] leading-[18px]">
        <span className={cn('tnum', st === 'pre' ? 'font-semibold text-zinc-100' : 'text-zinc-500')}>{hhmm(m.date)}</span>
        {st === 'live'
          ? <span className="flex min-w-0 items-center gap-1 font-medium text-rose-300"><LiveDot /><span className="truncate">{m.status || 'En juego'}</span></span>
          : st === 'post' ? <span className="text-zinc-500">Final</span> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">{line(m.a, m.b, 'a')}{line(m.b, m.a, 'b')}</span>
    </button>
  );
}

// ---------- Partido elegido ----------
// La ficha corta del partido elegido: quién juega, el marcador o la hora, las cuotas de ganador con lo que dan las casas sin su
// margen y, si hay, la más fiable de Sharpex. onOpen: la ficha entera, en una pestaña
export function TennisSpotlight({ m, odds, date, onOpen }: { m: TennisMatch; odds: Odds; date: string; onOpen: (tab?: 'odds' | 'picks') => void }) {
  const st = stOf(m);
  const surface = useSurface(m);
  const board = useQuery({
    queryKey: ['tennis', 'board', date], queryFn: () => window.api.tennis.picksBoard(date), staleTime: 60_000, retry: false,
    enabled: st === 'pre' && !m.level
  });
  const top = board.data?.matches.find(x => x.m.id === m.id)?.top ?? null;
  const n = Math.max(m.a.sets.length, m.b.sets.length);
  const pts = st === 'live' ? m.points ?? null : null;
  // Lo que dan las casas a cada uno, quitando su margen
  const pa = odds?.a && odds?.b ? (1 / odds.a) / (1 / odds.a + 1 / odds.b) : null;
  const when = st === 'pre'
    ? `${new Date(m.date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')} · ${hhmm(m.date)}`
    : st === 'live' ? m.status || 'En juego' : 'Final';

  const player = (p: TennisPlayer, o: TennisPlayer, side: 'a' | 'b') => {
    const lost = st === 'post' && !p.winner;
    return (
      <div className="flex min-w-0 items-center gap-3">
        <Flag p={p} big />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[15px] leading-5', p.winner ? 'font-semibold text-zinc-50' : lost ? 'text-zinc-500' : 'font-medium text-zinc-50')}>{p.name}</span>
          <span className="block truncate text-[11px] leading-4 text-zinc-500">{[p.rank ? `n.º ${p.rank}` : '', p.seed ? `cabeza de serie ${p.seed}` : '', p.country].filter(Boolean).join(' · ') || ' '}</span>
        </span>
        {pts?.server === side && <span title="Saca" className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />}
        {st !== 'pre' && Array.from({ length: n }, (_, i) => (
          <span key={i} className={cn('w-6 shrink-0 text-center font-score text-[15px] tnum', p.setWins[i] ? 'font-semibold text-zinc-50' : o.setWins[i] ? 'text-zinc-500' : 'text-zinc-300')}>
            {p.sets[i] ?? ''}{p.tiebreaks[i] != null && <sup className="text-[9px] text-zinc-500">{p.tiebreaks[i]}</sup>}
          </span>
        ))}
        {pts && <span title="Puntos del juego" className="w-8 shrink-0 rounded bg-amber-500/10 text-center font-score text-[14px] font-semibold leading-6 text-amber-300 tnum">{pts[side]}</span>}
        {st !== 'pre' && <span title="Sets" className={cn('w-8 shrink-0 border-l border-zinc-800 text-right font-score text-[20px] font-bold tnum', lost ? 'text-zinc-500' : 'text-zinc-50')}>{setsWon(p)}</span>}
      </div>
    );
  };

  return (
    <section className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <TourBadge m={m} small />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-zinc-100">{m.tournament}</span>
          <span className="block truncate text-[11px] text-zinc-500">{[m.round, surface?.label, m.level ? '' : m.city].filter(Boolean).join(' · ')}</span>
        </span>
        <span className={cn('flex shrink-0 items-center gap-1.5 text-xs font-medium first-letter:uppercase', st === 'live' ? 'text-rose-300' : 'text-zinc-400')}>{st === 'live' && <LiveDot />}{when}</span>
      </div>

      {m.fixed && <div className="flex items-start gap-2 border-b border-zinc-800 px-4 py-2 text-[11px] leading-4 text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{m.fixed}</div>}
      <div className="flex flex-col gap-3 px-4 py-4">{player(m.a, m.b, 'a')}{player(m.b, m.a, 'b')}</div>

      {odds && pa != null && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-zinc-500"><span>Ganador · mejor cuota</span><span>Probabilidad de las casas</span></div>
          <div className="grid grid-cols-2 gap-2">
            {(['a', 'b'] as const).map(s => {
              const p = m[s], best = (s === 'a' ? pa : 1 - pa) >= 0.5;
              return (
                <button key={s} onClick={() => onOpen('odds')} title="Comparar las cuotas de las casas"
                  className={cn('flex h-10 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md px-3 text-sm transition',
                    best ? 'bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/35 hover:bg-amber-500/20' : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700')}>
                  <span className="min-w-0 truncate text-xs font-medium opacity-80">{p.name.split(' ').pop()}</span>
                  <span className="font-score font-semibold tnum">{odd(odds[s])}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-amber-500" style={{ width: `${pa * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-zinc-400 tnum"><span>{pct(pa)}</span><span>{pct(1 - pa)}</span></div>
        </div>
      )}

      {top && (
        <button onClick={() => onOpen('picks')} title="Ver todas las recomendaciones del partido"
          className="flex w-full cursor-pointer items-center gap-3 border-t border-zinc-800 px-4 py-3 text-left transition hover:bg-zinc-900/70">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium text-zinc-500">La más fiable de Sharpex</span>
            <span className="block truncate text-[14px] font-semibold text-zinc-50">{top.title}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-score text-[17px] font-bold leading-5 text-amber-400 tnum">{pct(top.p)}</span>
            <span className="block text-[11px] text-zinc-500 tnum">{odd(top.price)} · {top.book}</span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-zinc-600" />
        </button>
      )}

      <div className="border-t border-zinc-800 p-2">
        <button onClick={() => onOpen()} className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-800">
          Ficha del partido<ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
}
