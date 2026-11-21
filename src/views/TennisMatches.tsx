// Tenis · Partidos: tira de días (hora de España) y filtro por estado arriba; debajo, los partidos agrupados por torneo
// (cada torneo en su panel, con sus rondas) y, en pantallas anchas, al lado el partido elegido. Al abrir uno, su ficha:
// marcador por sets, recomendaciones, cuotas de Winamax y Betway y la forma de los dos jugadores. Como en el baloncesto,
// el selector de arriba cambia a las recomendaciones de todos los partidos.
import { useCardOdd } from '@/lib/card-odds';
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Plus } from 'lucide-react';
import { sectionId, useApp, useLostMatch, useRouteDay, useRouteMatch, useSections } from '@/lib/app-context';
import { useBackLayer } from '@/lib/history';
import { cn } from '@/lib/format';
import { useMedia } from '@/lib/use-media';
import type { SheetTour, TennisBoardMatch, TennisMatch, TennisPlayer } from '@/lib/types';
import { AdSlot } from '@/components/AdSlot';
import { SportOdds } from '@/components/BasketOdds';
import { targetOfMatch } from '@/lib/odds-targets';
import { TennisPlayerSheet } from '@/components/TennisPlayerSheet';
import { TennisDayPicks, TennisPicksPage, TennisPicksPanel } from '@/components/TennisPicks';
import { Flag, TennisSpotlight, TournamentGroup, countriesOf } from '@/components/TennisList';
import { ChallengerPicksPanel } from '@/components/ChallengerPicks';
import { TennisCompare } from '@/components/TennisStats';
import { TennisRecent } from '@/components/TennisRecent';
import { SheetScroll, DayStrip, MatchesTitle, ModeSwitch, OddsLegend, NoGames, Scoreboard, SheetTabs, StateFilterBar, Toggle, noGamesText, useNextDay, type MatchState, type StateFilter } from '@/components/sport';
import { Button, Empty, ErrorBox, Loading, td, th } from '@/components/ui';
import { FavoritesStrip } from '@/components/Favorites';
import { MyBetsLive } from '@/components/MyBetsLive';
import { TennisMatchStats } from '@/components/TennisMatchStats';

const stateOf = (m: TennisMatch): MatchState => (m.state === 'in' ? 'live' : m.state);
type Mode = 'games' | 'picks';
export const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const setsWon = (p: TennisPlayer) => p.setWins.filter(Boolean).length;
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };
const label = (p: TennisPlayer) => `${p.name}${p.seed ? ` (${p.seed})` : ''}`;
// Una pareja en el marcador de la ficha: sus iniciales en el hueco de la bandera ("H/S" de "Harrison / Skupski") y sin favorito
const pairSide = (p: TennisPlayer) => (p.players ? { badge: p.short.split(' / ').map(h => h.trim()[0] || '').join('/'), noFav: true } : {});
// El partido que se enseña al lado si no se ha elegido ninguno: de la ATP o la WTA si hay, el primero en juego o, si no, el
// siguiente en empezar
const firstOf = (all: TennisMatch[]) => {
  const main = all.filter(g => !g.level), list = main.length ? main : all;
  return list.find(g => g.state === 'in') ?? list.filter(g => g.state === 'pre').sort((x, y) => +new Date(x.date) - +new Date(y.date))[0] ?? list[0] ?? null;
};


function loadPref<T>(key: string, def: T): T { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; } }
function savePref(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }

