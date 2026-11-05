// Estadísticas de juego de un tenista (TennisMyLife): cada dato frente a la media del circuito, con la superficie como
// filtro de toda la pantalla, y los dos jugadores de un partido frente a frente
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/format';
import type { TennisStatBlock as Block, TennisStatPeriod, TennisStats as Stats, TennisSurface, Tour } from '@/lib/types';
import { Empty, ErrorBox, Loading, th } from './ui';
import { KpiStrip, TvBand, TvFrame, TvHeader, TvPortrait, TvRow, TvTabs, surname, tdc } from './viz';

export const SURFACE_ES: Record<TennisSurface, string> = { Hard: 'Pista dura', Clay: 'Tierra', Grass: 'Hierba' };
// Validados con el comprobador de paletas sobre el fondo oscuro, también para daltonismo
export const SURFACE_COLOR: Record<TennisSurface, string> = { Hard: '#3f7fdc', Clay: '#d9692a', Grass: '#1f9e6a' };
const SURFACES: TennisSurface[] = ['Hard', 'Clay', 'Grass'];
type Pick = TennisSurface | 'all';
const MIN = 5;

const p1 = (v: number | null | undefined) => (v == null ? '–' : `${(v * 100).toFixed(1).replace('.', ',')} %`);
const n1 = (v: number | null | undefined) => (v == null ? '–' : v.toFixed(1).replace('.', ','));
const n0 = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('es-ES'));

// spread: distancia a la media que llena media barra. En puntos porcentuales, porque cada estadística se mueve en un rango
// distinto: 6 puntos de primer saque es muchísimo y 6 de juegos al resto, normal. Sin spread, proporcional a la media
type Metric = { label: string; key: keyof Block; pct?: boolean; better?: 'low'; spread?: number };
const SERVE: Metric[] = [
  { label: 'Primer saque dentro', key: 'firstInPct', pct: true, spread: 0.1 }, { label: 'Puntos con el 1.º', key: 'firstWonPct', pct: true, spread: 0.1 }, { label: 'Puntos con el 2.º', key: 'secondWonPct', pct: true, spread: 0.1 },
  { label: 'Juegos de saque ganados', key: 'holdPct', pct: true, spread: 0.2 }, { label: 'Bolas de break salvadas', key: 'bpSavedPct', pct: true, spread: 0.15 },
  { label: 'Aces por partido', key: 'acesPerMatch' }, { label: 'Dobles faltas por partido', key: 'dfPerMatch', better: 'low' }, { label: 'Breaks en contra por partido', key: 'bpFacedPerMatch', better: 'low' }
];
const RETURN: Metric[] = [
  { label: 'Puntos al 1.º del rival', key: 'ret1Pct', pct: true, spread: 0.1 }, { label: 'Puntos al 2.º del rival', key: 'ret2Pct', pct: true, spread: 0.1 }, { label: 'Puntos ganados al resto', key: 'retPtsPct', pct: true, spread: 0.1 },
  { label: 'Juegos de resto ganados', key: 'breakPct', pct: true, spread: 0.2 }, { label: 'Bolas de break convertidas', key: 'bpConvPct', pct: true, spread: 0.15 },
  { label: 'Ocasiones de break por partido', key: 'bpChancesPerMatch' }, { label: 'Aces recibidos por partido', key: 'acesAgainstPerMatch', better: 'low' }
];
const num = (b: Block, k: keyof Block) => b[k] as number | null;
const fmt = (m: { pct?: boolean }, v: number | null) => (m.pct ? p1(v) : n1(v));

export const useTennisStats = (tour: Tour, id: string | undefined) => useQuery({
  queryKey: ['tennis', 'stats', tour, id], queryFn: () => window.api.tennis.stats(tour, id!), enabled: !!id, staleTime: 30 * 60e3, retry: false
});

const fail = (e: unknown) => /No handler registered|is not a function/.test(String(e))
  ? <ErrorBox error="La app tiene que reiniciarse para ver las estadísticas">Para <code>npm run dev</code> (Ctrl+C) y vuelve a lanzarlo.</ErrorBox>
  : <ErrorBox error={e} />;

