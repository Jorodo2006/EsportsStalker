// Analizador de props de jugador de baloncesto (adaptado de courtside-edge): mercado, línea y cuotas, el panel de
// valor común con LoL, la proyección, los últimos partidos frente a la línea, tramos, escalera y bajas.
// Vale para cualquier liga del servicio basket (NBA con ESPN, Euroliga y EuroCup con sus box scores).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '@/lib/app-context';
import { cn, odd, pct, summarize } from '@/lib/format';
import { BASKET_MARKETS, analyze, playerLines, scanMarkets, suggestedLine, type BasketCtx, type BasketMarket } from '@/lib/basket-model';
import { SIDE_LABEL, type SideValue } from '@/lib/value';
import type { BasketGame, BasketInjury, BasketLeagueId, BasketLogGame, MatchOdds } from '@/lib/types';
import { ValuePanel } from './ValuePanel';
import { Badge, Card, Empty, ErrorBox, Input, Loading, Select, chip, td, th } from './ui';

const BOOKS = ['Winamax', 'Betway'];
export const LEAGUE_NAME: Record<BasketLeagueId, string> = { nba: 'NBA', wnba: 'WNBA', euroleague: 'Euroliga', eurocup: 'EuroCup' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
export const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return isFinite(n) ? n : null; };
const fx = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? '–' : v.toFixed(d));
export const badInjury = (s: string) => /out/i.test(s);

// market y line: con qué abrir el análisis (lo manda el escáner de líneas)
export type Picked = { id: string; name: string; league: BasketLeagueId; headshot?: string; teamId?: string; game?: BasketGame | null; market?: BasketMarket; line?: number };

