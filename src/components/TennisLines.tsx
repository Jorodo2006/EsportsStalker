// Pestaña Líneas de la ficha de un tenista, como el analizador de jugador del baloncesto (BasketAnalyzer): su próximo partido, sus
// líneas de las casas con valor, y por mercado (sus juegos, los del partido, el hándicap, sus aces, sus sets y sus dobles faltas) cómo
// le fue frente a la línea en sus partidos, lo que espera el modelo y el panel de valor. Las cifras del modelo y de las casas salen
// del servicio (server/services/tennis/picks.js, playerLines), del mismo cálculo que las recomendaciones del partido; lo puro, de
// lib/tennis-lines.ts. Sin cuenta se ve sólo el histórico: el modelo y el valor son recomendaciones (gateway/public.js)
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp, useBets } from '@/lib/app-context';
import { cn, decimal, odd, pct, summarize } from '@/lib/format';
import { madridDay } from '@/lib/route';
import { targetOfMatch } from '@/lib/odds-targets';
import { LINE_MARKETS, MARKET_ORDER, bookLines, hitRate, lineText, mainLine, sideText, splits, suggestedLine, usable, valueOf, wins, type BookSides } from '@/lib/tennis-lines';
import { verdictOf, type Side, type SideValue } from '@/lib/value';
import type { TennisLineMarket, TennisLogMatch, TennisMatch, TennisModelMarket, TennisPick, TennisPlayerLines, TennisSurface, Tour } from '@/lib/types';
import { sized, fallbackTo } from '@/lib/img';
import { useMember } from './AuthGate';
import { JoinPrompt } from './MemberOnly';
import { PickRow } from './TennisPicks';
import { SURFACE_COLOR, SURFACE_ES } from './TennisStats';
import { ValuePanel } from './ValuePanel';
import { Button, Card, Empty, ErrorBox, Loading, Tabs, td, th } from './ui';

const SURFACES: TennisSurface[] = ['Hard', 'Clay', 'Grass'];
const fx = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? '–' : decimal(v, d));
const when = (iso: string) => new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
const shortDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
const lastName = (n: string) => n.split(' ').slice(1).join(' ') || n;
// Con la línea de cada mercado arriba y abajo de la elegida: la escalera entera son hasta 30 filas
const LADDER_SPAN = 5;

