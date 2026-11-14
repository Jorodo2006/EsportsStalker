// Baloncesto · Partidos: igual que en LoL. Tira de días (hora de España), filtro por estado, partidos agrupados por
// competición (en pantallas anchas, las más fiables del día al lado) y, al pulsar uno, su ficha completa: marcador grande, estadísticas, cuotas, plantillas y valor de jugador.
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, CalendarX, Plus } from 'lucide-react';
import { cn } from '@/lib/format';
import { sectionId, useApp, useFocus, useSections } from '@/lib/app-context';
import type { BasketGame, BasketInjury, BasketLeagueId, BasketRosterPlayer, BoxTeam, MatchOdds } from '@/lib/types';
import { BasketAnalyzer, LEAGUE_NAME, badInjury, esTime, type Picked } from '@/components/BasketAnalyzer';
import { CompetitionBlock, DayStrip, LiveSection, MatchCard, MatchesTitle, Scoreboard, SheetTabs, StateFilterBar, Toggle, today, type MatchState, type StateFilter } from '@/components/sport';
import { BasketOdds, matchOfGame, useBasketOdds } from '@/components/BasketOdds';
import { BasketLineScanner } from '@/components/BasketLineScanner';
import { BasketPlayerGameDialog } from '@/components/BasketPlayerGame';
import { BasketFlow } from '@/components/BasketFlow';
import { TrendsTable, basketMarkets, basketTrendData } from '@/components/Trends';
import { BasketDayPicks, BasketPicksBoard } from '@/components/BasketPicks';
import { GamePoints } from '@/components/BasketPoints';
import { RangeFilters, useUpcomingGames } from '@/components/BasketRange';
import { restText, useRest } from '@/components/BasketContext';
import { BasketTeamSheet, TeamsCompare } from '@/components/BasketTeamSheet';
import type { BasketPick } from '@/lib/basket-picks';
import { useTeamThemes } from '@/lib/team-colors';
import { Badge, Button, Empty, ErrorBox, Loading, td, th } from '@/components/ui';
import { TvTabs } from '@/components/viz';
import { AdSlot } from '@/components/AdSlot';
import { useMedia } from '@/lib/use-media';
import { sized, fallbackTo } from '@/lib/img';
import { FavoritesStrip } from '@/components/Favorites';

const ORDER: BasketLeagueId[] = ['nba', 'euroleague', 'eurocup', 'nbl', 'wnba'];
const stateOf = (g: BasketGame): MatchState => (g.state === 'in' ? 'live' : g.state);
type Mode = 'games' | 'picks';
const pickedOf = (p: BasketPick): Picked => ({
  id: p.who!.id, name: p.who!.name, league: p.game.league, headshot: p.who!.headshot, teamId: p.who!.teamId, game: p.game, market: p.marketKey ?? undefined, line: p.line,
  seen: { side: p.side, price: p.price, book: p.book, ev: p.ev, at: Date.now() }
});

function loadSet(key: string) { try { return new Set<string>(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set<string>(); } }
function saveSet(key: string, s: Set<string>) { try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* sin almacenamiento */ } }

