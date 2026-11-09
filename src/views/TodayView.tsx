// Hoy: la portada común a los cuatro deportes, sólo con los partidos importantes (sin nada de dinero): los destacados del
// día, los que están en juego, las mejores recomendaciones (baloncesto y tenis) y los próximos. Cada partido lleva una nota
// según su competición, el nivel de los equipos o jugadores y la ronda (importance); los que no llegan al corte no salen.
// Pulsar un partido abre su ficha en su deporte.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useApp, type AppId } from '@/lib/app-context';
import { cn, odd, pct } from '@/lib/format';
import { bestPicks, type BasketPick } from '@/lib/basket-picks';
import type { BasketGame, FootballMatch, MatchEvent, TennisMatch } from '@/lib/types';
import { useBasketPicks, usePickAdd } from '@/components/BasketPicks';
import { targetOfGame } from '@/components/BasketOdds';
import { LEAGUE_NAME } from '@/components/BasketAnalyzer';
import { useUpcomingGames } from '@/components/BasketRange';
import { LiveDot, MatchCard, today, type MatchState, type RowTeam } from '@/components/sport';
import { Empty, oddBtn } from '@/components/ui';
import { Panel, surname } from '@/components/viz';
import { targetOfFootball } from './FootballMatches';
import { targetOfMatch } from './TennisMatches';

const SPORT: Record<AppId, { label: string; color: string }> = {
  lol: { label: 'LoL', color: '#3aa894' }, basket: { label: 'Baloncesto', color: '#dc7d41' },
  tennis: { label: 'Tenis', color: '#67ad53' }, football: { label: 'Fútbol', color: '#5f84cc' }
};
const Dot = ({ s }: { s: AppId }) => <span title={SPORT[s].label} className="h-2 w-2 shrink-0 rounded-full" style={{ background: SPORT[s].color }} />;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

// ---------- qué partidos son importantes ----------
// Nota de 0 a ~150; entra en la portada desde CUT. Por competición, y dentro de ella, por el nivel de los equipos o jugadores
// y la ronda. Es una decisión, no una medida: se ajusta aquí
const CUT = 60;
const FOOTBALL_LEAGUE: Record<string, number> = {
  champions: 100, laliga: 90, premier: 85, europa: 70, seriea: 65, bundesliga: 65, copa: 55, ligue1: 55, conference: 50, segunda: 30
};
const BIG_FOOTBALL = /real madrid|barcelona|atl[eé]tico( de)? madrid|manchester city|liverpool|arsenal|manchester united|chelsea|bayern|paris saint|psg|inter\b|internazionale|juventus|\bmilan|napoli|dortmund|tottenham|athletic|real sociedad|villarreal|betis/i;
const BASKET_LEAGUE: Record<string, number> = { euroleague: 80, nba: 70, eurocup: 45, wnba: 40 };
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
const lolScore = (e: MatchEvent) => {
  const l = `${e.league} ${e.leagueSlug}`;
  return /worlds|mundial|msi|first stand/i.test(l) ? 100 : /lck|lpl/i.test(l) ? 70 : /lec/i.test(l) ? 65 : /lcs|lta|lcp/i.test(l) ? 45 : 25;
};

// Un partido de cualquier deporte, listo para la tarjeta
interface Item {
  s: AppId; id: string; date: string; state: MatchState; score: number; comp: string; status: string; a: RowTeam; b: RowTeam;
  ev?: { id: string; a: { name: string; code: string; alt?: string[] }; b: { name: string; code: string; alt?: string[] }; start: string }; go: () => void;
}

