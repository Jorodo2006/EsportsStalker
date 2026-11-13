// Tenis · Partidos: tira de días (hora de España) y filtro por estado arriba; debajo, los partidos agrupados por torneo
// (cada torneo en su panel, con sus rondas) y, en pantallas anchas, al lado el partido elegido. Al abrir uno, su ficha:
// marcador por sets, recomendaciones, cuotas de Winamax y Betway y la forma de los dos jugadores. Como en el baloncesto,
// el selector de arriba cambia a las recomendaciones de todos los partidos.
import { Fragment, useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CalendarX, Plus } from 'lucide-react';
import { sectionId, useApp, useFocus, useSections } from '@/lib/app-context';
import { cn } from '@/lib/format';
import { useMedia } from '@/lib/use-media';
import type { TennisBoardMatch, TennisMatch, TennisPlayer } from '@/lib/types';
import { AdSlot } from '@/components/AdSlot';
import { SportOdds, type OddsTarget } from '@/components/BasketOdds';
import { TennisPlayerSheet } from '@/components/TennisPlayerSheet';
import { TennisDayPicks, TennisPicksPage, TennisPicksPanel } from '@/components/TennisPicks';
import { TennisSpotlight, TournamentGroup } from '@/components/TennisList';
import { TennisCompare } from '@/components/TennisStats';
import { DayStrip, MatchesTitle, Scoreboard, SheetTabs, StateFilterBar, Toggle, today, type MatchState, type StateFilter } from '@/components/sport';
import { Badge, Button, Empty, ErrorBox, Loading, td, th } from '@/components/ui';
import { sized, fallbackTo } from '@/lib/img';
import { Panel, TvTabs, panel } from '@/components/viz';

const stateOf = (m: TennisMatch): MatchState => (m.state === 'in' ? 'live' : m.state);
type Mode = 'games' | 'picks';
export const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const setsWon = (p: TennisPlayer) => p.setWins.filter(Boolean).length;
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };
const label = (p: TennisPlayer) => `${p.name}${p.seed ? ` (${p.seed})` : ''}`;
// El partido que se enseña al lado si no se ha elegido ninguno: de la ATP o la WTA si hay, el primero en juego o, si no, el
// siguiente en empezar
const firstOf = (all: TennisMatch[]) => {
  const main = all.filter(g => !g.level), list = main.length ? main : all;
  return list.find(g => g.state === 'in') ?? list.filter(g => g.state === 'pre').sort((x, y) => +new Date(x.date) - +new Date(y.date))[0] ?? list[0] ?? null;
};

// El partido para el lector, el comparador y el cupón
export const targetOfMatch = (m: TennisMatch): OddsTarget => ({
  id: m.id, done: m.state === 'post', sport: 'tennis', event: `${m.a.name} vs ${m.b.name}`, league: m.tournament,
  match: { a: { name: m.a.name, code: '', alt: m.a.alt }, b: { name: m.b.name, code: '', alt: m.b.alt }, start: m.date, sport: 'tennis', league: m.tournament }
});

function loadPref<T>(key: string, def: T): T { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; } }
function savePref(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }

