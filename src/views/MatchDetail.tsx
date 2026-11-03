import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, ChevronDown, ChevronsDownUp, ChevronsUpDown, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useApp, useRefreshMs } from '@/lib/app-context';
import { cn, fmtDay, fmtTime, groupBy, k, odd, pct, summarize } from '@/lib/format';
import type { AutoJob, EventDetails, LiveSide, MarketLine, MatchEvent, TeamForm, TeamRef } from '@/lib/types';
import { MIN_GAMES, analyzeLine, estimate, findPlayer, mapWinA, parseStat } from '@/lib/edge';
import { SIDE_LABEL, VERDICT_LABEL, type SideValue, type ValueData } from '@/lib/value';
import { ReliabilityMeter, ValuePanel, VerdictBadge } from '@/components/ValuePanel';
import { Badge, Button, Empty, ErrorBox, Loading, td, th } from '@/components/ui';
import { BookHead, BookIcon } from '@/components/BookIcon';
import { Scoreboard, SheetTabs } from '@/components/sport';

const DRAGONS: Record<string, string> = {
  ocean: 'Océano', infernal: 'Infernal', cloud: 'Nube', mountain: 'Montaña', hextech: 'Hextech', chemtech: 'Quimtec', elder: 'Ancestral'
};

export default function MatchDetail({ match, onClose }: { match: MatchEvent; onClose: () => void }) {
  const { go, openBet } = useApp();
  const done = match.state === 'completed';
  const [tab, setTab] = useState<'odds' | 'game'>(done ? 'game' : 'odds');
  const { data: ev, error, isLoading } = useQuery({
    queryKey: ['event', match.id], queryFn: () => window.api.esports.eventDetails(match.id), refetchInterval: 30_000
  });
  const games = ev?.games.filter(g => g.state !== 'unneeded') ?? [];
  const [gameId, setGameId] = useState<string>();
  useEffect(() => {
    if (gameId || !games.length) return;
    const cur = games.find(g => g.state === 'inProgress') || games.filter(g => g.state === 'completed').pop() || games[0];
    setGameId(cur.id);
  }, [games, gameId]);
  const [a, b] = match.teams;
  const game = games.find(g => g.id === gameId);
  const eventName = `${a.code || a.name} vs ${b.code || b.name}`;

  return (
    <div>
      <button onClick={onClose} className="mb-4 flex cursor-pointer items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-100">
        <ArrowLeft size={16} />Volver a partidos
      </button>
      <div className="mb-5">
        <Scoreboard competition={match.league} detail={[match.blockName, match.bestOf ? `al mejor de ${match.bestOf}` : ''].filter(Boolean).join(', ')}
          state={match.state === 'inProgress' ? 'live' : match.state === 'completed' ? 'post' : 'pre'}
          a={{ name: a.name, short: a.code, logo: a.image, score: ev?.teams[0]?.wins ?? a.wins ?? 0 }}
          b={{ name: b.name, short: b.code, logo: b.image, score: ev?.teams[1]?.wins ?? b.wins ?? 0 }}
          center={fmtTime(match.startTime)}
          centerSub={match.state === 'unstarted' ? fmtDay(match.startTime) : match.state === 'inProgress' ? 'En juego' : 'Final'}>
          <SheetTabs value={tab} onChange={setTab} items={[['odds', 'Cuotas'], ['game', 'Partida en vivo']]} right={<>
            {[a, b].map(t => (
              <Button key={t.name} variant="ghost" size="sm" onClick={() => go('players', `${t.name}|${t.code}`)}>
                <BarChart3 size={14} />Stats {t.code}
              </Button>
            ))}
            <Button size="sm" onClick={() => openBet({ league: match.league, event: eventName })}><Plus size={14} />Apuesta</Button>
          </>} />
        </Scoreboard>
      </div>

      {tab === 'odds' ? <OddsPanel match={match} eventName={eventName} /> : (
        isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : !ev ? <Empty>Sin detalles para este partido</Empty> : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {games.map(g => (
                <button key={g.id} onClick={() => setGameId(g.id)}
                  className={cn('flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                    g.id === gameId ? 'border-amber-500/60 bg-amber-500/10 text-amber-300' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200')}>
                  Mapa {g.number}
                  {g.state === 'inProgress' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />}
                  {g.state === 'completed' && <span className="text-zinc-500">✓</span>}
                </button>
              ))}
            </div>
            {!game ? <Empty>El partido aún no tiene partidas</Empty>
              : game.state === 'unstarted' ? <Empty>Esta partida aún no ha empezado</Empty>
                : <GameStats key={game.id} gameId={game.id} live={game.state === 'inProgress'} teams={ev.teams} />}
          </>
        )
      )}
    </div>
  );
}

