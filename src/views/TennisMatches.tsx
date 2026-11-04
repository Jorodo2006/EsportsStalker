// Tenis · Partidos: igual que LoL y baloncesto. Tira de días (hora de España), filtro por estado, partidos agrupados
// por torneo y, al pulsar uno, su ficha: marcador por sets, cuotas de Winamax y Betway y la forma de los dos jugadores.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarX, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { TennisMatch, TennisPlayer } from '@/lib/types';
import { SportOdds, type OddsTarget } from '@/components/BasketOdds';
import { CompetitionBlock, DayStrip, MatchRow, Scoreboard, SheetTabs, StateFilterBar, Toggle, today, type MatchState, type StateFilter } from '@/components/sport';
import { Badge, Button, Empty, ErrorBox, Loading, td, th } from '@/components/ui';

const stateOf = (m: TennisMatch): MatchState => (m.state === 'in' ? 'live' : m.state);
export const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const setsWon = (p: TennisPlayer) => p.setWins.filter(Boolean).length;
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };
const label = (p: TennisPlayer) => `${p.name}${p.seed ? ` (${p.seed})` : ''}`;

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
  const ok = !!window.api.tennis;

  const days = useQuery({ queryKey: ['tennis', 'days', date], queryFn: () => window.api.tennis.days(addWeekStart(date), 7), staleTime: 5 * 60e3, enabled: ok });
  const games = useQuery({
    queryKey: ['tennis', 'games', date], queryFn: () => window.api.tennis.games(date), enabled: ok,
    refetchInterval: q => (q.state.data?.some(g => g.state === 'in') ? 20_000 : 120_000)
  });
  // La previa llena el día de partidos que casi nadie apuesta: se puede ocultar
  const all = (games.data ?? []).filter(m => quali || !/^previa/i.test(m.round));
  const counts = useMemo(() => ({
    all: all.length, live: all.filter(g => g.state === 'in').length, pre: all.filter(g => g.state === 'pre').length, post: all.filter(g => g.state === 'post').length
  }), [all]);
  const shown = all.filter(g => filter === 'all' || stateOf(g) === filter);
  const byTour = useMemo(() => {
    const m = new Map<string, TennisMatch[]>();
    for (const g of shown) m.set(`${g.tour}|${g.tournament}`, [...(m.get(`${g.tour}|${g.tournament}`) ?? []), g]);
    return [...m.entries()].sort((x, y) => Number(y[1][0].major) - Number(x[1][0].major) || x[0].localeCompare(y[0]));
  }, [shown]);
  const pending = useMemo(() => all.filter(g => g.state !== 'post').map(g => ({ id: g.id, ...targetOfMatch(g).match, start: g.date })), [all]);
  const board = useQuery({
    queryKey: ['board', 'tennis', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: ok && showOdds && pending.length > 0, refetchInterval: 60_000
  });
  const open = (games.data ?? []).find(g => g.id === openId) ?? null;

  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para el tenis hay que parar <code>npm run dev</code> y volver a lanzarlo (cambió el preload).</ErrorBox>;
  if (open) return <MatchDetail key={open.id} m={open} onClose={() => setOpenId(null)} />;

  const toggle = (k: string) => { const n = closed.includes(k) ? closed.filter(x => x !== k) : [...closed, k]; setClosed(n); savePref('tennis-closed', n); };
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <DayStrip value={date} onChange={setDate} counts={days.data} />
      <StateFilterBar value={filter} onChange={setFilter} counts={counts}>
        <Toggle on={quali} onChange={v => { setQuali(v); savePref('tennis-quali', v); }} label="Previa" />
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); savePref('tennis-odds', v); }} label="Cuotas" />
      </StateFilterBar>
      {games.isLoading ? <Loading label="Cargando partidos…" /> : games.error ? <ErrorBox error={games.error} />
        : !shown.length ? <Empty icon={<CalendarX size={26} />}>Ese día no hay partidos de la ATP ni de la WTA con este filtro.</Empty>
          : byTour.map(([k, list]) => (
            <CompetitionBlock key={k} name={list[0].tournament} sub={[list[0].tour.toUpperCase(), list[0].city].filter(Boolean).join(', ')}
              count={list.length} live={list.filter(g => g.state === 'in').length} open={!closed.includes(k)} onToggle={() => toggle(k)}>
              {list.map(g => {
                const st = stateOf(g);
                return (
                  <MatchRow key={g.id} state={st} onClick={() => setOpenId(g.id)} odds={showOdds ? board.data?.[g.id] : null}
                    time={st === 'pre' ? esTime(g.date) : st === 'live' ? 'En juego' : 'Final'} status={st === 'live' ? g.status : g.round}
                    a={{ name: label(g.a), short: g.a.country, logo: g.a.flag, score: st === 'pre' ? null : setsWon(g.a), win: g.a.winner, lose: st === 'post' && !g.a.winner }}
                    b={{ name: label(g.b), short: g.b.country, logo: g.b.flag, score: st === 'pre' ? null : setsWon(g.b), win: g.b.winner, lose: st === 'post' && !g.b.winner }} />
                );
              })}
            </CompetitionBlock>
          ))}
    </div>
  );
}

type Tab = 'score' | 'odds' | 'form';

