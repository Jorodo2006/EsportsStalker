// Escáner de líneas: se elige un mercado y una línea (por ejemplo Más de 2,5 asistencias) y salen los jugadores de los partidos
// elegidos, primero los más rentables, con su cuota si las casas tienen esa línea. Lo que paga menos de la cuota mínima no sale.
// Usa el mismo cálculo que el analizador.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useApp } from '@/lib/app-context';
import { cn, odd, pct } from '@/lib/format';
import { gameCtx, teamGamesOf } from '@/lib/basket-context';
import { freshKeyOuts, matesOut } from '@/lib/basket-mates';
import { BASKET_MARKETS, fmtLine, missedByPlayer, parseLine, playerLines, playerOut, scanLine, type BasketMarket } from '@/lib/basket-model';
import { LEAN_EV, SIDE_LABEL, type Side } from '@/lib/value';
import type { BasketGame, BasketInjury, BasketSide, BasketTeamLogs } from '@/lib/types';
import { LEAGUE_NAME, badInjury, esTime, type Picked } from './BasketAnalyzer';
import { targetOfGame } from './BasketOdds';
import { BookIcon } from './BookIcon';
import { restart } from './BasketPoints';
import { Toggle } from './sport';
import { Badge, Empty, Input, Select, th } from './ui';
import { ReliabilityMeter } from './ValuePanel';
import { Panel, TvTabs, panel, tdc } from './viz';
import { gameMinutes } from '@/lib/basket-leagues';

const PREFS = 'basket-scan';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
const rateCls = (h: { won: number; n: number }) => (!h.n ? 'text-zinc-600' : h.won / h.n >= 0.6 ? 'text-emerald-400' : h.won / h.n <= 0.4 ? 'text-rose-400' : 'text-zinc-300');

type SortKey = 'p' | 'ev' | 'rel' | 'mu';
const SORTS: { value: SortKey; label: string }[] = [{ value: 'ev', label: 'Rentabilidad (EV)' }, { value: 'p', label: 'Probabilidad' }, { value: 'rel', label: 'Fiabilidad' }, { value: 'mu', label: 'Proyección' }];
// 1 = sin mínimo. Una cuota de 1,11 arriesga mucho para ganar casi nada
const MIN_ODDS = [1, 1.3, 1.5, 1.7, 2, 2.5];
const PAGE = 50;

type Row = NonNullable<ReturnType<typeof scanLine>> & {
  key: string; player: BasketTeamLogs['players'][number]; game: BasketGame; team: BasketSide; opp: BasketSide; home: boolean;
  injury: string | null; miss: number; out: boolean; book?: string; near: { line: number; over?: number; under?: number } | null;
};

