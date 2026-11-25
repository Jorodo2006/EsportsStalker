// Recomendaciones de baloncesto: la mejor opción y las demás por perfil de riesgo, con filtros por mercado, línea y cuota mínima, y
// las mejores de las próximas 24 horas en la lista de partidos. El cálculo está en lib/basket-picks.ts; aquí se piden los datos y se enseña.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import { injuryEs } from '@/lib/basket-labels';
import { parseLine } from '@/lib/basket-model';
import { PICK_BOOKS, PICK_GROUPS, arrangePicks, bestPicks, hasValue, onlyBook, pickVerdict, playerKeyOf, playerPicks, saneLine, teamPicks, type BasketPick, type PickBook, type PickFilters, type PickGroup } from '@/lib/basket-picks';
import { VERDICT_LABEL } from '@/lib/value';
import { teamOuts } from '@/lib/basket-absences';
import { basketPrediction, logPredictions } from '@/lib/predictions';
import type { BasketGame, BasketInjury, BasketSide, MatchOdds } from '@/lib/types';
import { sized } from '@/lib/img';
import type { Side } from '@/lib/value';
import { LEAGUE_NAME, esTime } from './BasketAnalyzer';
import { matchOfGame, targetOfGame } from './BasketOdds';
import { RefreshOdds } from './RefreshOdds';
import { restart } from './BasketPoints';
import { ReliabilityMeter } from './ValuePanel';
import { Toggle } from './sport';
import { Empty, FoldOnPhone, Input, Loading, Select } from './ui';
import { TvBand, TvFrame, TvHeader, TvStat, TvTabs, panel } from './viz';
import { ODDS_FALLBACK, oddsMeta } from '@/lib/odds-live';
import { EASY_HINT, PickWhy } from './PickWhy';
import { NewsBasisList, NewsHint, useTeamNews } from './MatchNews';
import { keyNews, withNews, type KeyNews } from '@/lib/news';

// La noticia que puede cambiar una recomendación (la del jugador, si la nombra; lib/news.ts). La del equipo sale sólo bajo la
// mejor opción; en las filas, sólo las que nombran a su jugador (si no, la misma se repetía en todas las de ese partido)
type NewsOf = (p: BasketPick) => KeyNews | null;
const newsKeys = (g: BasketGame) => [`${g.league}:${g.away.id}`, `${g.league}:${g.home.id}`];
import { memberOnly } from './MemberOnly';
import { PickNums, PickOdd, PickOddText, PicksTitle, p0, signed } from './PickParts';