export default function TennisMatches() {
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<StateFilter>('all');
  // Se entra siempre en Partidos (lo primero son los partidos); Recomendaciones es la otra pestaña
  const [mode, pickMode] = useState<Mode>('games');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<Tab | undefined>();
  // El partido elegido en la lista, que se ve al lado en pantallas anchas
  const [selId, setSelId] = useState<string | null>(null);
  const twoCols = useMedia('(min-width: 1280px)');
  const wide = useMedia('(min-width: 1400px)'); // con la columna del cupón y los anuncios a la derecha (App.tsx)
  const md = useMedia('(min-width: 768px)');
  // La recomendación puede ser de otro día que el de la tira: se guarda el partido que abre mientras llega la lista de ese día
  const [fromPick, setFromPick] = useState<TennisMatch | null>(null);
  const [closed, setClosed] = useState<string[]>(() => loadPref('tennis-closed', []));
  const [showOdds, setShowOdds] = useState(() => loadPref('tennis-odds', true));
  const [quali, setQuali] = useState(() => loadPref('tennis-quali', false));
  const [challengers, setChallengers] = useState(() => loadPref('tennis-challengers', true));
  const ok = !!window.api.tennis;

  const days = useQuery({ queryKey: ['tennis', 'days', date], queryFn: () => window.api.tennis.days(addWeekStart(date), 7), staleTime: 5 * 60e3, enabled: ok });
  const games = useQuery({
    queryKey: ['tennis', 'games', date], queryFn: () => window.api.tennis.games(date), enabled: ok,
    refetchInterval: q => (q.state.data?.some(g => g.state === 'in') ? 15_000 : 120_000)
  });
  // La previa llena el día de partidos que casi nadie apuesta: se puede ocultar
  const all = (games.data ?? []).filter(m => (quali || !/^previa/i.test(m.round)) && (challengers || m.level !== 'challenger'));
  const counts = useMemo(() => ({
    all: all.length, live: all.filter(g => g.state === 'in').length, pre: all.filter(g => g.state === 'pre').length, post: all.filter(g => g.state === 'post').length
  }), [all]);
  const shown = all.filter(g => filter === 'all' || stateOf(g) === filter);
  // Por torneo, con los que están en juego dentro del suyo: los Grand Slam, el circuito y, al final, los Challenger; dentro
  // de cada nivel, primero los torneos con partidos en juego
  const byTour = useMemo(() => {
    const m = new Map<string, TennisMatch[]>();
    for (const g of shown) m.set(`${g.tour}|${g.tournament}`, [...(m.get(`${g.tour}|${g.tournament}`) ?? []), g]);
    const tier = (g: TennisMatch) => (g.major ? 0 : g.level ? 2 : 1);
    const live = (l: TennisMatch[]) => Number(l.some(g => g.state === 'in'));
    return [...m.entries()].sort((x, y) => tier(x[1][0]) - tier(y[1][0]) || live(y[1]) - live(x[1]) || x[0].localeCompare(y[0]));
  }, [shown]);
  const pending = useMemo(() => all.filter(g => g.state !== 'post').map(g => ({ id: g.id, ...targetOfMatch(g).match, start: g.date })), [all]);
  const board = useQuery({
    queryKey: ['board', 'tennis', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: ok && showOdds && pending.length > 0, refetchInterval: 60_000
  });
  const open = (games.data ?? []).find(g => g.id === openId) ?? (fromPick?.id === openId ? fromPick : null);
  useSections(open || mode === 'picks' ? [] : byTour.map(([k, list]) => ({ id: sectionId(k), label: list[0].tournament, count: list.length, live: list.filter(g => g.state === 'in').length })));
  const openMatch = useCallback((id: string, tab?: Tab) => { setOpenTab(tab); setOpenId(id); }, []);
  const has = useCallback((id: string) => (games.data ?? []).some(g => g.id === id), [games.data]);
  useFocus(openMatch, has, setDate);

  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para el tenis hay que parar <code>npm run dev</code> y volver a lanzarlo (cambió el preload).</ErrorBox>;
  const openPick = (x: TennisBoardMatch) => { setFromPick(x.m); setDate(x.day); openMatch(x.m.id); };
  if (open) return <MatchDetail key={open.id} m={open} date={date} initialTab={openTab} onClose={() => { setOpenId(null); setFromPick(null); }} />;

  const modes = <TvTabs value={mode} onChange={pickMode} items={[{ value: 'games' as const, label: 'Partidos' }, { value: 'picks' as const, label: 'Recomendaciones' }]} />;
  if (mode === 'picks') return <div className="flex min-w-0 flex-col gap-5">{modes}<TennisPicksPage onOpen={openPick} /></div>;

  const toggle = (k: string) => { const n = closed.includes(k) ? closed.filter(x => x !== k) : [...closed, k]; setClosed(n); savePref('tennis-closed', n); };
  // Con la columna del partido elegido, el primer toque lo elige y el segundo abre su ficha; sin ella, la abre directamente
  const sel = twoCols ? shown.find(g => g.id === selId) ?? firstOf(shown) : null;
  const pick = (g: TennisMatch) => (twoCols && sel?.id !== g.id ? setSelId(g.id) : openMatch(g.id));
  const dayPicks = <TennisDayPicks date={date} onOpen={openPick} onAll={() => pickMode('picks')} />;
  return (
    <div className="flex flex-col gap-5">
      <MatchesTitle date={date} />
      {modes}
      <DayStrip value={date} onChange={setDate} counts={days.data} />
      <StateFilterBar value={filter} onChange={setFilter} counts={counts}>
        <Toggle on={quali} onChange={v => { setQuali(v); savePref('tennis-quali', v); }} label="Previa" />
        <Toggle on={challengers} onChange={v => { setChallengers(v); savePref('tennis-challengers', v); }} label="Challenger" />
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); savePref('tennis-odds', v); }} label="Cuotas" />
      </StateFilterBar>
      {games.isLoading ? <Loading label="Cargando partidos…" /> : games.error ? <ErrorBox error={games.error} />
        : !shown.length ? <Empty icon={<CalendarX size={22} />}>Ese día no hay partidos de la ATP ni de la WTA con este filtro.</Empty>
          : (
            <div className={cn('grid items-start gap-4', twoCols && 'grid-cols-[minmax(0,1fr)_minmax(320px,400px)]')}>
              <div className="flex min-w-0 flex-col gap-3">
                {byTour.map(([k, list], i) => (
                  <Fragment key={k}>
                    <TournamentGroup id={sectionId(k)} matches={list} open={!closed.includes(k)} onToggle={() => toggle(k)}
                      odds={showOdds ? board.data : undefined} selected={sel?.id} onPick={pick} />
                    {!twoCols && i === 2 && <AdSlot size={md ? 'banner' : 'mobile'} />}
                  </Fragment>
                ))}
              </div>
              {sel && (
                <div className="sticky top-0 flex min-w-0 flex-col gap-4">
                  <TennisSpotlight m={sel} odds={showOdds ? board.data?.[sel.id] : null} date={date} onOpen={tab => openMatch(sel.id, tab)} />
                  {dayPicks}
                  {!wide && <AdSlot size="rect" />}
                </div>
              )}
            </div>
          )}
    </div>
  );
}

