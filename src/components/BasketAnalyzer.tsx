// Analizador de props de jugador de baloncesto (adaptado de courtside-edge): mercado, línea y cuotas, el panel de
// valor común con LoL, la proyección, los últimos partidos frente a la línea, tramos, escalera y bajas.
// Vale para cualquier liga del servicio basket (NBA con ESPN, Euroliga y EuroCup con sus box scores).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '@/lib/app-context';
import { cn, odd, pct, summarize } from '@/lib/format';
import { BASKET_MARKETS, analyze, fmtLine, playerLines, scanMarkets, suggestedLine, type BasketCtx, type BasketMarket, type CasaLine } from '@/lib/basket-model';
import { BookHead } from './BookIcon';
import { BasketContext } from './BasketContext';
import { freshKeyOuts, matesOut } from '@/lib/basket-mates';
import { gameCtx } from '@/lib/basket-context';
import { SIDE_LABEL, type Side, type SideValue } from '@/lib/value';
import type { BasketAbsence, BasketGame, BasketInjury, BasketLeagueId, BasketLogGame, MatchOdds } from '@/lib/types';
import { ValuePanel } from './ValuePanel';
import { Badge, Card, Empty, ErrorBox, Input, Loading, Select, Tabs, oddBtn, td, th } from './ui';
import { espnLeague, gameMinutes } from '@/lib/basket-leagues';
import { sized } from '@/lib/img';

const BOOKS = ['Winamax', 'Betway'];
export const LEAGUE_NAME: Record<BasketLeagueId, string> = { nba: 'NBA', wnba: 'WNBA', euroleague: 'Euroliga', eurocup: 'EuroCup', nbl: 'NBL' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
export const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return isFinite(n) ? n : null; };
const fx = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? '–' : v.toFixed(d));
export const badInjury = (s: string) => /out/i.test(s);

// market y line: con qué abrir el análisis (lo manda el escáner de líneas)
// seen: cómo estaba la recomendación con la que se abrió, para avisar si la cuota ha cambiado desde entonces
export type Picked = { id: string; name: string; league: BasketLeagueId; headshot?: string; teamId?: string; game?: BasketGame | null; market?: BasketMarket; line?: number; seen?: { side: Side; price: number; book?: string; ev: number; at: number } };

