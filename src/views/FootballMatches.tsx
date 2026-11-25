// Fútbol · Partidos: igual que en baloncesto y tenis. Tira de días (hora de España), filtro por estado, los partidos en juego
// arriba y el resto por competición, con la cuota 1X2 en cada tarjeta, y en pantallas anchas las recomendaciones del día al
// lado. El selector de arriba cambia a la pantalla Recomendaciones. Al pulsar un partido, su ficha: marcador grande con los
// goleadores, resumen (goles, tarjetas y cambios), cuotas de Winamax y Betway, estadísticas, alineaciones, forma, cara a cara
// y clasificación.
import { useCardOdd } from '@/lib/card-odds';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { sectionId, useApp, useLostMatch, useRouteDay, useRouteMatch, useSections } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { FootballLeagueId, FootballMatch } from '@/lib/types';
import { SportOdds } from '@/components/BasketOdds';
import { targetOfFootball } from '@/lib/odds-targets';
import { FootballDayPicks, FootballPicksPage, FootballPicksPanel, footballDayQuery } from '@/components/FootballPicks';
import { useMember } from '@/components/AuthGate';
import { AdSlot } from '@/components/AdSlot';
import { useMedia } from '@/lib/use-media';
import { SheetScroll, CompetitionBlock, DayStrip, LiveSection, MatchCard, MatchesTitle, ModeSwitch, OddsLegend, NoGames, SheetTabs, StateFilterBar, Toggle, addDays, dayName, noGamesText, today, useNextDay, type StateFilter } from '@/components/sport';
import { esTime } from '@/components/football';
import { Button, ErrorBox, Loading } from '@/components/ui';
import { FavoritesStrip } from '@/components/Favorites';
import { MyBetsLive } from '@/components/MyBetsLive';
import { stateOf } from './football/shared';
import { MatchHeader } from './football/MatchHeader';
import { Timeline } from './football/Timeline';
import { MatchShotMap } from './football/Shots';
import { Stats } from './football/Stats';
import { Lineups } from './football/Lineups';
import { MatchNews } from '@/components/MatchNews';
import { FootballTrends, Form, Table } from './football/Form';
import { cardNote } from '@/lib/odds-window';

type Mode = 'games' | 'picks';
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };

function loadList(key: string): string[] { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function saveList(key: string, v: string[]) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }
function loadFlag(key: string, def: boolean): boolean { try { const v = localStorage.getItem(key); return v == null ? def : v === '1'; } catch { return def; } }
function saveFlag(key: string, v: boolean) { try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* sin almacenamiento */ } }


