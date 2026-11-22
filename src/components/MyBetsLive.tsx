// «Tus apuestas» arriba de Partidos: las pendientes de hoy (de los cinco deportes, primero las que se están jugando) y cómo van,
// con una barra para las líneas (puntos de un jugador, totales) y quién va por delante en el resto (lib/bet-track.ts). Pulsar
// una abre su partido y, si es de un jugador de baloncesto, sus estadísticas en ese partido (lib/focus-player.ts).
// Sólo las apuestas que saben su partido (ref, las que salen del cupón); las apuntadas a mano sin partido no se pueden seguir.
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useApp, useBets, useCurrency } from '@/lib/app-context';
import { trackOf, playerOf, type LiveGame, type Track } from '@/lib/bet-track';
import { focusPlayer } from '@/lib/focus-player';
import { cn, decEs, money, odd } from '@/lib/format';
import { madridDay } from '@/lib/route';
import type { BasketBox, BasketGame, Bet, BetLeg, BetRef, FootballMatch, MmaFight, Sport, TennisMatch } from '@/lib/types';
import { Card } from './ui';

const SPORT_NAME: Record<Sport, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };
// Desde 24 h antes del partido hasta 12 h después (por si tarda en resolverse)
const BEFORE = 24 * 3600e3, AFTER = 12 * 3600e3;
const sum = (xs: number[]) => xs.reduce((s, x) => s + (Number(x) || 0), 0);

type Leg = Pick<BetLeg, 'event' | 'market' | 'selection' | 'odds'> & { ref: BetRef };
type Row = { bet: Bet; legs: Leg[] };
// El partido de una selección como lo enseña la fila, y lo que necesita el seguimiento
type Snap = { live: LiveGame; label: string; status: string };

const inWindow = (ref: BetRef, now: number) => !!ref.start && +new Date(ref.start) > now - AFTER && +new Date(ref.start) < now + BEFORE;

// Las listas del día de cada deporte, con las mismas claves que sus pantallas: si ya están cargadas no se vuelven a pedir
function listQuery(sport: Sport, day: string, doubles: boolean) {
  if (sport === 'basket') return { queryKey: ['basket', 'games', day], queryFn: () => window.api.basket.games(day) };
  if (sport === 'football') return { queryKey: ['football', 'games', day], queryFn: () => window.api.football.games(day) };
  if (sport === 'tennis') return doubles
    ? { queryKey: ['tennis', 'doubles', day], queryFn: () => window.api.tennis.doubles(day) }
    : { queryKey: ['tennis', 'games', day], queryFn: () => window.api.tennis.games(day) };
  if (sport === 'mma') return { queryKey: ['mma', 'games', day], queryFn: () => window.api.mma.games(day) };
  return null;
}
const listId = (ref: BetRef) => `${ref.sport}|${/^dbl:/.test(ref.match) ? 'd' : 'g'}|${madridDay(ref.start!)}`;

function basketSnap(g: BasketGame, box?: BasketBox): Snap {
  const away = box?.teams.find(t => t.side === 'away'), home = box?.teams.find(t => t.side === 'home');
  const pa = away?.periods ?? [], pb = home?.periods ?? [];
  const fa = Number(g.away.score), fb = Number(g.home.score);
  return {
    live: {
      state: g.state,
      // Como settle.js: 1-2 las mitades (la segunda con la prórroga) y 11-14 los cuartos; en juego, lo que se lleve
      score: p => (p === 0 ? (g.away.score == null ? null : [fa, fb])
        : p === 1 ? (pa.length ? [sum(pa.slice(0, 2)), sum(pb.slice(0, 2))] : null)
          : p === 2 ? (pa.length > 2 ? [sum(pa.slice(2)), sum(pb.slice(2))] : null)
            : p >= 11 && p <= 14 && pa.length > p - 11 ? [pa[p - 11], pb[p - 11]] : null),
      players: box ? [...(away?.players ?? []), ...(home?.players ?? [])] : undefined
    },
    label: g.state === 'pre' ? `${g.away.abbr} @ ${g.home.abbr}` : `${g.away.abbr} ${g.away.score ?? 0}-${g.home.score ?? 0} ${g.home.abbr}`,
    status: g.state === 'in' ? g.status : ''
  };
}

