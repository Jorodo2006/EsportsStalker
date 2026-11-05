// Puntos de los equipos de baloncesto: tabla de toda la liga, puntos de un equipo por tramos y cuartos, y el partido con la
// proyección del total y de los puntos de cada uno, la probabilidad de la línea que se elija y el valor frente a las casas.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '@/lib/app-context';
import { cn, odd, pct, summarize } from '@/lib/format';
import {
  POINT_PERIODS, TABLE_WINDOWS, analyzePoints, leagueTable, mainLine, overRate, periodAverages, pointLines, pointSplits, pointValues, projectGame, teamRows,
  type BookLine, type PointKind, type PointPeriod, type PointSplit, type TableRow, type TableWindow, type TeamRow
} from '@/lib/basket-teams';
import { SIDE_LABEL } from '@/lib/value';
import type { BasketGame, BasketLeagueId, MatchOdds } from '@/lib/types';
import { LEAGUE_NAME } from './BasketAnalyzer';
import { ValuePanel } from './ValuePanel';
import { Empty, ErrorBox, Input, Loading, TeamLogo, th } from './ui';
import { Panel, TvBand, TvFrame, TvHeader, TvTabs, panel, tdc } from './viz';

export const dec = (v: number | null | undefined, d = 1) => (v == null ? '–' : v.toFixed(d).replace('.', ','));
export const signed = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${dec(v)}`);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
const fmtLine = (n: number) => String(n).replace('.', ',');
const toNum = (s: string) => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) ? n : null; };
const hitCls = (v: number | null) => (v == null ? 'text-zinc-500' : v >= 0.6 ? 'text-emerald-400' : v <= 0.4 ? 'text-rose-400' : 'text-zinc-300');
const diffCls = (v: number | null) => ((v ?? 0) > 0 ? 'text-emerald-400' : (v ?? 0) < 0 ? 'text-rose-400' : 'text-zinc-400');
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// El renderer se recarga solo, pero el proceso principal y el preload no: una ruta nueva pide relanzar la app
export const restart = (e: unknown) => (/No handler registered|is not a function/.test(String(e))
  ? <ErrorBox error="La app tiene que reiniciarse para ver esto">Para <code>npm run dev</code> (Ctrl+C) y vuelve a lanzarlo.</ErrorBox>
  : <ErrorBox error={e} />);

export const useLeagueGames = (league: BasketLeagueId) => useQuery({
  queryKey: ['basket', 'leagueGames', league], queryFn: () => window.api.basket.leagueGames(league), staleTime: 5 * 60e3, retry: false
});
const LOADING = 'Cargando los partidos de la temporada… la primera vez puede tardar unos segundos';

const Lbl = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-zinc-400">{label}</span>{children}</label>
);
const PeriodTabs = ({ value, onChange }: { value: PointPeriod; onChange: (p: PointPeriod) => void }) => (
  <TvTabs value={value} onChange={onChange} items={POINT_PERIODS.map(p => ({ value: p.id, label: p.label }))} />
);

// ---------- Tabla de la liga ----------
type SortKey = 'n' | 'us' | 'them' | 'total' | 'diff' | 'maxTotal' | 'minTotal' | 'overTotal' | 'overTeam';

export function LeaguePoints({ league, onTeam }: { league: BasketLeagueId; onTeam: (id: string) => void }) {
  const q = useLeagueGames(league);
  const [win, setWin] = useState<TableWindow>('season');
  const [period, setPeriod] = useState<PointPeriod>('game');
  const [lineTotal, setLineTotal] = useState('');
  const [lineTeam, setLineTeam] = useState('');
  const [chosen, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'total', desc: true });
  const LT = toNum(lineTotal), LE = toNum(lineTeam);
  // Si se borra la línea, su columna desaparece: no se puede seguir ordenando por ella
  const sort = (chosen.key === 'overTotal' && LT == null) || (chosen.key === 'overTeam' && LE == null) ? { key: 'total' as const, desc: true } : chosen;
  const rows = useMemo(() => {
    if (!q.data) return [];
    const val = (r: TableRow) => r[sort.key] ?? (sort.desc ? -Infinity : Infinity);
    return leagueTable(q.data, win, period, LT, LE).filter(r => r.n).sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)));
  }, [q.data, win, period, LT, LE, sort.key, sort.desc]);
  if (q.isLoading) return <Loading label={LOADING} />;
  if (q.error) return restart(q.error);
  if (!rows.length) return <Empty>Todavía no hay partidos terminados de esta liga.</Empty>;
  const H = ({ k, children, title }: { k: SortKey; children: ReactNode; title?: string }) => (
    <th className={th + ' text-right'} title={title} aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button onClick={() => setSort(s => ({ key: k, desc: s.key === k ? !s.desc : true }))} className={cn('cursor-pointer uppercase hover:text-zinc-200', sort.key === k && 'text-amber-400')}>
        {children}{sort.key === k ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  const mean = (f: (r: TableRow) => number | null) => avg(rows.map(f).filter((v): v is number => v != null));
  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn(panel, 'flex flex-wrap items-end gap-x-4 gap-y-2 px-3.5 py-2.5')}>
        <div className="flex flex-col gap-1.5"><span className="text-xs font-medium text-zinc-400">Partidos</span><TvTabs value={win} onChange={setWin} items={TABLE_WINDOWS.map(w => ({ value: w.id, label: w.label }))} /></div>
        <div className="flex flex-col gap-1.5"><span className="text-xs font-medium text-zinc-400">Tramo</span><PeriodTabs value={period} onChange={setPeriod} /></div>
        <div className="w-28"><Lbl label="Línea del total"><Input inputMode="decimal" placeholder="225,5" value={lineTotal} onChange={e => setLineTotal(e.target.value)} /></Lbl></div>
        <div className="w-28"><Lbl label="Línea del equipo"><Input inputMode="decimal" placeholder="112,5" value={lineTeam} onChange={e => setLineTeam(e.target.value)} /></Lbl></div>
      </div>
      <Panel title="Puntos por equipo" aside="Pulsa un equipo para ver su ficha; pulsa una columna para ordenar">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="bg-zinc-900/60"><tr>
              <th className={th + ' w-8 text-right'}>#</th><th className={th}>Equipo</th>
              <H k="n" title="Partidos jugados">PJ</H><H k="us" title="Puntos anotados por partido">Anotados</H><H k="them" title="Puntos encajados por partido">Encajados</H>
              <H k="total" title="Puntos de los dos equipos por partido">Total</H><H k="diff" title="Diferencia de puntos por partido">Dif.</H><H k="maxTotal" title="Mayor total en esos partidos">Máx.</H><H k="minTotal" title="Menor total en esos partidos">Mín.</H>
              {LT != null && <H k="overTotal" title={`Partidos con más de ${LT} puntos entre los dos`}>Total &gt; {fmtLine(LT)}</H>}
              {LE != null && <H k="overTeam" title={`Partidos en los que el equipo anotó más de ${LE}`}>Equipo &gt; {fmtLine(LE)}</H>}
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/50">
              {rows.map((t, i) => (
                <tr key={t.id} onClick={() => onTeam(t.id)} className="cursor-pointer hover:bg-zinc-800/30">
                  <td className={tdc + ' text-right text-zinc-500 tnum'}>{i + 1}</td>
                  <td className={tdc}><span className="flex items-center gap-2 whitespace-nowrap"><TeamLogo src={t.logo} name={t.abbr} size={18} /><span className="font-medium">{t.name}</span></span></td>
                  <td className={tdc + ' text-right text-zinc-400 tnum'}>{t.n}</td>
                  <td className={tdc + ' text-right tnum'}>{dec(t.us)}</td><td className={tdc + ' text-right tnum'}>{dec(t.them)}</td>
                  <td className={tdc + ' text-right font-semibold tnum'}>{dec(t.total)}</td>
                  <td className={cn(tdc, 'text-right tnum', diffCls(t.diff))}>{signed(t.diff)}</td>
                  <td className={tdc + ' text-right text-zinc-400 tnum'}>{t.maxTotal ?? '–'}</td><td className={tdc + ' text-right text-zinc-400 tnum'}>{t.minTotal ?? '–'}</td>
                  {LT != null && <td className={cn(tdc, 'text-right font-medium tnum', hitCls(t.overTotal))}>{t.overTotal == null ? '–' : pct(t.overTotal)}</td>}
                  {LE != null && <td className={cn(tdc, 'text-right font-medium tnum', hitCls(t.overTeam))}>{t.overTeam == null ? '–' : pct(t.overTeam)}</td>}
                </tr>
              ))}
              <tr className="bg-zinc-900/60 font-semibold">
                <td className={tdc} /><td className={tdc}>Media de la liga</td><td className={tdc} />
                <td className={tdc + ' text-right tnum'}>{dec(mean(r => r.us))}</td><td className={tdc + ' text-right tnum'}>{dec(mean(r => r.them))}</td><td className={tdc + ' text-right tnum'}>{dec(mean(r => r.total))}</td>
                <td className={tdc} /><td className={tdc} /><td className={tdc} />
                {LT != null && <td className={tdc + ' text-right tnum'}>{pct(mean(r => r.overTotal) ?? 0)}</td>}
                {LE != null && <td className={tdc + ' text-right tnum'}>{pct(mean(r => r.overTeam) ?? 0)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ---------- Piezas comunes ----------
function SplitsTable({ splits, value, line }: { splits: PointSplit[]; value?: (r: TeamRow) => number; line?: number | null }) {
  const hasLine = !!value && line != null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead className="bg-zinc-900/60"><tr>
          <th className={th}>Tramo</th><th className={th + ' text-right'}>PJ</th><th className={th + ' text-right'}>Anotados</th><th className={th + ' text-right'}>Encajados</th><th className={th + ' text-right'}>Total</th><th className={th + ' text-right'}>Dif.</th><th className={th + ' text-right'} title="Mayor y menor total">Máx.-mín.</th>
          {hasLine && <th className={th + ' text-right'}>% Más de {fmtLine(line!)}</th>}
        </tr></thead>
        <tbody className="divide-y divide-zinc-800/50">
          {splits.map(s => {
            const rate = hasLine ? overRate(s.rows.map(value!), line!) : null;
            return (
              <tr key={s.label} className={cn(!s.n && 'opacity-40')}>
                <td className={tdc + ' whitespace-nowrap'}>{s.label}</td><td className={tdc + ' text-right text-zinc-400 tnum'}>{s.n}</td>
                <td className={tdc + ' text-right tnum'}>{dec(s.us)}</td><td className={tdc + ' text-right tnum'}>{dec(s.them)}</td>
                <td className={tdc + ' text-right font-semibold tnum'}>{dec(s.total)}</td><td className={cn(tdc, 'text-right tnum', diffCls(s.diff))}>{signed(s.diff)}</td>
                <td className={tdc + ' whitespace-nowrap text-right text-zinc-400 tnum'}>{s.n ? `${s.maxTotal}-${s.minTotal}` : '–'}</td>
                {hasLine && <td className={cn(tdc, 'text-right font-medium tnum', hitCls(rate))}>{rate == null ? '–' : pct(rate)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Últimos partidos frente a la línea: las barras salen de la propia línea. Desde 0 no se verían 5 puntos sobre 225, y
// recortar el eje engañaría; así arriba es Más y abajo es Menos sin depender sólo del color.
function LineChart({ title, rows, value, line }: { title: string; rows: TeamRow[]; value: (r: TeamRow) => number; line: number }) {
  const data = rows.slice(0, 20).reverse().map(r => ({ x: `${r.home ? '' : '@'}${r.opp}`, date: shortDate(r.date), v: value(r), d: value(r) - line }));
  const hits = data.filter(d => d.v > line).length;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 px-3 pt-2 text-[13px]">
        <span className="truncate font-medium text-zinc-200">{title}</span>
        <span className="shrink-0 text-xs text-zinc-400 tnum">Más de {fmtLine(line)}: {hits}/{data.length}</span>
      </div>
      <div className="px-3 text-[11px] text-zinc-500">Puntos por encima y por debajo de la línea</div>
      <div className="h-44 px-1 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke="#222a3b" vertical={false} />
            <XAxis dataKey="x" stroke="#637089" fontSize={9} tickLine={false} axisLine={false} interval={0} angle={-45} textAnchor="end" height={34} />
            <YAxis stroke="#637089" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => (v > 0 ? `+${v}` : `${v}`)} />
            <Tooltip cursor={{ fill: '#222a3b88' }} contentStyle={{ background: '#161d2b', border: '1px solid #313b51', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#8590a8' }}
              labelFormatter={(_, p) => (p?.[0] ? `${p[0].payload.date} ${p[0].payload.x}` : '')}
              formatter={(_, __, p) => [`${p.payload.v} (${p.payload.d > 0 ? '+' : ''}${fmtLine(p.payload.d)})`, 'Puntos']} />
            <ReferenceLine y={0} stroke="#c7cedb" />
            <Bar dataKey="d" radius={[3, 3, 0, 0]} maxBarSize={18}>
              {data.map((d, i) => <Cell key={i} fill={d.d > 0 ? '#34d399' : d.d < 0 ? '#fb7185' : '#637089'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------- Ficha de un equipo ----------
export function TeamPoints({ league, teamId }: { league: BasketLeagueId; teamId: string }) {
  const q = useLeagueGames(league);
  const [period, setPeriod] = useState<PointPeriod>('game');
  const [mode, setMode] = useState<'total' | 'us'>('total');
  const [line, setLine] = useState('');
  const d = q.data;
  const rows = useMemo(() => (d ? teamRows(d, teamId, period) : []), [d, teamId, period]);
  const splits = useMemo(() => (d ? pointSplits(rows, d.currentSeason) : []), [d, rows]);
  const parts = useMemo(() => (d ? periodAverages(d, teamId) : []), [d, teamId]);
  const value = mode === 'total' ? (r: TeamRow) => r.total : (r: TeamRow) => r.us;
  // Al cambiar de tramo o de mercado, una línea de partida con la media de los últimos 20
  useEffect(() => {
    const m = avg(rows.slice(0, 20).map(value));
    if (m != null) setLine(fmtLine(Math.floor(m) + 0.5));
  }, [period, mode, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <Panel title="Puntos"><div className="px-3.5"><Loading label={LOADING} /></div></Panel>;
  if (q.error) return restart(q.error);
  if (!rows.length) return <Panel title="Puntos"><p className="px-3.5 py-3 text-[13px] text-zinc-500">Todavía no hay partidos terminados de este equipo.</p></Panel>;
  const L = toNum(line);
  return (
    <Panel title="Puntos">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-3.5 py-2">
        <PeriodTabs value={period} onChange={setPeriod} />
        <span className="ml-auto flex items-center gap-2">
          <TvTabs value={mode} onChange={setMode} items={[{ value: 'total', label: 'Total' }, { value: 'us', label: 'Equipo' }]} />
          <Input aria-label="Línea" title="Línea" inputMode="decimal" className="h-7 w-20" value={line} onChange={e => setLine(e.target.value)} />
        </span>
      </div>
      <SplitsTable splits={splits} value={value} line={L} />
      <div className="grid grid-cols-1 border-t border-white/10 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
        {L != null ? <LineChart title={`${mode === 'total' ? 'Total de los dos' : 'Puntos del equipo'}: últimos ${Math.min(20, rows.length)}`} rows={rows} value={value} line={L} /> : <p className="px-3.5 py-3 text-[13px] text-zinc-500">Escribe una línea para compararla con los últimos partidos.</p>}
        <div>
          <TvBand>Por cuartos y mitades</TvBand>
          <table className="w-full">
            <thead className="bg-zinc-900/60"><tr><th className={th}>Tramo</th><th className={th + ' text-right'}>Anotados</th><th className={th + ' text-right'}>Encajados</th><th className={th + ' text-right'}>Total</th><th className={th + ' text-right'}>Dif.</th></tr></thead>
            <tbody className="divide-y divide-zinc-800/50">
              {parts.map(p => (
                <tr key={p.id} className={cn(p.id === period && 'bg-amber-500/10')}>
                  <td className={tdc}>{p.label}</td><td className={tdc + ' text-right tnum'}>{dec(p.us)}</td><td className={tdc + ' text-right tnum'}>{dec(p.them)}</td><td className={tdc + ' text-right font-semibold tnum'}>{dec(p.total)}</td>
                  <td className={cn(tdc, 'text-right tnum', diffCls(p.us != null && p.them != null ? p.us - p.them : null))}>{p.us != null && p.them != null ? signed(p.us - p.them) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <TvBand>Últimos partidos</TvBand>
      <RowsTable rows={rows.slice(0, 10)} value={value} line={L} />
    </Panel>
  );
}

function RowsTable({ rows, value, line }: { rows: TeamRow[]; value: (r: TeamRow) => number; line: number | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px]">
        <thead className="bg-zinc-900/60"><tr><th className={th}>Fecha</th><th className={th}>Rival</th><th className={th + ' text-right'}>Anotados</th><th className={th + ' text-right'}>Encajados</th><th className={th + ' text-right'}>Total</th>{line != null && <th className={th + ' text-right'}>Línea {fmtLine(line)}</th>}</tr></thead>
        <tbody className="divide-y divide-zinc-800/50">
          {rows.map(r => {
            const v = value(r), over = line != null && v > line, under = line != null && v < line;
            return (
              <tr key={r.id}>
                <td className={tdc + ' whitespace-nowrap text-zinc-400 tnum'}>{shortDate(r.date)}</td>
                <td className={tdc}><span className="flex items-center gap-2 whitespace-nowrap"><span className="w-4 text-center text-[11px] text-zinc-500" title={r.home ? 'En casa' : 'Fuera'}>{r.home ? 'vs' : '@'}</span><TeamLogo src={r.oppLogo} name={r.opp} size={16} />{r.oppName || r.opp}</span></td>
                <td className={cn(tdc, 'text-right tnum', r.us > r.them ? 'font-semibold' : 'text-zinc-400')}>{r.us}</td><td className={cn(tdc, 'text-right tnum', r.them > r.us ? 'font-semibold' : 'text-zinc-400')}>{r.them}</td>
                <td className={tdc + ' text-right font-semibold tnum'}>{r.total}</td>
                {line != null && <td className={cn(tdc, 'whitespace-nowrap text-right font-medium', over ? 'text-emerald-400' : under ? 'text-rose-400' : 'text-zinc-400')}>{over ? 'Más' : under ? 'Menos' : 'Nula'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Un partido: total y puntos de cada equipo ----------
export function GamePoints({ game, odds }: { game: BasketGame; odds?: MatchOdds }) {
  const { addToSlip, settings } = useApp();
  const { data: bets = [] } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  const bank = (settings?.initialBankroll || 0) + summarize(bets).profit;
  const q = useLeagueGames(game.league);
  const [period, setPeriod] = useState<PointPeriod>('game');
  const [kind, setKind] = useState<PointKind>('total');
  const [line, setLine] = useState('');
  const [over, setOver] = useState('');
  const [under, setUnder] = useState('');
  const [books, setBooks] = useState<{ over?: string; under?: string }>({});
  const d = q.data;
  // Sólo lo anterior al partido: en uno ya jugado no se cuenta a sí mismo
  const P = useMemo(() => (d ? projectGame(d, game.away.id, game.home.id, period, game.date) : null), [d, game.away.id, game.home.id, game.date, period]);
  const lines = useMemo(() => pointLines(odds, kind, period), [odds, kind, period]);
  const applyLine = (l: BookLine) => {
    setLine(fmtLine(l.line)); setOver(l.over ? fmtLine(l.over) : ''); setUnder(l.under ? fmtLine(l.under) : ''); setBooks({ over: l.overBook, under: l.underBook });
  };
  // Al cambiar de mercado: la línea principal de las casas si la hay; si no, la proyección redondeada a x,5
  useEffect(() => {
    if (!P) return;
    const main = mainLine(lines);
    if (main) { applyLine(main); return; }
    setLine(fmtLine(Math.floor(P[kind].mu) + 0.5)); setOver(''); setUnder(''); setBooks({});
  }, [kind, period, !!P, lines.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const L = toNum(line);
  const A = useMemo(() => (P && L != null && L >= 0 ? analyzePoints(P, kind, L, { over: toNum(over), under: toNum(under), overBook: books.over, underBook: books.under }) : null), [P, kind, L, over, under, books]);

  if (q.isLoading) return <Loading label={LOADING} />;
  if (q.error) return restart(q.error);
  if (!d || !P) return <Empty>No hay partidos suficientes de estos equipos en este tramo.</Empty>;

  const { away, home } = game;
  const cards: { id: PointKind; title: string; logo?: string; abbr?: string }[] = [
    { id: 'total', title: 'Total del partido' }, { id: 'away', title: away.name, logo: away.logo, abbr: away.abbr }, { id: 'home', title: home.name, logo: home.logo, abbr: home.abbr }
  ];
  const label = POINT_PERIODS.find(p => p.id === period)!.label;
  const pre = period === 'game' ? '' : `${label} · `;
  const market = kind === 'total' ? `${pre}Total de puntos` : `${pre}Puntos de ${kind === 'away' ? away.abbr : home.abbr}`;
  const f = pointValues(kind);
  const chartA = kind === 'total' ? `Total en partidos de ${away.abbr}` : kind === 'away' ? `Anota ${away.abbr}` : `Encaja ${away.abbr}`;
  const chartB = kind === 'total' ? `Total en partidos de ${home.abbr}` : kind === 'home' ? `Anota ${home.abbr}` : `Encaja ${home.abbr}`;
  const h2h = P.rowsHome.filter(r => r.oppId === away.id).slice(0, 6);
  const season = d.currentSeason;
  return (
    <div className="flex flex-col gap-2.5">
      <TvFrame>
        <TvHeader title="Puntos" sub={`${LEAGUE_NAME[game.league]}: proyección con lo anterior al partido`}><PeriodTabs value={period} onChange={setPeriod} /></TvHeader>
        <div className="grid grid-cols-1 divide-y divide-white/10 md:grid-cols-3 md:divide-x md:divide-y-0">
          {cards.map(c => {
            const x = P[c.id], main = mainLine(pointLines(odds, c.id, period));
            return (
              <button key={c.id} onClick={() => setKind(c.id)} aria-pressed={kind === c.id} className={cn('flex cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition', kind === c.id ? 'bg-amber-500/10 shadow-[inset_0_-2px_0_var(--acc-500)]' : 'hover:bg-white/[.04]')}>
                {c.abbr && <TeamLogo src={c.logo} name={c.abbr} size={30} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-score text-[13px] font-semibold uppercase tracking-wide text-zinc-300">{c.title}</span>
                  <span className="block font-score text-[30px] font-bold leading-none text-white">{dec(x.mu)}</span>
                  <span className="block font-score text-[12px] text-zinc-400 tnum" title="Entre estos valores cae el 80 % de las veces, según el modelo">{dec(x.mu - 1.2816 * x.sd, 0)}–{dec(x.mu + 1.2816 * x.sd, 0)}{main ? ` · casas: ${fmtLine(main.line)}` : ''}</span>
                </span>
              </button>
            );
          })}
        </div>
      </TvFrame>

      <div className={cn(panel, 'flex flex-col gap-2 px-3.5 py-2.5')}>
        <div className="grid grid-cols-3 gap-3 md:max-w-lg">
          <Lbl label="Línea"><Input inputMode="decimal" value={line} onChange={e => setLine(e.target.value)} /></Lbl>
          <Lbl label="Cuota Más"><Input inputMode="decimal" placeholder="1,85" value={over} onChange={e => { setOver(e.target.value); setBooks(b => ({ ...b, over: undefined })); }} /></Lbl>
          <Lbl label="Cuota Menos"><Input inputMode="decimal" placeholder="1,95" value={under} onChange={e => { setUnder(e.target.value); setBooks(b => ({ ...b, under: undefined })); }} /></Lbl>
        </div>
        {!!lines.length && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 text-zinc-500">En las casas:</span>
            {lines.map(l => (
              <button key={l.line} onClick={() => applyLine(l)} title={`Más ${odd(l.over)} (${l.overBook ?? '–'}) · Menos ${odd(l.under)} (${l.underBook ?? '–'})`}
                className={cn('cursor-pointer rounded-full border px-2.5 py-1 tnum transition', L === l.line ? 'border-amber-500/60 bg-amber-500/10 text-amber-300' : 'border-zinc-800 text-zinc-300 hover:border-zinc-700')}>
                {fmtLine(l.line)} <span className="text-zinc-500">{odd(l.over)} / {odd(l.under)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!A || L == null ? <Empty>Escribe una línea válida (por ejemplo 225,5)</Empty> : (
        <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2">
          <ValuePanel bank={bank} v={A} onSlip={s => addToSlip({
            sport: 'basket', status: 'pending', league: LEAGUE_NAME[game.league], event: `${away.abbr} @ ${home.abbr}`, market, selection: `${SIDE_LABEL[s.side]} de ${L}`, odds: s.price, bookmaker: s.book
          })} />
          <div className="flex flex-col gap-2.5">
            <Panel title={market} aside={`Modelo ${pct(A.modelOver)} · histórico ${pct(A.histOver)} de Más`}>
              <div className="divide-y divide-white/10">
                <LineChart title={chartA} rows={P.rowsAway} value={f.a} line={L} />
                <LineChart title={chartB} rows={P.rowsHome} value={f.b} line={L} />
              </div>
            </Panel>
            <Panel title={`Frecuencia frente a ${fmtLine(L)}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-white/10">
                <LineHits title={chartA} rows={P.rowsAway} value={f.a} line={L} season={season} home={false} />
                <LineHits title={chartB} rows={P.rowsHome} value={f.b} line={L} season={season} home />
              </div>
            </Panel>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2">
        <Panel title={`${away.name}: ${label.toLowerCase()}`}><SplitsTable splits={pointSplits(P.rowsAway, season)} value={f.a} line={L} /></Panel>
        <Panel title={`${home.name}: ${label.toLowerCase()}`}><SplitsTable splits={pointSplits(P.rowsHome, season)} value={f.b} line={L} /></Panel>
      </div>
      {!!h2h.length && <Panel title={`${home.abbr} contra ${away.abbr}: ${label.toLowerCase()}`}><RowsTable rows={h2h} value={r => r.total} line={kind === 'total' ? L : null} /></Panel>}
      <p className="px-1 text-xs text-zinc-500">Parte de la media de la liga y suma lo que el equipo anota y su rival encaja por encima de ella, con el factor campo. No tiene en cuenta las bajas ni el cansancio: míralas en la pestaña Equipos. En la NBA falla el total por unos 15 puntos de media, y a principio de temporada, cuando sale muy lejos de la media de la liga, se pasa unos 7. Es una referencia, no una predicción.</p>
    </div>
  );
}