// ---------- Comparador de cuotas ----------
type Section = 'all' | 'match' | `map${number}` | 'players' | 'special' | 'other';
const sectionOf = (m: MarketLine): Section =>
  m.period === 0 ? 'match' : m.period === 98 ? 'players' : m.period === 99 ? 'special' : m.period === 50 ? 'other' : `map${m.period}`;
const SECTION_LABEL = (s: Section) =>
  s === 'all' ? 'Todo' : s === 'match' ? 'Partido' : s === 'players' ? 'Jugadores' : s === 'special' ? 'Especiales' : s === 'other' ? 'Otros' : `Mapa ${s.slice(3)}`;

const DEFAULT_FEATURED = 'Winamax,Betway';
const normBook = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '');
const SECTION_ORDER: Section[] = ['match', 'map1', 'map2', 'map3', 'map4', 'map5', 'players', 'other', 'special'];
// add = true: va directa al boleto de combinada (clic derecho o Mayús+clic)
type Pick = (market: string, sel: string, bk: string, price: number, add?: boolean) => void;

// Barra de las casas: estado de cada una y el botón que trae las cuotas con la extensión de Chrome
function BooksBar({ a, b, books, sources, updatedAt, fetching, onPaste }: {
  a: TeamRef; b: TeamRef; books: string[]; sources: Record<string, { ok: boolean; msg: string }>;
  updatedAt: number; fetching: boolean; onPaste: () => void;
}) {
  const { go, toast } = useApp();
  const [job, setJob] = useState<AutoJob | null>(null);
  // Progreso del trabajo propio y también de las lecturas programadas de este partido
  useEffect(() => window.api.onOddsAuto(j => setJob(cur => {
    if (cur && cur.id === j.id) return j;
    const mine = j.match.a.name === a.name && j.match.b.name === b.name;
    return mine && j.source === 'auto' && !(cur && !cur.done) ? j : cur;
  })), [a.name, b.name]);
  const running = !!job && !job.done;
  async function start() {
    try { setJob(await window.api.odds.auto({ a: { name: a.name, code: a.code }, b: { name: b.name, code: b.code } })); }
    catch (e) { toast((e as Error).message); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {books.map(name => {
        const st = sources[name];
        const step = job?.steps[normBook(name)];
        const busy = running && step && (step.estado === 'esperando' || step.estado === 'buscando' || step.estado === 'leyendo');
        const failed = step?.estado === 'error';
        return (
          <span key={name} title={step?.msg || st?.msg || 'Sin cuotas todavía'}
            className={cn('inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium',
              failed ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
                : st?.ok ? 'border-zinc-800 bg-zinc-900 text-zinc-200' : 'border-dashed border-zinc-800 text-zinc-500')}>
            {busy ? <Loader2 size={12} className="animate-spin text-amber-400" />
              : <BookIcon name={name} size={16} className={cn(!st?.ok && 'opacity-40 grayscale')} />}
            {name}
            {!busy && <span className={cn('h-1.5 w-1.5 rounded-full', failed ? 'bg-rose-400' : st?.ok ? 'bg-emerald-400' : 'bg-zinc-600')} />}
            {busy && step?.msg && <span className="max-w-40 truncate font-normal text-zinc-500">{step.msg}</span>}
          </span>
        );
      })}
      {!!job?.error && /lector/.test(job.error) && (
        <span className="text-xs text-rose-400">
          El lector de cuotas no responde: ejecuta <code>npm run backend</code>{' '}
          <button className="cursor-pointer text-amber-400 hover:underline" onClick={() => go('settings')}>Ajustes</button>
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-zinc-500">{updatedAt ? `Actualizado ${fmtTime(updatedAt)}` : ''}{fetching && ' · …'}</span>
        <button className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300" onClick={onPaste} title="Si el marcador no pudo enviarlas, las copia al portapapeles">
          Pegar del marcador
        </button>
        <Button size="sm" disabled={running} onClick={start} className="h-8 px-3">
          <RefreshCw size={14} className={cn(running && 'animate-spin')} />{running ? 'Actualizando…' : 'Actualizar cuotas'}
        </Button>
      </div>
    </div>
  );
}

function OddsPanel({ match, eventName }: { match: MatchEvent; eventName: string }) {
  const { openBet, addToSlip, settings, toast } = useApp();
  const refreshMs = useRefreshMs();
  const [a, b] = match.teams;
  const [section, setSection] = useState<Section>('all');
  const [mainOnly, setMainOnly] = useState(true);
  // Mercados plegados (se recuerdan entre partidos por nombre de mercado, sin el mapa)
  const [closed, setClosed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('oddsClosed') || '[]')); } catch { return new Set(); }
  });
  const saveClosed = (next: Set<string>) => { setClosed(next); try { localStorage.setItem('oddsClosed', JSON.stringify([...next])); } catch { /* sin almacenamiento */ } };
  const toggle = (id: string) => { const n = new Set(closed); if (n.has(id)) n.delete(id); else n.add(id); saveClosed(n); };
  const { data, error, isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ['odds', match.id],
    queryFn: () => window.api.odds.match({ a: { name: a.name, code: a.code }, b: { name: b.name, code: b.code }, start: match.startTime }),
    refetchInterval: match.state === 'inProgress' ? 15_000 : refreshMs
  });
  // Cuotas que llegan desde el marcador o la extensión
  useEffect(() => window.api.onOddsImported(() => { refetch(); }), [refetch]);
  // Forma de los jugadores (Leaguepedia) para estimar el valor de las líneas de jugador; sólo si hay líneas
  const hasLines = !!data?.markets.some(isPlayerLine);
  const formOf = (t: TeamRef) => ({
    queryKey: ['teamForm', t.name, t.code], enabled: hasLines, staleTime: 3600e3, retry: false,
    queryFn: () => window.api.stats.teamForm ? window.api.stats.teamForm(t.name, t.code) : Promise.reject(new Error('Reinicia la app para cargar la forma de los jugadores'))
  });
  const formA = useQuery(formOf(a)), formB = useQuery(formOf(b));
  const value: ValueCtx = {
    forms: [formA.data, formB.data], markets: data?.markets ?? [], bestOf: match.bestOf,
    loading: formA.isLoading || formB.isLoading, error: (formA.error || formB.error)?.message
  };
  async function pasteMarcador() {
    try {
      const r = await window.api.marcador.paste({ a: { name: a.name, code: a.code }, b: { name: b.name, code: b.code } });
      toast(`Cuotas importadas${r.partido ? ` (${r.partido})` : ''}`);
      refetch();
    } catch (e) { toast((e as Error).message); }
  }

  // Casas en el orden de Ajustes (las que aún no han mandado nada también salen, para ver qué falta)
  const featured = (settings?.featuredBooks || DEFAULT_FEATURED).split(',').map(x => x.trim()).filter(Boolean);
  const books = useMemo(() => {
    const got = data?.books ?? [];
    const ordered = featured.map(f => got.find(g => normBook(g).startsWith(normBook(f))) ?? f);
    return [...new Set([...ordered, ...got])];
  }, [data, settings?.featuredBooks]);
  const priced = useMemo(() => books.filter(bk => data?.books.includes(bk)), [books, data]);

  const visible = useMemo(() => (data?.markets ?? []).filter(m => m.outcomes.some(o => priced.some(bk => o.prices[bk]))), [data, priced]);
  const groups = useMemo(() => [...new Set(visible.filter(m => !isPlayerLine(m)).map(m => shortGroup(m.group)))].concat('__jugadores'), [visible]);
  const allClosed = groups.every(g => closed.has(g));
  const sections = useMemo(() => {
    const set = new Set(visible.map(sectionOf));
    return SECTION_ORDER.filter(x => set.has(x));
  }, [visible]);
  // Grupos donde ninguna casa marca línea principal: se enseñan enteros
  const groupsWithMain = useMemo(() => new Set(visible.filter(m => m.main).map(m => m.group)), [visible]);
  const shown = useMemo(() => visible.filter(m => !mainOnly || m.main || !groupsWithMain.has(m.group) || isPlayerLine(m)),
    [visible, mainOnly, groupsWithMain]);
  const hasAlt = visible.some(m => !m.main && groupsWithMain.has(m.group) && !isPlayerLine(m));
  const pick: Pick = (market, sel, bk, price, add) => add
    ? addToSlip({ league: match.league, event: eventName, market, selection: sel, bookmaker: bk, odds: price, status: 'pending' })
    : openBet({ league: match.league, event: eventName, market, selection: sel, bookmaker: bk, odds: price });

  if (match.state === 'completed') return <Empty>El partido ha terminado: ya no hay cuotas</Empty>;

  const bar = (
    <BooksBar a={a} b={b} books={books} sources={data?.sources ?? {}} updatedAt={data ? dataUpdatedAt : 0} fetching={isFetching} onPaste={pasteMarcador} />
  );
  if (isLoading) return <div className="space-y-4">{bar}<Loading label="Cargando cuotas…" /></div>;
  if (error) return <div className="space-y-4">{bar}<ErrorBox error={error} /></div>;

  const list = section === 'all' ? sections : sections.filter(s => s === section);
  return (
    <div className="space-y-4">
      {bar}
      {!visible.length ? (
        <Empty>
          Todavía no hay cuotas de este partido.<br />
          Pulsa <b>Actualizar cuotas</b>: el lector las trae de Winamax y Betway sin abrir Chrome. Si el partido empieza en las próximas horas, se leen solas cada pocos minutos.
        </Empty>
      ) : (
        <>
          <div className="sticky top-0 z-10 -mx-8 flex flex-wrap items-center gap-3 border-b border-zinc-800/70 bg-zinc-950/85 px-8 py-2.5 backdrop-blur">
            <div className="flex flex-wrap gap-1">
              {(['all', ...sections] as Section[]).map(s => (
                <button key={s} onClick={() => setSection(s)}
                  className={cn('cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition',
                    section === s ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100')}>
                  {SECTION_LABEL(s)}
                  <span className={cn('ml-1.5 tabular-nums', section === s ? 'text-zinc-950/60' : 'text-zinc-600')}>
                    {s === 'all' ? visible.length : visible.filter(m => sectionOf(m) === s).length}
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => saveClosed(allClosed ? new Set([...closed].filter(x => !groups.includes(x))) : new Set([...closed, ...groups]))}
              className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200">
              {allClosed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}{allClosed ? 'Desplegar todo' : 'Plegar todo'}
            </button>
            {hasAlt && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input type="checkbox" className="accent-amber-500" checked={!mainOnly} onChange={e => setMainOnly(!e.target.checked)} />
                Líneas alternativas
              </label>
            )}
          </div>
          {list.map(s => {
            const ms = shown.filter(m => sectionOf(m) === s);
            if (!ms.length) return null;
            return (
              <section key={s} className="space-y-3">
                {section === 'all' && <h3 className="pt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{SECTION_LABEL(s)}</h3>}
                {s === 'players' && <PlayerLines markets={ms.filter(isPlayerLine)} books={books} value={value} onPick={pick} open={!closed.has('__jugadores')} onToggle={() => toggle('__jugadores')} />}
                <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
                  {[...groupBy(ms.filter(m => !isPlayerLine(m)), m => m.group)].map(([group, lines]) => (
                    <MarketCard key={group} title={shortGroup(group)} group={group} lines={lines} books={books} onPick={pick}
                      open={!closed.has(shortGroup(group))} onToggle={() => toggle(shortGroup(group))} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

// "Mapa 1 · Total de kills" → "Total de kills" (la sección ya dice el mapa)
const shortGroup = (g: string) => g.replace(/^Mapa \d+ · /, '').replace(/^Jugadores · /, '');
const isPlayerLine = (m: MarketLine) => m.key.startsWith('player|');

// Mejor cuota de cada selección entre las casas visibles (sólo cuenta si hay al menos dos casas para comparar)
function bestOf(prices: Record<string, number>, books: string[]) {
  let bk = '', p = 0, n = 0;
  for (const k of books) { const v = prices[k]; if (v) n++; if (v && v > p) { p = v; bk = k; } }
  return { bk, p, n };
}

function OddButton({ price, best, onClick, title, className }: { price?: number; best?: boolean; onClick?: (add: boolean) => void; title?: string; className?: string }) {
  if (!price) return <span className={cn('grid h-8 place-items-center text-xs text-zinc-700', className)}>–</span>;
  return (
    <button onClick={e => onClick?.(e.shiftKey)} onContextMenu={e => { e.preventDefault(); onClick?.(true); }}
      title={title && title + ' · clic derecho: añadir a combinada'}
      className={cn('h-8 cursor-pointer rounded-md text-[13px] font-semibold tabular-nums transition',
        best ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/25'
          : 'bg-zinc-800/70 text-zinc-200 hover:bg-zinc-700', className)}>
      {odd(price)}
    </button>
  );
}

// Un mercado: selecciones en filas y una columna fija por casa (con su icono); la mejor cuota en verde.
// Se pliega pulsando la cabecera y los mercados largos se recortan.
function MarketCard({ title, group, lines, books, onPick, open, onToggle }: {
  title: string; group: string; lines: MarketLine[]; books: string[]; onPick: Pick; open: boolean; onToggle: () => void;
}) {
  const [all, setAll] = useState(false);
  const limit = 4;
  const list = all ? lines : lines.slice(0, limit);
  const best = lines.reduce((mx, l) => Math.max(mx, ...l.outcomes.flatMap(o => Object.values(o.prices))), 0);
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/40">
      <button onClick={onToggle} className={cn('flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left transition hover:bg-zinc-800/30', open && 'border-b border-zinc-800/60')}>
        <ChevronDown size={14} className={cn('shrink-0 text-zinc-500 transition-transform', !open && '-rotate-90')} />
        <h4 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100" title={group}>{title}</h4>
        {open ? <>
          <span className="w-11 text-right text-[10px] font-medium uppercase tracking-wider text-zinc-600" title="Probabilidad sin margen, con las mejores cuotas">Prob.</span>
          {books.map(bk => <BookHead key={bk} name={bk} className="w-[72px]" />)}
        </> : <span className="text-xs text-zinc-500">{lines.length > 1 ? `${lines.length} líneas` : ''}{best ? ` · hasta ${odd(best)}` : ''}</span>}
      </button>
      {open && <>
        <div className="divide-y divide-zinc-800/50">
          {list.map(l => {
            const bests = l.outcomes.map(o => bestOf(o.prices, books));
            const inv = bests.map(x => (x.p ? 1 / x.p : 0));
            const sum = inv.reduce((s, x) => s + x, 0);
            return (
              <div key={l.key} className="py-1">
                {l.outcomes.map((o, oi) => (
                  <div key={o.id} className="flex items-center gap-2 px-4 py-0.5 hover:bg-zinc-800/20">
                    <span className="min-w-0 flex-1 truncate pl-[22px] text-sm text-zinc-300" title={o.label}>{o.label}</span>
                    <span className="w-11 text-right text-xs tabular-nums text-zinc-500">{sum ? pct(inv[oi] / sum) : '–'}</span>
                    {books.map(bk => (
                      <OddButton key={bk} className="w-[72px]" price={o.prices[bk]} best={bests[oi].n > 1 && o.prices[bk] === bests[oi].p}
                        title={`${bk}: registrar apuesta`} onClick={add => onPick(group, o.label, bk, o.prices[bk], add)} />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {lines.length > limit && (
          <button onClick={() => setAll(v => !v)} className="w-full cursor-pointer border-t border-zinc-800/60 py-2 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800/30 hover:text-zinc-200">
            {all ? 'Ver menos' : `Ver ${lines.length - limit} líneas más`}
          </button>
        )}
      </>}
    </div>
  );
}

// Lo que hace falta para estimar el valor de las líneas de jugador
type ValueCtx = { forms: (TeamForm | undefined)[]; markets: MarketLine[]; bestOf: number | null; loading: boolean; error?: string };
type Value = { data: ValueData; best: SideValue; title: string } | { reason: string };
const VALUE_MIN = 0.03; // a partir de qué valor esperado se resalta una cuota

// Análisis de la línea con el mismo modelo de valor que la NBA (fiabilidad, margen, veredicto)
function lineValue(m: MarketLine, name: string, books: string[], ctx: ValueCtx): Value {
  const st = parseStat(m.key.split('|')[1]);
  if (!st || m.line == null) return { reason: 'Sólo se estiman líneas de un mapa' };
  if (ctx.loading) return { reason: 'Cargando la forma de los jugadores…' };
  if (ctx.error) return { reason: ctx.error };
  const hit = findPlayer(name, ctx.forms);
  if (!hit) return { reason: `${name} no aparece en las últimas partidas de Leaguepedia de estos equipos` };
  const games = hit.player.games;
  if (games.length < MIN_GAMES) return { reason: `Sólo ${games.length} partidas de ${name} con este equipo` };
  const pA = mapWinA(ctx.markets, st.map, ctx.bestOf);
  const pWin = pA == null ? null : hit.side === 0 ? pA : 1 - pA;
  const prices = { over: m.outcomes.find(x => x.id === 'over')?.prices ?? {}, under: m.outcomes.find(x => x.id === 'under')?.prices ?? {} };
  const data = analyzeLine(games, st.stat, m.line, pWin, prices, books);
  const best = data.sides.slice().sort((a, b) => b.ev - a.ev)[0];
  if (!best) return { reason: 'Sin cuotas' };
  const e = estimate(games, st.stat, m.line, pWin);
  const title = [
    `${hit.player.name}: media ${e.mean.toFixed(1)} en sus últimas ${e.n} partidas; superó ${m.line} en ${e.hits}`,
    pWin == null ? 'Sin cuota de ganador: no se ajusta por la probabilidad de ganar el mapa'
      : `Probabilidad de que su equipo gane el mapa ${st.map}: ${pct(pWin)} (cuotas sin margen)`,
    `Estimado: Más ${pct(data.pOver)} · Menos ${pct(data.pUnder)}${data.pPush > 0.001 ? ` · Nula ${pct(data.pPush)}` : ''}`,
    `Fiabilidad ${data.rel.score}/100 · ${VERDICT_LABEL[data.verdict.code]}`,
    'Pulsa la fila para ver el análisis completo'
  ].join('\n');
  return { data, best, title };
}

// Líneas de jugador (kills, asistencias, muertes): una tabla por estadística con Más / Menos de cada casa,
// la probabilidad estimada con las stats de los jugadores, el valor de la mejor cuota, la fiabilidad y el veredicto.
// Al pulsar una fila se abre el mismo panel de valor que en la sección NBA.
function PlayerLines({ markets, books, value, onPick, open, onToggle }: {
  markets: MarketLine[]; books: string[]; value: ValueCtx; onPick: Pick; open: boolean; onToggle: () => void;
}) {
  const { settings } = useApp();
  const { data: bets = [] } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  const bank = (settings?.initialBankroll || 0) + summarize(bets).profit;
  const stats = useMemo(() => [...new Set(markets.map(m => m.key.split('|')[1]))], [markets]);
  const [stat, setStat] = useState('');
  const [q, setQ] = useState('');
  const [onlyValue, setOnlyValue] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const cur = stats.includes(stat) ? stat : stats[0];
  const rows = useMemo(() => markets
    .filter(m => m.key.split('|')[1] === cur)
    .map(m => ({ m, name: (m.outcomes[0]?.label || '').split(' · ')[0] }))
    .filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()))
    .map(r => ({ ...r, v: lineValue(r.m, r.name, books, value) }))
    .filter(r => !onlyValue || ('data' in r.v && (r.v.data.verdict.code === 'BET' || r.v.data.verdict.code === 'LEAN')))
    .sort((x, y) => x.name.localeCompare(y.name) || (x.m.line ?? 0) - (y.m.line ?? 0)), [markets, cur, q, books, value, onlyValue]);
  const cols = books;
  if (!stats.length) return null;
  const nCols = 5 + cols.length * 2;
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/40">
      <div className={cn('flex flex-wrap items-center gap-2 px-4 py-2.5', open && 'border-b border-zinc-800/60')}>
        <button onClick={onToggle} className="mr-2 flex cursor-pointer items-center gap-2 text-[13px] font-semibold hover:text-zinc-50">
          <ChevronDown size={14} className={cn('text-zinc-500 transition-transform', !open && '-rotate-90')} />Líneas de jugador
          {!open && <span className="text-xs font-normal text-zinc-500">{markets.length} líneas</span>}
        </button>
        {open && <><div className="flex flex-wrap gap-1">
          {stats.map(s => (
            <button key={s} onClick={() => setStat(s)}
              className={cn('cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition',
                s === cur ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200')}>{s}</button>
          ))}
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-zinc-400" title="Líneas con veredicto Apostar o Valor ligero">
          <input type="checkbox" className="accent-amber-500" checked={onlyValue} onChange={e => setOnlyValue(e.target.checked)} />
          Sólo con valor
        </label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar jugador…"
          className="h-7 w-44 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs outline-none placeholder:text-zinc-600 focus:border-amber-500/60" /></>}
      </div>
      {open && <div className="overflow-x-auto">
        <table className="w-full table-fixed" style={{ minWidth: 640 + cols.length * 170 }}>
          <thead>
            <tr className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2 text-left">Jugador</th>
              <th className="w-20 px-2 py-2 text-center">Línea</th>
              <th className="w-24 px-2 py-2 text-center" title="Probabilidad de Más / Menos estimada con sus últimas partidas (Leaguepedia)">Estimado</th>
              <th className="w-28 px-2 py-2 text-center" title="Valor esperado de la mejor cuota: probabilidad estimada × cuota − 1">Valor</th>
              <th className="w-32 px-2 py-2 text-center" title="Fiabilidad 0-100 del pronóstico y veredicto">Fiabilidad</th>
              {cols.map(bk => <th key={bk} colSpan={2} className="w-[170px] border-l border-zinc-800/60 px-2 py-2 text-center normal-case tracking-normal"><BookHead name={bk} /></th>)}
            </tr>
            <tr className="border-b border-zinc-800/60 text-[10px] text-zinc-600">
              <th /><th /><th /><th /><th />
              {cols.map(bk => [<th key={bk + 'o'} className="border-l border-zinc-800/60 pb-1.5 font-normal">Más</th>, <th key={bk + 'u'} className="pb-1.5 font-normal">Menos</th>])}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, name, v }, i) => {
              const first = i === 0 || rows[i - 1].name !== name;
              const [over, under] = [m.outcomes.find(o => o.id === 'over'), m.outcomes.find(o => o.id === 'under')];
              const bo = over ? bestOf(over.prices, cols) : null, bu = under ? bestOf(under.prices, cols) : null;
              const ok = 'data' in v;
              const good = ok && v.best.ev >= VALUE_MIN;
              const ring = (side: 'over' | 'under', bk: string) => good && v.best.side === side && v.best.book === bk ? 'ring-2 ring-amber-400/70' : '';
              const isOpen = ok && expanded === m.key;
              const outcomeOf = (s: SideValue) => s.side === 'over' ? over : under;
              return [
                <tr key={m.key} onClick={ok ? () => setExpanded(isOpen ? null : m.key) : undefined}
                  className={cn('hover:bg-zinc-800/20', ok && 'cursor-pointer', isOpen && 'bg-zinc-800/30', first && i > 0 && 'border-t border-zinc-800/60')}>
                  <td className="px-4 py-1 text-sm font-medium">
                    <span className="flex items-center gap-1.5">
                      {ok && <ChevronDown size={12} className={cn('shrink-0 text-zinc-600 transition-transform', !isOpen && '-rotate-90')} />}
                      {first ? name : ''}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-center text-sm tabular-nums text-zinc-400">{m.line}</td>
                  {ok ? <>
                    <td className="px-2 py-1 text-center text-xs tabular-nums text-zinc-400" title={v.title}>{pct(v.data.pOver)} / {pct(v.data.pUnder)}</td>
                    <td className="px-2 py-1 text-center text-xs tabular-nums" title={v.title}>
                      <span className={cn('font-semibold', good ? 'text-emerald-400' : v.best.ev > 0 ? 'text-zinc-300' : 'text-zinc-600')}>
                        {v.best.ev > 0 ? '+' : ''}{pct(v.best.ev)}
                      </span>
                      <span className="ml-1 text-zinc-500">{SIDE_LABEL[v.best.side]}</span>
                    </td>
                    <td className="px-2 py-1" title={v.title}>
                      <div className="flex items-center justify-center gap-1.5">
                        <ReliabilityMeter rel={v.data.rel} compact />
                        {(v.data.verdict.code === 'BET' || v.data.verdict.code === 'LEAN') && <VerdictBadge code={v.data.verdict.code} />}
                      </div>
                    </td>
                  </> : <td colSpan={3} className="cursor-help px-2 py-1 text-center text-xs text-zinc-700" title={v.reason}>–</td>}
                  {cols.map(bk => [
                    <td key={bk + 'o'} className="border-l border-zinc-800/60 py-1 pl-2 pr-1" onClick={e => e.stopPropagation()}>
                      <OddButton className={cn('w-16', ring('over', bk))} price={over?.prices[bk]} best={!!bo && bo.n > 1 && over?.prices[bk] === bo.p}
                        title={`${bk}: ${over?.label}`} onClick={add => over && onPick(m.group, over.label, bk, over.prices[bk], add)} />
                    </td>,
                    <td key={bk + 'u'} className="py-1 pl-1 pr-2" onClick={e => e.stopPropagation()}>
                      <OddButton className={cn('w-16', ring('under', bk))} price={under?.prices[bk]} best={!!bu && bu.n > 1 && under?.prices[bk] === bu.p}
                        title={`${bk}: ${under?.label}`} onClick={add => under && onPick(m.group, under.label, bk, under.prices[bk], add)} />
                    </td>
                  ])}
                </tr>,
                isOpen && (
                  <tr key={m.key + '-panel'} className="bg-zinc-950/40">
                    <td colSpan={nCols} className="px-4 py-4">
                      <div className="max-w-3xl">
                        <ValuePanel v={v.data} bank={bank}
                          onBet={s => { const o = outcomeOf(s); if (o && s.book) onPick(m.group, o.label, s.book, s.price); }}
                          onSlip={s => { const o = outcomeOf(s); if (o && s.book) onPick(m.group, o.label, s.book, s.price, true); }} />
                      </div>
                    </td>
                  </tr>
                )
              ];
            })}
          </tbody>
        </table>
        {!rows.length && <p className="px-4 py-6 text-center text-sm text-zinc-500">{onlyValue ? 'Ninguna línea con valor' : 'Ningún jugador coincide'}</p>}
        {value.error && <p className="border-t border-zinc-800/60 px-4 py-2 text-xs text-rose-400">No se pudo estimar: {value.error}</p>}
      </div>}
    </div>
  );
}

function GameStats({ gameId, live, teams }: { gameId: string; live: boolean; teams: EventDetails['teams'] }) {
  const { data: w, error, isLoading } = useQuery({
    queryKey: ['window', gameId], queryFn: () => window.api.esports.liveWindow(gameId),
    refetchInterval: live ? 10_000 : false
  });
  if (isLoading) return <Loading label="Cargando estadísticas en vivo…" />;
  if (error) return <ErrorBox error={error} />;
  if (!w) return <Empty>Todavía no hay datos en vivo para esta partida (el feed va con ~1 min de retraso)</Empty>;

  const teamOf = (s: LiveSide, fallback: number) => teams.find(t => t.id === s.teamId) ?? teams[fallback];
  const blue = teamOf(w.blue, 0), red = teamOf(w.red, 1);
  const diff = w.blue.gold - w.red.gold;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
        {w.state === 'finished' ? <Badge>Terminada</Badge> : w.state === 'paused' ? <Badge tone="warning">Pausada</Badge> : <Badge tone="live">En juego</Badge>}
        <span>Parche {w.patch}</span><span>·</span><span>Actualizado {fmtTime(w.timestamp)}</span><span>·</span>
        <span>Diferencia de oro <b className={diff >= 0 ? 'text-sky-400' : 'text-rose-400'}>{diff >= 0 ? '+' : ''}{k(diff)}</b></span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="mb-4 flex justify-between text-sm font-bold">
          <span className="text-sky-400">{blue?.name ?? 'Azul'}</span><span className="text-rose-400">{red?.name ?? 'Rojo'}</span>
        </div>
        <Bar label="Oro" a={w.blue.gold} b={w.red.gold} fmt={k} />
        <Bar label="Kills" a={w.blue.kills} b={w.red.kills} />
        <Bar label="Torres" a={w.blue.towers} b={w.red.towers} />
        <Bar label="Inhibidores" a={w.blue.inhibitors} b={w.red.inhibitors} />
        <Bar label="Barones" a={w.blue.barons} b={w.red.barons} />
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
          <div className="flex flex-wrap gap-1">{w.blue.dragons.map((d, i) => <Badge key={i} tone="info">{DRAGONS[d] ?? d}</Badge>)}</div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Dragones</div>
          <div className="flex flex-wrap justify-end gap-1">{w.red.dragons.map((d, i) => <Badge key={i} tone="danger">{DRAGONS[d] ?? d}</Badge>)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Players side={w.blue} name={blue?.code ?? 'Azul'} color="text-sky-400" />
        <Players side={w.red} name={red?.code ?? 'Rojo'} color="text-rose-400" />
      </div>
    </div>
  );
}

function Bar({ label, a, b, fmt = String }: { label: string; a: number; b: number; fmt?: (v: number) => string }) {
  const tot = (a || 0) + (b || 0);
  const p = tot ? (a / tot) * 100 : 50;
  return (
    <div className="mb-3">
      <div className="mb-1 grid grid-cols-[1fr_auto_1fr] text-sm tabular-nums">
        <span className="font-semibold">{fmt(a)}</span>
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
        <span className="text-right font-semibold">{fmt(b)}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className="bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-700" style={{ width: `${p}%` }} />
        <div className="flex-1 bg-gradient-to-r from-rose-400 to-rose-600" />
      </div>
    </div>
  );
}

function Players({ side, name, color }: { side: LiveSide; name: string; color: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <table className="w-full">
        <thead className="bg-zinc-900/80"><tr>
          <th className={cn(th, color)}>{name}</th><th className={th}>Campeón</th><th className={th + ' text-right'}>Nv</th>
          <th className={th + ' text-right'}>K/D/A</th><th className={th + ' text-right'}>CS</th><th className={th + ' text-right'}>Oro</th><th className={th}>Vida</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-800/70">
          {side.players.map(p => (
            <tr key={p.name} className="hover:bg-zinc-900/50">
              <td className={td + ' font-medium'}>{p.name}</td><td className={td + ' text-zinc-400'}>{p.champion}</td>
              <td className={td + ' text-right tabular-nums'}>{p.level}</td>
              <td className={td + ' text-right tabular-nums'}>{p.kills}/<span className="text-rose-400">{p.deaths}</span>/{p.assists}</td>
              <td className={td + ' text-right tabular-nums'}>{p.cs}</td><td className={td + ' text-right tabular-nums'}>{k(p.gold)}</td>
              <td className={td}>
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full bg-emerald-500" style={{ width: `${p.maxHp ? (p.hp / p.maxHp) * 100 : 0}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