function footballSnap(m: FootballMatch): Snap {
  const goals = m.incidents.filter(e => ['goal', 'penalty', 'owngoal'].includes(e.kind));
  const first = [0, 0] as [number, number];
  for (const e of goals) if (parseInt(e.minute, 10) <= 45) first[e.team === m.home.id ? 0 : 1]++;
  const fa = m.home.score ?? 0, fb = m.away.score ?? 0;
  return {
    live: {
      state: m.off ? 'pre' : m.state,
      score: p => (p === 0 ? [fa, fb] : p === 1 ? first : p === 2 && m.state === 'post' ? [fa - first[0], fb - first[1]] : null),
      scorers: goals.filter(e => e.kind !== 'owngoal').map(e => e.player)
    },
    label: m.state === 'pre' ? `${m.home.short || m.home.name} - ${m.away.short || m.away.name}` : `${m.home.short || m.home.name} ${fa}-${fb} ${m.away.short || m.away.name}`,
    status: m.state === 'in' ? m.status : ''
  };
}

function tennisSnap(m: TennisMatch): Snap {
  const sa = m.a.sets ?? [], sb = m.b.sets ?? [];
  return {
    live: {
      state: m.state,
      score: p => (p === 0 ? [sum(sa), sum(sb)] : p >= 21 && p <= 25 && sa.length > p - 21 ? [sa[p - 21], sb[p - 21]] : null),
      sets: [m.a.setWins.filter(Boolean).length, m.b.setWins.filter(Boolean).length],
      winner: m.state === 'post' ? (m.a.winner ? 'a' : m.b.winner ? 'b' : null) : null
    },
    label: m.state === 'pre' ? `${m.a.short} - ${m.b.short}` : `${m.a.short} ${sa.map((x, i) => `${x}-${sb[i]}`).join(' ')} ${m.b.short}`,
    status: ''
  };
}

function mmaSnap(f: MmaFight): Snap {
  return {
    live: { state: f.cancelled ? 'pre' : f.state, score: () => null, winner: f.state === 'post' && !f.result?.draw && !f.result?.noContest ? f.result?.winner ?? null : null },
    label: `${f.a.name} - ${f.b.name}`, status: f.state === 'in' ? f.status : ''
  };
}