export default function BasketMatches() {
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<StateFilter>('all');
  // Se entra siempre en Partidos (lo primero son los partidos); Recomendaciones es la otra pestaña
  const [mode, pickMode] = useState<Mode>('games');
  const side = useMedia('(min-width: 1280px)'); // columna de las más fiables del día al lado de la lista
  const wide = useMedia('(min-width: 1400px)'); // con la columna del cupón y los anuncios a la derecha (App.tsx)
  const [openId, setOpenId] = useState<string | null>(null);
  // La recomendación puede ser de otro día que el de la tira: se guarda el partido que abre
  const [fromPick, setFromPick] = useState<BasketPick | null>(null);
  const [closed, setClosed] = useState(() => loadSet('basket-closed'));
  const [showOdds, setShowOdds] = useState(() => { try { return localStorage.getItem('basket-odds') !== '0'; } catch { return true; } });
  const ok = !!window.api.basket;

  const leagues = useQuery({ queryKey: ['basket', 'leagues'], queryFn: () => window.api.basket.leagues(), staleTime: 24 * 3600e3, enabled: ok });
  const days = useQuery({ queryKey: ['basket', 'days', date], queryFn: () => window.api.basket.days(addWeekStart(date), 7), staleTime: 5 * 60e3, enabled: ok });
  const games = useQuery({
    queryKey: ['basket', 'games', date], queryFn: () => window.api.basket.games(date), enabled: ok,
    refetchInterval: q => (q.state.data?.some(g => g.state === 'in') ? 20_000 : 120_000)
  });
  const injuries = useQuery({ queryKey: ['basket', 'injuries'], queryFn: () => window.api.basket.injuries(), staleTime: 10 * 60e3, enabled: ok });

  const all = games.data ?? [];
  const counts = useMemo(() => ({
    all: all.length, live: all.filter(g => g.state === 'in').length, pre: all.filter(g => g.state === 'pre').length, post: all.filter(g => g.state === 'post').length
  }), [all]);
  const shown = all.filter(g => filter === 'all' || stateOf(g) === filter);
  // Mejor cuota de ganador de cada partido sin terminar (de lo que ya ha leído el lector)
  const pending = useMemo(() => all.filter(g => g.state !== 'post').map(g => ({ id: g.id, ...matchOfGame(g) })), [all]);
  const board = useQuery({
    queryKey: ['board', 'basket', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: ok && showOdds && pending.length > 0, refetchInterval: 60_000
  });
  // Los que están en juego van arriba, destacados; el resto por competición
  const liveNow = shown.filter(g => g.state === 'in');
  const byLeague = ORDER.map(id => ({ id, list: shown.filter(g => g.league === id && g.state !== 'in') })).filter(x => x.list.length);
  const open = all.find(g => g.id === openId) ?? (fromPick?.game.id === openId ? fromPick?.game : null) ?? null;
  useSections(open || mode === 'picks' ? [] : [
    ...(liveNow.length ? [{ id: 'comp-en-directo', label: 'En directo', count: liveNow.length, live: liveNow.length }] : []),
    ...byLeague.map(({ id, list }) => ({ id: sectionId(LEAGUE_NAME[id]), label: LEAGUE_NAME[id], count: list.length, live: 0 }))
  ]);
  const has = useCallback((id: string) => all.some(g => g.id === id), [all]);
  useFocus(setOpenId, has, setDate);

  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para el baloncesto hay que parar <code>npm run dev</code> y volver a lanzarlo (cambió el preload).</ErrorBox>;

  const toggle = (id: string) => { const s = new Set(closed); if (s.has(id)) s.delete(id); else s.add(id); setClosed(s); saveSet('basket-closed', s); };
  const openPick = (p: BasketPick) => { setFromPick(p); setOpenId(p.game.id); };

  if (open) return <GameDetail key={open.id} game={open} injuries={injuries.data ?? []} from={fromPick?.game.id === open.id ? fromPick : null} onClose={() => { setOpenId(null); setFromPick(null); }} />;

  const modes = <TvTabs value={mode} onChange={pickMode} items={[{ value: 'games' as const, label: 'Partidos' }, { value: 'picks' as const, label: 'Recomendaciones' }]} />;
  if (mode === 'picks') return <div className="flex min-w-0 flex-col gap-5">{modes}<PicksPage onOpen={openPick} /></div>;

  const card = (g: BasketGame, featured?: boolean) => {
    const st = stateOf(g), done = st === 'post';
    const sa = Number(g.away.score), sh = Number(g.home.score);
    return (
      <MatchCard key={g.id} state={st} onClick={() => setOpenId(g.id)} odds={showOdds ? board.data?.[g.id] : null} featured={featured}
        competition={featured ? LEAGUE_NAME[g.league] : undefined}
        time={st === 'pre' ? esTime(g.date) : st === 'live' ? 'En juego' : 'Final'}
        status={st === 'live' ? g.status : undefined}
        a={{ name: g.away.name, short: g.away.abbr, logo: g.away.logo, score: g.away.score, win: done && sa > sh, lose: done && sa < sh }}
        b={{ name: g.home.name, short: g.home.abbr, logo: g.home.logo, score: g.home.score, win: done && sh > sa, lose: done && sh < sa }} />
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <MatchesTitle date={date} />
      <FavoritesStrip />
      {modes}
      <DayStrip value={date} onChange={d => { setDate(d); setOpenId(null); }} counts={days.data} />
      <StateFilterBar value={filter} onChange={setFilter} counts={counts}>
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); try { localStorage.setItem('basket-odds', v ? '1' : '0'); } catch { /* sin almacenamiento */ } }} label="Cuotas" />
      </StateFilterBar>
      {games.isLoading ? <Loading label="Cargando partidos…" /> : games.error ? <ErrorBox error={games.error} />
        : !all.length ? <Empty icon={<CalendarX size={22} />}>Ese día no hay partidos de NBA, Euroliga, EuroCup ni WNBA. Prueba otro día de la tira.</Empty>
          : <div className={cn('grid items-start gap-4', side && 'grid-cols-[minmax(0,1fr)_minmax(300px,380px)]')}>
            <div className="flex min-w-0 flex-col gap-5">
            {!!liveNow.length && <LiveSection count={liveNow.length}>{liveNow.map(g => card(g, true))}</LiveSection>}
            {byLeague.map(({ id, list }) => {
              const meta = leagues.data?.find(l => l.id === id);
              return (
                <CompetitionBlock key={id} id={sectionId(LEAGUE_NAME[id])} name={LEAGUE_NAME[id]} sub={[meta?.country, list[0]?.round].filter(Boolean).join(', ')} logo={meta?.logo}
                  count={list.length} open={!closed.has(id)} onToggle={() => toggle(id)}>
                  {list.map(g => card(g))}
                </CompetitionBlock>
              );
            })}
            </div>
            {side && (
              <div className="sticky top-0 flex min-w-0 flex-col gap-4">
                <DayBand onOpen={openPick} onAll={() => pickMode('picks')} />
                {!wide && <AdSlot size="rect" />}
              </div>
            )}
          </div>}
    </div>
  );
}

