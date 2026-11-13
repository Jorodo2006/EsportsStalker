// Hoy: la portada común a los cinco deportes, sólo con los partidos importantes (sin nada de dinero): los destacados del
// día, los que están en juego, las mejores recomendaciones (baloncesto, tenis, fútbol y MMA) y los próximos. Cada partido lleva una nota
// según su competición, el nivel de los equipos o jugadores y la ronda (importance); los que no llegan al corte no salen.
// Pulsar un partido abre su ficha en su deporte.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { BookIcon } from '@/components/BookIcon';
import { useApp, type AppId } from '@/lib/app-context';
import { cn, odd, pct } from '@/lib/format';
import { bestPicks, type BasketPick } from '@/lib/basket-picks';
import type { BasketGame, FootballMatch, MatchEvent, MmaFight, TennisMatch } from '@/lib/types';
import { useBasketPicks, usePickAdd } from '@/components/BasketPicks';
import { targetOfGame } from '@/components/BasketOdds';
import { LEAGUE_NAME } from '@/components/BasketAnalyzer';
import { useUpcomingGames } from '@/components/BasketRange';
import { LiveDot, MatchCard, Toggle, today, type MatchState, type RowTeam } from '@/components/sport';
import { Empty, oddBtn } from '@/components/ui';
import { Panel, surname } from '@/components/viz';
import { targetOfFight, surname as fighterSurname } from '@/components/mma';
import { targetOfFootball } from './FootballMatches';
import { targetOfMatch } from './TennisMatches';

const SPORT: Record<AppId, { label: string; color: string }> = {
  lol: { label: 'LoL', color: '#3aa894' }, basket: { label: 'Baloncesto', color: '#dc7d41' },
  tennis: { label: 'Tenis', color: '#67ad53' }, football: { label: 'Fútbol', color: '#5f84cc' }, mma: { label: 'MMA', color: '#bf5a5a' }
};
const Dot = ({ s }: { s: AppId }) => <span title={SPORT[s].label} className="h-2 w-2 shrink-0 rounded-full" style={{ background: SPORT[s].color }} />;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

// ---------- qué partidos son importantes ----------
// Nota de 0 a ~150; entra en la portada desde CUT. Por competición, y dentro de ella, por el nivel de los equipos o jugadores
// y la ronda. Es una decisión, no una medida: se ajusta aquí
const CUT = 60;
// Con un solo deporte (el elegido arriba) hay sitio para más: entran también las competiciones de segunda fila (WNBA, NBL,
// EuroCup, LCS, los torneos 500 y 250 de tenis, la Ligue 1 o la Conference). Los Challenger y la previa siguen fuera (nota 0)
const ONE_CUT = 20;
const ALL_KEY = 'today-all';
const loadAll = () => { try { return localStorage.getItem(ALL_KEY) === '1'; } catch { return false; } };
const FOOTBALL_LEAGUE: Record<string, number> = {
  champions: 100, laliga: 90, premier: 85, europa: 70, seriea: 65, bundesliga: 65, copa: 55, ligue1: 55, conference: 50, segunda: 30,
  // Selecciones: la Nations League cuenta como una gran liga; los amistosos, sólo si juega una de las grandes
  nations: 70, amistosos: 40,
  // Femenino: la Champions como una competición importante; las ligas, un poco por debajo
  wchampions: 62, ligaf: 45, wsl: 45
};
const BIG_FOOTBALL = /^(españa|francia|inglaterra|alemania|italia|portugal|países bajos|bélgica|croacia|argentina|brasil)$|real madrid|barcelona|atl[eé]tico( de)? madrid|manchester city|liverpool|arsenal|manchester united|chelsea|bayern|paris saint|psg|inter\b|internazionale|juventus|\bmilan|napoli|dortmund|tottenham|athletic|real sociedad|villarreal|betis/i;
const BASKET_LEAGUE: Record<string, number> = { euroleague: 80, nba: 70, eurocup: 45, wnba: 40, nbl: 40 };
const SPANISH_BASKET = /real madrid|barcelona|baskonia|valencia|unicaja|gran canaria|joventut|tenerife|murcia|bilbao|manresa|zaragoza/i;