export default function FootballMatches() {
  // Para saber desde cuándo se leen las cuotas (lib/odds-window.ts) y decirlo en las tarjetas que aún no tienen
  const { settings, openGame, closeMatch } = useApp();
  const addOdd = useCardOdd();
  const [date, setDate] = useRouteDay();
  const [filter, setFilter] = useState<StateFilter>('all');
  // El partido abierto va en la dirección (/futbol/partido/<id>): atrás del navegador lo cierra
  const openId = useRouteMatch('football');
  // La pestaña con la que se abrió, sólo para ese partido (con atrás no se pasa por onClose para olvidarla)
  const [openTab, setOpenTab] = useState<{ id: string; tab: Tab } | null>(null);
  // Se entra siempre en Partidos (lo primero son los partidos); Recomendaciones es la otra pestaña
  const [mode, pickMode] = useState<Mode>('games');
  const side = useMedia('(min-width: 1280px)'); // columna de las recomendaciones del día al lado de la lista
  const wide = useMedia('(min-width: 1400px)'); // con la columna del cupón y los anuncios a la derecha (App.tsx)
  const [closed, setClosed] = useState(() => loadList('football-closed'));
  const [showOdds, setShowOdds] = useState(() => loadFlag('football-odds', true));
  const ok = !!window.api.football;

  const leagues = useQuery({ queryKey: ['football', 'leagues'], queryFn: () => window.api.football.leagues(), staleTime: 24 * 3600e3, enabled: ok });
  const days = useQuery({ queryKey: ['football', 'days', date], queryFn: () => window.api.football.days(addWeekStart(date), 7), staleTime: 5 * 60e3, enabled: ok });
  const games = useQuery({
    queryKey: ['football', 'games', date], queryFn: () => window.api.football.games(date), enabled: ok,
    refetchInterval: q => (q.state.data?.some(g => g.state === 'in') ? 20_000 : 120_000)
  });

  const all = games.data ?? [];
  const counts = useMemo(() => ({
    all: all.length, live: all.filter(g => g.state === 'in').length, pre: all.filter(g => g.state === 'pre').length, post: all.filter(g => g.state === 'post').length
  }), [all]);
  const shown = all.filter(g => filter === 'all' || stateOf(g) === filter);
  // Los que están en juego van arriba, destacados; el resto por competición, en el orden del servicio
  const liveNow = shown.filter(g => g.state === 'in');
  const order = (leagues.data ?? []).map(l => l.id);
  const byLeague = useMemo(() => {
    const m = new Map<FootballLeagueId, FootballMatch[]>();
    for (const g of shown) if (g.state !== 'in') m.set(g.league, [...(m.get(g.league) ?? []), g]);
    return [...m.entries()].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
  }, [shown, order.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cuota 1X2 de las tarjetas: la mejor de las casas ya leídas
  const pending = useMemo(() => all.filter(g => g.state !== 'post' && !g.off).map(g => ({ id: g.id, ...targetOfFootball(g).match, start: g.date })), [all]);
  const board = useQuery({
    queryKey: ['board', 'football', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: ok && showOdds && pending.length > 0, refetchInterval: 60_000
  });
  const open = openId ? all.find(g => g.id === openId) ?? null : null;
  useSections(openId || mode === 'picks' ? [] : [
    ...(liveNow.length ? [{ id: 'comp-en-directo', label: 'En directo', count: liveNow.length, live: liveNow.length }] : []),
    ...byLeague.map(([, list]) => ({ id: sectionId(list[0].leagueName), label: list[0].leagueName, count: list.length, live: 0 }))
  ]);
  // Un id que no es de ninguna liga (dirección escrita a mano o de una liga que ya no se sigue) no se pide: a la lista
  const known = !openId || /^(laliga|champions|premier|seriea|bundesliga|ligue1|europa|conference|segunda|copa|nations|amistosos|wchampions|ligaf|wsl):\d+$/.test(openId);
  useLostMatch(!known);
  const nextDay = useNextDay('football', date, games.isSuccess && !all.length);
  // La columna de las recomendaciones del día sólo se guarda si hay alguna (o un anuncio, entre 1280 y 1400 px); sin cuenta
  // sale cómo conseguirlas. Antes, sin ninguna, la lista se quedaba en la mitad izquierda y el resto vacío
  const member = useMember();
  const dayPicks = useQuery({ ...footballDayQuery(date), enabled: ok && member && side && mode === 'games' });
  const showSide = side && (!member || !wide || !!dayPicks.data?.length);

  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para el fútbol hay que volver a lanzar <code>npm run backend</code> y recargar la página.</ErrorBox>;
  // La ficha se carga por su id: también abre los partidos que llegan desde la columna de directo aunque sean de otro día
  if (openId && known) return <MatchDetail key={openId} id={openId} preview={open} initialTab={openTab?.id === openId ? openTab.tab : undefined} onClose={closeMatch} />;

  const modes = <ModeSwitch value={mode} onChange={pickMode} />;
  // La ficha de fútbol se carga por su id, así que el día sólo dice a qué lista se vuelve: la que se estaba viendo
  const openPick = (id: string) => { setOpenTab({ id, tab: 'picks' }); openGame(id, date); };
  if (mode === 'picks') {
    const next = [0, 1, 2].map(n => addDays(today(), n)).map(d => ({ value: d, label: dayName(d) }));
    return <div className="flex min-w-0 flex-col gap-5">{modes}<FootballPicksPage days={next} onOpen={openPick} /></div>;
  }

  const toggle = (k: string) => { const n = closed.includes(k) ? closed.filter(x => x !== k) : [...closed, k]; setClosed(n); saveList('football-closed', n); };
  const card = (g: FootballMatch, featured?: boolean) => {
    const st = stateOf(g), done = st === 'post' && !g.off;
    const hs = g.home.score ?? 0, as = g.away.score ?? 0;
    return (
      <MatchCard key={g.id} state={st} onClick={() => openGame(g.id, date)} onOdd={s => addOdd(targetOfFootball(g), s)} featured={featured} odds={showOdds ? board.data?.[g.id] : null} noOdds={showOdds && board.data && !g.off ? cardNote(g.date, { sport: 'football' }, settings) : null}
        competition={featured ? g.leagueName : undefined}
        time={st === 'pre' ? esTime(g.date) : st === 'live' ? 'En juego' : g.off ? g.status : 'Final'}
        status={st === 'live' ? g.status : g.stage || undefined}
        a={{ name: g.home.name, short: g.home.abbr, alt: g.home.short, logo: g.home.logo, score: g.off ? null : g.home.score, win: done && hs > as, lose: done && hs < as }}
        b={{ name: g.away.name, short: g.away.abbr, alt: g.away.short, logo: g.away.logo, score: g.off ? null : g.away.score, win: done && as > hs, lose: done && as < hs }} />
    );
  };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <MatchesTitle date={date} />
      {modes}
      <MyBetsLive />
      <FavoritesStrip />
      <StateFilterBar above={<DayStrip value={date} onChange={setDate} counts={days.data} />} value={filter} onChange={setFilter} counts={counts}>
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); saveFlag('football-odds', v); }} label="Cuotas" />
      </StateFilterBar>
      {showOdds && !!shown.length && <OddsLegend />}
      {games.isLoading ? <Loading label="Cargando partidos…" /> : games.error ? <ErrorBox error={games.error} />
        : !shown.length ? (
          filter !== 'all' && all.length
            ? <NoGames app="football" text="Ningún partido de ese día con este filtro." onDay={setDate}><Button size="sm" variant="secondary" onClick={() => setFilter('all')}>Ver todos</Button></NoGames>
            : <NoGames app="football" text={noGamesText('football', date)} next={nextDay} onDay={setDate} />
        )
          : <div className={cn('grid items-start gap-4', showSide && 'grid-cols-[minmax(0,1fr)_minmax(300px,380px)]')}>
            <div className="flex min-w-0 flex-col gap-5">
            {!!liveNow.length && <LiveSection count={liveNow.length}>{liveNow.map(g => card(g, true))}</LiveSection>}
            {byLeague.map(([id, list]) => {
              const meta = leagues.data?.find(l => l.id === id);
              return (
                <CompetitionBlock key={id} id={sectionId(list[0].leagueName)} name={list[0].leagueName} sub={meta?.country} logo={meta?.logo}
                  count={list.length} open={!closed.includes(id)} onToggle={() => toggle(id)}>
                  {list.map(g => card(g))}
                </CompetitionBlock>
              );
            })}
            </div>
            {showSide && (
              <div className="sticky top-0 flex min-w-0 flex-col gap-4">
                <FootballDayPicks date={date} onOpen={openPick} onAll={() => pickMode('picks')} />
                {!wide && <AdSlot size="rect" />}
              </div>
            )}
          </div>}
    </div>
  );
}