type Tab = 'score' | 'odds' | 'picks' | 'form';

// initialTab: la pestaña con la que se abre (desde la columna del partido elegido: cuotas o recomendaciones)
function MatchDetail({ m, date, initialTab, onClose }: { m: TennisMatch; date: string; initialTab?: Tab; onClose: () => void }) {
  const { openBet } = useApp();
  const st = stateOf(m);
  // Los Challenger no tienen modelo ni fichas de jugador: sólo marcador y cuotas (su motor va aparte, servicio challenger)
  const full = !m.level;
  const ok = (t?: Tab) => !!t && (t !== 'picks' || (st === 'pre' && full)) && (t !== 'odds' || st !== 'post');
  const [tab, setTab] = useState<Tab>(ok(initialTab) ? initialTab! : st !== 'pre' ? 'score' : full ? 'picks' : 'odds');
  const t = targetOfMatch(m);
  const [sheet, setSheet] = useState<string | null>(null);
  if (sheet) return <TennisPlayerSheet key={sheet} tour={m.tour} id={sheet} backLabel="Partido" onBack={() => setSheet(null)} onPlayer={setSheet} />;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <button onClick={onClose} className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={16} />Volver a partidos</button>
      <Scoreboard competition={m.tournament} detail={[m.round, m.court].filter(Boolean).join(', ')} state={st}
        a={{ name: label(m.a), short: m.a.country, logo: m.a.flag, score: setsWon(m.a) }}
        b={{ name: label(m.b), short: m.b.country, logo: m.b.flag, score: setsWon(m.b) }}
        center={esTime(m.date)}
        centerSub={st === 'pre' ? new Date(m.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : st === 'live' ? (m.points ? `${m.status} · ${m.points.a}-${m.points.b}` : m.status) : 'Final'}>
        <SheetTabs value={tab} onChange={setTab} items={[
          ['score', 'Marcador'], ...(st === 'pre' && full ? [['picks', 'Recomendaciones']] as [Tab, string][] : []), ...(st === 'post' ? [] : [['odds', 'Cuotas']] as [Tab, string][]), ...(full ? [['form', 'Forma de los jugadores']] as [Tab, string][] : [])
        ]} right={<Button size="sm" onClick={() => openBet({ sport: 'tennis', league: m.tournament, event: t.event })}><Plus size={14} />Apuesta</Button>} />
      </Scoreboard>
      {m.fixed && <p className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle size={13} className="shrink-0" />{m.fixed}</p>}
      {tab === 'score' ? <Sets m={m} /> : tab === 'odds' ? <SportOdds target={t} /> : tab === 'picks' ? <TennisPicksPanel m={m} date={date} onOdds={() => setTab('odds')} /> : <Form m={m} onPlayer={setSheet} />}
    </div>
  );
}