export default function TodayView() {
  const { switchApp, go, setFocusId, setOpenMatch, addToSlip } = useApp();
  const day = today();
  const { data: basketToday = [] } = useQuery({ queryKey: ['basket', 'games', day], queryFn: () => window.api.basket.games(day), refetchInterval: 60_000 });
  const { data: footballToday = [] } = useQuery({ queryKey: ['football', 'games', day], queryFn: () => window.api.football.games(day), refetchInterval: 60_000 });
  const { data: tennisToday = [] } = useQuery({ queryKey: ['tennis', 'games', day], queryFn: () => window.api.tennis.games(day), refetchInterval: 60_000 });
  const { data: lolSchedule } = useQuery({ queryKey: ['today', 'lol'], queryFn: () => window.api.esports.schedule({}), refetchInterval: 60_000 });
  // Los de LoL en juego aunque empezaran ayer (una serie al mejor de cinco pasa de medianoche)
  const { data: lolLive = [] } = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: 60_000 });
  const u = useUpcomingGames();

  const open = (s: AppId, id: string) => { switchApp(s); setFocusId(id); go('matches'); };
  const openLol = (m: MatchEvent) => { switchApp('lol'); setOpenMatch(m); go('matches'); };

  // ---------- todos los partidos de hoy (y los de baloncesto de esta noche) con su nota ----------
  const items = useMemo<Item[]>(() => {
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
    return out.filter(x => x.score >= CUT);
  }, [basketToday, u.byLeague, footballToday, tennisToday, lolSchedule, lolLive, day]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---------- mejores apuestas (baloncesto y tenis), sólo las que tienen valor ----------
  const bp = useBasketPicks(u.games, u.injuries);
  const addBasket = usePickAdd();
  const basketBest = useMemo(() => bestPicks(bp.picks, 1.5, 5), [bp.picks]);
  const tq = useQuery({ queryKey: ['tennis', 'picks-day', day], queryFn: () => window.api.tennis.picksDay(day), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false });
  type Best = { id: string; s: AppId; title: string; event: string; date: string; p: number; ev: number; price: number; book?: string; open: () => void; add: () => void };
  const best: Best[] = [
    ...basketBest.map((p: BasketPick) => ({ id: p.id, s: 'basket' as const, title: p.title, event: `${p.game.away.abbr} @ ${p.game.home.abbr}`, date: p.game.date, p: p.p, ev: p.ev, price: p.price, book: p.book, open: () => open('basket', p.game.id), add: () => addBasket(p) })),
    ...(tq.data ?? []).slice(0, 5).map(d => ({
      id: d.id, s: 'tennis' as const, title: d.top.title, event: `${surname(d.a.name)} - ${surname(d.b.name)}`, date: d.date, p: d.top.p, ev: d.top.ev, price: d.top.price, book: d.top.book,
      open: () => open('tennis', d.id),
      add: () => addToSlip({ sport: 'tennis', league: d.tournament, event: `${d.a.name} vs ${d.b.name}`, market: d.top.market, selection: d.top.selection, bookmaker: d.top.book, odds: d.top.price, status: 'pending' })
    }))
  ].filter(x => x.ev > 0).sort((x, y) => y.ev - x.ev).slice(0, 6);

  const longDate = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const card = (x: Item) => (
    <MatchCard key={x.s + x.id} state={x.state} onClick={x.go} odds={x.state === 'post' ? null : board.data?.[x.id]} competition={x.comp} tag={SPORT[x.s].label}
      time={x.state === 'pre' ? hhmm(x.date) : x.state === 'live' ? 'En juego' : 'Final'} status={x.state === 'live' ? x.status : undefined} a={x.a} b={x.b} />
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Hoy</h1>
        <p className="text-sm text-zinc-400 first-letter:uppercase">{longDate} · los partidos importantes de los cuatro deportes</p>
      </div>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[15px] font-semibold text-zinc-100">Partidos destacados</h2>
        {!featured.length ? <Empty>Hoy no hay partidos importantes en las competiciones que sigue la app.</Empty>
          : <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-4">{featured.map(card)}</div>}
      </section>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <Panel title="En directo" aside={live.length ? `${live.length}` : undefined}>
          {!live.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">Ahora mismo no se juega ningún partido importante.</p> : (
            <div className="divide-y divide-zinc-800/60">
              {live.slice(0, 10).map(x => (
                <button key={x.s + x.id} onClick={x.go} className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left hover:bg-zinc-900/60">
                  <Dot s={x.s} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-zinc-100">{x.a.short && x.s !== 'tennis' ? x.a.short : x.a.name} <span className="font-semibold tnum">{x.a.score ?? 0}-{x.b.score ?? 0}</span> {x.b.short && x.s !== 'tennis' ? x.b.short : x.b.name}</span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-rose-300"><LiveDot />{[x.comp, x.status].filter(Boolean).join(' · ')}</span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-zinc-600" />
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Mejores apuestas del día" aside="baloncesto y tenis">
          {!best.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">{bp.loaded < bp.total ? 'Calculando las recomendaciones…' : 'Hoy no hay recomendaciones con valor: las casas aún no tienen las cuotas o no hay partidos.'}</p> : (
            <div className="divide-y divide-zinc-800/60">
              {best.map(x => (
                <div key={x.s + x.id} className="flex items-center gap-2.5 px-4 py-2">
                  <Dot s={x.s} />
                  <button onClick={x.open} className="min-w-0 flex-1 cursor-pointer text-left">
                    <span className="block truncate text-[13px] font-semibold text-zinc-50 hover:underline">{x.title}</span>
                    <span className="block truncate text-xs text-zinc-500"><span className="tnum">{hhmm(x.date)}</span> · {x.event} · EV <span className="text-emerald-300">+{pct(x.ev)}</span></span>
                  </button>
                  <span className="w-11 shrink-0 text-right text-xs text-zinc-400 tnum">{pct(x.p)}</span>
                  <button onClick={x.add} title={`${x.book ?? ''}: al cupón`} className={cn(oddBtn(true), 'h-8 w-14 text-[13px]')}>{odd(x.price)}</button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Próximos partidos importantes" aside="próximas 12 horas">
        {!next.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">No hay más partidos importantes en las próximas 12 horas.</p> : (
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