export function MyBetsLive() {
  const { app, openGame, openList, go } = useApp();
  const cur = useCurrency();
  const bets = useBets();

  // Las pendientes con algún partido de hoy; de una combinada, todas sus selecciones con partido
  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    return (bets.data ?? []).filter(b => b.status === 'pending').flatMap(b => {
      const legs: Leg[] = b.legs?.length
        ? b.legs.filter(l => l.ref && l.status === 'pending').map(l => ({ event: l.event, market: l.market, selection: l.selection, odds: l.odds, ref: l.ref! }))
        : b.ref ? [{ event: b.event, market: b.market, selection: b.selection, odds: b.odds, ref: b.ref }] : [];
      return legs.some(l => inWindow(l.ref, now)) ? [{ bet: b, legs }] : [];
    });
  }, [bets.data]);

  const refs = rows.flatMap(r => r.legs.map(l => l.ref)).filter(r => r.start && r.sport !== 'lol');
  const lists = [...new Map(refs.map(r => [listId(r), r])).values()];
  // ¿Alguna en juego ahora? Por la hora (el estado llega con la propia consulta): empezada hace menos de 4 h
  const anyLive = refs.some(r => { const t = +new Date(r.start!); return t < Date.now() && t > Date.now() - 4 * 3600e3; });
  const listQs = useQueries({
    // Cada 15 s mientras se juega alguna, y al volver a la app (en el móvil, al desbloquear); si no, cada minuto
    queries: lists.map(r => ({ ...listQuery(r.sport, madridDay(r.start!), /^dbl:/.test(r.match))!, staleTime: 10_000, refetchInterval: anyLive ? 15_000 : 60_000, refetchOnWindowFocus: true }))
  });
  const games = new Map<string, BasketGame | FootballMatch | TennisMatch | MmaFight>();
  lists.forEach((r, i) => { for (const g of (listQs[i]?.data ?? []) as { id: string }[]) games.set(`${r.sport}|${g.id}`, g as never); });

  // La ficha de baloncesto sólo hace falta para las líneas de jugador y los periodos, y desde que empieza
  const boxIds = [...new Set(refs.filter(r => {
    if (r.sport !== 'basket') return false;
    const g = games.get(`basket|${r.match}`) as BasketGame | undefined;
    const [type, period] = r.key.split('|');
    return g && g.state !== 'pre' && (type === 'player' || Number(period) > 0);
  }).map(r => r.match))];
  const boxQs = useQueries({
    queries: boxIds.map(id => {
      const live = (games.get(`basket|${id}`) as BasketGame | undefined)?.state === 'in';
      return { queryKey: ['basket', 'box', id], queryFn: () => window.api.basket.boxscore(id), refetchInterval: live ? 15_000 : false as const, staleTime: live ? 10_000 : 3600e3, refetchOnWindowFocus: live };
    })
  });
  const boxes = new Map(boxIds.map((id, i) => [id, boxQs[i]?.data]));

  const snapOf = (ref: BetRef): Snap | null => {
    const g = games.get(`${ref.sport}|${ref.match}`);
    if (!g) return null;
    if (ref.sport === 'basket') return basketSnap(g as BasketGame, boxes.get(ref.match));
    if (ref.sport === 'football') return footballSnap(g as FootballMatch);
    if (ref.sport === 'tennis') return tennisSnap(g as TennisMatch);
    if (ref.sport === 'mma') return mmaSnap(g as MmaFight);
    return null;
  };

  if (!rows.length) return null;

  // Primero lo que se está jugando, luego lo que empieza antes; las del deporte que se ve, delante a igualdad
  const rank = (r: Row) => {
    const snaps = r.legs.map(l => snapOf(l.ref));
    const live = snaps.some(s => s?.live.state === 'in');
    const next = Math.min(...r.legs.map(l => +new Date(l.ref.start ?? 0)));
    return (live ? 0 : 1e15) + next + (r.bet.sport === app ? 0 : 1);
  };
  const list = rows.slice().sort((a, b) => rank(a) - rank(b));
  const shown = list.slice(0, 8);

  const open = (l: Leg) => {
    const { ref } = l;
    if (ref.sport === 'lol') { openList('lol'); return; }
    const who = playerOf(ref);
    if (who && ref.sport === 'basket') focusPlayer(ref.match, who);
    openGame(ref.match, ref.start ? madridDay(ref.start) : undefined, ref.sport);
  };

  return (
    <Card title={<>Tus apuestas <span className="text-sm font-normal text-zinc-500 tnum">{rows.length}</span></>}
      action={<button type="button" onClick={() => go('bets')} className="cursor-pointer text-xs text-zinc-400 transition hover:text-zinc-100">Ver todas</button>}>
      <div className="-mx-5 -my-3 divide-y divide-zinc-800/60">
        {shown.map(({ bet, legs }) => {
          const combo = !!bet.legs?.length;
          return (
            <div key={bet.id} className="py-1">
              {combo && (
                <div className="flex items-baseline justify-between gap-3 px-5 pt-1.5 text-xs">
                  <span className="font-medium text-zinc-300">Combinada de {bet.legs!.length}</span>
                  <span className="text-zinc-500 tnum">{money(bet.stake, cur)} a {odd(bet.odds)}</span>
                </div>
              )}
              {legs.map((l, i) => (
                <LegRow key={i} leg={l} snap={snapOf(l.ref)} other={l.ref.sport !== app} onOpen={() => open(l)}
                  stake={combo ? null : money(bet.stake, cur)} />
              ))}
            </div>
          );
        })}
        {list.length > shown.length && (
          <button type="button" onClick={() => go('bets')} className="flex w-full cursor-pointer items-center justify-center gap-1 px-5 py-2.5 text-xs text-zinc-400 transition hover:text-zinc-100">
            {list.length - shown.length} más en Mis apuestas<ChevronRight size={13} />
          </button>
        )}
      </div>
    </Card>
  );
}