// Marcador por sets, con el tie-break en pequeño y, en juego, los puntos del juego y quién saca
function Sets({ m }: { m: TennisMatch }) {
  const n = Math.max(m.a.sets.length, m.b.sets.length);
  if (!n) return <Empty>El partido aún no ha empezado. Mira las cuotas o la forma de los jugadores mientras tanto.</Empty>;
  const live = m.state === 'in', pts = m.points ?? null;
  const row = (p: TennisPlayer, o: TennisPlayer, side: 'a' | 'b') => (
    <tr>
      <td className={td}><span className="flex items-center gap-2">{p.flag && <img loading="lazy" decoding="async" src={sized(p.flag, 24)} onError={fallbackTo(p.flag)} alt="" className="h-4 w-6 rounded-sm object-cover" />}<span className={cn(p.winner && 'font-semibold text-zinc-50')}>{label(p)}</span>{pts?.server === side && <span title="Saca" aria-label="Saca" className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />}{p.rank && <span className="hidden text-xs text-zinc-500 sm:inline">n.º {p.rank}</span>}</span></td>
      {Array.from({ length: n }, (_, i) => (
        <td key={i} className={cn(td, 'text-center font-score text-xl tnum', p.setWins[i] ? 'font-semibold text-zinc-50' : (o.setWins[i] ? 'text-zinc-500' : 'text-zinc-200'))}>
          {p.sets[i] ?? ''}{p.tiebreaks[i] != null && <sup className="ml-0.5 text-xs text-zinc-500">{p.tiebreaks[i]}</sup>}
        </td>
      ))}
      {pts && <td className={td + ' text-center font-score text-xl font-semibold text-amber-300 tnum'}>{pts[side]}</td>}
    </tr>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-surface">
        <table className="w-full">
          <thead className="bg-zinc-900/60"><tr><th className={th}>Jugador</th>{Array.from({ length: n }, (_, i) => <th key={i} className={th + ' text-center'}><span className="sm:hidden">S{i + 1}</span><span className="hidden sm:inline">Set {i + 1}</span></th>)}{pts && <th className={th + ' text-center'}>{pts.tiebreak ? 'Tie-break' : 'Puntos'}</th>}</tr></thead>
          <tbody className="divide-y divide-zinc-800/60">{row(m.a, m.b, 'a')}{row(m.b, m.a, 'b')}</tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        Al mejor de {m.bestOf} sets.{m.court ? ` ${m.court}, ${m.city}.` : ''}
        {live && (pts ? ` Puntos de ${pts.source}: pueden ir algo por detrás del partido.` : ' Puntos del juego no disponibles ahora mismo.')}
      </p>
    </div>
  );
}

// Lo que lleva cada jugador en los torneos en juego (su camino y los últimos resultados) y su ranking
function Form({ m, onPlayer }: { m: TennisMatch; onPlayer: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <TennisCompare tour={m.tour} a={m.a} b={m.b} tournament={m.tournament} city={m.city} />
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">{[m.a, m.b].map(p => <PlayerForm key={p.id} tour={m.tour} p={p} current={m.id} onPlayer={onPlayer} />)}</div>
      <HeadToHead m={m} />
    </div>
  );
}