const sourceLine = (s: Stats) => `${s.source}${s.updated ? `, hasta ${new Date(s.updated + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : ''}. Sin W.O. Uso personal.`;

// Ratio de dominio: puntos ganados al resto entre puntos perdidos al saque. Por encima de 1 gana más de los que cede
const dominance = (b: Block) => (b.retPtsPct == null || b.servePtsPct == null || b.servePtsPct >= 1 ? null : b.retPtsPct / (1 - b.servePtsPct));
const DR_TITLE = 'Ratio de dominio: % de puntos ganados al resto entre % de puntos perdidos al saque. Por encima de 1, gana más puntos de los que cede.';
const dr = (v: number | null) => (v == null ? '–' : v.toFixed(2).replace('.', ','));

export function TennisStatsPanel({ tour, id, name, photo, credit }: { tour: Tour; id: string; name: string; photo: string; credit?: string }) {
  const q = useTennisStats(tour, id);
  const [key, setKey] = useState<string>();
  const [pick, setPick] = useState<Pick>('all');
  const [table, setTable] = useState(false);
  if (q.isLoading) return <Loading label="Calculando sus estadísticas…" />;
  if (q.error) return <div className="p-3">{fail(q.error)}</div>;
  const s = q.data;
  if (!s?.found || !s.periods.length) return <div className="p-3"><Empty>Sin estadísticas de este jugador en TennisMyLife.</Empty></div>;
  const p = s.periods.find(x => x.key === key) ?? s.periods[0];
  // Al cambiar de año, una superficie sin partidos no puede quedar elegida
  const cur: Pick = pick !== 'all' && p.surfaces[pick].matches ? pick : 'all';
  const b = cur === 'all' ? p.total : p.surfaces[cur], avg = p.tour[cur];
  const dim = b.matches < MIN;
  const delta = (k: keyof Block) => { const v = num(b, k), r = num(avg, k); if (v == null || r == null) return ''; const d = (v - r) * 100; return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1).replace('.', ',')} vs. media`; };
  const score = dominance(b);
  const row = (m: Metric) => <TvRow key={m.key} label={m.label} a={num(b, m.key)} b={num(avg, m.key)} aText={fmt(m, num(b, m.key))} bText={fmt(m, num(avg, m.key))} better={m.better} spread={m.spread} muted dim={dim} title={`${m.label}: ${fmt(m, num(b, m.key))}. Media del circuito: ${fmt(m, num(avg, m.key))}`} />;
  const count = (label: string, r: { won: number; lost: number }) => <TvRow key={label} label={label} a={r.won} b={r.lost} aText={n0(r.won)} bText={n0(r.lost)} spread={r.won + r.lost || 1} muted title={`${label}: ${r.won} ganados, ${r.lost} perdidos`} />;
  const heads = <div className="grid grid-cols-2 px-3 pb-0.5 pt-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400"><span className="truncate">{surname(name)}</span><span className="truncate text-right">Media {tour.toUpperCase()}</span></div>;
  const rivals = ([['Top 10', p.vs.top10], ['Puestos 11 a 50', p.vs.top11to50], ['Resto del ranking', p.vs.rest], ['Grand Slam', p.levels.grandSlam], ['Masters / WTA 1000', p.levels.masters], ['Torneos 250 y 500', p.levels.others]] as const).filter(([, r]) => r.won + r.lost);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <TvTabs value={cur} onChange={setPick} items={[
          { value: 'all' as Pick, label: <>Todas <span className="tnum opacity-70">{p.total.won}-{p.total.lost}</span></> },
          ...SURFACES.map(sf => ({
            value: sf as Pick, disabled: !p.surfaces[sf].matches, title: p.best === sf ? 'Su mejor superficie' : p.worst === sf ? 'Su peor superficie' : undefined,
            label: <><span className="h-2 w-2 rounded-full" style={{ background: SURFACE_COLOR[sf] }} />{SURFACE_ES[sf]} <span className="tnum opacity-70">{p.surfaces[sf].won}-{p.surfaces[sf].lost}</span>{p.best === sf ? <span className="font-bold">· Mejor</span> : p.worst === sf ? <span className="font-bold">· Peor</span> : null}</>
          }))
        ]} />
        <TvTabs value={p.key} onChange={setKey} items={s.periods.map(x => ({ value: x.key, label: x.label }))} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
        <TvPortrait name={name} photo={photo} side="left" heroLabel="Ratio de dominio" hero={dr(score)} lead={score != null && score > 1} heroTitle={DR_TITLE} />
        <div className="min-w-0 md:border-l md:border-white/10">
          <KpiStrip className="border-b border-white/10" items={[
            { label: 'Victorias', value: p1(b.winPct), sub: `${b.won}-${b.lost}` },
            { label: 'Juegos ganados', value: p1(b.gamesPct), sub: `${n0(b.gamesWon)} - ${n0(b.gamesLost)}` },
            { label: 'Puntos ganados', value: p1(b.totalPtsPct), sub: delta('totalPtsPct') },
            { label: 'Aces por partido', value: n1(b.acesPerMatch), sub: `${n0(b.aces)} en total` }
          ]} />
          {dim && <p className="px-3 pt-1.5 text-xs text-amber-300">Sólo {b.matches} partidos con este filtro: los porcentajes dicen poco.</p>}
          <div className="grid grid-cols-1 2xl:grid-cols-2 xl:divide-x xl:divide-white/10">
            <div className="pb-2"><TvBand>Saque</TvBand>{heads}{SERVE.map(row)}<div className="mt-2"><TvBand>Balance · ganados / perdidos</TvBand></div>{count('Partidos', { won: b.won, lost: b.lost })}{count('Sets', { won: b.setsWon, lost: b.setsLost })}{count('Juegos', { won: b.gamesWon, lost: b.gamesLost })}{count('Tie-breaks', { won: b.tbWon, lost: b.tbLost })}</div>
            <div className="pb-2"><TvBand>Resto</TvBand>{heads}{RETURN.map(row)}{!!rivals.length && <><div className="mt-2"><TvBand>{`Por rival y torneo · ${p.label}`}</TvBand></div>{rivals.map(([l, r]) => count(l, r))}</>}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
        <span>{sourceLine(s)}{b.statMatches < b.matches ? ` Saque y resto: ${b.statMatches} de ${b.matches} partidos.` : ''}{credit ? ` Foto: ${credit}.` : ''}</span>
        <button onClick={() => setTable(v => !v)} className="flex cursor-pointer items-center gap-1 text-zinc-300 hover:text-white"><ChevronDown size={13} className={cn('transition', table && 'rotate-180')} />{table ? 'Ocultar tabla' : 'Ver tabla completa'}</button>
      </div>
      {table && <FullTable p={p} />}
    </>
  );
}