const footballScore = (g: FootballMatch) =>
  (FOOTBALL_LEAGUE[g.league] ?? 30) + [g.home.name, g.away.name].filter(n => BIG_FOOTBALL.test(n)).length * 15;
const basketScore = (g: BasketGame) =>
  (BASKET_LEAGUE[g.league] ?? 40) + (g.league !== 'nba' && g.league !== 'wnba' ? [g.home.name, g.away.name].filter(n => SPANISH_BASKET.test(n)).length * 15 : 0);
const tennisScore = (m: TennisMatch) => {
  if (m.level || /^previa/i.test(m.round)) return 0; // Challenger y previa, fuera
  const rank = (r: number | null) => (r && r <= 10 ? 25 : r && r <= 30 ? 12 : r && r <= 60 ? 4 : 0);
  const round = /final$/i.test(m.round) && !/semi|cuartos/i.test(m.round) ? 30 : /semi/i.test(m.round) ? 20 : /cuartos/i.test(m.round) ? 10 : 0;
  const tour = m.major ? 60 : /masters|1000|finals/i.test(m.tournament) ? 40 : 20;
  return tour + rank(m.a.rank) + rank(m.b.rank) + round;
};
// MMA: el principal de cada cartel, y el co-principal si es a cinco asaltos (título). WOW cuenta algo más: es la organización española
const mmaScore = (f: MmaFight) =>
  ({ ufc: 40, pfl: 35, wow: 30 }[f.org] ?? 30) + (f.cardPos === 1 ? (f.org === 'wow' ? 35 : 25) : f.cardPos === 2 ? 10 : 0) + (f.rounds >= 5 ? 20 : 0) + (f.title ? 20 : 0);
const lolScore = (e: MatchEvent) => {
  const l = `${e.league} ${e.leagueSlug}`;
  return /worlds|mundial|msi|first stand/i.test(l) ? 100 : /lck|lpl/i.test(l) ? 70 : /lec/i.test(l) ? 65 : /lcs|lta|lcp/i.test(l) ? 45 : 25;
};

// Un partido de cualquier deporte, listo para la tarjeta
interface Item {
  s: AppId; id: string; date: string; state: MatchState; score: number; comp: string; status: string; a: RowTeam; b: RowTeam;
  ev?: { id: string; a: { name: string; code: string; alt?: string[] }; b: { name: string; code: string; alt?: string[] }; start: string }; go: () => void;
}

const NO_GAMES: BasketGame[] = [];

// true cuando el elemento entra en pantalla o está a `margin` de entrar, y ya no vuelve a false. Se observa dentro del <main>,
// que es lo que se desplaza: con la ventana como raíz, el margen no serviría (main recorta lo que queda fuera). Sólo desde que
// `ready`: mientras carga, lo de arriba está vacío y el panel saldría a la vista aunque luego quede muy abajo
function useSeen<T extends HTMLElement>(ready: boolean, margin = '300px') {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el || !ready) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { root: el.closest('main'), rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, ready, margin]);
  return [ref, seen] as const;
}