function LineHits({ title, rows, value, line, season, home }: { title: string; rows: TeamRow[]; value: (r: TeamRow) => number; line: number; season: number; home: boolean }) {
  const cur = rows.filter(r => r.season === season);
  const list: [string, TeamRow[]][] = [['Últimos 5', rows.slice(0, 5)], ['Últimos 10', rows.slice(0, 10)], ['Últimos 20', rows.slice(0, 20)], ['Esta temporada', cur], [home ? 'En casa' : 'Fuera', cur.filter(r => r.home === home)]];
  return (
    <div className="min-w-0">
      <div className="truncate px-3 pt-2 text-[13px] font-medium text-zinc-200">{title}</div>
      <table className="w-full">
        <thead><tr><th className={th}>Tramo</th><th className={th + ' text-right'}>PJ</th><th className={th + ' text-right'}>Media</th><th className={th + ' text-right'}>% Más</th></tr></thead>
        <tbody className="divide-y divide-zinc-800/50">
          {list.map(([label, l]) => {
            const v = l.map(value), rate = overRate(v, line);
            return <tr key={label}><td className={tdc + ' whitespace-nowrap'}>{label}</td><td className={tdc + ' text-right text-zinc-400 tnum'}>{l.length}</td><td className={tdc + ' text-right tnum'}>{dec(avg(v))}</td><td className={cn(tdc, 'text-right font-medium tnum', hitCls(rate))}>{rate == null ? '–' : pct(rate)}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