// ---------- ficha del partido ----------
type Tab = 'summary' | 'picks' | 'odds' | 'news' | 'stats' | 'lineups' | 'form' | 'h2h' | 'table';

// initialTab: la pestaña con la que se abre (desde Recomendaciones, la suya)
function MatchDetail({ id, preview, initialTab, onClose }: { id: string; preview: FootballMatch | null; initialTab?: Tab; onClose: () => void }) {
  const { openBet } = useApp();
  const q = useQuery({
    queryKey: ['football', 'match', id], queryFn: () => window.api.football.match(id),
    refetchInterval: r => (r.state.data?.match.state === 'in' ? 20_000 : false)
  });
  const m = q.data?.match ?? preview;
  const [tab, setTab] = useState<Tab | null>(initialTab ?? null);
  const back = (
    <button onClick={onClose} className="flex w-fit cursor-pointer items-center gap-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-100">
      <ArrowLeft size={16} />Volver a partidos
    </button>
  );
  if (!m) return <div className="flex flex-col gap-3">{back}{q.error ? <ErrorBox error={q.error} /> : <Loading label="Cargando el partido…" />}</div>;
  const st = stateOf(m);
  // Antes de empezar no hay resumen ni estadísticas: se abren las recomendaciones
  const current: Tab = tab ?? (st === 'pre' && !m.off ? 'picks' : 'summary');
  const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <SheetScroll />
      {back}
      <MatchHeader m={m} events={d?.timeline ?? m.incidents} attendance={d?.attendance ?? null}>
        <SheetTabs value={current} onChange={setTab} items={[
          ['summary', 'Resumen'], ...(st === 'pre' && !m.off ? [['picks', 'Recomendaciones']] as [Tab, string][] : []),
          ...(st === 'post' || m.off ? [] : [['odds', 'Cuotas']] as [Tab, string][]),
          ['news', 'Noticias'],
          ['stats', 'Estadísticas'], ['lineups', 'Alineaciones'], ['form', 'Forma'], ['h2h', 'H2H'],
          ...(m.league !== 'copa' ? [['table', 'Clasificación']] as [Tab, string][] : [])
        ]} right={<Button size="sm" onClick={() => openBet({ sport: 'football', league: m.leagueName, event: targetOfFootball(m).event })}><Plus size={14} /><span className="max-sm:sr-only">Apuesta</span></Button>} />
      </MatchHeader>
      {current === 'odds' ? <SportOdds target={targetOfFootball(m)} />
        : current === 'picks' ? <FootballPicksPanel m={m} onOdds={() => setTab('odds')} />
        : current === 'news' ? <MatchNews sport="football" teams={[m.home, m.away].map(t => ({ key: String(t.id), name: t.name, logo: t.logo }))} />
        : !d ? (q.error ? <ErrorBox error={q.error} /> : <Loading label="Cargando la ficha…" />)
        : current === 'summary' ? <Timeline d={d} />
          : current === 'stats' ? <div className="flex flex-col gap-3">{!!d.shots?.length && <MatchShotMap m={m} shots={d.shots} />}<Stats d={d} /></div>
            : current === 'lineups' ? <Lineups d={d} />
              : current === 'form' ? <Form d={d} />
                : current === 'h2h' ? <FootballTrends d={d} />
                : <Table m={m} />}
    </div>
  );
}
