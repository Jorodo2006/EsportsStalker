// Recomendaciones de baloncesto: la mejor opción y las demás por perfil de riesgo, con filtros por mercado, línea y cuota mínima, y
// las mejores de las próximas 24 horas en la lista de partidos. El cálculo está en lib/basket-picks.ts; aquí se piden los datos y se enseña.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import { BASKET_MARKETS, parseLine } from '@/lib/basket-model';
import { PICK_GROUPS, arrangePicks, bestPicks, hasValue, pickVerdict, playerPicks, saneLine, teamPicks, type BasketPick, type PickFilters, type PickGroup } from '@/lib/basket-picks';
import { VERDICT_LABEL } from '@/lib/value';
import { basketPrediction, logPredictions } from '@/lib/predictions';
import type { BasketGame, BasketInjury, MatchOdds } from '@/lib/types';
import type { Side } from '@/lib/value';
import { LEAGUE_NAME, esTime } from './BasketAnalyzer';
import { targetOfGame } from './BasketOdds';
import { restart } from './BasketPoints';
import { ReliabilityMeter } from './ValuePanel';
import { Toggle } from './sport';
import { Empty, Input, Loading, Select } from './ui';
import { TvBand, TvFrame, TvHeader, TvStat, TvTabs, panel } from './viz';
import { ODDS_FALLBACK, oddsMeta } from '@/lib/odds-live';