export default function TennisMatches() {
  const addOdd = useCardOdd();
  const { openGame, closeMatch } = useApp();
  const [date, setDate] = useRouteDay();
  const [filter, setFilter] = useState<StateFilter>('all');
  // Se entra siempre en Partidos (lo primero son los partidos); Recomendaciones es la otra pestaña
  const [mode, pickMode] = useState<Mode>('games');
  // El partido abierto va en la dirección (/tenis/partido/<id>): atrás del navegador lo cierra
  const openId = useRouteMatch('tennis');
  // La pestaña con la que se abrió, sólo para ese partido (con atrás no se pasa por onClose para olvidarla)
  const [openTab, setOpenTab] = useState<{ id: string; tab: Tab } | null>(null);
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
  // Los dobles, encendidos de entrada: apagados, nadie encontraba el interruptor y parecía que no los había (19-11-2026). Van en su
  // propio panel detrás de los individuales de cada nivel, así que no tapan nada
  const [doubles, setDoubles] = useState(() => loadPref('tennis-doubles', true));
  const ok = !!window.api.tennis;

  const days = useQuery({ queryKey: ['tennis', 'days', date], queryFn: () => window.api.tennis.days(addWeekStart(date), 7), staleTime: 5 * 60e3, enabled: ok });
  // La tira de días cuenta los dobles sólo si se enseñan: si no, decía 31 y la lista 49
  const dayCounts = useMemo(() => days.data && Object.fromEntries(Object.entries(days.data).map(([d, c]) => [d, doubles ? { total: c.total + (c.doubles ?? 0), live: c.live + (c.doublesLive ?? 0) } : c])), [days.data, doubles]);
  const games = useQuery({
    queryKey: ['tennis', 'games', date], queryFn: () => window.api.tennis.games(date), enabled: ok,
    refetchInterval: q => (q.state.data?.some(g => g.state === 'in') ? 15_000 : 120_000)
  });
  // Los dobles van en su propia ruta (server/services/tennis/doubles.js): se piden con el interruptor encendido o si se abre uno por
  // su dirección (/tenis/partido/dbl:…, un enlace compartido)
  const doublesOpen = !!openId?.startsWith('dbl:');
  const pairs = useQuery({
    queryKey: ['tennis', 'doubles', date], queryFn: () => window.api.tennis.doubles(date), enabled: ok && (doubles || doublesOpen),
    refetchInterval: q => (q.state.data?.some(g => g.state === 'in') ? 15_000 : 120_000)
  });
  // La previa llena el día de partidos que casi nadie apuesta: se puede ocultar
  const all = [...(games.data ?? []), ...(doubles ? pairs.data ?? [] : [])]
    .filter(m => (quali || !/^previa/i.test(m.round)) && (challengers || m.level !== 'challenger'));
  const counts = useMemo(() => ({
    all: all.length, live: all.filter(g => g.state === 'in').length, pre: all.filter(g => g.state === 'pre').length, post: all.filter(g => g.state === 'post').length
  }), [all]);
  const shown = all.filter(g => filter === 'all' || stateOf(g) === filter);
  // Por torneo, con los que están en juego dentro del suyo: los Grand Slam, el circuito y, al final, los Challenger; dentro
  // de cada nivel, primero los torneos con partidos en juego. Los dobles de cada torneo, en su propio panel detrás de los
  // individuales de su nivel
  const byTour = useMemo(() => {
    const m = new Map<string, TennisMatch[]>();
    const key = (g: TennisMatch) => `${g.tour}|${g.tournament}${g.doubles ? '|d' : ''}`;
    for (const g of shown) m.set(key(g), [...(m.get(key(g)) ?? []), g]);
    const tier = (g: TennisMatch) => (g.major ? 0 : g.level ? 2 : 1) + (g.doubles ? 0.5 : 0);
    const live = (l: TennisMatch[]) => Number(l.some(g => g.state === 'in'));
    return [...m.entries()].sort((x, y) => tier(x[1][0]) - tier(y[1][0]) || live(y[1]) - live(x[1]) || x[0].localeCompare(y[0]));
  }, [shown]);
  const pending = useMemo(() => all.filter(g => g.state !== 'post').map(g => ({ id: g.id, ...targetOfMatch(g).match, start: g.date })), [all]);
  const board = useQuery({
    queryKey: ['board', 'tennis', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: ok && showOdds && pending.length > 0, refetchInterval: 60_000
  });
  const open = (games.data ?? []).find(g => g.id === openId) ?? pairs.data?.find(g => g.id === openId) ?? (fromPick?.id === openId ? fromPick : null);
  // Con los dobles, cada torneo sale dos veces en el menú: el de dobles lo dice
  useSections(open || mode === 'picks' ? [] : byTour.map(([k, list]) => ({ id: sectionId(k), label: list[0].doubles ? `${list[0].tournament} · Dobles` : list[0].tournament, count: list.length, live: list.filter(g => g.state === 'in').length })));
  const openMatch = (id: string, tab?: Tab, day = date) => { setOpenTab(tab ? { id, tab } : null); openGame(id, day); };
  useLostMatch(!!openId && (doublesOpen ? pairs.isSuccess : games.isSuccess) && !open);
  const nextDay = useNextDay('tennis', date, games.isSuccess && !games.data?.length);

  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para el tenis hay que parar <code>npm run dev</code> y volver a lanzarlo (cambió el preload).</ErrorBox>;
  const openPick = (x: TennisBoardMatch) => { setFromPick(x.m); openMatch(x.m.id, undefined, x.day); };
  // Un Challenger desde sus recomendaciones (motor aparte): por su id y su día, en la pestaña Recomendaciones
  const openChallenger = (id: string, day: string) => { setFromPick(null); openMatch(id, 'picks', day); };
  if (open) return <MatchDetail key={open.id} m={open} date={date} initialTab={openTab?.id === open.id ? openTab.tab : undefined} onClose={closeMatch} />;

  const modes = <ModeSwitch value={mode} onChange={pickMode} />;
  if (mode === 'picks') return <div className="flex min-w-0 flex-col gap-5">{modes}<TennisPicksPage onOpen={openPick} onOpenChallenger={openChallenger} /></div>;

  const toggle = (k: string) => { const n = closed.includes(k) ? closed.filter(x => x !== k) : [...closed, k]; setClosed(n); savePref('tennis-closed', n); };
  // Con la columna del partido elegido, el primer toque lo elige y el segundo abre su ficha; sin ella, la abre directamente
  const sel = twoCols ? shown.find(g => g.id === selId) ?? firstOf(shown) : null;
  const pick = (g: TennisMatch) => (twoCols && sel?.id !== g.id ? setSelId(g.id) : openMatch(g.id));
  const dayPicks = <TennisDayPicks date={date} onOpen={openPick} onAll={() => pickMode('picks')} onOpenChallenger={openChallenger} />;
  return (
    <div className="flex flex-col gap-5">
      <MatchesTitle date={date} />
      {modes}
      <MyBetsLive />
      <FavoritesStrip />
      <StateFilterBar above={<DayStrip value={date} onChange={setDate} counts={dayCounts} />} value={filter} onChange={setFilter} counts={counts}>
        <Toggle on={quali} onChange={v => { setQuali(v); savePref('tennis-quali', v); }} label="Previa" />
        <Toggle on={challengers} onChange={v => { setChallengers(v); savePref('tennis-challengers', v); }} label="Challenger" />
        <Toggle on={doubles} onChange={v => { setDoubles(v); savePref('tennis-doubles', v); }} label="Dobles" />
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); savePref('tennis-odds', v); }} label="Cuotas" />
      </StateFilterBar>
      {showOdds && !!shown.length && <OddsLegend />}
      {games.isLoading ? <Loading label="Cargando partidos…" /> : games.error ? <ErrorBox error={games.error} />
        : !shown.length ? (
          filter !== 'all' && all.length
            ? <NoGames app="tennis" text="Ningún partido de ese día con este filtro." onDay={setDate}><Button size="sm" variant="secondary" onClick={() => setFilter('all')}>Ver todos</Button></NoGames>
            : games.data?.length
              ? <NoGames app="tennis" text="Ese día sólo hay partidos de previa o de Challenger, y los tienes ocultos." onDay={setDate}>
                <Button size="sm" variant="secondary" onClick={() => { setQuali(true); savePref('tennis-quali', true); setChallengers(true); savePref('tennis-challengers', true); }}>Enseñarlos</Button>
              </NoGames>
              : <NoGames app="tennis" text={noGamesText('tennis', date)} next={nextDay} onDay={setDate} />
        )
          : (
            <div className={cn('grid items-start gap-4', twoCols && 'grid-cols-[minmax(0,1fr)_minmax(320px,400px)]')}>
              <div className="flex min-w-0 flex-col gap-3">
                {byTour.map(([k, list], i) => (
                  <Fragment key={k}>
                    <TournamentGroup id={sectionId(k)} matches={list} open={!closed.includes(k)} onToggle={() => toggle(k)}
                      odds={showOdds ? board.data : undefined} selected={sel?.id} onPick={pick} onOdd={(m, side) => addOdd(targetOfMatch(m), side)} />
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
  // Los Challenger: sus fichas salen de TennisMyLife con el nombre como id (circuito 'challenger', no están en ESPN) y sus
  // recomendaciones, de su motor aparte (servicio challenger). Los dobles, ni fichas ni recomendaciones (no hay modelo de dobles)
  const full = !m.level && !m.doubles;
  const form = !m.doubles;
  const sheetTour: SheetTour = m.level ? 'challenger' : m.tour;
  const picks = st === 'pre' && !m.doubles;
  const ok = (t?: Tab) => !!t && (t !== 'picks' || picks) && (t !== 'odds' || st !== 'post') && (t !== 'form' || form);
  const [tab, setTab] = useState<Tab>(ok(initialTab) ? initialTab! : st !== 'pre' ? 'score' : picks ? 'picks' : 'odds');
  const t = targetOfMatch(m);
  const [sheet, setSheet] = useState<string | null>(null);
  useBackLayer(!!sheet, () => setSheet(null));
  if (sheet) return <TennisPlayerSheet key={sheet} tour={sheetTour} id={sheet} backLabel="Partido" onBack={() => setSheet(null)} onPlayer={setSheet} />;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <SheetScroll />
      <button onClick={onClose} className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={16} />Volver a partidos</button>
      <Scoreboard competition={m.tournament} detail={[m.round, m.court].filter(Boolean).join(', ')} state={st}
        a={{ name: label(m.a), short: countriesOf(m.a), logo: m.a.flag, score: setsWon(m.a), ...pairSide(m.a) }}
        b={{ name: label(m.b), short: countriesOf(m.b), logo: m.b.flag, score: setsWon(m.b), ...pairSide(m.b) }}
        center={esTime(m.date)}
        centerSub={st === 'pre' ? new Date(m.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : st === 'live' ? (m.points ? `${m.status} · ${m.points.a}-${m.points.b}` : m.status) : 'Final'}>
        <SheetTabs value={tab} onChange={setTab} items={[
          ['score', 'Marcador'], ...(picks ? [['picks', 'Recomendaciones']] as [Tab, string][] : []), ...(st === 'post' ? [] : [['odds', 'Cuotas']] as [Tab, string][]), ...(form ? [['form', 'Forma de los jugadores']] as [Tab, string][] : [])
        ]} right={<Button size="sm" onClick={() => openBet({ sport: 'tennis', league: m.tournament, event: t.event })}><Plus size={14} /><span className="max-sm:sr-only">Apuesta</span></Button>} />
      </Scoreboard>
      {m.fixed && <p className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle size={13} className="shrink-0" />{m.fixed}</p>}
      {tab === 'score' ? <><Sets m={m} />{!m.doubles && <TennisMatchStats m={m} onForm={form ? () => setTab('form') : undefined} />}</> : tab === 'odds' ? <SportOdds target={t} /> : tab === 'picks' ? (full ? <TennisPicksPanel m={m} date={date} onOdds={() => setTab('odds')} /> : <ChallengerPicksPanel id={m.id} date={date} onOdds={() => setTab('odds')} />) : <Form m={m} tour={sheetTour} onPlayer={setSheet} />}
    </div>
  );
}

// Marcador por sets, con el tie-break en pequeño y, en juego, los puntos del juego y quién saca
function Sets({ m }: { m: TennisMatch }) {
  const n = Math.max(m.a.sets.length, m.b.sets.length);
  if (!n) return <Empty>{m.doubles ? 'El partido aún no ha empezado. Mira las cuotas mientras tanto.' : 'El partido aún no ha empezado. Mira las cuotas o la forma de los jugadores mientras tanto.'}</Empty>;
  const live = m.state === 'in', pts = m.points ?? null;
  // Dobles que no son de Grand Slam: el tercer set es un súper tie-break a 10 (llega como un set 1-0 con los puntos en pequeño)
  const stb = !!m.doubles && !m.major;
  const setHead = (i: number) => (stb && i === 2 ? ['STB', 'Súper tie-break'] : [`S${i + 1}`, `Set ${i + 1}`]);
  const row = (p: TennisPlayer, o: TennisPlayer, side: 'a' | 'b') => (
    <tr>
      <td className={td}><span className="flex items-center gap-2">{(p.flag || p.players?.some(x => x.flag)) && <Flag p={p} big />}<span className={cn(p.winner && 'font-semibold text-zinc-50')}>{label(p)}</span>{pts?.server === side && <span title="Saca" aria-label="Saca" className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />}{p.rank && <span className="hidden text-xs text-zinc-500 sm:inline">n.º {p.rank}</span>}</span></td>
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
          <thead className="bg-zinc-900/60"><tr><th className={th}>{m.doubles ? 'Pareja' : 'Jugador'}</th>{Array.from({ length: n }, (_, i) => <th key={i} className={th + ' text-center'}><span className="sm:hidden">{setHead(i)[0]}</span><span className="hidden sm:inline">{setHead(i)[1]}</span></th>)}{pts && <th className={th + ' text-center'}>{pts.tiebreak ? 'Tie-break' : 'Puntos'}</th>}</tr></thead>
          <tbody className="divide-y divide-zinc-800/60">{row(m.a, m.b, 'a')}{row(m.b, m.a, 'b')}</tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        Al mejor de {m.bestOf} sets{stb ? '; el tercero es un súper tie-break a 10 puntos' : ''}.{m.court ? ` ${m.court}, ${m.city}.` : ''}
        {live && (pts ? ` Puntos de ${pts.source}: pueden ir algo por detrás del partido.` : ' Puntos del juego no disponibles ahora mismo.')}
      </p>
    </div>
  );
}

// Los de los Challenger se identifican por su nombre: su ficha sale de TennisMyLife (circuito 'challenger')
const asSheet = (tour: SheetTour, p: TennisPlayer) => (tour === 'challenger' ? { ...p, id: p.name } : p);
// La forma de los dos: sus últimos partidos y el cara a cara (arriba, que es lo que se busca) y sus estadísticas comparadas
function Form({ m, tour, onPlayer }: { m: TennisMatch; tour: SheetTour; onPlayer: (id: string) => void }) {
  const a = asSheet(tour, m.a), b = asSheet(tour, m.b);
  return (
    <div className="flex flex-col gap-2.5">
      <TennisRecent tour={tour} a={a} b={b} current={m.id} onPlayer={onPlayer} />
      <TennisCompare tour={tour} a={a} b={b} tournament={m.tournament} city={m.city} />
    </div>
  );
}