export default function TodayView() {
  const { app, switchApp, go, setFocusId, setOpenMatch, addToSlip } = useApp();
  const day = today();
  // Con el deporte elegido arriba, sólo ese; «Los cinco deportes» vuelve a la portada común. Se recuerda en este navegador
  const [everything, setEverything] = useState(loadAll);
  const toggleAll = (v: boolean) => { setEverything(v); try { localStorage.setItem(ALL_KEY, v ? '1' : '0'); } catch { /* sin almacenamiento */ } };
  const only: AppId | null = everything ? null : app;
  const shows = (s: AppId) => !only || only === s;
  const { data: basketToday = [], isPending: p1 } = useQuery({ queryKey: ['basket', 'games', day], queryFn: () => window.api.basket.games(day), refetchInterval: 60_000 });
  const { data: footballToday = [], isPending: p2 } = useQuery({ queryKey: ['football', 'games', day], queryFn: () => window.api.football.games(day), refetchInterval: 60_000 });
  const { data: tennisToday = [], isPending: p3 } = useQuery({ queryKey: ['tennis', 'games', day], queryFn: () => window.api.tennis.games(day), refetchInterval: 60_000 });
  const { data: mmaToday = [] } = useQuery({ queryKey: ['mma', 'games', day], queryFn: () => window.api.mma.games(day), refetchInterval: 60_000, enabled: !!window.api.mma });
  const { data: lolSchedule, isPending: p4 } = useQuery({ queryKey: ['today', 'lol'], queryFn: () => window.api.esports.schedule({}), refetchInterval: 60_000 });
  // Los de LoL en juego aunque empezaran ayer (una serie al mejor de cinco pasa de medianoche)
  const { data: lolLive = [] } = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: 60_000 });
  const u = useUpcomingGames();

  const open = (s: AppId, id: string) => { switchApp(s); setFocusId(id); go('matches'); };
  const openLol = (m: MatchEvent) => { switchApp('lol'); setOpenMatch(m); go('matches'); };

  // ---------- todos los partidos de hoy (y los de baloncesto de esta noche) con su nota ----------
  const scored = useMemo<Item[]>(() => {
    const st = (s: string): MatchState => (s === 'in' || s === 'inProgress' ? 'live' : s === 'post' || s === 'completed' ? 'post' : 'pre');
    const basket = new Map<string, BasketGame>();
    for (const g of [...basketToday, ...u.byLeague]) basket.set(g.id, g);
    const out: Item[] = [
      ...[...basket.values()].map(g => {
        const s = st(g.state), as = Number(g.away.score), hs = Number(g.home.score), done = s === 'post';
        return {
          s: 'basket' as const, id: g.id, date: g.date, state: s, score: basketScore(g), comp: LEAGUE_NAME[g.league], status: g.status,
          a: { name: g.away.name, short: g.away.abbr, logo: g.away.logo, score: s === 'pre' ? null : g.away.score, win: done && as > hs, lose: done && as < hs },
          b: { name: g.home.name, short: g.home.abbr, logo: g.home.logo, score: s === 'pre' ? null : g.home.score, win: done && hs > as, lose: done && hs < as },
          ev: { id: g.id, ...targetOfGame(g).match, start: g.date }, go: () => open('basket', g.id)
        };
      }),
      ...footballToday.filter(g => !g.off).map(g => {
        const s = st(g.state), hs = g.home.score ?? 0, as = g.away.score ?? 0, done = s === 'post';
        return {
          s: 'football' as const, id: g.id, date: g.date, state: s, score: footballScore(g), comp: g.leagueName, status: g.status,
          a: { name: g.home.name, short: g.home.abbr, logo: g.home.logo, score: s === 'pre' ? null : g.home.score, win: done && hs > as, lose: done && hs < as },
          b: { name: g.away.name, short: g.away.abbr, logo: g.away.logo, score: s === 'pre' ? null : g.away.score, win: done && as > hs, lose: done && as < hs },
          ev: { id: g.id, ...targetOfFootball(g).match, start: g.date }, go: () => open('football', g.id)
        };
      }),
      ...tennisToday.map(m => {
        const s = st(m.state), sets = (p: TennisMatch['a']) => p.setWins.filter(Boolean).length;
        const name = (p: TennisMatch['a']) => `${p.name}${p.rank ? ` (${p.rank})` : ''}`;
        return {
          s: 'tennis' as const, id: m.id, date: m.date, state: s, score: tennisScore(m), comp: `${m.tournament} · ${m.round}`, status: m.status,
          a: { name: name(m.a), short: m.a.country, logo: m.a.flag, score: s === 'pre' ? null : sets(m.a), win: m.a.winner, lose: s === 'post' && !m.a.winner },
          b: { name: name(m.b), short: m.b.country, logo: m.b.flag, score: s === 'pre' ? null : sets(m.b), win: m.b.winner, lose: s === 'post' && !m.b.winner },
          ev: { id: m.id, ...targetOfMatch(m).match, start: m.date }, go: () => open('tennis', m.id)
        };
      }),
      ...mmaToday.filter(g => !g.cancelled).map(g => {
        const s = st(g.state), r = g.result;
        return {
          s: 'mma' as const, id: g.id, date: g.date, state: s, score: mmaScore(g), comp: `${g.event} · ${g.weightClass}`, status: g.status,
          a: { name: g.a.name, short: fighterSurname(g.a.name), logo: g.a.flag, score: null, win: !!r && r.winner === 'a', lose: s === 'post' && !!r?.winner && r.winner !== 'a' },
          b: { name: g.b.name, short: fighterSurname(g.b.name), logo: g.b.flag, score: null, win: !!r && r.winner === 'b', lose: s === 'post' && !!r?.winner && r.winner !== 'b' },
          ev: { id: g.id, ...targetOfFight(g).match, start: g.date }, go: () => open('mma', g.id)
        };
      }),
      ...[...new Map([...(lolSchedule?.events ?? []).filter(e => new Date(e.startTime).toLocaleDateString('en-CA') === day), ...lolLive].map(e => [e.id, e])).values()]
        .filter(e => e.teams.length === 2).map(e => {
        const s = st(e.state), [x, y] = e.teams;
        return {
          s: 'lol' as const, id: e.id, date: e.startTime, state: s, score: lolScore(e), comp: [e.league, e.blockName].filter(Boolean).join(' · '), status: '',
          a: { name: x.name, short: x.code, logo: x.image, score: s === 'pre' ? null : x.wins, win: x.outcome === 'win', lose: x.outcome === 'loss' },
          b: { name: y.name, short: y.code, logo: y.image, score: s === 'pre' ? null : y.wins, win: y.outcome === 'win', lose: y.outcome === 'loss' },
          ev: { id: e.id, a: { name: x.name, code: x.code }, b: { name: y.name, code: y.code }, start: e.startTime }, go: () => openLol(e)
        };
      })
    ];
    return out;
  }, [basketToday, u.byLeague, footballToday, tennisToday, mmaToday, lolSchedule, lolLive, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => scored.filter(x => (only ? x.s === only && x.score >= ONE_CUT : x.score >= CUT)), [scored, only]);

  // Destacados: en juego primero, luego los que faltan y al final los acabados; dentro, por nota y hora
  const order: Record<MatchState, number> = { live: 0, pre: 1, post: 2 };
  const featured = [...items].sort((x, y) => order[x.state] - order[y.state] || y.score - x.score || x.date.localeCompare(y.date)).slice(0, 8);
  const live = items.filter(x => x.state === 'live').sort((x, y) => y.score - x.score);
  const soon = Date.now() + 12 * 3600e3;
  const next = items.filter(x => x.state === 'pre' && +new Date(x.date) > Date.now() && +new Date(x.date) < soon && !featured.includes(x))
    .sort((x, y) => x.date.localeCompare(y.date)).slice(0, 12);
  const withOdds = [...featured.filter(x => x.state !== 'post'), ...next];
  const board = useQuery({
    queryKey: ['board', 'today', withOdds.map(x => x.id).join()], queryFn: () => window.api.odds.board(withOdds.map(x => x.ev!)),
    enabled: withOdds.length > 0, refetchInterval: 60_000
  });

  // ---------- mejores apuestas (baloncesto, tenis, fútbol y MMA), sólo las que tienen valor ----------
  // Las de baloncesto necesitan los partidos de los jugadores de todos los equipos que juegan (eran tres cuartas partes de lo
  // que bajaba la portada): sólo se calculan cuando el panel está a la vista o a punto de estarlo
  const [picksRef, picksSeen] = useSeen<HTMLDivElement>(!p1 && !p2 && !p3 && !p4);
  const bp = useBasketPicks(picksSeen && shows('basket') ? u.games : NO_GAMES, u.injuries);
  const addBasket = usePickAdd();
  const basketBest = useMemo(() => bestPicks(bp.picks, 1.5, 5), [bp.picks]);
  const tq = useQuery({ queryKey: ['tennis', 'picks-day', day], queryFn: () => window.api.tennis.picksDay(day), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false, enabled: shows('tennis') });
  const fq = useQuery({ queryKey: ['football', 'picks-day', day], queryFn: () => window.api.football.picksDay(day), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false, enabled: shows('football') });
  const mq = useQuery({ queryKey: ['mma', 'picks-day', day], queryFn: () => window.api.mma.picksDay(day), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false, enabled: !!window.api.mma && shows('mma') });
  type Best = { id: string; s: AppId; title: string; event: string; date: string; p: number; ev: number; price: number; book?: string; open: () => void; add: () => void };
  const best: Best[] = [
    ...basketBest.map((p: BasketPick) => ({ id: p.id, s: 'basket' as const, title: p.title, event: `${p.game.away.abbr} @ ${p.game.home.abbr}`, date: p.game.date, p: p.p, ev: p.ev, price: p.price, book: p.book, open: () => open('basket', p.game.id), add: () => addBasket(p) })),
    ...(tq.data ?? []).slice(0, 5).map(d => ({
      id: d.id, s: 'tennis' as const, title: d.top.title, event: `${surname(d.a.name)} - ${surname(d.b.name)}`, date: d.date, p: d.top.p, ev: d.top.ev, price: d.top.price, book: d.top.book,
      open: () => open('tennis', d.id),
      add: () => addToSlip({ sport: 'tennis', league: d.tournament, event: `${d.a.name} vs ${d.b.name}`, market: d.top.market, selection: d.top.selection, bookmaker: d.top.book, odds: d.top.price, status: 'pending' })
    })),
    ...(fq.data ?? []).slice(0, 5).map(d => ({
      id: d.id, s: 'football' as const, title: d.top.title, event: `${d.home.short || d.home.name} - ${d.away.short || d.away.name}`, date: d.date, p: d.top.p, ev: d.top.ev, price: d.top.price, book: d.top.book,
      open: () => open('football', d.id),
      add: () => addToSlip({ sport: 'football', league: d.leagueName, event: `${d.home.name} - ${d.away.name}`, market: d.top.market, selection: d.top.selection, bookmaker: d.top.book, odds: d.top.price, status: 'pending' })
    }))
    ,
    ...(mq.data ?? []).slice(0, 5).map(d => ({
      id: d.id, s: 'mma' as const, title: d.top.title, event: `${fighterSurname(d.a.name)} - ${fighterSurname(d.b.name)}`, date: d.date, p: d.top.p, ev: d.top.ev, price: d.top.price, book: d.top.book,
      open: () => open('mma', d.id),
      add: () => addToSlip({
        sport: 'mma', league: d.orgName, event: `${d.a.name} vs ${d.b.name}`, market: d.top.market, selection: d.top.selection, bookmaker: d.top.book, odds: d.top.price, status: 'pending',
        ref: { sport: 'mma', match: d.id, key: d.top.id.split('#')[0], out: d.top.id.split('#')[1], start: d.date }
      })
    }))
  ].filter(x => x.ev > 0 && shows(x.s)).sort((x, y) => y.ev - x.ev).slice(0, 6);
  const sportName = only ? SPORT[only].label.toLowerCase() : '';
  const picksSports = only ? (only === 'lol' ? '' : sportName) : 'baloncesto, tenis, fútbol y MMA';

  const longDate = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const card = (x: Item) => (
    <MatchCard key={x.s + x.id} state={x.state} onClick={x.go} odds={x.state === 'post' ? null : board.data?.[x.id]} competition={x.comp} tag={SPORT[x.s].label}
      time={x.state === 'pre' ? hhmm(x.date) : x.state === 'live' ? 'En juego' : 'Final'} status={x.state === 'live' ? x.status : undefined} a={x.a} b={x.b} />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-50">Hoy{only ? ` en ${only === 'lol' ? 'LoL' : sportName}` : ''}</h1>
          <p className="text-sm text-zinc-400 first-letter:uppercase">{longDate} · {only ? `lo importante de ${only === 'lol' ? 'LoL' : sportName}` : 'los partidos importantes de los cinco deportes'}</p>
        </div>
        <Toggle on={everything} onChange={toggleAll} label="Los cinco deportes" />
      </div>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[15px] font-semibold text-zinc-100">Partidos destacados</h2>
        {!featured.length ? <Empty>{only ? `Hoy no hay partidos de ${only === 'lol' ? 'LoL' : sportName} en las competiciones que sigue la app.` : 'Hoy no hay partidos importantes en las competiciones que sigue la app.'}</Empty>
          : <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-4">{featured.map(card)}</div>}
      </section>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <Panel title="En directo" aside={live.length ? `${live.length}` : undefined}>
          {!live.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">{only ? `Ahora mismo no se juega ningún partido de ${only === 'lol' ? 'LoL' : sportName}.` : 'Ahora mismo no se juega ningún partido importante.'}</p> : (
            <div className="divide-y divide-zinc-800/60">
              {live.slice(0, 10).map(x => (
                <button key={x.s + x.id} onClick={x.go} className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left hover:bg-zinc-900/60">
                  <Dot s={x.s} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-zinc-100">{x.a.short && x.s !== 'tennis' ? x.a.short : x.a.name} <span className="font-semibold tnum">{x.s === 'mma' ? 'vs' : `${x.a.score ?? 0}-${x.b.score ?? 0}`}</span> {x.b.short && x.s !== 'tennis' ? x.b.short : x.b.name}</span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-rose-300"><LiveDot />{[x.comp, x.status].filter(Boolean).join(' · ')}</span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-zinc-600" />
                </button>
              ))}
            </div>
          )}
        </Panel>

        <div ref={picksRef} className="min-w-0">
        <Panel title="Mejores apuestas del día" aside={picksSports || undefined}>
          {!best.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">{only === 'lol' ? 'LoL no tiene recomendaciones del día: el valor de cada línea de jugador está en la ficha del partido.' : (shows('basket') && (!picksSeen || bp.loaded < bp.total)) || (shows('tennis') && tq.isLoading) || (shows('mma') && mq.isLoading) || (shows('football') && fq.isLoading) ? 'Calculando las recomendaciones…' : 'Hoy no hay recomendaciones con valor: las casas aún no tienen las cuotas o no hay partidos.'}</p> : (
            <div className="divide-y divide-zinc-800/60">
              {best.map(x => (
                <div key={x.s + x.id} className="flex items-center gap-2.5 px-4 py-2">
                  <Dot s={x.s} />
                  <button onClick={x.open} className="min-w-0 flex-1 cursor-pointer text-left">
                    <span className="block truncate text-[13px] font-semibold text-zinc-50 hover:underline">{x.title}</span>
                    <span className="block truncate text-xs text-zinc-500"><span className="tnum">{hhmm(x.date)}</span> · {x.event} · EV <span className="text-emerald-300">+{pct(x.ev)}</span></span>
                  </button>
                  <span className="w-11 shrink-0 text-right text-xs text-zinc-400 tnum">{pct(x.p)}</span>
                  <span className="grid w-4 shrink-0 place-items-center" title={x.book}>{x.book && <BookIcon name={x.book} size={16} />}</span>
                  <button onClick={x.add} title={`${x.book ?? ''}: al cupón`} className={cn(oddBtn(true), 'h-8 w-14 text-[13px]')}>{odd(x.price)}</button>
                </div>
              ))}
            </div>
          )}
        </Panel>
        </div>
      </div>

      <Panel title="Próximos partidos importantes" aside="próximas 12 horas">
        {!next.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">{only ? `No hay más partidos de ${only === 'lol' ? 'LoL' : sportName} en las próximas 12 horas.` : 'No hay más partidos importantes en las próximas 12 horas.'}</p> : (
          <div className="divide-y divide-zinc-800/60">
            {next.map(x => {
              const o = board.data?.[x.id];
              return (
                <button key={x.s + x.id} onClick={x.go} className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left hover:bg-zinc-900/60">
                  <span className="w-12 shrink-0 text-[13px] font-semibold text-zinc-100 tnum">{hhmm(x.date)}</span>
                  <Dot s={x.s} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-zinc-100">{x.a.name} - {x.b.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{x.comp}</span>
                  </span>
                  {o && <span className="shrink-0 text-xs text-zinc-300 tnum">{[o.a, o.x, o.b].filter(Boolean).map(v => odd(v!)).join(' · ')}</span>}
                  <ChevronRight size={14} className="shrink-0 text-zinc-600" />
                </button>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