const MOOD_TEXT = { good: 'text-emerald-400', bad: 'text-rose-300', even: 'text-zinc-300' } as const;
const MOOD_FILL = { good: 'bg-emerald-500', bad: 'bg-rose-400', even: 'bg-amber-500' } as const;

function when(ref: BetRef) {
  const d = new Date(ref.start!);
  const today = madridDay(new Date().toISOString()) === madridDay(ref.start!);
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  return today ? `Hoy ${time}` : `${d.toLocaleDateString('es-ES', { weekday: 'short', timeZone: 'Europe/Madrid' })} ${time}`;
}

function LegRow({ leg, snap, other, stake, onOpen }: { leg: Leg; snap: Snap | null; other: boolean; stake: string | null; onOpen: () => void }) {
  const t: Track | null = trackOf(leg.ref, snap?.live, leg.selection);
  const state = snap?.live.state;
  const player = leg.ref.sport === 'basket' && !!playerOf(leg.ref);
  // El marcador va a la derecha, para que no se corte en el móvil; debajo, el cuarto y el reloj, o la hora
  return (
    <button type="button" onClick={onOpen} title={player ? 'Ver sus estadísticas en el partido' : 'Abrir el partido'}
      className="group flex w-full cursor-pointer flex-col gap-1.5 px-5 py-2 text-left transition hover:bg-zinc-800/30">
      <span className="flex w-full items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-50">{decEs(leg.selection)}</span>
          <span className="block truncate text-xs text-zinc-500">
            {[other && SPORT_NAME[leg.ref.sport], decEs(leg.market), stake ? `${stake} a ${odd(leg.odds)}` : leg.odds > 1 ? odd(leg.odds) : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="max-w-[45%] shrink-0 text-right text-xs tnum">
          <span className="block truncate font-medium text-zinc-200">{snap?.label ?? leg.event}</span>
          {state === 'in' ? <span className="block truncate text-rose-300">{snap?.status || 'En juego'}</span>
            : state === 'post' ? <span className="block text-zinc-500">Final · por resolver</span>
              : leg.ref.start ? <span className="block text-zinc-400">{when(leg.ref)}</span> : null}
        </span>
        <ChevronRight size={14} className="mt-1 shrink-0 text-zinc-600 transition group-hover:text-zinc-300" />
      </span>
      {t?.kind === 'bar' && <TrackBar t={t} />}
      {t?.kind === 'lead' && <span className={cn('text-xs font-medium', MOOD_TEXT[t.mood])}>{t.text}</span>}
    </button>
  );
}

// La cifra frente a la línea. En un «más de», la barra se llena hasta la línea; en un «menos de», también, y pasarla es perderla
function TrackBar({ t }: { t: Extract<Track, { kind: 'bar' }> }) {
  const fill = Math.min(1, t.line > 0 ? t.value / t.line : 1);
  const v = String(t.value).replace('.', ',');
  const note = t.dnp ? 'No ha jugado'
    : t.over ? (t.value > t.line ? 'Conseguida' : t.done ? 'No llegó' : `Faltan ${String(Math.ceil(t.line - t.value)).replace('.', ',')}`)
      : (t.value > t.line ? 'Se ha pasado' : t.done ? 'Conseguida' : `Margen ${String(Math.ceil(t.line - t.value) - 1).replace('.', ',')}`);
  return (
    <span className="flex w-full items-center gap-3">
      <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={t.line} aria-valuenow={t.value}
        aria-label={`${t.player ? t.player + ', ' : ''}${t.what.toLowerCase()}: ${v} de ${decEs(String(t.line))}`}>
        <span className={cn('absolute inset-y-0 left-0 rounded-full', MOOD_FILL[t.mood])} style={{ width: `${Math.max(fill * 100, t.value ? 4 : 0)}%` }} />
      </span>
      <span className="shrink-0 text-xs tnum">
        <span className={cn('font-semibold', MOOD_TEXT[t.mood])}>{v}</span>
        <span className="text-zinc-500"> / {decEs(String(t.line))}<span className="max-sm:hidden"> {t.what.toLowerCase()}</span></span>
        <span className={cn('ml-2', MOOD_TEXT[t.mood])}>{note}</span>
      </span>
    </span>
  );
}