function MatchDetail({ m, onClose }: { m: TennisMatch; onClose: () => void }) {
  const { openBet } = useApp();
  const st = stateOf(m);
  const [tab, setTab] = useState<Tab>(st === 'pre' ? 'odds' : 'score');
  const t = targetOfMatch(m);
  return (
    <div className="flex flex-col gap-5">
      <button onClick={onClose} className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={16} />Volver a partidos</button>
      <Scoreboard competition={m.tournament} detail={[m.round, m.court].filter(Boolean).join(', ')} state={st}
        a={{ name: label(m.a), short: m.a.country, logo: m.a.flag, score: setsWon(m.a) }}
        b={{ name: label(m.b), short: m.b.country, logo: m.b.flag, score: setsWon(m.b) }}
        center={esTime(m.date)}
        centerSub={st === 'pre' ? new Date(m.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : st === 'live' ? m.status : 'Final'}>
        <SheetTabs value={tab} onChange={setTab} items={[
          ['score', 'Marcador'], ...(st === 'post' ? [] : [['odds', 'Cuotas']] as [Tab, string][]), ['form', 'Forma de los jugadores']
        ]} right={<Button size="sm" onClick={() => openBet({ sport: 'tennis', league: m.tournament, event: t.event })}><Plus size={14} />Apuesta</Button>} />
      </Scoreboard>
      {tab === 'score' ? <Sets m={m} /> : tab === 'odds' ? <SportOdds target={t} /> : <Form m={m} />}
    </div>
  );
}

// Marcador por sets, con el tie-break en pequeño
function Sets({ m }: { m: TennisMatch }) {
  const n = Math.max(m.a.sets.length, m.b.sets.length);
  if (!n) return <Empty>El partido aún no ha empezado. Mira las cuotas o la forma de los jugadores mientras tanto.</Empty>;
  const row = (p: TennisPlayer, o: TennisPlayer) => (
    <tr>
      <td className={td}><span className="flex items-center gap-2">{p.flag && <img src={p.flag} alt="" className="h-4 w-6 rounded-sm object-cover" />}<span className={cn(p.winner && 'font-semibold text-zinc-50')}>{label(p)}</span>{p.rank && <span className="text-xs text-zinc-500">n.º {p.rank}</span>}</span></td>
      {Array.from({ length: n }, (_, i) => (
        <td key={i} className={cn(td, 'text-center font-score text-xl tnum', p.setWins[i] ? 'font-semibold text-zinc-50' : (o.setWins[i] ? 'text-zinc-500' : 'text-zinc-200'))}>
          {p.sets[i] ?? ''}{p.tiebreaks[i] != null && <sup className="ml-0.5 text-xs text-zinc-500">{p.tiebreaks[i]}</sup>}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50">
        <table className="w-full">
          <thead className="bg-zinc-900/60"><tr><th className={th}>Jugador</th>{Array.from({ length: n }, (_, i) => <th key={i} className={th + ' text-center'}>Set {i + 1}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-800/60">{row(m.a, m.b)}{row(m.b, m.a)}</tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">Al mejor de {m.bestOf} sets.{m.court ? ` ${m.court}, ${m.city}.` : ''}</p>
    </div>
  );
}

// Lo que lleva cada jugador en los torneos en juego (su camino y los últimos resultados) y su ranking
function Form({ m }: { m: TennisMatch }) {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{[m.a, m.b].map(p => <PlayerForm key={p.id} tour={m.tour} p={p} current={m.id} />)}</div>;
}

function PlayerForm({ tour, p, current }: { tour: TennisMatch['tour']; p: TennisPlayer; current: string }) {
  const q = useQuery({ queryKey: ['tennis', 'player', tour, p.id], queryFn: () => window.api.tennis.player(tour, p.id), staleTime: 5 * 60e3 });
  const done = (q.data ?? []).filter(x => x.state === 'post' && x.id !== current);
  const wins = done.filter(x => (x.a.id === p.id ? x.a : x.b).winner).length;
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50">
      <div className="flex items-center gap-3 border-b border-zinc-800/60 px-4 py-3">
        {p.flag && <img src={p.flag} alt="" className="h-5 w-7 rounded-sm object-cover" />}
        <div className="min-w-0 flex-1"><div className="truncate font-semibold">{p.name}</div><div className="text-xs text-zinc-500">{p.country}</div></div>
        {p.rank && <div className="text-right"><div className="font-score text-2xl font-semibold tnum">{p.rank}</div><div className="text-[11px] text-zinc-500">ranking</div></div>}
      </div>
      {q.isLoading ? <div className="px-4"><Loading /></div> : !done.length ? <div className="px-4 py-4 text-sm text-zinc-500">Sin partidos recientes en los torneos de estos días.</div> : <>
        <div className="px-4 pt-3 text-xs text-zinc-500">Últimos días: {wins} ganados de {done.length}</div>
        <div className="divide-y divide-zinc-800/60">
          {done.slice(0, 8).map(x => {
            const me = x.a.id === p.id ? x.a : x.b, rival = x.a.id === p.id ? x.b : x.a;
            return (
              <div key={x.id} className="flex items-center gap-3 px-4 py-2 text-sm">
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