export function BasketAnalyzer({ player, games = [], injuries = [], odds }: { player: Picked; games?: BasketGame[]; injuries?: BasketInjury[]; odds?: MatchOdds }) {
  const { addToSlip, settings } = useApp();
  const log = useQuery({ queryKey: ['basket', 'gamelog', player.league, player.id, player.teamId], queryFn: () => window.api.basket.gamelog(player.league, player.id, player.teamId), staleTime: 10 * 60e3 });
  const { data: bets = [] } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  const bank = (settings?.initialBankroll || 0) + summarize(bets).profit;

  const [market, setMarket] = useState<BasketMarket>(player.market ?? 'pts');
  // Más o Menos: lo que se mira en la gráfica y en los tramos. Si viene de una recomendación, su lado
  const [side, setSide] = useState<Side>(player.seen?.side ?? 'over');
  const [line, setLine] = useState('');
  // La línea con la que se abrió se respeta hasta que se cambie de mercado
  const wanted = useRef<{ market: BasketMarket; line: number } | null>(player.market && player.line != null ? { market: player.market, line: player.line } : null);
  const [over, setOver] = useState('');
  const [under, setUnder] = useState('');
  const [book, setBook] = useState(BOOKS[0]);
  const [venue, setVenue] = useState<'' | 'home' | 'away'>('');
  const [opp, setOpp] = useState('');

  const all = log.data?.games ?? [];
  const teamId = player.teamId || all[0]?.teamId || undefined;
  // Partidos de su equipo que no jugó (sólo las ligas de ESPN): en la gráfica, para no confundirlos con un 0
  const absences = useQuery({
    queryKey: ['basket', 'absences', player.league, player.id, teamId], enabled: !!teamId && espnLeague(player.league),
    queryFn: () => window.api.basket.absences(player.league, player.id, teamId!), staleTime: 30 * 60e3
  });
  const team = all[0]?.team || '';
  // Partido de la jornada cargada: rellena rival y local / visitante
  const game = player.game ?? games.find(g => g.league === player.league && (g.home.id === teamId || g.away.id === teamId)) ?? null;
  useEffect(() => {
    if (!game || !teamId) return;
    const home = game.home.id === teamId;
    setVenue(home ? 'home' : 'away');
    setOpp(home ? game.away.abbr : game.home.abbr);
  }, [game?.id, teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  const injury = injuries.find(i => i.playerId === player.id)?.status || null;
  // Calendario de su equipo: con él se sabe si vuelve de una baja (el escáner lo saca de la plantilla; es el mismo)
  const sched = useQuery({
    queryKey: ['basket', 'schedule', player.league, teamId], enabled: !!teamId && espnLeague(player.league),
    queryFn: () => window.api.basket.schedule(player.league, teamId!), staleTime: 30 * 60e3
  });
  // B2B y vuelta de baja para el partido que se mira, igual que en el escáner y en las recomendaciones
  const gctx = game ? gameCtx(all, sched.data ?? [], game.date, teamId) : {};
  // Plantilla con sus partidos (la misma consulta que el escáner): qué compañeros faltan y cómo le fue sin ellos
  const mateLogs = useQuery({
    queryKey: ['basket', 'teamLogs', player.league, teamId], enabled: !!teamId && espnLeague(player.league),
    queryFn: () => window.api.basket.teamLogs(player.league, teamId!), staleTime: 15 * 60e3, retry: 1
  });
  const mates = useMemo(() => matesOut(mateLogs.data, teamId, player.id, game?.date ?? new Date(Date.now() + 864e5).toISOString(),
    (id, roster) => (player.league === 'nba' ? injuries.find(i => i.playerId === id)?.status : null) || roster, gameMinutes(player.league)),
  [mateLogs.data, teamId, player.id, player.league, game?.date, injuries]);
  const freshNames = freshKeyOuts(mates).map(m => m.name);
  const ctx: BasketCtx | null = log.data ? { currentSeason: log.data.currentSeason, home: venue === '' ? null : venue === 'home', opp: opp || null, injury, matesOut: freshNames, ...gctx } : null;

  // Líneas de este jugador y mercado que ya han leído las casas (si el partido tiene cuotas)
  const casa = useMemo(() => playerLines(odds, player.name)[BASKET_MARKETS[market].label] ?? [], [odds, player.name, market]);
  const useLine = (c: (typeof casa)[number]) => {
    setLine(String(c.line).replace('.', ','));
    setOver(c.over ? String(c.over).replace('.', ',') : ''); setUnder(c.under ? String(c.under).replace('.', ',') : '');
    if (c.overBook || c.underBook) setBook((c.overBook || c.underBook)!);
  };
  // Al cambiar de mercado: la línea principal de las casas si la hay (la más igualada); si no, la de la proyección
  useEffect(() => {
    if (!ctx) return;
    if (wanted.current?.market !== market) wanted.current = null;
    if (wanted.current) {
      const c = casa.find(x => x.line === wanted.current!.line);
      if (c) useLine(c);
      else { setLine(String(wanted.current.line).replace('.', ',')); setOver(''); setUnder(''); }
      return;
    }
    const main = casa.slice().sort((x, y) => Math.abs((x.over ?? 9) - (x.under ?? 0)) - Math.abs((y.over ?? 9) - (y.under ?? 0)))[0];
    if (main) { useLine(main); return; }
    const s = suggestedLine(all, market, ctx);
    if (s != null) setLine(String(s).replace('.', ','));
    setOver(''); setUnder('');
  }, [market, log.data, casa.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const L = num(line);
  // La probabilidad de la casa sale de todas las casas de esa línea, pulses la cuota que pulses: sólo cambia lo que se paga
  const lineBooks = useMemo(() => { const c = casa.find(x => x.line === L); return c ? Object.values(c.books) : undefined; }, [casa, L]);
  const R = useMemo(() => ctx && L != null && L >= 0 ? analyze(all, market, L, { over: num(over), under: num(under), book, books: lineBooks }, ctx) : null,
    [all, market, L, over, under, book, lineBooks, ctx?.home, ctx?.opp, ctx?.injury, ctx?.b2b, ctx?.back, freshNames.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const scan = useMemo(() => ctx ? scanMarkets(all, ctx) : [], [all, ctx?.home, ctx?.opp, ctx?.b2b, ctx?.back]); // eslint-disable-line react-hooks/exhaustive-deps
  const opps = useMemo(() => [...new Set(all.map(g => g.opp).filter(o => o && o !== '?'))].sort(), [all]);

  if (log.isLoading) return <Loading label={`Cargando los partidos de ${player.name}…`} />;
  if (log.error) return <ErrorBox error={log.error} />;
  if (!all.length) return <Empty>No hay partidos registrados de {player.name}</Empty>;

  const M = BASKET_MARKETS[market];
  const event = game ? `${game.away.abbr} @ ${game.home.abbr}` : `${team}${opp ? ` vs ${opp}` : ''}`;
  const betOf = (s: SideValue) => ({
    league: LEAGUE_NAME[player.league], event, market: `${M.label} · ${player.name}`, selection: `${SIDE_LABEL[s.side]} de ${L}`, odds: s.price, bookmaker: s.book || book,
    // Con partido, se resuelve sola con su línea de jugador
    ...(game && L != null ? { ref: { sport: 'basket' as const, match: game.id, start: game.date, key: `player|${M.label}|${player.name.toLowerCase()}|${L}`, out: s.side } } : {})
  });

  const cs = log.data!.currentSeason;
  // ESPN numera la temporada por el año en que acaba (2027 = 26-27) y la Euroliga por el que empieza (2026 = 26-27)
  const espn = espnLeague(player.league);
  const seasonLabel = (y: number) => espn ? `${String(y - 1).slice(2)}-${String(y).slice(2)}` : `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
  let base = all.filter(g => g.type === 'reg' && g.season === cs), label = seasonLabel(cs);
  if (!base.length) { base = all.filter(g => g.type === 'reg' && g.season === cs - 1); label = seasonLabel(cs - 1); }
  const avg = (f: (g: BasketLogGame) => number) => (base.length ? base.reduce((s, g) => s + f(g), 0) / base.length : null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-surface p-4">
        {player.headshot && <img loading="lazy" decoding="async" src={sized(player.headshot, 64)} alt="" className="h-16 w-16 rounded-full bg-zinc-800 object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xl font-bold">{player.name}{injury && <Badge tone={badInjury(injury) ? 'danger' : 'warning'}>{injury}</Badge>}</div>
          <div className="text-sm text-zinc-400">{LEAGUE_NAME[player.league]}, {team}{game ? `, ${event}, ${game.state === 'pre' ? esTime(game.date) : game.status}` : ''}</div>
        </div>
        <div className="flex gap-5">
          {([['PTS', avg(g => g.pts)], ['REB', avg(g => g.reb)], ['AST', avg(g => g.ast)], ['MIN', avg(g => g.min)]] as const).map(([k, v]) => (
            <div key={k} className="text-center"><div className="text-lg font-bold tabular-nums">{fx(v)}</div><div className="text-xs text-zinc-500">{k} {label}</div></div>
          ))}
          <div className="text-center"><div className="text-lg font-bold tabular-nums">{base.length}</div><div className="text-xs text-zinc-500">PJ {label}</div></div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {(Object.keys(BASKET_MARKETS) as BasketMarket[]).map(k => (
          <button key={k} onClick={() => setMarket(k)} title={BASKET_MARKETS[k].label}
            className={cn('cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition', k === market ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200')}>{BASKET_MARKETS[k].short}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Lbl label="Línea"><Input inputMode="decimal" value={line} onChange={e => setLine(e.target.value)} /></Lbl>
        <Lbl label="Cuota Más"><Input inputMode="decimal" placeholder="1,85" value={over} onChange={e => setOver(e.target.value)} /></Lbl>
        <Lbl label="Cuota Menos"><Input inputMode="decimal" placeholder="1,95" value={under} onChange={e => setUnder(e.target.value)} /></Lbl>
        <Lbl label="Casa"><Select value={book} onChange={e => setBook(e.target.value)}>{BOOKS.map(b => <option key={b}>{b}</option>)}</Select></Lbl>
        <Lbl label="Juega"><Select value={venue} onChange={e => setVenue(e.target.value as typeof venue)}><option value="">Sin indicar</option><option value="home">En casa</option><option value="away">Fuera</option></Select></Lbl>
        <Lbl label="Rival"><Select value={opp} onChange={e => setOpp(e.target.value)}><option value="">Sin indicar</option>{(opp && !opps.includes(opp) ? [opp, ...opps] : opps).map(o => <option key={o}>{o}</option>)}</Select></Lbl>
      </div>
      {!!casa.length && <CasaTable casa={casa} line={L} onPick={useLine} />}
      <BasketContext games={all} missed={absences.data} season={cs} game={game} teamId={teamId} playerId={player.id} injuries={injuries} market={market} line={L} mates={mates} mateLogs={mateLogs.data} />

      {!R ? <Empty>Escribe una línea válida (por ejemplo 24,5)</Empty> : <>
        <Moved seen={player.market === market && player.line === L ? player.seen : undefined} now={R.sides} />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
          <ValuePanel bank={bank}
            v={{ line: L!, pOver: R.pOver, pUnder: R.pUnder, pPush: R.pPush, fairOver: R.fairOver, fairUnder: R.fairUnder, margin: R.market.margin, exact: R.market.exact, sides: R.sides, rel: R.rel, verdict: R.verdict }}
            side={side} onSide={setSide}
            onSlip={s => addToSlip({ sport: 'basket', status: 'pending', ...betOf(s) })} />
          <div className="flex flex-col gap-5">
            <Card title={`Proyección: ${fx(R.mu)} ${M.short}`} action={<span className="text-xs text-zinc-500">{fx(R.projMin)} min previstos</span>}>
              <div className="flex flex-wrap gap-1.5">
                {R.factors.map(f => {
                  const d = (f.f - 1) * 100;
                  return <span key={f.label} title={`${f.n} partidos`} className={cn('rounded-md border px-2 py-0.5 text-xs', Math.abs(d) < 0.5 ? 'border-zinc-700 text-zinc-400' : d > 0 ? 'border-emerald-500/30 text-emerald-300' : 'border-rose-500/30 text-rose-300')}>{f.label} {d >= 0 ? '+' : ''}{d.toFixed(1)} %</span>;
                })}
                <span className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">Modelo {pct(R.modelOver)} · histórico {pct(R.histOver)} de Más</span>
              </div>
            </Card>
            <LastGames games={all} missed={absences.data} market={market} line={L!} mu={R.mu} season={cs} side={side} onSide={setSide} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
          <Card className="overflow-hidden" title="Tramos">
            <table className="-m-5 w-[calc(100%+2.5rem)]">
              <thead className="bg-zinc-900/60"><tr><th className={th}>Tramo</th><th className={th + ' text-right'}>PJ</th><th className={th + ' text-right'}>Media</th><th className={th + ' text-right'}>Min</th><th className={th + ' text-right'}>% {SIDE_LABEL[side]}</th></tr></thead>
              <tbody className="divide-y divide-zinc-800/70">
                {R.splits.map(s => (
                  <tr key={s.label}><td className={td}>{s.label}</td><td className={td + ' text-right tabular-nums text-zinc-400'}>{s.n}</td><td className={td + ' text-right tabular-nums'}>{fx(s.avg)}</td>
                    <td className={td + ' text-right tabular-nums text-zinc-400'}>{fx(s.min)}</td>
                    {(() => { const h = side === 'over' ? s.hit : s.under; return <td className={cn(td, 'text-right tabular-nums', h != null && (h >= 0.6 ? 'text-emerald-400' : h <= 0.4 ? 'text-rose-400' : ''))}>{s.n && h != null ? pct(h) : '–'}</td>; })()}</tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card className="overflow-hidden" title="Escalera de líneas (cuotas justas)">
            <table className="-m-5 w-[calc(100%+2.5rem)]">
              <thead className="bg-zinc-900/60"><tr><th className={th + ' text-right'}>Línea</th><th className={th + ' text-right'}>P(Más)</th><th className={th + ' text-right'}>Justa Más</th><th className={th + ' text-right'}>Justa Menos</th></tr></thead>
              <tbody className="divide-y divide-zinc-800/70">
                {R.ladder.map(r => {
                  const sel = Math.abs(r.line - L!) < 1e-9, o = num(over), u = num(under);
                  return (
                    <tr key={r.line} className={cn('cursor-pointer hover:bg-zinc-800/40', sel && 'bg-amber-500/10')} onClick={() => setLine(String(r.line).replace('.', ','))} title="Usar esta línea">
                      <td className={td + ' text-right tabular-nums'}>{r.line}</td><td className={td + ' text-right tabular-nums'}>{pct(r.pOver)}</td>
                      <td className={cn(td, 'text-right tabular-nums', sel && o && o > r.fairOver && 'font-semibold text-emerald-400')}>{odd(r.fairOver)}</td>
                      <td className={cn(td, 'text-right tabular-nums', sel && u && u > r.fairUnder && 'font-semibold text-emerald-400')}>{odd(r.fairUnder)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      </>}

      <Card className="overflow-hidden" title="Todos los mercados">
        <table className="-m-5 w-[calc(100%+2.5rem)]">
          <thead className="bg-zinc-900/60"><tr><th className={th}>Mercado</th><th className={th + ' text-right'}>Proyección</th><th className={th + ' text-right'}>Rango 80 %</th><th className={th + ' text-right'}>Últ. 10</th><th className={th}>Regularidad</th></tr></thead>
          <tbody className="divide-y divide-zinc-800/70">
            {scan.map(r => (
              <tr key={r.key} className={cn('cursor-pointer hover:bg-zinc-800/40', r.key === market && 'bg-amber-500/10')} onClick={() => setMarket(r.key)}>
                <td className={td}>{r.label}</td><td className={td + ' text-right font-semibold tabular-nums'}>{fx(r.mu)}</td>
                <td className={td + ' text-right tabular-nums text-zinc-400'}>{fx(r.range[0], 0)}–{fx(r.range[1], 0)}</td><td className={td + ' text-right tabular-nums'}>{fx(r.l10)}</td>
                <td className={td}><Badge tone={r.consistency === 'Alta' ? 'success' : r.consistency === 'Media' ? 'warning' : 'danger'}>{r.consistency}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {player.league === 'nba' && <Injuries teamId={teamId} team={team} opp={opp} injuries={injuries} />}
    </div>
  );
}

// Las líneas de este mercado en cada casa, con su cuota de Más y de Menos: se ve de dónde es cada una y cuál paga más
// (resaltada cuando las dos casas la tienen). Pulsar una cuota usa esa línea con las dos cuotas de esa casa; pulsar la
// línea, las mejores de cada lado
function CasaTable({ casa, line, onPick }: { casa: CasaLine[]; line: number | null; onPick: (c: CasaLine) => void }) {
  const books = [...new Set(casa.flatMap(c => Object.keys(c.books)))].sort((a, b) => BOOKS.indexOf(a) - BOOKS.indexOf(b));
  const rows = casa.slice().sort((x, y) => x.line - y.line);
  const only = (c: CasaLine, b: string): CasaLine => ({ line: c.line, ...c.books[b], overBook: b, underBook: b, books: { [b]: c.books[b] } });
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-surface">
      <div className="flex items-baseline justify-between gap-2 border-b border-zinc-800/60 px-4 py-2.5">
        <span className="text-sm font-semibold">En las casas</span>
        <span className="text-[11px] text-zinc-500">{books.length > 1 ? 'Resaltada, la que paga más' : `Sólo la tiene ${books[0]}`}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-zinc-900/60">
            <tr>
              <th className={th} rowSpan={2}>Línea</th>
              {books.map(b => <th key={b} colSpan={2} className={cn(th, 'pb-0 text-center')}><BookHead name={b} /></th>)}
            </tr>
            <tr>{books.map(b => <Fragment key={b}><th className={cn(th, 'pt-1 text-center')}>Más</th><th className={cn(th, 'pt-1 text-center')}>Menos</th></Fragment>)}</tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {rows.map(c => (
              <tr key={c.line} className={cn(line === c.line && 'bg-amber-500/10')}>
                <td className={td}>
                  <button onClick={() => onPick(c)} title="Usar esta línea con la mejor cuota de cada lado" className="cursor-pointer font-mono font-semibold tnum hover:text-amber-300">{fmtLine(c.line)}</button>
                </td>
                {books.map(b => (
                  <Fragment key={b}>
                    {(['over', 'under'] as const).map(s => {
                      const p = c.books[b]?.[s];
                      const best = !!p && p === c[s] && Object.values(c.books).filter(x => x[s]).length > 1;
                      return (
                        <td key={s} className="px-1 py-1.5 text-center">
                          {p
                            ? <button onClick={() => onPick(only(c, b))} title={`${b}: ${s === 'over' ? 'Más' : 'Menos'} de ${fmtLine(c.line)} a ${odd(p)}`} className={cn(oddBtn(best), 'h-8 w-[62px] text-[13px]')}>{odd(p)}</button>
                            : <span className="text-zinc-700">–</span>}
                        </td>
                      );
                    })}
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Lbl = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-zinc-400">{label}</span>{children}</label>
);

// Últimos 20 partidos frente a la línea, según el lado elegido: verde si esa apuesta habría ganado (Más: superó la línea;
// Menos: se quedó por debajo), rojo si no, gris si fue justo la línea (nula). Entre medias, en gris oscuro, los de su equipo
// que no jugó (con el motivo en el tooltip), para no confundirlos con un 0
type LastRow = { k: number; x: string; date: string; v: number | null; na: number | null; reason?: string };
// Qué partidos enseña la gráfica: los 20 últimos (pueden ser de la temporada pasada) o todos los de esta temporada. Se recuerda
const RANGE_KEY = 'basket.lastGames.range';
type Range = 'last' | 'season';
const loadRange = (): Range => { try { return localStorage.getItem(RANGE_KEY) === 'season' ? 'season' : 'last'; } catch { return 'last'; } };

function LastGames({ games, missed = [], market, line, mu, season, side, onSide }: {
  games: BasketLogGame[]; missed?: BasketAbsence[]; market: BasketMarket; line: number; mu: number; season: number; side: Side; onSide: (s: Side) => void;
}) {
  const M = BASKET_MARKETS[market];
  const [range, setRangeState] = useState<Range>(loadRange);
  const setRange = (r: Range) => { setRangeState(r); try { localStorage.setItem(RANGE_KEY, r); } catch { /* sin almacenamiento */ } };
  let list = games.filter(g => g.type !== 'pre');
  if (list.length < 3) list = games;
  const thisSeason = list.filter(g => g.season === season);
  const played = range === 'season' ? thisSeason : list.slice(0, 20);
  // Las ausencias de la lista de bajas sólo llegan a los 25 últimos partidos del equipo: con toda la temporada pueden faltar las antiguas
  const since = played.length ? +new Date(played[played.length - 1].date) : Infinity;
  const vs = (home: boolean | null, opp: string) => `${home ? '' : '@'}${opp}`;
  // k: clave única de cada barra. Con el rival como clave, dos partidos contra el mismo equipo enseñaban en el tooltip
  // las cifras del primero (5 asistencias salían como 1)
  const data: LastRow[] = [
    ...played.map(g => ({ t: +new Date(g.date), x: vs(g.home, g.opp), date: shortDate(g.date), v: M.f(g), na: null })),
    ...missed.filter(m => +new Date(m.date) >= since).map(m => ({ t: +new Date(m.date), x: vs(m.home, m.opp), date: shortDate(m.date), v: null, na: Math.max(line, 1), reason: m.reason }))
  ].sort((a, b) => a.t - b.t).map(({ t: _t, ...r }, k) => ({ ...r, k }));
  const n = played.length, out = data.length - n;
  const wins = (v: number) => (side === 'over' ? v > line : v < line);
  const hits = played.filter(g => wins(M.f(g))).length;
  const avg = n ? played.reduce((a, g) => a + M.f(g), 0) / n : null;
  // Con muchos partidos no caben todos los rivales debajo: se deja que la gráfica salte los que no quepan
  const many = data.length > 24;
  return (
    <Card title={`${M.label}: ${range === 'season' ? 'esta temporada' : `últimos ${n}`}${out ? ` (y ${out} sin jugar)` : ''}`}
      action={<Tabs value={range} onChange={setRange} items={[{ value: 'last', label: 'Últimos 20' }, { value: 'season', label: 'Esta temporada' }]} />}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <Tabs value={side} onChange={onSide} items={[{ value: 'over' as const, label: 'Más de' }, { value: 'under' as const, label: 'Menos de' }]} />
        <span className={cn('font-semibold', !n ? 'text-zinc-500' : hits / n >= 0.6 ? 'text-emerald-400' : hits / n <= 0.4 ? 'text-rose-400' : 'text-zinc-400')}>{SIDE_LABEL[side]} de {line} en {hits}/{n}{n ? ` (${Math.round((hits / n) * 100)} %)` : ''}</span>
        {avg != null && <span className="text-zinc-500">Media <span className="tnum text-zinc-200">{fx(avg)}</span></span>}
      </div>
      {!n ? <Empty>Todavía no ha jugado esta temporada.</Empty> : <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#2b3034" vertical={false} />
            <XAxis dataKey="k" tickFormatter={k => data[k]?.x ?? ''} stroke="#85948f" fontSize={10} tickLine={false} axisLine={false} interval={many ? 'preserveStartEnd' : 0} minTickGap={many ? 4 : 0} />
            <YAxis stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: '#2b303488' }} contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }} itemStyle={{ color: '#fafafa', fontWeight: 600 }}
              labelStyle={{ color: '#d4d4d8' }} labelFormatter={(_, p) => p?.[0] ? `${p[0].payload.date} ${p[0].payload.x}` : ''}
              formatter={(v, name, p) => (name === 'na' ? [p.payload.reason, 'No jugó'] : [v, M.short])} />
            <ReferenceLine y={line} stroke="var(--acc-400)" strokeDasharray="4 4" />
            <ReferenceLine y={mu} stroke="#9aaaa4" strokeDasharray="2 4" />
            <Bar dataKey="v" stackId="g" radius={[3, 3, 0, 0]} minPointSize={v => (v === 0 ? 3 : 0)} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.v == null ? 'transparent' : d.v === line ? '#85948f' : wins(d.v) ? 'var(--color-emerald-400)' : 'var(--color-rose-400)'} />)}
            </Bar>
            <Bar dataKey="na" stackId="g" radius={[3, 3, 0, 0]} fill="#3f3f46" fillOpacity={0.55} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span><span className="text-amber-400">- -</span> línea {line}</span><span><span className="text-zinc-300">··</span> proyección {fx(mu)}</span>
        {out > 0 && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-zinc-700" />no jugó (el motivo, al pasar por encima)</span>}
      </div>
    </Card>
  );
}

function Injuries({ teamId, team, opp, injuries }: { teamId?: string; team: string; opp: string; injuries: BasketInjury[] }) {
  const groups = [{ title: team || 'Su equipo', list: injuries.filter(i => i.teamId === teamId) }];
  if (opp) groups.push({ title: `${opp} (rival)`, list: injuries.filter(i => i.team === opp) });
  return (
    <Card title="Bajas">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {groups.map(g => (
          <div key={g.title}>
            <div className="mb-2 text-xs font-semibold text-zinc-500">{g.title}</div>
            {!g.list.length ? <div className="text-sm text-zinc-600">Sin bajas</div> : g.list.map(i => (
              <div key={i.name} className="flex items-center gap-2 py-1 text-sm">
                <span className="flex-1 truncate">{i.name}</span>
                <span className="truncate text-xs text-zinc-500">{i.detail}</span>
                <Badge tone={badInjury(i.status) ? 'danger' : 'warning'}>{i.status}</Badge>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-500">Si falta un titular de su equipo suele subir el uso del jugador; el modelo no lo ajusta solo.</p>
    </Card>
  );
}

// Si se abrió desde una recomendación y la cuota ha cambiado desde entonces, se dice: el veredicto de aquí es con la cuota de
// ahora, y por eso puede no coincidir con lo que decía la lista
function Moved({ seen, now }: { seen?: Picked['seen']; now: SideValue[] }) {
  const cur = seen && now.find(s => s.side === seen.side);
  if (!seen || !cur || Math.abs(cur.price - seen.price) < 0.005) return null;
  const mins = Math.max(1, Math.round((Date.now() - seen.at) / 60e3));
  const down = cur.price < seen.price;
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200">
      En la recomendación la cuota era <b className="tnum">{odd(seen.price)}</b>{seen.book ? ` (${seen.book})` : ''} con valor {signedPct(seen.ev)}; ahora es <b className="tnum">{odd(cur.price)}</b>{cur.book ? ` (${cur.book})` : ''} con {signedPct(cur.ev)}.
      {down ? ' La casa la ha bajado: el modelo piensa lo mismo, pero ahora paga menos y queda menos valor.' : ' La casa la ha subido: ahora paga más.'}
      <span className="text-zinc-500"> El veredicto de abajo es con la cuota de ahora{mins < 120 ? ` (la lista era de hace ${mins} min)` : ''}.</span>
    </div>
  );
}
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')} %`;