export function TennisLines({ tour, id, name }: { tour: Tour; id: string; name: string }) {
  const member = useMember();
  const { addToSlip, settings, openGame } = useApp();
  const { data: bets = [] } = useBets();
  const bank = (settings?.initialBankroll || 0) + summarize(bets).profit;
  const log = useQuery({ queryKey: ['tennis', 'gamelog', tour, id], queryFn: () => window.api.tennis.gamelog(tour, id), staleTime: 30 * 60e3, retry: false });
  const lq = useQuery({
    queryKey: ['tennis', 'playerLines', tour, id], queryFn: () => window.api.tennis.playerLines(tour, id), enabled: member,
    staleTime: 60e3, refetchInterval: 3 * 60e3, retry: false
  });
  const L: TennisPlayerLines | undefined = lq.data;
  const next = L?.next ?? null, me = L?.side;
  const ready = !!(L?.ready && L.ladders && me && next);
  const list = useMemo(() => log.data?.matches ?? [], [log.data]);

  const [market, setMarket] = useState<TennisLineMarket>('games');
  const [side, setSide] = useState<Side>('over');
  const [line, setLine] = useState<number | null>(null);
  const [surf, setSurf] = useState<TennisSurface | 'all' | null>(null);
  const surface: TennisSurface | 'all' = surf ?? L?.surface ?? 'all';

  const myName = next && me ? next[me].name : name;
  const books = useMemo(() => (ready ? bookLines(L!.picks ?? [], market, me!, myName, L!.bestOf) : new Map<number, BookSides>()), [ready, L, market, me, myName]);
  const expected = ready && LINE_MARKETS[market].model ? L!.expected![market as TennisModelMarket] : null;
  // Al cambiar de mercado o al llegar los datos: la línea de la casa más igualada si la hay; si no, la más cercana a lo esperado
  useEffect(() => { setLine(mainLine(books) ?? suggestedLine(market, expected, list)); }, [market, books, expected == null, list]); // eslint-disable-line react-hooks/exhaustive-deps

  const addPick = (p: TennisPick) => {
    if (!next) return;
    const [key, out] = p.id.split('#');
    addToSlip({
      sport: 'tennis', status: 'pending', league: next.tournament, event: `${next.a.name} vs ${next.b.name}`, market: p.market, selection: p.selection, bookmaker: p.book, odds: p.price,
      ...(key && out ? { live: { match: targetOfMatch(next).match, key, out } } : {})
    });
  };

  if (log.isLoading) return <Loading label="Cargando sus partidos…" />;
  if (log.error) return <div className="p-3"><ErrorBox error={log.error} /></div>;
  const M = LINE_MARKETS[market];
  const cur = line ?? suggestedLine(market, expected, list);
  const b = books.get(cur);
  const v = M.ou ? valueOf(market, cur, b) : null;
  const ladder = ready && M.model ? L!.ladders![market as TennisModelMarket] : [];
  const pLine = ladder.find(x => Math.abs(x.line - cur) < 1e-9)?.p ?? null;
  const step = (d: number) => setLine(Math.max(market === 'spread' ? -20.5 : 0.5, cur + d));

  return (
    <div className="flex flex-col gap-4 p-3">
      <NextMatch L={L} member={member} loading={lq.isLoading} error={lq.error} onOpen={m => openGame(m.id, madridDay(m.date), 'tennis')} />
      {ready && !!L!.picks?.length && <ValueLines picks={L!.picks!} match={next!} onAdd={addPick} />}

      {!log.data?.found || !list.length ? <Empty>Sin partidos de {name} en TennisMyLife: no hay con qué comparar sus líneas.</Empty> : <>
        <div className="flex flex-wrap gap-1">
          {MARKET_ORDER.map(k => (
            <button key={k} onClick={() => setMarket(k)} title={LINE_MARKETS[k].label}
              className={cn('cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition', k === market ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200')}>{LINE_MARKETS[k].label}</button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs font-medium text-zinc-400">Línea</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Bajar la línea" onClick={() => step(-1)}><ChevronLeft size={16} /></Button>
            <span className="w-14 text-center font-score text-lg font-bold tnum">{lineText(market, cur)}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Subir la línea" onClick={() => step(1)}><ChevronRight size={16} /></Button>
          </div>
          <Tabs value={side} onChange={setSide} items={[{ value: 'over' as const, label: sideText(market, cur, 'over') }, { value: 'under' as const, label: sideText(market, cur, 'under') }]} />
          {expected != null && (
            <span className="text-xs text-zinc-400">
              El modelo espera <b className="tnum text-zinc-100">{market === 'spread' ? `${expected >= 0 ? '+' : '−'}${fx(Math.abs(expected))}` : fx(expected)}</b> {market === 'spread' ? 'juegos de diferencia' : M.unit}
              {pLine != null && <> · {sideText(market, cur, 'over')}: <b className="tnum text-zinc-100">{pct(pLine)}</b> (justa {odd(1 / Math.max(pLine, 0.001))})</>}
            </span>
          )}
          {!M.model && <span className="text-xs text-zinc-500">Las dobles faltas no las calcula el modelo ni las dan las casas: sólo su histórico.</span>}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {v ? <ValuePanel v={v} bank={bank} side={side} onSide={setSide} onSlip={(s: SideValue) => { const p = s.side === 'over' ? b?.over : b?.under; if (p) addPick(p); }} />
            : b ? <BookCard b={b} match={next!} onAdd={addPick} />
              : ready && M.model ? <Card title="En las casas"><p className="text-[13px] text-zinc-400">{L!.withOdds ? `Las casas no dan esta línea de ${M.label.toLowerCase()} en su próximo partido.` : 'Todavía no hay cuotas de su próximo partido: las casas las sacan uno o dos días antes. La escalera dice a qué cuota tendría valor cada línea.'}</p></Card>
                : null}
          <History list={list} market={market} line={cur} side={side} onSide={setSide} surface={surface} onSurface={setSurf} expected={expected} />
        </div>

        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          <Splits list={list} market={market} line={cur} side={side} surface={surface === 'all' ? null : surface} />
          {ready && M.model && <Ladder ladder={ladder} market={market} line={cur} books={books} onLine={setLine} />}
        </div>

        <AllMarkets list={list} L={ready ? L! : null} me={me} name={myName} current={market} onMarket={setMarket} />
        <p className="text-[11px] text-zinc-500">
          Sus partidos, de TennisMyLife{log.data.updated ? ` (hasta el ${shortDate(log.data.updated)})` : ''}: la fecha es la de la semana del torneo. Sin las retiradas ni los W.O.
          Lo que espera el modelo y las cuotas justas son para su próximo partido, con el mismo cálculo que sus recomendaciones.
        </p>
      </>}
    </div>
  );
}

// ---------- Próximo partido ----------
function NextMatch({ L, member, loading, error, onOpen }: { L?: TennisPlayerLines; member: boolean; loading: boolean; error: unknown; onOpen: (m: TennisMatch) => void }) {
  if (!member) return <JoinPrompt what="su próximo partido y sus líneas con valor" compact />;
  if (loading) return <Loading label="Buscando su próximo partido…" />;
  if (error) return <ErrorBox error={error} />;
  if (!L?.next || !L.side) return <Card title="Próximo partido"><p className="text-[13px] text-zinc-400">No juega en los próximos 7 días, o su partido todavía no está en el calendario. Abajo tienes su histórico frente a cada línea.</p></Card>;
  const m = L.next, me = L.side, op = m[me === 'a' ? 'b' : 'a'];
  const live = m.state === 'in';
  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-zinc-800 bg-surface p-4">
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-xs font-medium text-zinc-500">{live ? 'Jugando ahora' : 'Próximo partido'}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-lg font-bold">
          <span className="shrink-0 text-zinc-500">contra</span>
          {op.flag && <img src={sized(op.flag, 24)} onError={fallbackTo(op.flag)} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />}
          <span className="truncate">{op.name}</span>{op.rank ? <span className="shrink-0 text-sm font-normal text-zinc-500">n.º {op.rank}</span> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-zinc-400">
          <span>{m.tournament}</span>{m.round && <span>· {m.round}</span>}<span className="first-letter:uppercase">· {live ? m.status || 'en juego' : when(m.date)}</span>
          {L.surface && <span className="inline-flex items-center gap-1">· <span className="h-2 w-2 rounded-full" style={{ background: SURFACE_COLOR[L.surface] }} />{SURFACE_ES[L.surface]}</span>}
        </div>
      </div>
      {L.ready && L.expected && (
        <div className="flex gap-5">
          {([['Gana', pct(L.pWin ?? 0)], ['Juegos', fx(L.expected.games)], ['Aces', fx(L.expected.aces)]] as const).map(([k, x]) => (
            <div key={k} className="text-center"><div className="font-score text-lg font-bold tnum">{x}</div><div className="text-[11px] text-zinc-500">{k === 'Gana' ? 'gana (modelo)' : `${k.toLowerCase()} esperados`}</div></div>
          ))}
        </div>
      )}
      <Button size="sm" variant="secondary" onClick={() => onOpen(m)}>Abrir el partido<ChevronRight size={14} /></Button>
      {!!L.warnings?.length && <p className="w-full text-xs text-amber-300">{L.warnings.join('. ')}.</p>}
    </section>
  );
}

// Sus líneas de las casas en el próximo partido: las que tienen valor (la regla común de value.ts). Si no hay, las que más se acercan
// (las más probables pagan poco y suelen tener el peor valor: enseñarlas aquí confundía)
function ValueLines({ picks, match, onAdd }: { picks: TennisPick[]; match: TennisMatch; onAdd: (p: TennisPick) => void }) {
  const good = picks.filter(p => verdictOf(p.ev, p.rel.score) === 'BET').sort((x, y) => y.ev - x.ev);
  const shown = good.length ? good : picks.slice().sort((x, y) => y.ev - x.ev).slice(0, 3);
  const live = targetOfMatch(match).match;
  return (
    <Card className="overflow-hidden" title={good.length ? `Líneas con valor (${good.length})` : 'Líneas con valor'}
      action={<span className="text-[11px] text-zinc-500">{picks.length} suyas en las casas</span>}>
      {!good.length && <p className="-mt-2 mb-2 text-[13px] text-zinc-400">Ninguna tiene valor ahora mismo. Las que más se acercan:</p>}
      <div className="-mx-5 -mb-5 divide-y divide-zinc-800/70">{shown.map(p => <PickRow key={p.id} pick={p} onAdd={onAdd} match={live} />)}</div>
    </Card>
  );
}

// El hándicap y los sets no son Más / Menos: sus cuotas de esa línea, cada una con su botón
function BookCard({ b, match, onAdd }: { b: BookSides; match: TennisMatch; onAdd: (p: TennisPick) => void }) {
  const live = targetOfMatch(match).match;
  return (
    <Card className="overflow-hidden" title="En las casas">
      <div className="-mx-5 -my-5 divide-y divide-zinc-800/70">{[b.over, b.under].filter(Boolean).map(p => <PickRow key={p!.id} pick={p!} onAdd={onAdd} match={live} />)}</div>
    </Card>
  );
}

// ---------- Sus partidos frente a la línea ----------
function History({ list, market, line, side, onSide, surface, onSurface, expected }: {
  list: TennisLogMatch[]; market: TennisLineMarket; line: number; side: Side; onSide: (s: Side) => void; surface: TennisSurface | 'all'; onSurface: (s: TennisSurface | 'all') => void; expected: number | null;
}) {
  const M = LINE_MARKETS[market];
  const pool = usable(list, market).filter(g => surface === 'all' || g.surface === surface);
  const played = pool.slice(0, 20);
  const data = played.slice().reverse().map((g, k) => ({ k, v: M.value(g)!, x: lastName(g.opp), g }));
  const h = hitRate(played, market, line, side);
  // En el hándicap se dibuja su diferencia de juegos, y la línea que la cubre es la contraria (con +3,5, perder por 3)
  const ref = market === 'spread' ? -line : line;
  const many = data.length > 14;
  return (
    <Card title={`${M.label}: últimos ${played.length}`} action={
      <Tabs value={surface} onChange={onSurface} items={[{ value: 'all' as const, label: 'Todas' }, ...SURFACES.filter(s => list.some(g => g.surface === s)).map(s => ({ value: s, label: SURFACE_ES[s] }))]} />}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <Tabs value={side} onChange={onSide} items={[{ value: 'over' as const, label: market === 'spread' ? 'Cubre' : market === 'sets' ? 'Sí' : 'Más de' }, { value: 'under' as const, label: market === 'spread' ? 'No cubre' : market === 'sets' ? 'No' : 'Menos de' }]} />
        <span className={cn('font-semibold', h.rate == null ? 'text-zinc-500' : h.rate >= 0.6 ? 'text-emerald-400' : h.rate <= 0.4 ? 'text-rose-400' : 'text-zinc-400')}>
          {sideText(market, line, side)} en {h.hits}/{h.n}{h.rate != null ? ` (${Math.round(h.rate * 100)} %)` : ''}
        </span>
        {h.avg != null && <span className="text-zinc-500">Media <span className="tnum text-zinc-200">{fx(h.avg)}</span></span>}
      </div>
      {!played.length ? <Empty>Sin partidos con este dato{surface !== 'all' ? ` en ${SURFACE_ES[surface].toLowerCase()}` : ''}.</Empty> : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#2b3034" vertical={false} />
              <XAxis dataKey="k" tickFormatter={k => data[k]?.x ?? ''} stroke="#85948f" fontSize={10} tickLine={false} axisLine={false} interval={many ? 'preserveStartEnd' : 0} minTickGap={many ? 4 : 0} />
              <YAxis stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: '#2b303488' }} contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }} itemStyle={{ color: '#fafafa', fontWeight: 600 }}
                labelStyle={{ color: '#d4d4d8' }} labelFormatter={(_, p) => { const g: TennisLogMatch | undefined = p?.[0]?.payload.g; return g ? `${shortDate(g.date)} · ${g.tournament}, ${g.round} · ${g.win ? 'ganó a' : 'perdió con'} ${g.opp} ${g.score}` : ''; }}
                formatter={x => [x, M.label]} />
              <ReferenceLine y={ref} stroke="var(--acc-400)" strokeDasharray="4 4" />
              {expected != null && <ReferenceLine y={expected} stroke="#9aaaa4" strokeDasharray="2 4" />}
              <Bar dataKey="v" radius={[3, 3, 0, 0]} minPointSize={x => (x === 0 ? 3 : 0)} isAnimationActive={false}>
                {data.map(d => <Cell key={d.k} fill={wins(market, d.v, line, side) ? 'var(--color-emerald-400)' : 'var(--color-rose-400)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span><span className="text-amber-400">- -</span> {market === 'spread' ? `cubre ${lineText(market, line)} por encima` : `línea ${lineText(market, line)}`}</span>
        {expected != null && <span><span className="text-zinc-300">··</span> lo que espera el modelo</span>}
        <span>De más antiguo a más reciente; el rival, abajo</span>
      </div>
    </Card>
  );
}

function Splits({ list, market, line, side, surface }: { list: TennisLogMatch[]; market: TennisLineMarket; line: number; side: Side; surface: TennisSurface | null }) {
  const rows = splits(list, market, line, side, { today: madridDay(new Date().toISOString()), surface, surfaceLabel: surface ? SURFACE_ES[surface].toLowerCase() : undefined });
  return (
    <Card className="overflow-hidden" title="Tramos" action={<span className="text-[11px] text-zinc-500">{sideText(market, line, side)}</span>}>
      <div className="-m-5 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-zinc-900/60"><tr><th className={th}>Tramo</th><th className={th + ' text-right'}>PJ</th><th className={th + ' text-right'}>Media</th><th className={th + ' text-right'}>Acierto</th></tr></thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.map(r => (
              <tr key={r.label}>
                <td className={td}>{r.label}</td><td className={td + ' text-right tabular-nums text-zinc-400'}>{r.n}</td><td className={td + ' text-right tabular-nums'}>{fx(r.avg)}</td>
                <td className={cn(td, 'text-right tabular-nums', r.rate != null && r.n >= 3 && (r.rate >= 0.6 ? 'text-emerald-400' : r.rate <= 0.4 ? 'text-rose-400' : ''))}>{r.n && r.rate != null ? pct(r.rate) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// La escalera del modelo para su próximo partido: la probabilidad de cada línea, sus cuotas justas y, si la casa la da, sus cuotas
function Ladder({ ladder, market, line, books, onLine }: { ladder: { line: number; p: number }[]; market: TennisLineMarket; line: number; books: Map<number, BookSides>; onLine: (l: number) => void }) {
  const i = Math.max(0, ladder.findIndex(x => Math.abs(x.line - line) < 1e-9));
  const rows = ladder.length <= 2 * LADDER_SPAN + 1 ? ladder : ladder.slice(Math.max(0, i - LADDER_SPAN), i + LADDER_SPAN + 1);
  const yes = market === 'spread' ? 'Cubre' : 'Más';
  return (
    <Card className="overflow-hidden" title="Escalera de líneas (modelo)" action={<span className="text-[11px] text-zinc-500">su próximo partido</span>}>
      <div className="-m-5 overflow-x-auto">
        <table className="w-full min-w-[420px]">
          <thead className="bg-zinc-900/60"><tr>
            <th className={th + ' text-right'}>Línea</th><th className={th + ' text-right'}>P({yes})</th><th className={th + ' text-right'}>Justa {yes.toLowerCase()}</th><th className={th + ' text-right'}>Justa contra</th><th className={th + ' text-right'} title="La mejor cuota de las casas, a favor / en contra">Casa</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.map(r => {
              const sel = Math.abs(r.line - line) < 1e-9, bk = books.get(r.line);
              return (
                <tr key={r.line} className={cn('cursor-pointer hover:bg-zinc-800/40', sel && 'bg-amber-500/10')} onClick={() => onLine(r.line)} title="Usar esta línea">
                  <td className={td + ' text-right font-mono tabular-nums'}>{lineText(market, r.line)}</td>
                  <td className={td + ' text-right tabular-nums'}>{pct(r.p)}</td>
                  <td className={td + ' text-right tabular-nums'}>{r.p > 0.002 ? odd(1 / r.p) : '–'}</td>
                  <td className={td + ' text-right tabular-nums'}>{r.p < 0.998 ? odd(1 / (1 - r.p)) : '–'}</td>
                  <td className={td + ' text-right tabular-nums text-zinc-300'}>{bk ? `${bk.over ? odd(bk.over.price) : '–'} / ${bk.under ? odd(bk.under.price) : '–'}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Todos sus mercados de un vistazo: lo que espera el modelo, su media reciente, la línea de la casa (o la sugerida) y cuánto la superó
function AllMarkets({ list, L, me, name, current, onMarket }: { list: TennisLogMatch[]; L: TennisPlayerLines | null; me?: 'a' | 'b'; name: string; current: TennisLineMarket; onMarket: (m: TennisLineMarket) => void }) {
  const today = madridDay(new Date().toISOString());
  const cut = new Date(Date.parse(`${today}T12:00:00Z`) - 364 * 864e5).toISOString().slice(0, 10);
  const year = list.filter(g => g.date >= cut);
  const rows = MARKET_ORDER.map(k => {
    const M = LINE_MARKETS[k];
    const exp = L?.expected && M.model ? L.expected[k as TennisModelMarket] : null;
    const books = L && me ? bookLines(L.picks ?? [], k, me, name, L.bestOf) : new Map<number, BookSides>();
    const line = mainLine(books) ?? suggestedLine(k, exp, list);
    const fromBook = books.has(line);
    const recent = hitRate(list.slice(0, 10), k, line, 'over');
    const h = hitRate(year, k, line, 'over');
    const value = [...books.values()].flatMap(b => [b.over, b.under]).filter((p): p is TennisPick => !!p && verdictOf(p.ev, p.rel.score) === 'BET').length;
    return { k, M, exp, line, fromBook, avg: recent.avg, rate: h.rate, n: h.n, value };
  });
  return (
    <Card className="overflow-hidden" title="Todos los mercados">
      <div className="-m-5 overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead className="bg-zinc-900/60"><tr>
            <th className={th}>Mercado</th><th className={th + ' text-right'}>Modelo</th><th className={th + ' text-right'}>Últ. 10</th><th className={th + ' text-right'}>Línea</th><th className={th + ' text-right'}>Más (52 sem.)</th><th className={th}></th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.map(r => (
              <tr key={r.k} className={cn('cursor-pointer hover:bg-zinc-800/40', r.k === current && 'bg-amber-500/10')} onClick={() => onMarket(r.k)}>
                <td className={td}>{r.M.label}</td>
                <td className={td + ' text-right font-semibold tabular-nums'}>{r.exp == null ? '–' : r.k === 'spread' ? `${r.exp >= 0 ? '+' : '−'}${fx(Math.abs(r.exp))}` : fx(r.exp)}</td>
                <td className={td + ' text-right tabular-nums'}>{fx(r.avg)}</td>
                <td className={td + ' text-right tabular-nums'} title={r.fromBook ? 'La línea de las casas' : 'Sin línea de las casas: la más cercana a lo esperado'}>{lineText(r.k, r.line)}{r.fromBook ? '' : '*'}</td>
                <td className={td + ' text-right tabular-nums'}>{r.rate == null ? '–' : `${pct(r.rate)} (${r.n})`}</td>
                <td className={td}>{r.value > 0 && <span className="whitespace-nowrap rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-400">con valor</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="-mx-5 -mb-5 mt-5 border-t border-zinc-800/70 px-5 py-2 text-[11px] text-zinc-500">* Sin línea de las casas: la más cercana a lo que se espera. En el hándicap, «Más» es cubrirlo.</p>
    </Card>
  );
}