// La versión en tabla de todo lo anterior, con los números exactos por superficie
const TABLE: { title: string; rows: [string, (b: Block) => string][] }[] = [
  { title: 'Resultados', rows: [['Partidos', b => n0(b.matches)], ['Ganados - perdidos', b => `${b.won}-${b.lost}`], ['% de victorias', b => p1(b.winPct)], ['Sets', b => `${b.setsWon}-${b.setsLost}`], ['% de sets', b => p1(b.setsPct)], ['Tie-breaks', b => `${b.tbWon}-${b.tbLost}`], ['% de tie-breaks', b => p1(b.tbPct)]] },
  { title: 'Juegos', rows: [['Ganados', b => n0(b.gamesWon)], ['Perdidos', b => n0(b.gamesLost)], ['% ganados', b => p1(b.gamesPct)], ['Ganados por partido', b => n1(b.gamesWonPerMatch)], ['Perdidos por partido', b => n1(b.gamesLostPerMatch)], ['Total por partido', b => n1(b.gamesPerMatch)], ['Minutos por partido', b => n0(b.minutesPerMatch)]] },
  { title: 'Saque', rows: [['Aces', b => n0(b.aces)], ['Aces por partido', b => n1(b.acesPerMatch)], ['% de aces', b => p1(b.acePct)], ['Dobles faltas', b => n0(b.df)], ['Dobles faltas por partido', b => n1(b.dfPerMatch)], ['% de dobles faltas', b => p1(b.dfPct)], ['Primer saque dentro', b => p1(b.firstInPct)], ['Puntos con el 1.º', b => p1(b.firstWonPct)], ['Puntos con el 2.º', b => p1(b.secondWonPct)], ['Puntos al saque', b => p1(b.servePtsPct)], ['Juegos de saque ganados', b => p1(b.holdPct)], ['Bolas de break salvadas', b => p1(b.bpSavedPct)], ['Breaks en contra por partido', b => n1(b.bpFacedPerMatch)]] },
  { title: 'Resto', rows: [['Puntos al 1.º del rival', b => p1(b.ret1Pct)], ['Puntos al 2.º del rival', b => p1(b.ret2Pct)], ['Puntos al resto', b => p1(b.retPtsPct)], ['Juegos de resto ganados', b => p1(b.breakPct)], ['Bolas de break convertidas', b => p1(b.bpConvPct)], ['Ocasiones de break por partido', b => n1(b.bpChancesPerMatch)], ['Aces recibidos por partido', b => n1(b.acesAgainstPerMatch)], ['Puntos totales', b => p1(b.totalPtsPct)]] }
];