export function BasketLineScanner({ games, injuries, onPick }: { games: BasketGame[]; injuries: BasketInjury[]; onPick: (p: Picked) => void }) {
  const { addToSlip } = useApp();
  const prefs = useMemo(loadPrefs, []);
  const [market, setMarket] = useState<BasketMarket>(prefs.market in BASKET_MARKETS ? prefs.market : 'ast');
  const [side, setSide] = useState<Side>(prefs.side === 'under' ? 'under' : 'over');
  const [line, setLine] = useState<string>(typeof prefs.line === 'string' ? prefs.line : '4,5');
  const [minMin, setMinMin] = useState<number>(typeof prefs.minMin === 'number' ? prefs.minMin : 15);
  const [minOdds, setMinOdds] = useState<number>(MIN_ODDS.includes(prefs.minOdds) ? prefs.minOdds : 1.5);
  const [sort, setSort] = useState<SortKey>(SORTS.some(s => s.value === prefs.sort) ? prefs.sort : 'ev');
  const [onlyOdds, setOnlyOdds] = useState(false);
  const [hideOut, setHideOut] = useState(true);
  const [all, setAll] = useState(false);
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ market, side, line, minMin, minOdds, sort })); } catch { /* sin almacenamiento */ } }, [market, side, line, minMin, minOdds, sort]);

  const teams = useMemo(() => games.flatMap(g => [{ game: g, team: g.away, home: false, opp: g.home }, { game: g, team: g.home, home: true, opp: g.away }]), [games]);
  const logs = useQueries({
    queries: teams.map(t => ({
      queryKey: ['basket', 'teamLogs', t.game.league, t.team.id], queryFn: () => window.api.basket.teamLogs(t.game.league, t.team.id), staleTime: 15 * 60e3, retry: 1
    }))
  });
  // La misma clave que la ficha del partido: comparten las cuotas ya leídas. Mirar muchos partidos no es abrirlos: quiet
  const oddsQ = useQueries({
    queries: games.map(g => { const t = targetOfGame(g); return { queryKey: ['odds', t.sport, t.id], queryFn: () => window.api.odds.match(t.match, { quiet: true }), refetchInterval: 60_000 }; })
  });
  const logsKey = logs.map(q => q.dataUpdatedAt).join(), oddsKey = oddsQ.map(q => q.dataUpdatedAt).join();

  // Las líneas de las casas de cada jugador sólo cambian con las cuotas, no al escribir
  const linesOf = useMemo(() => {
    const out = new Map<string, ReturnType<typeof playerLines>>();
    teams.forEach((t, i) => {
      const odds = oddsQ[games.indexOf(t.game)]?.data;
      if (odds) for (const p of logs[i]?.data?.players ?? []) out.set(`${t.game.id}:${p.id}`, playerLines(odds, p.name));
    });
    return out;
  }, [logsKey, oddsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const L = useDeferredValue(parseLine(line));
  const { rows, hidden, shortMin, lowOdds } = useMemo(() => {
    const out: Row[] = [];
    let hidden = 0, shortMin = 0, lowOdds = 0;
    if (L == null) return { rows: out, hidden, shortMin, lowOdds };
    for (let i = 0; i < teams.length; i++) {
      const t = teams[i], data = logs[i]?.data;
      if (!data) continue;
      const missed = missedByPlayer(data);
      const sched = teamGamesOf(data, t.team.id);
      const statusOf = (id: string, roster: string | null | undefined) => (t.game.league === 'nba' ? injuries.find(x => x.playerId === id)?.status : null) || roster;
      const fresh = freshKeyOuts(matesOut(data, t.team.id, '', t.game.date, statusOf, gameMinutes(t.game.league)));
      for (const p of data.players) {
        const ctx = { currentSeason: data.currentSeason, home: t.home, opp: t.opp.abbr, injury: statusOf(p.id, p.injury) ?? null, matesOut: fresh.filter(m => m.id !== p.id).map(m => m.name), ...gameCtx(p.games, sched, t.game.date, t.team.id) };
        const book = linesOf.get(`${t.game.id}:${p.id}`)?.[BASKET_MARKETS[market].label] ?? [];
        const exact = book.find(b => b.line === L);
        const r = scanLine(p.games, market, L, side, ctx, { over: exact?.over, under: exact?.under, books: exact ? Object.values(exact.books) : undefined });
        if (!r || r.played < 3) continue;
        const miss = missed.get(p.id) ?? 0;
        // Con la línea de otra casa a la vista se sabe qué pagan aunque no sea exactamente la pedida
        const near = exact ? null : book.slice().sort((a, b) => Math.abs(a.line - L) - Math.abs(b.line - L))[0] ?? null;
        out.push({
          key: `${t.game.id}:${p.id}`, player: p, ...r, game: t.game, team: t.team, opp: t.opp, home: t.home, injury: ctx.injury, miss,
          out: playerOut(ctx.injury, miss),
          book: side === 'over' ? exact?.overBook : exact?.underBook, near
        });
      }
    }
    const shown = out.filter(r => {
      if (hideOut && r.out) { hidden++; return false; }
      if (r.projMin < minMin) { shortMin++; return false; }
      if (onlyOdds && !r.value) return false;
      // Sin cuota de la casa se mira la justa: si la justa ya es baja, lo que paguen será menos todavía
      if ((r.value?.price ?? r.fair) < minOdds) { lowOdds++; return false; }
      return true;
    });
    // Sin cuotas todos empatan en valor y quedan por probabilidad
    const val = (r: Row) => (sort === 'p' ? r.p : sort === 'ev' ? r.value?.ev ?? -Infinity : sort === 'rel' ? r.rel.score : r.mu);
    shown.sort((a, b) => val(b) - val(a) || b.p - a.p);
    return { rows: shown, hidden, shortMin, lowOdds };
  }, [logsKey, linesOf, market, L, side, minMin, minOdds, sort, onlyOdds, hideOut, injuries, teams]); // eslint-disable-line react-hooks/exhaustive-deps

  const M = BASKET_MARKETS[market];
  const loaded = logs.filter(q => q.data).length, failed = logs.find(q => q.error);
  const list = all ? rows : rows.slice(0, PAGE);
  const oneGame = games.length === 1;
  const onLine = (v: string) => { const s = v.trim()[0]; if (s === '+') setSide('over'); else if (s === '-') setSide('under'); setLine(v); };

  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn(panel, 'flex flex-col gap-2.5 px-3.5 py-2.5')}>
        <div className="flex flex-wrap items-center gap-2">
          <TvTabs value={side} onChange={setSide} items={[{ value: 'over', label: 'Más de' }, { value: 'under', label: 'Menos de' }]} />
          <Input aria-label="Línea" autoFocus inputMode="decimal" className="h-7 w-20 text-center font-semibold lg:h-7" placeholder="2,5" value={line} onChange={e => onLine(e.target.value)} />
          <span className="text-[14px] font-semibold text-zinc-100">{M.label}</span>
        </div>
        <TvTabs value={market} onChange={setMarket} items={(Object.keys(BASKET_MARKETS) as BasketMarket[]).map(k => ({ value: k, label: BASKET_MARKETS[k].short, title: BASKET_MARKETS[k].label }))} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-zinc-400">
          <label className="flex items-center gap-2">Ordenar por<Select className="h-7 w-44 text-xs lg:h-7 lg:text-xs" value={sort} onChange={e => setSort(e.target.value as SortKey)}>{SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></label>
          <label className="flex items-center gap-2" title="Fuera lo que paga menos. Si la casa no tiene esa línea, se mira la cuota justa">Cuota mínima<Select className="h-7 w-28 text-xs lg:h-7 lg:text-xs" value={minOdds} onChange={e => setMinOdds(Number(e.target.value))}>{MIN_ODDS.map(m => <option key={m} value={m}>{m === 1 ? 'Sin mínimo' : odd(m).replace('.', ',')}</option>)}</Select></label>
          <label className="flex items-center gap-2" title="Minutos previstos según sus últimos partidos">Minutos, al menos<Select className="h-7 w-20 text-xs lg:h-7 lg:text-xs" value={minMin} onChange={e => setMinMin(Number(e.target.value))}>{[0, 10, 15, 20, 25, 30].map(m => <option key={m} value={m}>{m}</option>)}</Select></label>
          <Toggle on={hideOut} onChange={setHideOut} label="Ocultar bajas" />
          <Toggle on={onlyOdds} onChange={setOnlyOdds} label="Sólo con cuota" />
        </div>
      </div>

      {failed && restart(failed.error)}
      {loaded < teams.length && !failed && (
        <div className={cn(panel, 'px-3.5 py-2')} role="status">
          <div className="mb-1.5 text-[13px] text-zinc-400">Leyendo los partidos de los jugadores: {loaded} de {teams.length} equipos. La primera vez tarda algo más.</div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${(loaded / Math.max(1, teams.length)) * 100}%` }} /></div>
        </div>
      )}

      {L == null ? <Empty>Escribe una línea, por ejemplo 2,5.</Empty> : !rows.length ? (
        loaded < teams.length ? null : <Empty>Ningún jugador cumple esos filtros. {onlyOdds ? 'Prueba sin «Sólo con cuota»: las casas pueden no tener esta línea.' : lowOdds ? 'Prueba a bajar la cuota mínima o con otra línea.' : 'Prueba con menos minutos.'}</Empty>
      ) : (
        <Panel title={`${SIDE_LABEL[side]} de ${fmtLine(L)}: ${M.label.toLowerCase()}`} aside={`${rows.length} jugadores, ${sort === 'p' || (sort === 'ev' && !rows.some(r => r.value)) ? 'de más a menos probabilidad' : sort === 'ev' ? 'primero los más rentables' : `por ${SORTS.find(s => s.value === sort)!.label.toLowerCase()}`}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px]">
              <thead className="bg-zinc-900/60"><tr>
                <th className={th + ' w-8 text-right'}>#</th><th className={th}>Jugador</th>{!oneGame && <th className={th}>Partido</th>}
                <th className={th + ' text-right'} title="Proyección del modelo y minutos previstos">Proyección</th>
                <th className={th + ' w-36'} title="Probabilidad estimada de que se cumpla">Probabilidad</th>
                <th className={th + ' text-right'} title="La cuota a la que la apuesta no ganaría ni perdería a la larga">Justa</th>
                <th className={th + ' text-right'}>Últ. 5</th><th className={th + ' text-right'}>Últ. 10</th><th className={th + ' text-right'} title="Veces que se cumplió esta temporada">Temp.</th>
                <th className={th} title="Muestra, regularidad, minutos estables y margen sobre la línea">Fiabilidad</th>
                <th className={th + ' text-right'} title="La mejor cuota de las casas para esta línea. Clic: al cupón">Cuota</th><th className={th + ' text-right'} title="Valor esperado con esa cuota, mezclando el modelo con la casa sin margen">EV</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-800/50">
                {list.map((r, i) => (
                  <tr key={r.key} onClick={() => onPick({ id: r.player.id, name: r.player.name, league: r.game.league, headshot: r.player.headshot, teamId: r.team.id, game: r.game, market, line: L })} className="cursor-pointer hover:bg-zinc-800/30">
                    <td className={tdc + ' text-right text-zinc-500 tnum'}>{i + 1}</td>
                    <td className={tdc}>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        {r.player.headshot ? <img src={r.player.headshot} alt="" loading="lazy" className="h-6 w-6 shrink-0 rounded-full bg-zinc-800 object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="h-6 w-6 shrink-0 rounded-full bg-zinc-800" />}
                        <button className="cursor-pointer font-medium hover:text-amber-300" title="Ver su análisis">{r.player.name}</button>
                        {r.injury && <Badge tone={badInjury(r.injury) ? 'danger' : 'warning'}>{r.injury}</Badge>}
                        {r.miss > 0 && <span title={`No jugó los últimos ${r.miss} partidos de su equipo`}><Badge tone={r.miss >= 3 ? 'danger' : 'warning'}>Sin jugar: {r.miss}</Badge></span>}
                      </span>
                    </td>
                    {!oneGame && <td className={tdc + ' whitespace-nowrap'}><span className="font-medium">{r.team.abbr}</span> <span className="text-zinc-500">{r.home ? 'vs' : '@'}</span> {r.opp.abbr}<span className="ml-2 text-[11px] text-zinc-500" title={LEAGUE_NAME[r.game.league]}>{esTime(r.game.date)}</span></td>}
                    <td className={tdc + ' whitespace-nowrap text-right tnum'}><span className="font-semibold">{r.mu.toFixed(1).replace('.', ',')}</span> <span className="text-[11px] text-zinc-500">{Math.round(r.projMin)} min</span></td>
                    <td className={tdc}>
                      <span className="flex items-center gap-2">
                        <span className="w-12 text-right font-score text-[16px] font-bold tnum">{pct(r.p)}</span>
                        <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${r.p * 100}%` }} /></span>
                      </span>
                    </td>
                    <td className={tdc + ' text-right text-zinc-300 tnum'}>{odd(r.fair)}</td>
                    <td className={cn(tdc, 'text-right tnum', rateCls(r.last5))}>{r.last5.won}/{r.last5.n}</td>
                    <td className={cn(tdc, 'text-right tnum', rateCls(r.last10))}>{r.last10.won}/{r.last10.n}</td>
                    <td className={cn(tdc, 'text-right tnum', rateCls(r.season))}>{r.season.n ? `${r.season.won}/${r.season.n}` : '–'}</td>
                    <td className={tdc}><ReliabilityMeter rel={r.rel} compact /></td>
                    <td className={tdc + ' text-right'}>
                      {r.value ? (
                        <button onClick={e => { e.stopPropagation(); addToSlip({ sport: 'basket', status: 'pending', league: LEAGUE_NAME[r.game.league], event: `${r.game.away.abbr} @ ${r.game.home.abbr}`, market: `${M.label} · ${r.player.name}`, selection: `${SIDE_LABEL[side]} de ${L}`, odds: r.value!.price, bookmaker: r.book, ref: { sport: 'basket', match: r.game.id, start: r.game.date, key: `player|${M.label}|${r.player.name.toLowerCase()}|${L}`, out: side } }); }}
                          title={`${r.book ?? ''}: añadir al cupón (otra vez para quitarla)`} className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-zinc-800/70 px-2 text-sm font-semibold tnum transition hover:bg-zinc-700">
                          {r.book && <BookIcon name={r.book} size={14} />}{odd(r.value.price)}
                        </button>
                      ) : r.near ? (
                        <span className="whitespace-nowrap text-xs text-zinc-500" title={`Las casas tienen otra línea: ${fmtLine(r.near.line)} (Más ${odd(r.near.over)} · Menos ${odd(r.near.under)})`}>línea {fmtLine(r.near.line)}</span>
                      ) : <span className="text-zinc-700">–</span>}
                    </td>
                    <td className={cn(tdc, 'text-right font-medium tnum', !r.value ? 'text-zinc-700' : r.value.ev >= LEAN_EV ? 'text-emerald-400' : r.value.ev < 0 ? 'text-rose-400' : 'text-zinc-300')}>{r.value ? `${r.value.ev > 0 ? '+' : ''}${pct(r.value.ev)}` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PAGE && <button onClick={() => setAll(!all)} className="w-full cursor-pointer border-t border-zinc-800/60 py-1.5 text-xs text-zinc-500 hover:text-zinc-200">{all ? `Ver sólo los ${PAGE} primeros` : `Ver los ${rows.length}`}</button>}
        </Panel>
      )}
      <div className="flex flex-col gap-1 px-1 text-xs text-zinc-500">
        {(hidden > 0 || shortMin > 0 || lowOdds > 0) && <p>{hidden > 0 && `${hidden} ocultos por baja o por no jugar los últimos 3 partidos de su equipo. `}{shortMin > 0 && `${shortMin} ocultos por jugar menos de ${minMin} minutos. `}{lowOdds > 0 && `${lowOdds} ocultos por pagar menos de ${odd(minOdds).replace('.', ',')} (sin cuota de la casa, por tener una justa menor).`}</p>}
        <p>Probabilidad del modelo, la misma que en Valor de jugador. Cuidado con los primeros de la lista: en la NBA (25-26) el 1.º de cada jornada decía un 77 % y se cumplió un 71 %, y los 5 primeros, un 68 % y un 63 %. En robos y tapones se desvía más. Las bajas de los compañeros no cambian la proyección: si son nuevas, bajan la fiabilidad de los «menos».</p>
        <p>Una probabilidad alta no quiere decir que la apuesta valga la pena: eso lo dice el EV, que mezcla el modelo con la casa sin margen. Si no hay cuota de la casa, la columna Justa es lo mínimo que tendrían que pagar para que saliera rentable.</p>
      </div>
    </div>
  );
}
