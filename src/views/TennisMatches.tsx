// Tenis · Partidos: igual que LoL y baloncesto. Tira de días (hora de España), filtro por estado, partidos agrupados
// por torneo y, al pulsar uno, su ficha: marcador por sets, cuotas de Winamax y Betway y la forma de los dos jugadores.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarX, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { TennisMatch, TennisPlayer } from '@/lib/types';
import { SportOdds, type OddsTarget } from '@/components/BasketOdds';
import { TennisPlayerSheet } from '@/components/TennisPlayerSheet';
import { TennisDayPicks, TennisPicksPanel } from '@/components/TennisPicks';
import { TennisCompare } from '@/components/TennisStats';
import { CompetitionBlock, DayStrip, MatchRow, Scoreboard, SheetTabs, StateFilterBar, Toggle, today, type MatchState, type StateFilter } from '@/components/sport';
import { Badge, Button, Empty, ErrorBox, Loading, td, th } from '@/components/ui';
import { Panel, panel } from '@/components/viz';

const stateOf = (m: TennisMatch): MatchState => (m.state === 'in' ? 'live' : m.state);
export const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const setsWon = (p: TennisPlayer) => p.setWins.filter(Boolean).length;
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };
const label = (p: TennisPlayer) => `${p.name}${p.seed ? ` (${p.seed})` : ''}`;
// Lo que va en la fila de un partido en juego: juegos del set y puntos del juego
const liveOf = (m: TennisMatch, side: 'a' | 'b') => (m.state !== 'in' ? {} : { games: m[side].sets[m[side].sets.length - 1] ?? 0, points: m.points?.[side] ?? null, serving: m.points?.server === side });

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
  const [openId, setOpenId] = useState<string | null>(null);
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
  const byTour = useMemo(() => {
    const m = new Map<string, TennisMatch[]>();
    for (const g of shown) m.set(`${g.tour}|${g.tournament}`, [...(m.get(`${g.tour}|${g.tournament}`) ?? []), g]);
    // Grand Slam, circuito y, al final, Challenger
    return [...m.entries()].sort((x, y) => Number(y[1][0].major) - Number(x[1][0].major) || Number(!!x[1][0].level) - Number(!!y[1][0].level) || x[0].localeCompare(y[0]));
  }, [shown]);
  const pending = useMemo(() => all.filter(g => g.state !== 'post').map(g => ({ id: g.id, ...targetOfMatch(g).match, start: g.date })), [all]);
  const board = useQuery({
    queryKey: ['board', 'tennis', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: ok && showOdds && pending.length > 0, refetchInterval: 60_000
  });
  const open = (games.data ?? []).find(g => g.id === openId) ?? null;

  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para el tenis hay que parar <code>npm run dev</code> y volver a lanzarlo (cambió el preload).</ErrorBox>;
  if (open) return <MatchDetail key={open.id} m={open} date={date} onClose={() => setOpenId(null)} />;

  const toggle = (k: string) => { const n = closed.includes(k) ? closed.filter(x => x !== k) : [...closed, k]; setClosed(n); savePref('tennis-closed', n); };
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <DayStrip value={date} onChange={setDate} counts={days.data} />
      <StateFilterBar value={filter} onChange={setFilter} counts={counts}>
        <Toggle on={quali} onChange={v => { setQuali(v); savePref('tennis-quali', v); }} label="Previa" />
        <Toggle on={challengers} onChange={v => { setChallengers(v); savePref('tennis-challengers', v); }} label="Challenger" />
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); savePref('tennis-odds', v); }} label="Cuotas" />
      </StateFilterBar>
      <TennisDayPicks date={date} onOpen={setOpenId} />
      {games.isLoading ? <Loading label="Cargando partidos…" /> : games.error ? <ErrorBox error={games.error} />
        : !shown.length ? <Empty icon={<CalendarX size={26} />}>Ese día no hay partidos de la ATP ni de la WTA con este filtro.</Empty>
          : byTour.map(([k, list]) => (
            <CompetitionBlock key={k} name={list[0].tournament} sub={[list[0].level ? 'ATP Challenger' : list[0].tour.toUpperCase(), list[0].city].filter(Boolean).join(', ')}
              count={list.length} live={list.filter(g => g.state === 'in').length} open={!closed.includes(k)} onToggle={() => toggle(k)}>
              {list.map(g => {
                const st = stateOf(g);
                return (
                  <MatchRow key={g.id} state={st} onClick={() => setOpenId(g.id)} odds={showOdds ? board.data?.[g.id] : null}
                    time={st === 'pre' ? esTime(g.date) : st === 'live' ? 'En juego' : 'Final'} status={st === 'live' ? g.status : g.round}
                    a={{ name: label(g.a), short: g.a.country, logo: g.a.flag, score: st === 'pre' ? null : setsWon(g.a), win: g.a.winner, lose: st === 'post' && !g.a.winner, ...liveOf(g, 'a') }}
                    b={{ name: label(g.b), short: g.b.country, logo: g.b.flag, score: st === 'pre' ? null : setsWon(g.b), win: g.b.winner, lose: st === 'post' && !g.b.winner, ...liveOf(g, 'b') }} />
                );
              })}
            </CompetitionBlock>
          ))}
    </div>
  );
}

type Tab = 'score' | 'odds' | 'picks' | 'form';

function MatchDetail({ m, date, onClose }: { m: TennisMatch; date: string; onClose: () => void }) {
  const { openBet } = useApp();
  const st = stateOf(m);
  // Los Challenger no tienen modelo ni fichas de jugador: sólo marcador y cuotas
  const full = !m.level;
  const [tab, setTab] = useState<Tab>(st !== 'pre' ? 'score' : full ? 'picks' : 'odds');
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
      <td className={td}><span className="flex items-center gap-2">{p.flag && <img src={p.flag} alt="" className="h-4 w-6 rounded-sm object-cover" />}<span className={cn(p.winner && 'font-semibold text-zinc-50')}>{label(p)}</span>{pts?.server === side && <span title="Saca" aria-label="Saca" className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />}{p.rank && <span className="hidden text-xs text-zinc-500 sm:inline">n.º {p.rank}</span>}</span></td>
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
      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50">
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
      <div className="flex items-center gap-2.5 bg-gradient-to-r from-[var(--tv-band)] to-[var(--tv-band-2)] px-3.5 py-1.5 text-white">
        {p.flag && <img src={p.flag} alt="" className="h-3.5 w-5 rounded-[2px] object-cover" />}
        <div className="min-w-0 flex-1">
          <button onClick={() => onPlayer(p.id)} title="Ver su ficha" className="block max-w-full cursor-pointer truncate font-score text-[17px] font-bold uppercase tracking-wide hover:opacity-80">{p.name}</button>
        </div>
        {p.rank && <div className="font-score text-xl font-bold">#{p.rank}</div>}
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