function FullTable({ p }: { p: TennisStatPeriod }) {
  const cols = SURFACES.filter(s => p.surfaces[s].matches);
  return (
    <div className="overflow-x-auto border-t border-white/10">
      <table className="w-full min-w-[640px]">
        <thead className="bg-zinc-900/60"><tr>
          <th className={th}>{p.label}</th><th className={th + ' text-right'}>Total</th><th className={th + ' text-right'}>Circuito</th>
          {cols.map(s => <th key={s} className={th + ' text-right'}>{SURFACE_ES[s]}</th>)}
        </tr></thead>
        {TABLE.map(g => (
          <tbody key={g.title} className="divide-y divide-zinc-800/50">
            <tr><td colSpan={cols.length + 3} className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400">{g.title}</td></tr>
            {g.rows.map(([l, f]) => (
              <tr key={l} className="hover:bg-zinc-800/30">
                <td className={tdc + ' text-zinc-300'}>{l}</td>
                <td className={tdc + ' text-right font-medium tnum'}>{f(p.total)}</td>
                <td className={tdc + ' text-right text-zinc-500 tnum'}>{/%|por partido|Puntos|Juegos de|Bolas/.test(l) ? f(p.tour.all) : ''}</td>
                {cols.map(s => <td key={s} className={tdc + ' text-right text-zinc-400 tnum'}>{f(p.surfaces[s])}</td>)}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

// ---------- Los dos jugadores de un partido ----------
const COMPARE: { title: string; rows: Metric[] }[] = [
  { title: 'General', rows: [{ label: 'Victorias', key: 'winPct', pct: true, spread: 0.3 }, { label: 'Juegos ganados', key: 'gamesPct', pct: true, spread: 0.1 }, { label: 'Puntos ganados', key: 'totalPtsPct', pct: true, spread: 0.05 }, { label: 'Tie-breaks', key: 'tbPct', pct: true, spread: 0.3 }] },
  { title: 'Saque', rows: [{ label: 'Primer saque dentro', key: 'firstInPct', pct: true, spread: 0.1 }, { label: 'Puntos con el 1.º', key: 'firstWonPct', pct: true, spread: 0.1 }, { label: 'Puntos con el 2.º', key: 'secondWonPct', pct: true, spread: 0.1 }, { label: 'Juegos al saque', key: 'holdPct', pct: true, spread: 0.2 }, { label: 'Breaks salvados', key: 'bpSavedPct', pct: true, spread: 0.15 }, { label: 'Aces por partido', key: 'acesPerMatch' }, { label: 'Dobles faltas por partido', key: 'dfPerMatch', better: 'low' }] },
  { title: 'Resto', rows: [{ label: 'Puntos al resto', key: 'retPtsPct', pct: true, spread: 0.1 }, { label: 'Juegos al resto', key: 'breakPct', pct: true, spread: 0.2 }, { label: 'Breaks convertidos', key: 'bpConvPct', pct: true, spread: 0.15 }] }
];

type Side = { id: string; name: string; flag?: string };

export function TennisCompare({ tour, a, b, tournament, city }: { tour: Tour; a: Side; b: Side; tournament: string; city: string }) {
  const qa = useTennisStats(tour, a.id), qb = useTennisStats(tour, b.id);
  // Del perfil sólo hace falta la foto: si falla, salen las iniciales
  const fa = useQuery({ queryKey: ['tennis', 'profile', tour, a.id], queryFn: () => window.api.tennis.profile(tour, a.id), staleTime: 30 * 60e3, retry: false });
  const fb = useQuery({ queryKey: ['tennis', 'profile', tour, b.id], queryFn: () => window.api.tennis.profile(tour, b.id), staleTime: 30 * 60e3, retry: false });
  const sf = useQuery({ queryKey: ['tennis', 'surface', tour, tournament, city], queryFn: () => window.api.tennis.surface(tour, tournament, city), staleTime: 6 * 3600e3, retry: false });
  const [choice, setChoice] = useState<Pick | null>(null);
  const [key, setKey] = useState('52w');
  if (qa.isLoading || qb.isLoading) return <Loading label="Calculando las estadísticas de los dos…" />;
  if (qa.error || qb.error) return fail(qa.error ?? qb.error);
  if (!qa.data?.found || !qb.data?.found) return <Empty>Sin estadísticas de {!qa.data?.found ? a.name : b.name} en TennisMyLife.</Empty>;
  const keys = qa.data.periods.filter(p => qb.data!.periods.some(x => x.key === p.key));
  const cur = keys.find(p => p.key === key) ?? keys[0];
  if (!cur) return <Empty>Sin datos del mismo periodo para los dos.</Empty>;
  const pa = qa.data.periods.find(p => p.key === cur.key)!, pb = qb.data.periods.find(p => p.key === cur.key)!;
  const here = sf.data ?? null;
  const pick: Pick = choice ?? here ?? 'all';
  const blockOf = (p: TennisStatPeriod) => (pick === 'all' ? p.total : p.surfaces[pick]);
  const x = blockOf(pa), y = blockOf(pb);
  const dx = dominance(x), dy = dominance(y);
  const row = (m: Metric) => <TvRow key={m.key} label={m.label} a={num(x, m.key)} b={num(y, m.key)} aText={fmt(m, num(x, m.key))} bText={fmt(m, num(y, m.key))} better={m.better} spread={m.spread} />;
  const line = (s: Side, r: Block) => (
    <div className="grid h-[22px] grid-cols-[minmax(0,9rem)_1.25rem_3rem] items-center gap-2 font-score">
      <span className="truncate text-[17px] font-bold uppercase tracking-wide">{surname(s.name)}</span>
      {s.flag ? <img src={s.flag} alt="" className="h-3 w-5 object-cover" /> : <span />}
      <span className="text-right text-[17px] font-bold tnum">{r.won}-{r.lost}</span>
    </div>
  );
  return (
    <TvFrame className="mx-auto w-full max-w-6xl">
      <TvHeader title="Estadísticas" sub={`${cur.label} · ${pick === 'all' ? 'Todas las superficies' : SURFACE_ES[pick]}`}>
        <div className="flex flex-col">{line(a, x)}{line(b, y)}</div>
        <div className="hidden min-w-0 flex-1 basis-40 text-right font-score lg:block">
          <div className="truncate text-[17px] font-bold uppercase tracking-wide">{tournament}</div>
          <div className="text-[12px] font-medium uppercase tracking-wider text-white/80">{tour.toUpperCase()}{city ? ` · ${city}` : ''}</div>
        </div>
      </TvHeader>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <TvTabs value={pick} onChange={v => setChoice(v)} items={[{ value: 'all' as Pick, label: 'Todas' }, ...SURFACES.map(s => ({ value: s as Pick, label: <><span className="h-2 w-2 rounded-full" style={{ background: SURFACE_COLOR[s] }} />{SURFACE_ES[s]}{here === s ? ' · este torneo' : ''}</> }))]} />
        <TvTabs value={cur.key} onChange={setKey} items={keys.map(p => ({ value: p.key, label: p.label }))} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)_200px] lg:grid-cols-[230px_minmax(0,1fr)_230px]">
        <TvPortrait name={a.name} photo={fa.data?.photo} side="left" heroLabel="Ratio de dominio" hero={dr(dx)} lead={dx != null && dy != null && dx > dy} heroTitle={DR_TITLE} />
        <div className="min-w-0 pb-2">
          {COMPARE.map(g => <div key={g.title}><TvBand>{g.title}</TvBand><div className="pb-1.5">{g.rows.map(row)}</div></div>)}
        </div>
        <TvPortrait name={b.name} photo={fb.data?.photo} side="right" heroLabel="Ratio de dominio" hero={dr(dy)} lead={dx != null && dy != null && dy > dx} heroTitle={DR_TITLE} />
      </div>
      <p className="flex flex-wrap justify-between gap-2 border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
        <span>{sourceLine(qa.data)}{[fa.data?.photoFrom, fb.data?.photoFrom].includes('Wikipedia') ? ' Fotos: ESPN y Wikipedia.' : ''}</span>
        {(x.matches < MIN || y.matches < MIN) && <span className="text-amber-300">Menos de {MIN} partidos con este filtro: dice poco.</span>}
      </p>
    </TvFrame>
  );
}