export function BasketAnalyzer({ player, games = [], injuries = [], odds }: { player: Picked; games?: BasketGame[]; injuries?: BasketInjury[]; odds?: MatchOdds }) {
  const { addToSlip, settings } = useApp();
  const log = useQuery({ queryKey: ['basket', 'gamelog', player.league, player.id, player.teamId], queryFn: () => window.api.basket.gamelog(player.league, player.id, player.teamId), staleTime: 10 * 60e3 });
  const { data: bets = [] } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  const bank = (settings?.initialBankroll || 0) + summarize(bets).profit;

  const [market, setMarket] = useState<BasketMarket>(player.market ?? 'pts');
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
  const ctx: BasketCtx | null = log.data ? { currentSeason: log.data.currentSeason, home: venue === '' ? null : venue === 'home', opp: opp || null, injury } : null;

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
  const R = useMemo(() => ctx && L != null && L >= 0 ? analyze(all, market, L, { over: num(over), under: num(under), book }, ctx) : null,
    [all, market, L, over, under, book, ctx?.home, ctx?.opp, ctx?.injury]); // eslint-disable-line react-hooks/exhaustive-deps
  const scan = useMemo(() => ctx ? scanMarkets(all, ctx) : [], [all, ctx?.home, ctx?.opp]); // eslint-disable-line react-hooks/exhaustive-deps
  const opps = useMemo(() => [...new Set(all.map(g => g.opp).filter(o => o && o !== '?'))].sort(), [all]);

  if (log.isLoading) return <Loading label={`Cargando los partidos de ${player.name}…`} />;
  if (log.error) return <ErrorBox error={log.error} />;
  if (!all.length) return <Empty>No hay partidos registrados de {player.name}</Empty>;

  const M = BASKET_MARKETS[market];
  const event = game ? `${game.away.abbr} @ ${game.home.abbr}` : `${team}${opp ? ` vs ${opp}` : ''}`;
  const betOf = (s: SideValue) => ({
    league: LEAGUE_NAME[player.league], event, market: `${M.label} · ${player.name}`, selection: `${SIDE_LABEL[s.side]} de ${L}`, odds: s.price, bookmaker: s.book || book
  });

  const cs = log.data!.currentSeason;
  // ESPN numera la temporada por el año en que acaba (2027 = 26-27) y la Euroliga por el que empieza (2026 = 26-27)
  const espn = player.league === 'nba' || player.league === 'wnba';
  const seasonLabel = (y: number) => espn ? `${String(y - 1).slice(2)}-${String(y).slice(2)}` : `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
  let base = all.filter(g => g.type === 'reg' && g.season === cs), label = seasonLabel(cs);
  if (!base.length) { base = all.filter(g => g.type === 'reg' && g.season === cs - 1); label = seasonLabel(cs - 1); }
  const avg = (f: (g: BasketLogGame) => number) => (base.length ? base.reduce((s, g) => s + f(g), 0) / base.length : null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-surface p-4">
        {player.headshot && <img src={player.headshot} alt="" className="h-16 w-16 rounded-full bg-zinc-800 object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
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
      {!!casa.length && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 text-zinc-500">En las casas:</span>
          {casa.slice().sort((x, y) => x.line - y.line).map(c => (
            <button key={c.line} onClick={() => useLine(c)} title={`Más ${odd(c.over)} (${c.overBook ?? '–'}) · Menos ${odd(c.under)} (${c.underBook ?? '–'})`}
              className={cn(chip(L === c.line), 'font-mono tnum')}>
              {c.line} <span className="text-zinc-500">{odd(c.over)} / {odd(c.under)}</span>
            </button>
          ))}
        </div>
      )}

      {!R ? <Empty>Escribe una línea válida (por ejemplo 24,5)</Empty> : <>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
          <ValuePanel bank={bank}
            v={{ line: L!, pOver: R.pOver, pUnder: R.pUnder, pPush: R.pPush, fairOver: R.fairOver, fairUnder: R.fairUnder, margin: R.market.margin, exact: R.market.exact, sides: R.sides, rel: R.rel, verdict: R.verdict }}
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
            <LastGames games={all} market={market} line={L!} mu={R.mu} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
          <Card className="overflow-hidden" title="Tramos">
            <table className="-m-5 w-[calc(100%+2.5rem)]">
              <thead className="bg-zinc-900/60"><tr><th className={th}>Tramo</th><th className={th + ' text-right'}>PJ</th><th className={th + ' text-right'}>Media</th><th className={th + ' text-right'}>Min</th><th className={th + ' text-right'}>% Más</th></tr></thead>
              <tbody className="divide-y divide-zinc-800/70">
                {R.splits.map(s => (
                  <tr key={s.label}><td className={td}>{s.label}</td><td className={td + ' text-right tabular-nums text-zinc-400'}>{s.n}</td><td className={td + ' text-right tabular-nums'}>{fx(s.avg)}</td>
                    <td className={td + ' text-right tabular-nums text-zinc-400'}>{fx(s.min)}</td>
                    <td className={cn(td, 'text-right tabular-nums', s.hit != null && (s.hit >= 0.6 ? 'text-emerald-400' : s.hit <= 0.4 ? 'text-rose-400' : ''))}>{s.n ? pct(s.hit!) : '–'}</td></tr>
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

const Lbl = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-zinc-400">{label}</span>{children}</label>
);

// Últimos 20 partidos frente a la línea: verde si superó, rojo si no
function LastGames({ games, market, line, mu }: { games: BasketLogGame[]; market: BasketMarket; line: number; mu: number }) {
  const M = BASKET_MARKETS[market];
  let list = games.filter(g => g.type !== 'pre');
  if (list.length < 3) list = games;
  const data = list.slice(0, 20).reverse().map(g => ({ x: `${g.home ? '' : '@'}${g.opp}`, date: shortDate(g.date), v: M.f(g) }));
  const hits = data.filter(d => d.v > line).length;
  return (
    <Card title={`${M.label}: últimos ${data.length}`} action={<span className={cn('text-xs font-semibold', hits / data.length >= 0.6 ? 'text-emerald-400' : hits / data.length <= 0.4 ? 'text-rose-400' : 'text-zinc-400')}>Más de {line} en {hits}/{data.length}</span>}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#2b3034" vertical={false} />
            <XAxis dataKey="x" stroke="#85948f" fontSize={10} tickLine={false} axisLine={false} interval={0} />
            <YAxis stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: '#2b303488' }} contentStyle={{ background: '#191c22', border: '1px solid #3b4a45', borderRadius: 2, fontSize: 12 }}
              labelStyle={{ color: '#9aaaa4' }} labelFormatter={(_, p) => p?.[0] ? `${p[0].payload.date} ${p[0].payload.x}` : ''} formatter={v => [v, M.short]} />
            <ReferenceLine y={line} stroke="var(--acc-400)" strokeDasharray="4 4" />
            <ReferenceLine y={mu} stroke="#9aaaa4" strokeDasharray="2 4" />
            <Bar dataKey="v" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.v > line ? '#55f28c' : d.v < line ? '#ff8a7f' : '#85948f'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-zinc-500"><span><span className="text-amber-400">- -</span> línea {line}</span><span><span className="text-zinc-300">··</span> proyección {fx(mu)}</span></div>
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