const PREFS = 'basket-picks';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
const MIN_ODDS = [1.3, 1.5, 1.7, 2, 2.5];
const DEFAULT_MIN_ODDS = 1.5;
const STALE_MS = 6 * 3600e3;
const PAGE = 5;
const p0 = (v: number) => `${Math.round(v * 100)} %`;
const signed = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')} %`;
const ago = (ms: number) => { const m = Math.round(ms / 60e3); return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
const eventOf = (g: BasketGame) => `${g.away.abbr} @ ${g.home.abbr}`;
const newest = (o?: MatchOdds) => Math.max(0, ...Object.values(o?.sources ?? {}).map(s => s.ts || 0));
const hasPlayers = (o?: MatchOdds) => !!o?.markets.some(m => m.key.startsWith('player|'));
const hasTeams = (o?: MatchOdds) => !!o?.markets.some(m => /^(total|team_total)\|/.test(m.key));

// Todo lo que hace falta de varios partidos. Los jugadores y los equipos sólo se piden si las casas tienen líneas: mirar un partido sin
// cuotas no sirve de nada, y los partidos de los jugadores pesan
export function useBasketPicks(games: BasketGame[], injuries: BasketInjury[]) {
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
  const teams = useMemo(() => games.flatMap((game, i) => (hasPlayers(oddsQ[i]?.data) ? [{ game, side: 'away' as const }, { game, side: 'home' as const }] : [])), [games, oddsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const logs = useQueries({
    queries: teams.map(t => ({ queryKey: ['basket', 'teamLogs', t.game.league, t.game[t.side].id], queryFn: () => window.api.basket.teamLogs(t.game.league, t.game[t.side].id), staleTime: 15 * 60e3, retry: 1 }))
  });
  const leagues = useMemo(() => [...new Set(games.filter((_, i) => hasTeams(oddsQ[i]?.data)).map(g => g.league))], [games, oddsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const points = useQueries({
    queries: leagues.map(l => ({ queryKey: ['basket', 'leagueGames', l], queryFn: () => window.api.basket.leagueGames(l), staleTime: 5 * 60e3, retry: false }))
  });
  const logsKey = logs.map(q => idOf(q.data)).join(), pointsKey = points.map(q => idOf(q.data)).join();

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
    games.forEach((g, i) => {
      const odds = oddsQ[i]?.data;
      const leagueData = points[leagues.indexOf(g.league)]?.data;
      if (odds && leagueData && hasTeams(odds)) all.push(...once(`${g.id}:equipos`, [g.date, odds.markets, leagueData], () => teamPicks(g, leagueData, odds)));
    });
    teams.forEach((t, i) => {
      const data = logs[i]?.data, odds = oddsQ[games.indexOf(t.game)]?.data;
      if (data && odds) all.push(...once(`${t.game.id}:${t.side}`, [t.game.date, odds.markets, data, injuries.length], () => playerPicks(t.game, t.side, data, odds, injuries)));
    });
    return { picks: all.filter(saneLine), considered: all.length, lines: all };
  }, [games, oddsKey, logsKey, pointsKey, injuries.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
    stale: games.filter((_, i) => { const t = newest(oddsQ[i]?.data); return t && now - t > STALE_MS; }),
    age: stamps.length ? now - Math.max(...stamps) : null,
    loaded: logs.filter(q => q.data).length + points.filter(q => q.data).length, total: logs.length + points.length,
    failed: [...oddsQ, ...logs].find(q => q.error)?.error
  };
}

export const usePickAdd = () => {
  const { addToSlip } = useApp();
  // Las de jugador llevan su línea (para resolverse solas); las de equipo las reconoce el servidor por el texto si puede
  return (p: BasketPick) => addToSlip({
    sport: 'basket', status: 'pending', league: LEAGUE_NAME[p.game.league], event: eventOf(p.game), market: p.market, selection: p.selection, odds: p.price, bookmaker: p.book,
    ...(p.kind === 'player' && p.who && p.marketKey
      ? { ref: { sport: 'basket' as const, match: p.game.id, start: p.game.date, key: `player|${BASKET_MARKETS[p.marketKey].label}|${p.who.name.toLowerCase()}|${p.line}`, out: p.side } }
      : {})
  });
};

const tip = (p: BasketPick) => `${p.market}: ${p.selection}. Modelo ${p0(p.pModel)}${p.pMarket != null ? `, casa ${p0(p.pMarket)}` : ''}. Fiabilidad ${p.rel.score}/100. Cuota justa ${odd(p.fair)}`;

function PickRow({ pick, oneGame, onOpen, onAdd }: { pick: BasketPick; oneGame: boolean; onOpen: (p: BasketPick) => void; onAdd: (p: BasketPick) => void }) {
  const good = hasValue(pick);
  return (
    <div className="px-3 py-1.5 transition hover:bg-white/[.04]">
      <div className="flex items-center gap-2.5">
        <button onClick={() => onOpen(pick)} title={tip(pick)} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="line-clamp-2 font-score text-[15px] font-semibold leading-[18px] text-white">{pick.title}</div>
          <div className="line-clamp-2 text-[11px] leading-[14px] text-zinc-400">
            {!oneGame && <span className="text-zinc-300">{eventOf(pick.game)}, {esTime(pick.game.date)} · </span>}
            {pick.injury && <span className="text-amber-300">{pick.injury} · </span>}
            {pick.why}
          </div>
        </button>
        <div className="w-[52px] shrink-0 text-right" title={`Probabilidad estimada y valor esperado por cada euro: ${VERDICT_LABEL[pickVerdict(pick)].toLowerCase()}`}>
          <div className="font-score text-[20px] font-bold leading-none text-white tnum">{p0(pick.p)}</div>
          <div className={cn('font-score text-[12px] font-semibold tnum', good ? 'text-[var(--tv-mark)]' : pick.ev > 0 ? 'text-zinc-200' : 'text-zinc-500')}>{signed(pick.ev)}</div>
        </div>
        <button onClick={() => onAdd(pick)} title={`Añadir al cupón: ${pick.book ?? ''}. Justa: ${odd(pick.fair)}`}
          className="flex h-9 w-[58px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-sm bg-white/[.08] text-white transition hover:bg-[var(--tv-mark)] hover:text-black">
          <span className="font-score text-[16px] font-bold leading-none tnum">{odd(pick.price)}</span>
          <span className="text-[9px] leading-tight opacity-75">{pick.book}</span>
        </button>
      </div>
      <div className="mt-1 h-[2px] bg-white/15"><div className="h-full bg-[var(--tv-mark)]" style={{ width: `${pick.p * 100}%` }} /></div>
    </div>
  );
}

function PickList({ title, hint, list, oneGame, onOpen, onAdd }: { title: string; hint: string; list: BasketPick[]; oneGame: boolean; onOpen: (p: BasketPick) => void; onAdd: (p: BasketPick) => void }) {
  const [all, setAll] = useState(false);
  return (
    <div className="min-w-0">
      <TvBand aside={list.length || undefined}>{title}</TvBand>
      <p className="px-3 pt-1 text-[11px] text-zinc-500">{hint}</p>
      {!list.length ? <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna con estos filtros.</p> : (all ? list : list.slice(0, PAGE)).map(p => <PickRow key={p.id} pick={p} oneGame={oneGame} onOpen={onOpen} onAdd={onAdd} />)}
      {list.length > PAGE && <button onClick={() => setAll(!all)} className="w-full cursor-pointer py-1.5 text-xs text-zinc-500 hover:text-zinc-200">{all ? `Ver sólo las ${PAGE} primeras` : `Ver las ${list.length}`}</button>}
    </div>
  );
}

function TopPick({ pick, oneGame, onOpen, onAdd }: { pick: BasketPick; oneGame: boolean; onOpen: (p: BasketPick) => void; onAdd: (p: BasketPick) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <button onClick={() => onOpen(pick)} title={tip(pick)} className="col-span-2 min-w-0 cursor-pointer text-left md:col-span-1">
        <div className="font-score text-[26px] font-bold leading-[28px] text-white md:text-[30px] md:leading-[32px]">{pick.title}</div>
        <div className="mt-1.5 text-[13px] text-zinc-300">
          {!oneGame && <>{eventOf(pick.game)}, {esTime(pick.game.date)} · </>}
          {pick.injury && <span className="text-amber-300">{pick.injury} · </span>}
          {pick.why}
        </div>
      </button>
      <div className="text-center" title={`Modelo ${p0(pick.pModel)}${pick.pMarket != null ? `, casa ${p0(pick.pMarket)}` : ''}`}>
        <div className="font-score text-[44px] font-bold leading-[42px] text-[var(--tv-mark)] tnum">{p0(pick.p)}</div>
        <div className="font-score text-[11px] font-semibold text-zinc-400">Probabilidad</div>
      </div>
      <div className="col-span-2 min-w-32 md:order-none md:col-span-1">
        <div className="mb-1 flex justify-between font-score text-[11px] font-semibold text-zinc-400"><span>Fiabilidad</span><span>{pick.rel.label}</span></div>
        <ReliabilityMeter rel={pick.rel} />
        <div className="mt-1 flex justify-between gap-3 text-[11px] text-zinc-400"><span>Justa <span className="tnum text-zinc-200">{odd(pick.fair)}</span></span><span className={cn('font-semibold tnum', hasValue(pick) ? 'text-[var(--tv-mark)]' : 'text-zinc-200')}>{hasValue(pick) ? 'Con valor ' : 'Valor '}{signed(pick.ev)}</span></div>
      </div>
      <button onClick={() => onAdd(pick)} title="Añadir al cupón" className="col-start-2 row-start-2 flex h-[58px] w-[92px] cursor-pointer flex-col items-center justify-center rounded-sm bg-[var(--tv-mark)] text-black transition hover:opacity-85 md:col-start-auto md:row-start-auto">
        <span className="flex items-center gap-1 font-score text-[24px] font-bold leading-none tnum"><Plus size={15} />{odd(pick.price)}</span>
        <span className="text-[11px] font-medium">{pick.book}</span>
      </button>
    </div>
  );
}

const Note = ({ children }: { children: ReactNode }) => <div className="flex items-start gap-2 text-xs text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{children}</span></div>;

// games: un partido (pestaña de su ficha) o varios (pantalla de recomendaciones). onOdds: ir a las cuotas de ese partido
export function BasketPicksBoard({ games, injuries, onOpen, onOdds }: { games: BasketGame[]; injuries: BasketInjury[]; onOpen: (p: BasketPick) => void; onOdds?: () => void }) {
  const oneGame = games.length === 1;
  const prefs = useMemo(loadPrefs, []);
  const [group, setGroup] = useState<PickGroup | 'all'>(PICK_GROUPS.some(g => g.value === prefs.group) ? prefs.group : 'all');
  const [side, setSide] = useState<Side | 'all'>(prefs.side === 'over' || prefs.side === 'under' ? prefs.side : 'all');
  const [minOdds, setMinOdds] = useState<number>(MIN_ODDS.includes(prefs.minOdds) ? prefs.minOdds : DEFAULT_MIN_ODDS);
  const [onlyValue, setOnlyValue] = useState<boolean>(prefs.onlyValue === true);
  const [lineText, setLineText] = useState('');
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ group, side, minOdds, onlyValue })); } catch { /* sin almacenamiento */ } }, [group, side, minOdds, onlyValue]);

  const add = usePickAdd();
  const q = useBasketPicks(games, injuries);
  const line = lineText.trim() ? parseLine(lineText) : null;
  const filters: PickFilters = { group, side, line, minOdds, onlyValue };
  const A = useMemo(() => arrangePicks(q.picks, filters), [q.picks, group, side, line, minOdds, onlyValue]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const sub = [oneGame ? LEAGUE_NAME[games[0].league] : `${games.length - q.noOdds.length} de ${games.length} partidos con cuotas`, q.age != null ? `cuotas ${ago(q.age)}` : ''].filter(Boolean).join(' · ');
  const props = { oneGame, onOpen, onAdd: add };
  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn(panel, 'flex flex-col gap-2.5 px-3.5 py-2.5')}>
        <TvTabs value={group} onChange={setGroup} items={PICK_GROUPS} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-zinc-400">
          <TvTabs value={side} onChange={setSide} items={[{ value: 'all' as const, label: 'Más y menos' }, { value: 'over' as const, label: 'Más' }, { value: 'under' as const, label: 'Menos' }]} />
          <label className="flex items-center gap-2" title="Sólo esta línea exacta. +2,5 es Más de 2,5 y -2,5, Menos de 2,5">Línea<Input aria-label="Línea" inputMode="decimal" className="h-7 w-20 text-center font-semibold lg:h-7" placeholder="Todas" value={lineText} onChange={e => onLine(e.target.value)} /></label>
          <label className="flex items-center gap-2" title="Fuera lo que paga menos: una cuota de 1,11 arriesga mucho para ganar casi nada">Cuota mínima<Select className="h-7 w-24 text-xs lg:h-7 lg:text-xs" value={minOdds} onChange={e => setMinOdds(Number(e.target.value))}>{MIN_ODDS.map(m => <option key={m} value={m}>{odd(m).replace('.', ',')}</option>)}</Select></label>
          <span title="Valor esperado de 2 % o más y fiabilidad de 55 o más"><Toggle on={onlyValue} onChange={setOnlyValue} label="Sólo con valor" /></span>
        </div>
      </div>

      {q.loaded < q.total && (
        <div className={cn(panel, 'px-3.5 py-2')} role="status">
          <div className="mb-1.5 text-[13px] text-zinc-400">Leyendo los partidos de los jugadores: {q.loaded} de {q.total}. La primera vez tarda algo más.</div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${(q.loaded / Math.max(1, q.total)) * 100}%` }} /></div>
        </div>
      )}

      <TvFrame>
        <TvHeader title="Recomendaciones" sub={sub}>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
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
          <PickList title="Más fáciles" hint="Probabilidad de 58 % o más, de más a menos valor" list={A.easy} {...props} />
          <PickList title="Equilibradas" hint="Probabilidad de 42 a 58 %, de más a menos valor" list={A.mid} {...props} />
          <PickList title="Más complicadas" hint="Probabilidad de menos de 42 %, cuota alta" list={A.hard} {...props} />
        </div>

        {(!!q.noOdds.length || !!q.stale.length) && (
          <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-1.5">
            {!!q.noOdds.length && <Note>Sin cuotas todavía: {q.noOdds.map(eventOf).join(', ')}.</Note>}
            {!!q.stale.length && <Note>Cuotas de hace más de 6 h en {q.stale.map(eventOf).join(', ')}: actualízalas antes de apostar.</Note>}
          </div>
        )}
        <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
          Es una estimación, no una garantía: el valor mezcla el modelo con la casa sin margen, y la casa pesa más. Sin cuotas históricas no se ha podido comprobar si a la larga da dinero. Las bajas de los compañeros no cambian la proyección: si son nuevas, bajan la fiabilidad de los «menos». En robos y tapones se desvía más. Ganador y hándicap no salen porque el modelo no los calcula.
        </p>
      </TvFrame>
    </div>
  );
}

// Las mejores de las próximas 24 horas, en la lista de partidos. Sin cuotas no sale y no se piden los partidos de los jugadores
export function BasketDayPicks({ games, injuries, onOpen, onAll }: { games: BasketGame[]; injuries: BasketInjury[]; onOpen: (p: BasketPick) => void; onAll: () => void }) {
  const { picks } = useBasketPicks(games, injuries);
  const minOdds = useMemo(() => { const m = loadPrefs().minOdds; return MIN_ODDS.includes(m) ? m : DEFAULT_MIN_ODDS; }, []);
  const list = useMemo(() => bestPicks(picks, minOdds, 4), [picks, minOdds]);
  if (!list.length) return null;
  return (
    <TvFrame>
      <TvBand>Las mejores de las próximas 24 h</TvBand>
      {list.map(p => (
        <button key={p.id} onClick={() => onOpen(p)} title={tip(p)} className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_2.75rem_3rem_1rem] items-center gap-2 border-b border-white/10 px-3 py-1.5 text-left transition hover:bg-white/[.05]">
          <span className="min-w-0">
            <span className="block truncate font-score text-[15px] font-bold text-white">{p.title}</span>
            <span className="block truncate text-[11px] text-zinc-400">{eventOf(p.game)}, {esTime(p.game.date)} · {VERDICT_LABEL[pickVerdict(p)]} {signed(p.ev)} · {p.book}</span>
          </span>
          <span className="text-right font-score text-[17px] font-bold text-[var(--tv-mark)] tnum">{p0(p.p)}</span>
          <span className="text-right font-score text-[17px] font-bold text-white tnum">{odd(p.price)}</span>
          <ChevronRight size={14} className="text-zinc-500" />
        </button>
      ))}
      <button onClick={onAll} className="w-full cursor-pointer py-1.5 text-xs text-zinc-400 hover:text-zinc-100">Ver todas las recomendaciones</button>
    </TvFrame>
  );
}