const PREFS = 'basket-picks';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
const MIN_ODDS = [1.3, 1.5, 1.7, 2, 2.5];
const DEFAULT_MIN_ODDS = 1.5;
const bookOf = (prefs: { book?: unknown }): PickBook => (PICK_BOOKS.some(b => b.value === prefs.book) ? prefs.book as PickBook : 'all');
const STALE_MS = 6 * 3600e3;
const PAGE = 5;
const ago = (ms: number) => { const m = Math.round(ms / 60e3); return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
const eventOf = (g: BasketGame) => `${g.away.abbr} @ ${g.home.abbr}`;
// Sólo se enseña: lo que se apunta en la apuesta sigue siendo eventOf (el resolvedor y los avisos leen ese texto)
const cupTag = (g: BasketGame) => (g.cup ? ' (NBA Cup)' : '');
const newest = (o?: MatchOdds) => Math.max(0, ...Object.values(o?.sources ?? {}).map(s => s.ts || 0));
const hasPlayers = (o?: MatchOdds) => !!o?.markets.some(m => m.key.startsWith('player|'));
const hasTeams = (o?: MatchOdds) => !!o?.markets.some(m => /^(total|team_total)\|/.test(m.key));

// Todo lo que hace falta de varios partidos. Los jugadores y los equipos sólo se piden si las casas tienen líneas: mirar un partido sin
// cuotas no sirve de nada, y los partidos de los jugadores pesan. book: calcular sólo con las cuotas de esa casa (onlyBook)
export function useBasketPicks(games: BasketGame[], injuries: BasketInjury[], book: PickBook = 'all') {
  // La misma clave que la ficha del partido: comparten las cuotas ya leídas. Mirar muchos partidos no es abrirlos: quiet
  const oddsQ = useQueries({
    queries: games.map(g => { const t = targetOfGame(g); return { queryKey: ['odds', t.sport, t.id], queryFn: () => window.api.odds.match(t.match, { quiet: true }), meta: oddsMeta(t.match), refetchInterval: ODDS_FALLBACK }; })
  });
  // Las cuotas se vuelven a pedir cuando llega una lectura nueva, y a veces no cambian: si son iguales, TanStack Query conserva la misma lista de
  // mercados. Sólo se recalcula cuando cambia de verdad, porque son miles de líneas
  const ids = useRef(new WeakMap<object, number>());
  const nextId = useRef(1);
  const idOf = (o?: object) => { if (!o) return 0; if (!ids.current.has(o)) ids.current.set(o, nextId.current++); return ids.current.get(o)!; };
  const oddsKey = oddsQ.map(q => idOf(q.data?.markets)).join();
  // También los de los partidos con sólo líneas de equipo: hacen falta para saber quién falta (bajas en los puntos de equipo)
  const teams = useMemo(() => games.flatMap((game, i) => (hasPlayers(oddsQ[i]?.data) || hasTeams(oddsQ[i]?.data) ? [{ game, side: 'away' as const }, { game, side: 'home' as const }] : [])), [games, oddsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const logs = useQueries({
    queries: teams.map(t => ({ queryKey: ['basket', 'teamLogs', t.game.league, t.game[t.side].id], queryFn: () => window.api.basket.teamLogs(t.game.league, t.game[t.side].id), staleTime: 15 * 60e3, retry: 1 }))
  });
  const leagues = useMemo(() => [...new Set(games.filter((_, i) => hasTeams(oddsQ[i]?.data)).map(g => g.league))], [games, oddsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const points = useQueries({
    queries: leagues.map(l => ({ queryKey: ['basket', 'leagueGames', l], queryFn: () => window.api.basket.leagueGames(l), staleTime: 5 * 60e3, retry: false }))
  });
  const logsKey = logs.map(q => idOf(q.data)).join(), pointsKey = points.map(q => idOf(q.data)).join();
  // Las cuotas de la casa elegida, una vez por lectura: si se rehicieran en cada vuelta, se recalcularía todo cada vez
  const views = useRef(new WeakMap<object, Map<PickBook, MatchOdds>>());
  const view = (o?: MatchOdds) => {
    if (!o || book === 'all') return o;
    let m = views.current.get(o.markets);
    if (!m) views.current.set(o.markets, (m = new Map()));
    if (!m.has(book)) m.set(book, onlyBook(o, book));
    return m.get(book);
  };

  // Los equipos llegan de uno en uno: cada uno se calcula una vez, no todos cada vez que llega otro
  const done = useRef(new Map<string, { deps: unknown[]; picks: BasketPick[] }>());
  const once = (key: string, deps: unknown[], make: () => BasketPick[]) => {
    const c = done.current.get(key);
    if (c && c.deps.every((d, i) => d === deps[i])) return c.picks;
    const picks = make();
    done.current.set(key, { deps, picks });
    return picks;
  };
  const { picks, considered, lines } = useMemo(() => {
    const all: BasketPick[] = [];
    const logsOf = (g: BasketGame, side: 'away' | 'home') => logs[teams.findIndex(t => t.game.id === g.id && t.side === side)]?.data;
    games.forEach((g, i) => {
      const odds = view(oddsQ[i]?.data);
      const leagueData = points[leagues.indexOf(g.league)]?.data;
      if (!odds || !leagueData || !hasTeams(odds)) return;
      // Bajas de habituales de cada equipo (parte de ESPN en la NBA; si no, el de la plantilla), sólo antes del partido
      const la = logsOf(g, 'away'), lb = logsOf(g, 'home');
      const statusOf = (id: string, roster: string | null | undefined) => (g.league === 'nba' ? injuries.find(x => x.playerId === id)?.status : null) || roster;
      const outsOf = g.state === 'pre' && (la || lb) ? (P: Parameters<NonNullable<Parameters<typeof teamPicks>[3]>>[0]) => ({ away: teamOuts(la, g.away.id, P.a, g.date, statusOf), home: teamOuts(lb, g.home.id, P.b, g.date, statusOf) }) : undefined;
      all.push(...once(`${g.id}:equipos:${book}`, [g.date, odds.markets, leagueData, la, lb, injuries.length], () => teamPicks(g, leagueData, odds, outsOf)));
    });
    teams.forEach((t, i) => {
      const data = logs[i]?.data, odds = view(oddsQ[games.indexOf(t.game)]?.data);
      if (data && odds) all.push(...once(`${t.game.id}:${t.side}:${book}`, [t.game.date, odds.markets, data, injuries.length], () => playerPicks(t.game, t.side, data, odds, injuries)));
    });
    return { picks: all.filter(saneLine), considered: all.length, lines: all };
  }, [games, oddsKey, logsKey, pointsKey, injuries.length, book]); // eslint-disable-line react-hooks/exhaustive-deps

  // Se registran todas las líneas calculadas, no sólo las de valor, para medir después si el modelo acierta (Mis apuestas →
  // Acierto del modelo). Si sólo se guardaran las de valor, que son justo en las que el modelo no está de acuerdo con la casa,
  // la casa saldría siempre mejor y no se podría medir cuánto debe pesar cada uno. Las recomendadas se separan al mirarlas
  useEffect(() => {
    logPredictions(lines.map(basketPrediction).filter((x): x is NonNullable<typeof x> => !!x));
  }, [lines]);

  const now = Date.now();
  const stamps = games.map((_, i) => newest(oddsQ[i]?.data)).filter(Boolean);
  return {
    picks, considered,
    oddsLoading: oddsQ.some(q => q.isLoading),
    noOdds: games.filter((_, i) => oddsQ[i]?.data && !oddsQ[i].data!.markets.length),
    // Con una casa elegida: los partidos que tienen cuotas, pero no de ésa
    noBook: book === 'all' ? [] : games.filter((_, i) => oddsQ[i]?.data?.markets.length && !view(oddsQ[i].data)!.markets.length),
    stale: games.filter((_, i) => { const t = newest(oddsQ[i]?.data); return t && now - t > STALE_MS; }),
    age: stamps.length ? now - Math.max(...stamps) : null,
    loaded: logs.filter(q => q.data).length + points.filter(q => q.data).length, total: logs.length + points.length,
    failed: [...oddsQ, ...logs].find(q => q.error)?.error
  };
}

// La clave del comparador de una línea de jugador (las de equipo no la llevan: se leen enteras)

export const usePickAdd = () => {
  const { addToSlip } = useApp();
  // Las de jugador llevan su línea (para resolverse solas); las de equipo las reconoce el servidor por el texto si puede
  return (p: BasketPick) => addToSlip({
    sport: 'basket', status: 'pending', league: LEAGUE_NAME[p.game.league], event: eventOf(p.game), market: p.market, selection: p.selection, odds: p.price, bookmaker: p.book,
    ...(() => {
      const key = playerKeyOf(p);
      return key ? { ref: { sport: 'basket' as const, match: p.game.id, start: p.game.date, key, out: p.side }, live: { match: matchOfGame(p.game), key, out: p.side } } : {};
    })()
  });
};

const tip = (p: BasketPick) => `${p.market}: ${p.selection}. Modelo ${p0(p.pModel)}${p.pMarket != null ? `, casa ${p0(p.pMarket)}` : ''}. Fiabilidad ${p.rel.score}/100. Cuota justa ${odd(p.fair)}`;

// La cara de cada recomendación, para que se vea de quién es y que se puede pulsar: la foto del jugador con el escudo de su equipo
// en la esquina (sin foto, sus iniciales) o, en las de puntos, el escudo del equipo (los dos en las del total del partido)
const initials = (name: string) => { const w = name.split(/\s+/).filter(Boolean); return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
function PickFace({ pick, big }: { pick: BasketPick; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  const g = pick.game;
  const logo = (t: BasketSide, cls: string) => (t.logo ? <img src={sized(t.logo, 40)} alt="" loading="lazy" decoding="async" className={cn('shrink-0 object-contain', cls)} /> : null);
  const circle = cn('relative grid shrink-0 place-items-center rounded-full bg-zinc-800 ring-1 ring-inset ring-white/10', big ? 'h-14 w-14 md:h-16 md:w-16' : 'h-10 w-10');
  if (!pick.who) {
    if (pick.pointKind === 'home' || pick.pointKind === 'away') return <span className={circle}>{logo(g[pick.pointKind], big ? 'h-9 w-9' : 'h-6 w-6')}</span>;
    return <span className={circle}><span className="flex items-center -space-x-1">{logo(g.away, big ? 'h-7 w-7' : 'h-[18px] w-[18px]')}{logo(g.home, big ? 'h-7 w-7' : 'h-[18px] w-[18px]')}</span></span>;
  }
  const team = g.home.id === pick.who.teamId ? g.home : g.away.id === pick.who.teamId ? g.away : null;
  const photo = !broken && pick.who.headshot;
  return (
    <span className={circle}>
      <span className="absolute inset-0 grid place-items-center overflow-hidden rounded-full">
        {photo ? <img src={sized(photo, big ? 64 : 40)} onError={() => setBroken(true)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
          : <span className={cn('font-score font-semibold text-zinc-300', big ? 'text-lg' : 'text-[13px]')}>{initials(pick.who.name)}</span>}
      </span>
      {team?.logo && <span className={cn('absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-zinc-950 ring-1 ring-zinc-800', big ? 'h-6 w-6' : 'h-[18px] w-[18px]')}>{logo(team, big ? 'h-4 w-4' : 'h-3 w-3')}</span>}
    </span>
  );
}
// Que se vea que la recomendación se abre: su análisis (el del jugador o el de los puntos del partido)
const OpenHint = ({ pick, big }: { pick: BasketPick; big?: boolean }) => (
  <span className={cn('mt-1 flex items-center gap-0.5 whitespace-nowrap font-medium text-amber-400 group-hover:underline', big ? 'text-xs' : 'text-[11px] leading-[14px]')}>
    {pick.who ? 'Pulsa para ver su análisis' : 'Pulsa para ver el análisis'}<ChevronRight size={big ? 14 : 12} className="shrink-0" />
  </span>
);

function PickRow({ pick, oneGame, onOpen, onAdd, newsOf }: { pick: BasketPick; oneGame: boolean; onOpen: (p: BasketPick) => void; onAdd: (p: BasketPick) => void; newsOf?: NewsOf }) {
  const good = hasValue(pick);
  return (
    <div className="px-3 py-2.5 transition hover:bg-white/[.04]">
      <button onClick={() => onOpen(pick)} title={tip(pick)} className="group flex w-full cursor-pointer items-start gap-2.5 text-left">
        <PickFace pick={pick} />
        <span className="min-w-0 flex-1">
          <span className="block font-score text-[15px] font-semibold leading-[18px] text-white transition group-hover:text-amber-300">{pick.title}</span>
          <span className="mt-0.5 line-clamp-2 text-[11px] leading-[14px] text-zinc-400">
            {!oneGame && <span className="text-zinc-300">{eventOf(pick.game)}{cupTag(pick.game)}, {esTime(pick.game.date)} · </span>}
            {pick.injury && <span className="text-amber-300">{injuryEs(pick.injury)} · </span>}
            {pick.why}
          </span>
          <OpenHint pick={pick} />
        </span>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2.5">
        <span className="flex items-center gap-2.5"><PickNums p={pick.p} ev={pick.ev} good={good} /></span>
        <span className="flex items-center gap-1.5">
          <RefreshOdds match={matchOfGame(pick.game)} focus={playerKeyOf(pick)} />
          <PickOdd price={pick.price} book={pick.book} fair={pick.fair} onAdd={() => onAdd(pick)} />
        </span>
      </div>
      {newsOf && <NewsHint k={newsOf(pick)?.player ? newsOf(pick) : null} className="mt-1.5" />}
      <div className="mt-1.5 h-[2px] bg-white/15"><div className="h-full bg-[var(--tv-mark)]" style={{ width: `${pick.p * 100}%` }} /></div>
    </div>
  );
}

function PickList({ title, hint, list, oneGame, onOpen, onAdd, newsOf }: { title: string; hint: string; list: BasketPick[]; oneGame: boolean; onOpen: (p: BasketPick) => void; onAdd: (p: BasketPick) => void; newsOf?: NewsOf }) {
  const [all, setAll] = useState(false);
  return (
    <div className="min-w-0">
      <TvBand aside={list.length || undefined}>{title}</TvBand>
      <p className="px-3 pt-1 text-[11px] text-zinc-500">{hint}</p>
      {!list.length ? <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna con estos filtros.</p> : (all ? list : list.slice(0, PAGE)).map(p => <PickRow key={p.id} pick={p} oneGame={oneGame} onOpen={onOpen} onAdd={onAdd} newsOf={newsOf} />)}
      {list.length > PAGE && <button onClick={() => setAll(!all)} className="w-full cursor-pointer py-1.5 text-xs text-zinc-500 hover:text-zinc-200">{all ? `Ver sólo las ${PAGE} primeras` : `Ver las ${list.length}`}</button>}
    </div>
  );
}

function TopPick({ pick, oneGame, onOpen, onAdd, newsOf }: { pick: BasketPick; oneGame: boolean; onOpen: (p: BasketPick) => void; onAdd: (p: BasketPick) => void; newsOf?: NewsOf }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <button onClick={() => onOpen(pick)} title={tip(pick)} className="group col-span-2 flex min-w-0 cursor-pointer items-start gap-3.5 text-left md:col-span-1">
        <PickFace pick={pick} big />
        <span className="min-w-0 flex-1">
          <span className="block font-score text-[26px] font-bold leading-[28px] text-white transition group-hover:text-amber-300 md:text-[30px] md:leading-[32px]">{pick.title}</span>
          <span className="mt-1.5 block text-[13px] text-zinc-300">
            {!oneGame && <>{eventOf(pick.game)}{cupTag(pick.game)}, {esTime(pick.game.date)} · </>}
            {pick.injury && <span className="text-amber-300">{injuryEs(pick.injury)} · </span>}
            {pick.why}
          </span>
          <OpenHint pick={pick} big />
        </span>
      </button>
      <div className="text-center" title={`Modelo ${p0(pick.pModel)}${pick.pMarket != null ? `, casa ${p0(pick.pMarket)}` : ''}`}>
        <div className="font-score text-[44px] font-bold leading-[42px] text-[var(--tv-mark)] tnum">{p0(pick.p)}</div>
        <div className="font-score text-[11px] font-semibold text-zinc-400">Probabilidad</div>
      </div>
      <div className="col-span-2 min-w-32 md:order-none md:col-span-1">
        <div className="mb-1 flex justify-between font-score text-[11px] font-semibold text-zinc-400"><span>Fiabilidad del cálculo</span><span>{pick.rel.label}</span></div>
        <ReliabilityMeter rel={pick.rel} />
        <div className="mt-1 flex justify-between gap-3 text-[11px] text-zinc-400"><span>Justa <span className="tnum text-zinc-200">{odd(pick.fair)}</span></span><span className={cn('font-semibold tnum', hasValue(pick) ? 'text-[var(--tv-mark)]' : 'text-zinc-200')}>{hasValue(pick) ? 'Con valor ' : 'Valor '}{signed(pick.ev)}</span></div>
      </div>
      <div className="col-start-2 row-start-2 flex items-center gap-1 md:col-start-auto md:row-start-auto">
        <RefreshOdds match={matchOfGame(pick.game)} focus={playerKeyOf(pick)} />
        <button onClick={() => onAdd(pick)} title="Añadir al cupón" className="flex h-[58px] w-[92px] cursor-pointer flex-col items-center justify-center rounded-sm bg-[var(--tv-mark)] text-black transition hover:opacity-85">
          <span className="flex items-center gap-1 font-score text-[24px] font-bold leading-none tnum"><Plus size={15} />{odd(pick.price)}</span>
          <span className="text-[11px] font-medium">{pick.book}</span>
        </button>
      </div>
      <PickWhy p={pick.p} ev={pick.ev} rel={pick.rel.score} by="value" className="col-span-2 md:col-span-4" />
      {newsOf && <NewsHint k={newsOf(pick)} className="col-span-2 md:col-span-4" />}
    </div>
  );
}

const Note = ({ children }: { children: ReactNode }) => <div className="flex items-start gap-2 text-xs text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{children}</span></div>;

// games: un partido (pestaña de su ficha) o varios (pantalla de recomendaciones). onOdds: ir a las cuotas de ese partido
function BasketPicksBoardInner({ games, injuries, onOpen, onOdds }: { games: BasketGame[]; injuries: BasketInjury[]; onOpen: (p: BasketPick) => void; onOdds?: () => void }) {
  const oneGame = games.length === 1;
  const prefs = useMemo(loadPrefs, []);
  const [group, setGroup] = useState<PickGroup | 'all'>(PICK_GROUPS.some(g => g.value === prefs.group) ? prefs.group : 'all');
  const [side, setSide] = useState<Side | 'all'>(prefs.side === 'over' || prefs.side === 'under' ? prefs.side : 'all');
  const [minOdds, setMinOdds] = useState<number>(MIN_ODDS.includes(prefs.minOdds) ? prefs.minOdds : DEFAULT_MIN_ODDS);
  const [onlyValue, setOnlyValue] = useState<boolean>(prefs.onlyValue === true);
  const [book, setBook] = useState<PickBook>(bookOf(prefs));
  const [lineText, setLineText] = useState('');
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ group, side, minOdds, onlyValue, book })); } catch { /* sin almacenamiento */ } }, [group, side, minOdds, onlyValue, book]);

  const add = usePickAdd();
  const q = useBasketPicks(games, injuries, book);
  // Las noticias de los equipos: una de baja o duda que nombra al jugador le baja la fiabilidad antes de ordenar y filtrar
  const news = useTeamNews('basket', games.flatMap(newsKeys)).data;
  const withN = useMemo(() => {
    const ks = new Map<string, KeyNews | null>();
    const picks = q.picks.map(p => {
      const k = news ? keyNews(news, newsKeys(p.game), p.who?.name ?? '') : null;
      ks.set(p.id, k);
      return k ? { ...p, rel: withNews(p.rel, k) } : p;
    });
    return { picks, newsOf: ((p: BasketPick) => ks.get(p.id) ?? null) as NewsOf };
  }, [q.picks, news]);
  const line = lineText.trim() ? parseLine(lineText) : null;
  const filters: PickFilters = { group, side, line, minOdds, onlyValue };
  const A = useMemo(() => arrangePicks(withN.picks, filters), [withN.picks, group, side, line, minOdds, onlyValue]); // eslint-disable-line react-hooks/exhaustive-deps
  // "+2,5" es Más de 2,5 y "-2,5", Menos de 2,5
  const onLine = (v: string) => { const s = v.trim()[0]; if (s === '+') setSide('over'); else if (s === '-') setSide('under'); setLineText(v); };

  if (q.oddsLoading) return <Loading label="Mirando las cuotas…" />;
  if (q.failed && !q.considered) return restart(q.failed);
  const nothing = q.noOdds.length === games.length;
  if (nothing) return (
    <div className="flex flex-col items-center gap-2">
      <Empty>{oneGame ? 'Todavía no hay cuotas de este partido, y sin ellas no se puede saber qué sale rentable.' : 'Todavía no hay cuotas de estos partidos, y sin ellas no se puede saber qué sale rentable. El lector las trae solo antes de cada partido.'} Mientras, en Jugadores → Líneas tienes la probabilidad y la cuota justa de cualquier línea.</Empty>
      {onOdds && <button onClick={onOdds} className="cursor-pointer text-[13px] text-amber-400 hover:underline">Ir a Cuotas y actualizarlas</button>}
    </div>
  );

  const sub = [oneGame ? (games[0].round ? `${LEAGUE_NAME[games[0].league]} · ${games[0].round}` : LEAGUE_NAME[games[0].league]) : `${games.length - q.noOdds.length} de ${games.length} partidos con cuotas`, book !== 'all' ? `sólo ${book}` : '', q.age != null ? `cuotas ${ago(q.age)}` : ''].filter(Boolean).join(' · ');
  const props = { oneGame, onOpen, onAdd: add, newsOf: withN.newsOf };
  return (
    <div className="flex flex-col gap-2.5">
      <FoldOnPhone always label="Más filtros" remember="basket-picks-more" summary={[PICK_GROUPS.find(g => g.value === group)?.label, side === 'over' ? 'Más' : side === 'under' ? 'Menos' : '', line != null && `línea ${lineText}`, book !== 'all' && book, onlyValue && 'con valor', `cuota ≥ ${odd(minOdds).replace('.', ',')}`].filter(Boolean).join(' · ')}>
      <div className={cn(panel, 'flex flex-col gap-2.5 px-3.5 py-2.5')}>
        <TvTabs value={group} onChange={setGroup} items={PICK_GROUPS} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-zinc-400">
          <TvTabs value={side} onChange={setSide} items={[{ value: 'all' as const, label: 'Más y menos' }, { value: 'over' as const, label: 'Más' }, { value: 'under' as const, label: 'Menos' }]} />
          <label className="flex items-center gap-2" title="Sólo esta línea exacta. +2,5 es Más de 2,5 y -2,5, Menos de 2,5">Línea<Input aria-label="Línea" inputMode="decimal" className="h-7 w-20 text-center font-semibold lg:h-7" placeholder="Todas" value={lineText} onChange={e => onLine(e.target.value)} /></label>
          <label className="flex items-center gap-2" title="Calcular sólo con las cuotas de una casa: la cuota, la probabilidad de la casa y el valor salen de ella, y se pueden comprobar en su web">Casa<Select className="h-7 w-36 text-xs lg:h-7 lg:w-28 lg:text-xs" value={book} onChange={e => setBook(e.target.value as PickBook)}>{PICK_BOOKS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}</Select></label>
          <label className="flex items-center gap-2" title="Fuera lo que paga menos: una cuota de 1,11 arriesga mucho para ganar casi nada">Cuota mínima<Select className="h-7 w-24 text-xs lg:h-7 lg:text-xs" value={minOdds} onChange={e => setMinOdds(Number(e.target.value))}>{MIN_ODDS.map(m => <option key={m} value={m}>{odd(m).replace('.', ',')}</option>)}</Select></label>
          <span title="Valor esperado de 2 % o más y fiabilidad de 55 o más"><Toggle on={onlyValue} onChange={setOnlyValue} label="Sólo con valor" /></span>
        </div>
      </div>
      </FoldOnPhone>

      {q.loaded < q.total && (
        <div className={cn(panel, 'px-3.5 py-2')} role="status">
          <div className="mb-1.5 text-[13px] text-zinc-400">Leyendo los partidos de los jugadores: {q.loaded} de {q.total}. La primera vez tarda algo más.</div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${(q.loaded / Math.max(1, q.total)) * 100}%` }} /></div>
        </div>
      )}

      <TvFrame>
        <TvHeader title={<PicksTitle />} sub={sub}>
          <p className="w-full text-xs text-zinc-400 sm:hidden">{A.count} opciones de {q.considered} líneas · {A.withValue} con valor</p>
          <div className="hidden sm:flex sm:flex-wrap sm:gap-x-3 sm:gap-y-1">
            <TvStat label="Opciones" value={A.count} sub={`de ${q.considered} líneas`} title="Las que pasan los filtros, de todas las líneas de las casas que el modelo sabe calcular" />
            <TvStat label="Con valor" value={A.withValue} sub="para apostar" title="Las que el análisis del jugador llama «Apostar»: valor esperado de 2 % o más y fiabilidad de 55 o más" />
            {A.bestEv != null && <TvStat label="Mejor valor" value={signed(A.bestEv)} sub="por euro" />}
          </div>
        </TvHeader>

        <TvBand>La mejor opción</TvBand>
        {A.top ? <TopPick pick={A.top} {...props} /> : (
          <p className="px-4 py-3 text-[13px] text-zinc-300">{!q.considered ? (q.loaded < q.total ? 'Calculando…' : 'Las casas todavía no tienen líneas de jugadores ni totales que el modelo sepa calcular.') : 'Ninguna sale rentable con estos filtros. Abajo tienes las que menos pierden; prueba a bajar la cuota mínima o a quitar filtros.'}</p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x lg:divide-white/10">
          <PickList title="Más fáciles" hint={`Probabilidad de 58 % o más, de más a menos valor: ${EASY_HINT}`} list={A.easy} {...props} />
          <PickList title="Equilibradas" hint="Probabilidad de 42 a 58 %, de más a menos valor" list={A.mid} {...props} />
          <PickList title="Más complicadas" hint="Probabilidad de menos de 42 %, cuota alta" list={A.hard} {...props} />
        </div>

        <NewsBasisList items={injuries.filter(i => i.news && games.some(g => g.league === 'nba' && (g.home.id === i.teamId || g.away.id === i.teamId))).map(i => ({
          name: i.name, status: /^Sancionado/.test(i.detail) ? 'suspended' as const : 'out' as const, news: i.news!,
          did: 'Cuenta como baja en el modelo, igual que las del parte de ESPN'
        }))} />
        {(!!q.noOdds.length || !!q.stale.length || !!q.noBook.length) && (
          <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-1.5">
            {!!q.noOdds.length && <Note>Sin cuotas todavía: {q.noOdds.map(eventOf).join(', ')}.</Note>}
            {!!q.noBook.length && <Note>{book} no tiene cuotas de {q.noBook.map(eventOf).join(', ')}: esos partidos no salen.</Note>}
            {!!q.stale.length && <Note>Cuotas de hace más de 6 h en {q.stale.map(eventOf).join(', ')}: actualízalas antes de apostar.</Note>}
          </div>
        )}
        <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
          Las cuotas se leen solas de las webs de las casas y alguna lectura puede equivocarse: compruébala en {book === 'all' ? 'la casa que sale en cada una' : book} antes de apostar.{book === 'all' ? ' Con «Las dos», cada recomendación lleva la casa con la mejor cuota; elige una casa para ver sólo las suyas.' : ''} Es una estimación, no una garantía: el valor mezcla el modelo con la casa sin margen, y la casa pesa más. Sin cuotas históricas no se ha podido comprobar si a la larga da dinero. Las bajas de los compañeros no cambian la proyección: si son nuevas, bajan la fiabilidad de los «menos». En robos y tapones se desvía más. Ganador y hándicap no salen porque el modelo no los calcula.
        </p>
      </TvFrame>
    </div>
  );
}

// Las mejores de las próximas 24 horas, en la lista de partidos. Sin cuotas no sale y no se piden los partidos de los jugadores
function BasketDayPicksInner({ games, injuries, onOpen, onAll }: { games: BasketGame[]; injuries: BasketInjury[]; onOpen: (p: BasketPick) => void; onAll: () => void }) {
  const prefs = useMemo(loadPrefs, []);
  const { picks } = useBasketPicks(games, injuries, bookOf(prefs));
  const minOdds = MIN_ODDS.includes(prefs.minOdds) ? prefs.minOdds : DEFAULT_MIN_ODDS;
  const list = useMemo(() => bestPicks(picks, minOdds, 4), [picks, minOdds]);
  if (!list.length) return null;
  return (
    <TvFrame>
      <TvBand>Las mejores de las próximas 24 h</TvBand>
      {list.map(p => (
        <button key={p.id} onClick={() => onOpen(p)} title={tip(p)}
          className="group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 border-b border-white/10 px-3 py-2.5 text-left transition hover:bg-white/[.05]">
          <span className="row-span-2 self-center"><PickFace pick={p} /></span>
          <span className="min-w-0">
            <span className="line-clamp-2 text-[14px] font-semibold leading-[18px] text-white transition group-hover:text-amber-300">{p.title}</span>
            <span className="block truncate text-[11px] text-zinc-400">{eventOf(p.game)}{cupTag(p.game)}, {esTime(p.game.date)} · {VERDICT_LABEL[pickVerdict(p)]}</span>
          </span>
          <span className="flex items-center gap-2.5"><PickNums p={p.p} ev={p.ev} good={hasValue(p)} /><PickOddText price={p.price} book={p.book} /></span>
          <span className="col-span-2 col-start-2"><OpenHint pick={p} /></span>
        </button>
      ))}
      <button onClick={onAll} className="w-full cursor-pointer py-1.5 text-xs text-zinc-400 hover:text-zinc-100">Ver todas las recomendaciones</button>
    </TvFrame>
  );
}

// Sin cuenta, en su lugar sale cómo conseguirlas (las recomendaciones piden cuenta: gateway/public.js)
export const BasketPicksBoard = memberOnly(BasketPicksBoardInner, 'las recomendaciones del modelo');
export const BasketDayPicks = memberOnly(BasketDayPicksInner, 'las recomendaciones del modelo', true);