// Las recomendaciones de los partidos que aún no han empezado, de las próximas 24 horas o del día que se elija
function PicksPage({ onOpen }: { onOpen: (p: BasketPick) => void }) {
  const u = useUpcomingGames();
  return (
    <div className="flex flex-col gap-2.5">
      <RangeFilters u={u} />
      {u.loading ? <Loading label="Cargando partidos…" /> : u.error ? <ErrorBox error={u.error} /> : !u.games.length
        ? <Empty icon={<CalendarX size={26} />}>No quedan partidos por empezar en ese intervalo. Prueba con otro día.</Empty>
        : <BasketPicksBoard games={u.games} injuries={u.injuries} onOpen={onOpen} />}
    </div>
  );
}

function DayBand({ onOpen, onAll }: { onOpen: (p: BasketPick) => void; onAll: () => void }) {
  const u = useUpcomingGames();
  return <BasketDayPicks games={u.games} injuries={u.injuries} onOpen={onOpen} onAll={onAll} />;
}

// El día de la tira va al centro: la semana que se pide empieza 3 días antes
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };

type Tab = 'stats' | 'odds' | 'picks' | 'points' | 'lines' | 'h2h' | 'teams' | 'rosters' | 'value';

// Ficha del partido (como la de LoL): estadísticas en juego o terminado, recomendaciones y cuotas antes de empezar.
// from: la recomendación con la que se abrió, para ir directo a su análisis
function GameDetail({ game, injuries, from, onClose }: { game: BasketGame; injuries: BasketInjury[]; from?: BasketPick | null; onClose: () => void }) {
  const { openBet } = useApp();
  const st = stateOf(game);
  const [tab, setTab] = useState<Tab>(from ? (from.who ? 'value' : 'points') : st === 'pre' ? 'picks' : 'stats');
  const odds = useBasketOdds(game);
  const [player, setPlayer] = useState<Picked | null>(from?.who ? pickedOf(from) : null);
  const [teamPick, setTeamPick] = useState<BasketPick | null>(from && !from.who ? from : null);
  const pick = (p: { id: string; name: string; headshot?: string }, teamId: string) => { setPlayer({ id: p.id, name: p.name, league: game.league, headshot: p.headshot, teamId, game }); setTab('value'); };
  const openPick = (p: BasketPick) => {
    if (p.who) { setPlayer(pickedOf(p)); setTab('value'); } else { setTeamPick(p); setTab('points'); }
  };
  const event = `${game.away.abbr} @ ${game.home.abbr}`;
  const themeOf = useTeamThemes(game.league);
  const [sheet, setSheet] = useState<string | null>(null);
  if (sheet) return <BasketTeamSheet key={sheet} league={game.league} teamId={sheet} backLabel="Volver al partido" onBack={() => setSheet(null)}
    onPlayer={(p, teamId) => { setSheet(null); pick(p, teamId); }} />;
  return (
    <div className="flex flex-col gap-5">
      <button onClick={onClose} className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-100">
        <ArrowLeft size={16} />Volver a partidos
      </button>
      <Scoreboard competition={LEAGUE_NAME[game.league]} detail={game.round || undefined} state={st}
        a={{ name: game.away.name, short: game.away.abbr, logo: game.away.logo, score: game.away.score, color: themeOf(game.away.id)?.glow, plate: themeOf(game.away.id)?.plate }}
        b={{ name: game.home.name, short: game.home.abbr, logo: game.home.logo, score: game.home.score, color: themeOf(game.home.id)?.glow, plate: themeOf(game.home.id)?.plate }}
        center={esTime(game.date)}
        centerSub={st === 'pre' ? new Date(game.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : st === 'live' ? game.status : 'Final'}>
        <SheetTabs value={tab} onChange={setTab} items={[
          ['stats', 'Estadísticas'],
          ...(st === 'pre' ? [['picks', 'Recomendaciones']] as [Tab, string][] : []),
          ...(st === 'post' ? [] : [['odds', 'Cuotas']] as [Tab, string][]),
          ['points', 'Puntos'],
          ...(st === 'pre' ? [['lines', 'Líneas']] as [Tab, string][] : []),
          ['h2h', 'H2H'], ['teams', 'Equipos'], ['rosters', 'Plantillas'], ['value', player ? `Valor: ${player.name}` : 'Valor de jugador']
        ]} right={<Button size="sm" onClick={() => openBet({ sport: 'basket', league: LEAGUE_NAME[game.league], event })}><Plus size={14} />Apuesta</Button>} />
      </Scoreboard>
      {st === 'pre' && <RestStrip game={game} />}
      {tab === 'stats' ? <GameStats game={game} onPick={pick} /> : tab === 'odds' ? <BasketOdds game={game} />
        : tab === 'picks' ? <BasketPicksBoard games={[game]} injuries={injuries} onOpen={openPick} onOdds={() => setTab('odds')} />
        : tab === 'points' ? <GamePoints key={teamPick?.id} game={game} odds={odds.data} initial={teamPick?.period && teamPick.pointKind ? { period: teamPick.period, kind: teamPick.pointKind, line: teamPick.line } : undefined} />
          : tab === 'lines' ? <BasketLineScanner games={[game]} injuries={injuries} onPick={p => { setPlayer(p); setTab('value'); }} />
          : tab === 'h2h' ? <BasketTrends game={game} odds={odds.data} />
            : tab === 'teams' ? <TeamsCompare game={game} onTeam={setSheet} /> : tab === 'rosters'
        ? <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Roster game={game} side="away" injuries={injuries} current={player?.id} onPick={pick} />
          <Roster game={game} side="home" injuries={injuries} current={player?.id} onPick={pick} />
        </div>
        : player ? <BasketAnalyzer key={`${player.id}:${player.market}:${player.line}`} player={player} games={[game]} injuries={injuries} odds={odds.data} />
          : <Empty>Pulsa un jugador en Plantillas para analizar sus líneas.</Empty>}
    </div>
  );
}

// Descanso de los dos equipos antes del partido: un B2B o un 3 en 4 cambia totales y hándicaps
function RestStrip({ game }: { game: BasketGame }) {
  const r = useRest(game).data;
  if (!r?.home || !r.away) return null;
  const side = (abbr: string, x: NonNullable<typeof r.home>, home: boolean) => {
    const t = restText(x, home);
    return <span><span className="font-semibold text-zinc-300">{abbr}</span> <span className={t.tone === 'bad' ? 'text-rose-300' : 'text-zinc-400'}>{t.text.charAt(0).toLowerCase() + t.text.slice(1)}</span></span>;
  };
  return (
    <div className="-mt-2 flex flex-wrap gap-x-5 gap-y-1 px-1 text-xs">
      <span className="text-zinc-500">Descanso</span>{side(game.away.abbr, r.away, false)}{side(game.home.abbr, r.home, true)}
    </div>
  );
}

function Roster({ game, side, injuries, current, onPick }: {
  game: BasketGame; side: 'home' | 'away'; injuries: BasketInjury[]; current?: string; onPick: (p: BasketRosterPlayer, teamId: string) => void;
}) {
  const team = game[side];
  const r = useQuery({ queryKey: ['basket', 'roster', game.league, team.id], queryFn: () => window.api.basket.roster(game.league, team.id), staleTime: 30 * 60e3 });
  const injuryOf = (p: BasketRosterPlayer) => (game.league === 'nba' ? injuries.find(i => i.playerId === p.id)?.status : null) || p.injury;
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-surface">
      <div className="flex items-center gap-2.5 border-b border-zinc-800/60 px-4 py-2.5">
        {team.logo && <img loading="lazy" decoding="async" src={sized(team.logo, 24)} onError={fallbackTo(team.logo)} alt="" className="h-6 w-6 object-contain" />}
        <span className="font-semibold">{team.name}</span>
        <span className="ml-auto text-xs text-zinc-500">{side === 'home' ? 'Local' : 'Visitante'}</span>
      </div>
      {r.isLoading ? <div className="px-4"><Loading /></div> : r.error ? <div className="p-3"><ErrorBox error={r.error} /></div> : (
        <div className="divide-y divide-zinc-800/60">
          {(r.data ?? []).map(p => {
            const inj = injuryOf(p);
            return (
              <button key={p.id} onClick={() => onPick(p, team.id)}
                className={cn('flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition hover:bg-zinc-800/40', current === p.id && 'bg-amber-500/10')}>
                <span className="w-6 text-right font-score text-base text-zinc-500 tnum">{p.jersey}</span>
                {p.headshot
                  ? <img loading="lazy" decoding="async" src={sized(p.headshot, 32)} alt="" className="h-8 w-8 shrink-0 rounded-full bg-zinc-800 object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                  : <span className="h-8 w-8 shrink-0 rounded-full bg-zinc-800" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-zinc-500">{p.pos}</div>
                </div>
                {inj && <Badge tone={badInjury(inj) ? 'danger' : 'warning'}>{inj}</Badge>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Estadísticas del partido ----------
const STAT_COLS: [keyof BoxTeam['totals'], string][] = [['min', 'MIN'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'ROB'], ['blk', 'TAP'], ['tov', 'PÉR'], ['fg', 'TC'], ['fg3', 'T3'], ['ft', 'TL'], ['pm', '+/-']];
const pctOf = (s: string) => { const [m, a] = s.split('-').map(Number); return a ? Math.round((m / a) * 100) : null; };

function GameStats({ game, onPick }: { game: BasketGame; onPick: (p: { id: string; name: string }, teamId: string) => void }) {
  const st = stateOf(game);
  const box = useQuery({
    queryKey: ['basket', 'box', game.id], queryFn: () => window.api.basket.boxscore(game.id),
    refetchInterval: st === 'live' ? 20_000 : false, staleTime: st === 'post' ? 3600e3 : 15_000
  });
  const themeOf = useTeamThemes(game.league);
  if (box.isLoading) return <Loading label="Cargando estadísticas…" />;
  if (box.error) return <ErrorBox error={box.error} />;
  const teams = ['away', 'home'].map(s => box.data!.teams.find(t => t.side === s)).filter(Boolean) as BoxTeam[];
  const played = teams.some(t => t.players.length);
  return (
    <div className="flex flex-col gap-5">
      {played && <Periods teams={teams} />}
      {played && <BasketFlow game={game} colorA={themeOf(game.away.id)?.mark ?? '#a1a1aa'} colorB={themeOf(game.home.id)?.mark ?? '#f59e0b'} />}
      {played && <Compare teams={teams} />}
      {!played && <Empty>El partido aún no ha empezado: las estadísticas salen en cuanto arranque. Mientras, mira las cuotas o el valor de los jugadores.</Empty>}
      {teams.filter(t => t.players.length).map(t => <BoxTable key={t.side} team={t} game={game} onPick={p => onPick(p, t.id)} />)}
      {!!box.data!.series.length && <Series series={box.data!.series} />}
    </div>
  );
}

// Puntos por cuarto (y prórrogas)
function Periods({ teams }: { teams: BoxTeam[] }) {
  const n = Math.max(...teams.map(t => t.periods.length));
  const label = (i: number) => (i < 4 ? `${i + 1}.º` : `P${i - 3}`);
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-surface">
      <table className="w-full">
        <thead className="bg-zinc-900/60"><tr><th className={th}>Equipo</th>{Array.from({ length: n }, (_, i) => <th key={i} className={th + ' text-center'}>{label(i)}</th>)}<th className={th + ' text-center'}>Total</th></tr></thead>
        <tbody className="divide-y divide-zinc-800/60">
          {teams.map(t => (
            <tr key={t.side}>
              <td className={td}><span className="flex items-center gap-2">{t.logo && <img loading="lazy" decoding="async" src={sized(t.logo, 20)} onError={fallbackTo(t.logo)} alt="" className="h-5 w-5 object-contain" />}{t.name}</span></td>
              {Array.from({ length: n }, (_, i) => {
                const other = teams.find(x => x !== t)?.periods[i] ?? 0, v = t.periods[i];
                return <td key={i} className={cn(td, 'text-center font-score text-base tnum', v != null && v > other ? 'text-zinc-50' : 'text-zinc-500')}>{v ?? ''}</td>;
              })}
              <td className={td + ' text-center font-score text-lg font-semibold tnum'}>{t.periods.reduce((s, v) => s + v, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Comparación de equipo: barras enfrentadas con el que va mejor en cada estadística
function Compare({ teams }: { teams: BoxTeam[] }) {
  const [a, b] = teams;
  const rows: [string, number | null, number | null, string?][] = [
    ['Tiros de campo', pctOf(a.totals.fg), pctOf(b.totals.fg), '%'], ['Triples', pctOf(a.totals.fg3), pctOf(b.totals.fg3), '%'],
    ['Tiros libres', pctOf(a.totals.ft), pctOf(b.totals.ft), '%'], ['Rebotes', a.totals.reb, b.totals.reb], ['Asistencias', a.totals.ast, b.totals.ast],
    ['Robos', a.totals.stl, b.totals.stl], ['Tapones', a.totals.blk, b.totals.blk], ['Pérdidas', a.totals.tov, b.totals.tov]
  ];
  return (
    <div className="rounded-xl border border-zinc-800 bg-surface p-5">
      <div className="mb-3 flex justify-between text-sm font-semibold"><span>{a.abbr}</span><span>{b.abbr}</span></div>
      <div className="flex flex-col gap-3">
        {rows.map(([label, x, y, unit]) => {
          const tot = (x ?? 0) + (y ?? 0) || 1, lowBetter = label === 'Pérdidas';
          const aWins = x != null && y != null && (lowBetter ? x < y : x > y), bWins = x != null && y != null && (lowBetter ? y < x : y > x);
          return (
            <div key={label}>
              <div className="mb-1 flex justify-between text-xs"><span className={cn('tnum', aWins ? 'font-semibold text-zinc-50' : 'text-zinc-400')}>{x ?? '–'}{unit && x != null ? unit : ''}</span><span className="text-zinc-500">{label}</span><span className={cn('tnum', bWins ? 'font-semibold text-zinc-50' : 'text-zinc-400')}>{y ?? '–'}{unit && y != null ? unit : ''}</span></div>
              <div className="flex h-1.5 gap-1">
                <div className="flex flex-1 justify-end overflow-hidden rounded-full bg-zinc-800"><div className={cn('h-full rounded-full', aWins ? 'bg-amber-500' : 'bg-zinc-600')} style={{ width: `${((x ?? 0) / tot) * 100}%` }} /></div>
                <div className="flex flex-1 overflow-hidden rounded-full bg-zinc-800"><div className={cn('h-full rounded-full', bWins ? 'bg-amber-500' : 'bg-zinc-600')} style={{ width: `${((y ?? 0) / tot) * 100}%` }} /></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- H2H y "cuántas veces se cumple" ----------
// Con los partidos de la liga de esta temporada y la anterior (los mismos que usan los puntos de los equipos): los cara a cara
// y los últimos 10 de cada uno, contra las líneas que dan ahora las casas. A = visitante, B = local, como en la app
function BasketTrends({ game, odds }: { game: BasketGame; odds?: MatchOdds }) {
  const q = useQuery({ queryKey: ['basket', 'leagueGames', game.league], queryFn: () => window.api.basket.leagueGames(game.league), staleTime: 5 * 60e3, retry: false });
  if (q.isLoading) return <Loading label="Cargando los partidos de la liga…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const A = game.away, B = game.home;
  const { h2h, lastA, lastB } = basketTrendData(game, q.data!);
  const markets = basketMarkets(odds, A.abbr, B.abbr, [...lastA, ...lastB]);
  const date = (d: string) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return (
    <TrendsTable A={A.abbr} B={B.abbr} logoA={A.logo} logoB={B.logo} h2h={h2h} lastA={lastA} lastB={lastB} markets={markets}
      note={!odds?.markets.length ? 'Todavía no hay cuotas de este partido: las líneas son las habituales de los dos equipos.' : undefined}
      list={g => <>
        <span className="w-16 shrink-0 text-xs text-zinc-500 tnum">{date(g.date)}</span>
        <span className="min-w-0 flex-1 truncate font-medium tnum">
          <span className={g.a > g.b ? 'text-zinc-50' : 'text-zinc-400'}>{A.abbr} {g.a}</span> - <span className={g.b > g.a ? 'text-zinc-50' : 'text-zinc-400'}>{g.b} {B.abbr}</span>
        </span>
        <span className="shrink-0 text-xs text-zinc-500">{g.vs} · {g.a + g.b} puntos</span>
      </>} />
  );
}

type StatKey = keyof BoxTeam['totals'];
// Valor para ordenar una columna: los tiros ("7-15") por los metidos y, a igualdad, por los intentados; el +/- por su número
const sortValue = (p: BoxTeam['players'][number], k: StatKey) => {
  const v = p[k];
  if (typeof v === 'number') return v;
  const s = String(v ?? '');
  if (/^\d+-\d+$/.test(s)) { const [m, a] = s.split('-').map(Number); return m + a / 1000; }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : -Infinity;
};

// Tabla de anotadores de un equipo: titulares primero; pulsar un jugador abre su partido (tiros y estadísticas, como en
// fútbol), y desde ahí el valor de sus líneas. Pulsar una columna ordena por ella de más a menos; otra vez, de menos a más;
// y otra, vuelta al orden de titulares
function BoxTable({ team, game, onPick }: { team: BoxTeam; game: BasketGame; onPick: (p: { id: string; name: string }) => void }) {
  const [sort, setSort] = useState<{ k: StatKey; dir: 'desc' | 'asc' } | null>(null);
  const [sel, setSel] = useState<BoxTeam['players'][number] | null>(null);
  const byDefault = team.players.slice().sort((x, y) => Number(y.starter) - Number(x.starter) || y.min - x.min);
  // Los que no jugaron van siempre al final, ordenes como ordenes
  const list = sort
    ? byDefault.slice().sort((x, y) => Number(!y.min) - Number(!x.min) || (sort.dir === 'desc' ? 1 : -1) * (sortValue(y, sort.k) - sortValue(x, sort.k)))
    : byDefault;
  const click = (k: StatKey) => setSort(s => (!s || s.k !== k ? { k, dir: 'desc' } : s.dir === 'desc' ? { k, dir: 'asc' } : null));
  const top = Math.max(...list.map(p => p.pts));
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-surface">
      <div className="flex items-center gap-2.5 border-b border-zinc-800/60 px-4 py-2.5">
        {team.logo && <img loading="lazy" decoding="async" src={sized(team.logo, 24)} onError={fallbackTo(team.logo)} alt="" className="h-6 w-6 object-contain" />}
        <span className="font-semibold">{team.name}</span>
        <span className="ml-auto text-xs text-zinc-500">Pulsa un jugador para ver su partido</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-zinc-900/60"><tr>
            <th className={th}>Jugador</th>
            {STAT_COLS.map(([k, l]) => {
              const on = sort?.k === k;
              return (
                <th key={k} className={cn(th, 'text-right')} aria-sort={on ? (sort!.dir === 'desc' ? 'descending' : 'ascending') : undefined}>
                  <button type="button" onClick={() => click(k)} title={on && sort!.dir === 'desc' ? 'Ordenar de menos a más' : on ? 'Quitar el orden' : 'Ordenar de más a menos'}
                    className={cn('inline-flex cursor-pointer items-center gap-0.5 transition hover:text-zinc-100', on && 'text-amber-300')}>
                    {l}{on ? (sort!.dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />) : <ArrowUpDown size={11} className="opacity-30" />}
                  </button>
                </th>
              );
            })}
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {list.map(p => (
              <tr key={p.id || p.name} onClick={() => setSel(p)} className="cursor-pointer hover:bg-zinc-800/30" title="Su partido: tiros y estadísticas">
                <td className={td}><span className="flex items-center gap-2">{p.name}{p.starter && <span className="text-[10px] text-zinc-500" title="Titular">T</span>}</span></td>
                {STAT_COLS.map(([k]) => (
                  <td key={k} className={cn(td, 'text-right tnum', k === 'pts' ? cn('font-semibold', p.pts === top && top > 0 ? 'text-amber-300' : 'text-zinc-100') : 'text-zinc-300')}>
                    {k === 'min' ? Math.round(p.min) : p[k]}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-zinc-900/60 font-semibold">
              <td className={td}>Total</td>
              {STAT_COLS.map(([k]) => <td key={k} className={td + ' text-right tnum'}>{k === 'min' || k === 'pm' ? '' : team.totals[k]}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {!!team.out?.length && (
        <div className="border-t border-zinc-800/60 px-4 py-2.5 text-xs leading-relaxed">
          <span className="text-zinc-500">No jugaron: </span>
          {team.out.map((o, i) => (
            <span key={o.id || o.name}>{i > 0 && <span className="text-zinc-600"> · </span>}<span className="text-zinc-300">{o.name}</span> <span className="text-zinc-500">({o.reason.toLowerCase()})</span></span>
          ))}
        </div>
      )}
      {sel && <BasketPlayerGameDialog key={sel.id || sel.name} game={game} team={team} player={sel} onClose={() => setSel(null)}
        onLines={() => { const p = sel; setSel(null); onPick(p); }} />}
    </div>
  );
}

// Enfrentamientos de la temporada entre los dos equipos
function Series({ series }: { series: { date: string; status: string; score: { abbr: string; score: string; winner: boolean }[] }[] }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-surface p-4">
      <div className="mb-3 text-sm font-semibold">Enfrentamientos esta temporada</div>
      <div className="flex flex-wrap gap-2">
        {series.map(s => {
          const played = s.score.some(x => x.winner);
          return (
            <div key={s.date} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm">
              <div className="text-xs text-zinc-500">{new Date(s.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</div>
              {played
                ? <div className="font-score text-base tnum">{s.score.map((x, i) => <span key={i} className={x.winner ? 'font-semibold text-zinc-50' : 'text-zinc-500'}>{i ? ' – ' : ''}{x.abbr} {x.score}</span>)}</div>
                : <div className="text-zinc-400">{s.score.map(x => x.abbr).join(' – ')}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