// Enfrentamientos recientes entre los dos, de los partidos que ESPN da del primero
function HeadToHead({ m }: { m: TennisMatch }) {
  const q = useQuery({ queryKey: ['tennis', 'profile', m.tour, m.a.id], queryFn: () => window.api.tennis.profile(m.tour, m.a.id), staleTime: 30 * 60e3, retry: false });
  const list = (q.data?.matches ?? []).filter(x => x.opponent.id === m.b.id && x.id !== m.id);
  if (q.isLoading || q.error) return null;
  return (
    <Panel title={`Enfrentamientos recientes${list.length ? `: ${m.a.name} ${list.filter(x => x.win).length} - ${list.filter(x => !x.win).length} ${m.b.name}` : ''}`}>
      {!list.length ? <p className="px-3.5 py-2 text-[13px] text-zinc-400">Sin enfrentamientos recientes.</p> : (
        <div className="divide-y divide-white/10 px-3.5">
          {list.map(x => (
            <div key={x.id} className="flex h-7 items-center gap-3 text-[13px]">
              <span className="w-20 shrink-0 text-xs text-zinc-500">{new Date(x.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
              <span className="min-w-0 flex-1 truncate">{x.tournament}, {x.round}</span>
              <span className="font-score tnum text-zinc-300">{x.score}</span>
              <span className="w-32 truncate text-right font-medium text-amber-300">Gana {x.win ? m.a.name : m.b.name}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PlayerForm({ tour, p, current, onPlayer }: { tour: TennisMatch['tour']; p: TennisPlayer; current: string; onPlayer: (id: string) => void }) {
  const q = useQuery({ queryKey: ['tennis', 'player', tour, p.id], queryFn: () => window.api.tennis.player(tour, p.id), staleTime: 5 * 60e3 });
  const done = (q.data ?? []).filter(x => x.state === 'post' && x.id !== current);
  const wins = done.filter(x => (x.a.id === p.id ? x.a : x.b).winner).length;
  return (
    <div className={cn(panel, 'overflow-hidden')}>
      <div className="flex items-center gap-2.5 border-b border-zinc-800 bg-zinc-900 px-3.5 py-2 text-zinc-50">
        {p.flag && <img loading="lazy" decoding="async" src={sized(p.flag, 24)} onError={fallbackTo(p.flag)} alt="" className="h-3.5 w-5 rounded-[2px] object-cover" />}
        <div className="min-w-0 flex-1">
          <button onClick={() => onPlayer(p.id)} title="Ver su ficha" className="block max-w-full cursor-pointer truncate text-[15px] font-semibold hover:text-amber-400">{p.name}</button>
        </div>
        {p.rank && <div className="font-mono text-[13px] font-bold text-zinc-400">#{p.rank}</div>}
      </div>
      {q.isLoading ? <div className="px-4"><Loading /></div> : !done.length ? <div className="px-3.5 py-2.5 text-[13px] text-zinc-500">Sin partidos en los últimos días.</div> : <>
        <div className="px-3.5 pt-2 text-[11px] text-zinc-500">Últimos días: {wins} de {done.length}</div>
        <div className="divide-y divide-zinc-800/60">
          {done.slice(0, 5).map(x => {
            const me = x.a.id === p.id ? x.a : x.b, rival = x.a.id === p.id ? x.b : x.a;
            return (
              <div key={x.id} className="flex items-center gap-2.5 px-3.5 py-1.5 text-[13px]">
                <Badge tone={me.winner ? 'success' : 'danger'}>{me.winner ? 'G' : 'P'}</Badge>
                <div className="min-w-0 flex-1"><div className="truncate">vs {rival.name}</div><div className="truncate text-xs text-zinc-500">{x.tournament}, {x.round}</div></div>
                <span className="font-score tnum text-zinc-300">{me.sets.map((s, i) => `${s}-${rival.sets[i] ?? ''}`).join(' ')}</span>
              </div>
            );
          })}
        </div>
      </>}
    </div>
  );
}
