// Acierto del modelo (panel de administración): las recomendaciones que ha hecho la app en los cinco deportes, se apostaran o no,
// ya resueltas, frente a lo que decía. ¿Cuando dice 60 % sale un 60 %? ¿Daría dinero apostar 1 unidad a cada una? ¿En qué
// competiciones, mercados y casas? ¿Acierta más el modelo o la casa? ¿Se mueve la cuota hacia lo que decía (CLV)? Las guarda
// bets.predictions (server/services/bets/predictions.js) y sólo las ven los administradores (/api/admin/predictions).
import { useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { cn, odd, pct, tone } from '@/lib/format';
import { verdictOf } from '@/lib/value';
import type { PredictionRow, Sport } from '@/lib/types';
import { Button, chip, Empty, ErrorBox, Loading, Tabs } from '@/components/ui';
import { Panel, panel, TvTabs } from '@/components/viz';

type SportF = 'all' | Sport;
type RangeF = '30' | '90' | 'all';
type ScopeF = 'picks' | 'lines';
type GroupF = 'league' | 'market' | 'price' | 'ev' | 'book' | 'sport';

// De baloncesto se guardan todas las líneas que calcula el modelo; recomendadas son las que la app enseña como de valor
// (hasValue en basket-picks.ts). De tenis, fútbol y MMA sólo se guardan las que enseña
const isPick = (r: PredictionRow) => r.sport !== 'basket' || verdictOf(r.ev, r.rel ?? 0) === 'BET';

const SPORT_NAME: Record<string, string> = { basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA', lol: 'LoL' };
const SPORT_ORDER: Sport[] = ['basket', 'tennis', 'football', 'mma', 'lol'];
// La competición tal como se guarda (en baloncesto, el código de la liga en mayúsculas) y cómo se enseña
const LEAGUE_NAME: Record<string, string> = { NBA: 'NBA', WNBA: 'WNBA', NBL: 'NBL', EUROLEAGUE: 'Euroliga', EUROCUP: 'EuroCup' };
const leagueName = (l: string) => LEAGUE_NAME[l] ?? (l || 'Sin competición');
// Movimiento de la cuota desde la primera vez que se recomendó hasta la última antes de empezar (CLV): +5 % es que la
// cuota bajó un 5 %, es decir, que el mercado fue hacia lo que decía el modelo. La última es la que se vio por última vez en la
// app antes del partido, que suele estar cerca del cierre, pero no siempre
const clv = (r: PredictionRow) => (r.firstPrice > 1 && r.price > 1 ? r.firstPrice / r.price - 1 : null);
const decided = (r: PredictionRow) => r.status !== 'void';
const won = (r: PredictionRow) => r.status === 'won';
// Beneficio de apostar 1 unidad: la nula devuelve lo apostado
const profit = (r: PredictionRow) => (r.status === 'won' ? r.price - 1 : r.status === 'lost' ? -1 : 0);

// Resumen de un grupo: cuántas, acierto real frente al que esperaba y beneficio a 1 unidad
type Sum = ReturnType<typeof sum>;
function sum(rows: PredictionRow[]) {
  const d = rows.filter(decided);
  const hit = d.length ? d.filter(won).length / d.length : 0;
  const said = d.length ? d.reduce((s, r) => s + r.p, 0) / d.length : 0;
  const pl = rows.reduce((s, r) => s + profit(r), 0);
  return { n: rows.length, decided: d.length, hit, said, pl, roi: rows.length ? pl / rows.length : 0, ev: rows.length ? rows.reduce((s, r) => s + r.ev, 0) / rows.length : 0 };
}
// Margen al 95 % de un porcentaje con n casos: con pocas, la diferencia no dice nada
const margin = (p: number, n: number) => (n ? 1.96 * Math.sqrt(Math.max(p * (1 - p), 0.01) / n) : 1);
// Brier: error cuadrático medio de la probabilidad (0 perfecto; 0,25 es decir siempre 50 %)
const brier = (rows: PredictionRow[], p: (r: PredictionRow) => number | null) => {
  const xs = rows.filter(r => decided(r) && p(r) != null);
  return xs.length ? xs.reduce((s, r) => s + (p(r)! - (won(r) ? 1 : 0)) ** 2, 0) / xs.length : null;
};
const PRICE_BANDS: [number, number, string][] = [[1, 1.5, 'Hasta 1,50'], [1.5, 2, '1,50-2'], [2, 3, '2-3'], [3, 5, '3-5'], [5, 8, '5-8'], [8, 1e9, 'Más de 8']];
const EV_BANDS: [number, number, string][] = [[-99, 0, 'Valor negativo'], [0, 0.05, 'Hasta 5 %'], [0.05, 0.1, '5-10 %'], [0.1, 0.2, '10-20 %'], [0.2, 99, 'Más de 20 %']];
const units = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')} u`;
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${pct(v)}`;
// Fuera del margen por azar: verde si acierta más de lo que decía, rojo si menos
const offTone = (hit: number, said: number, n: number) => (Math.abs(hit - said) > margin(said, n) ? (hit > said ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-50');

function groupRows(rows: PredictionRow[], key: (r: PredictionRow) => string) {
  const m = new Map<string, PredictionRow[]>();
  for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
  return [...m].map(([k, rs]) => ({ key: k, ...sum(rs) })).sort((a, b) => b.n - a.n);
}
const bands = (rows: PredictionRow[], list: [number, number, string][], v: (r: PredictionRow) => number) =>
  list.map(([lo, hi, label]) => ({ key: label, ...sum(rows.filter(r => v(r) >= lo && v(r) < hi)) })).filter(x => x.n);

export default function ModelTab() {
  const q = useQuery({ queryKey: ['admin', 'predictions'], queryFn: () => window.api.admin.predictions(), staleTime: 60e3 });
  const [sport, setSport] = useState<SportF>('all');
  const [range, setRange] = useState<RangeF>('all');
  const [scope, setScope] = useState<ScopeF>('picks');
  // Competición: sólo con un deporte elegido; al cambiar de deporte vuelve a todas
  const [league, setLeague] = useState<string>('all');
  const pickSport = (s: SportF) => { setSport(s); setLeague('all'); };
  const rows = useMemo(() => {
    const since = range === 'all' ? 0 : Date.now() - Number(range) * 864e5;
    return (q.data?.rows ?? []).filter(r => (sport === 'all' || r.sport === sport) && (league === 'all' || r.league === league)
      && +new Date(r.start) >= since && (scope === 'lines' || isPick(r)));
  }, [q.data, sport, league, range, scope]);
  // Sólo los deportes que ya tienen alguna resuelta, y las competiciones del elegido de la que más a la que menos
  const sports = useMemo(() => SPORT_ORDER.filter(s => (q.data?.rows ?? []).some(r => r.sport === s)), [q.data]);
  const leagues = useMemo(() => {
    if (sport === 'all') return [];
    const n = new Map<string, number>();
    for (const r of q.data?.rows ?? []) if (r.sport === sport) n.set(r.league, (n.get(r.league) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  }, [q.data, sport]);

  if (q.isLoading) return <Loading label="Cargando las recomendaciones resueltas…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const data = q.data!;

  const toolbar = (
    <div className={cn(panel, 'mb-4 flex flex-col gap-3 p-3 sm:p-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={sport} onChange={pickSport} items={[{ value: 'all' as SportF, label: 'Todo' }, ...sports.map(s => ({ value: s as SportF, label: SPORT_NAME[s] }))]} />
        <Tabs value={range} onChange={setRange} items={[{ value: '30', label: '30 días' }, { value: '90', label: '90 días' }, { value: 'all', label: 'Siempre' }]} />
        <Tabs value={scope} onChange={setScope} items={[{ value: 'picks', label: 'Recomendadas' }, { value: 'lines', label: 'Todas las líneas' }]} />
        <span className="text-xs text-zinc-500 lg:ml-auto">{data.pending} por resolver{data.since ? ` · desde el ${new Date(data.since).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}` : ''}</span>
      </div>
      {leagues.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/70 pt-3" role="group" aria-label="Competición">
          {[{ v: 'all', label: 'Todas' }, ...leagues.map(l => ({ v: l, label: leagueName(l) }))].map(x => (
            <button key={x.v} type="button" className={chip(league === x.v)} aria-pressed={league === x.v} onClick={() => setLeague(x.v)}>{x.label}</button>
          ))}
        </div>
      )}
    </div>
  );
  if (!rows.length) return (
    <>
      {toolbar}
      <Empty>
        Todavía no hay recomendaciones resueltas{sport !== 'all' ? ` de ${league !== 'all' ? leagueName(league) : SPORT_NAME[sport].toLowerCase()}` : ''}{scope === 'picks' && (sport === 'basket' || sport === 'all') ? ' entre las recomendadas (prueba con «Todas las líneas»)' : ''}.
        Se guardan todas las líneas que calcula el modelo de baloncesto y las recomendaciones de tenis, fútbol y MMA que se ven en la app; cuando
        acaban sus partidos se resuelven solas y salen aquí. Hacen falta unas cuantas decenas para que las cifras digan algo.
      </Empty>
    </>
  );

  const S = sum(rows);
  const nWon = rows.filter(won).length, nVoid = S.n - S.decided, nLost = S.decided - nWon;
  const m = margin(S.said, S.decided);
  const verdict = S.decided < 30 ? 'Todavía son pocas para sacar conclusiones.'
    : Math.abs(S.hit - S.said) <= m ? `Calibrado: la diferencia con lo que esperaba cabe en lo que da el azar con ${S.decided.toLocaleString('es-ES')} casos (±${pct(m)}).`
    : S.hit < S.said ? 'Acierta menos de lo que dice: el modelo es optimista.' : 'Acierta más de lo que dice: el modelo es prudente.';
  const clvs = rows.map(clv).filter((v): v is number => v != null);
  const clvAvg = clvs.length ? clvs.reduce((a, v) => a + v, 0) / clvs.length : null;
  const clvBeat = clvs.length ? clvs.filter(v => v > 0).length / clvs.length : null;
  // Calibración por tramos de probabilidad
  const buckets = [[0, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
    const rs = rows.filter(r => decided(r) && r.p >= lo && r.p < hi);
    return { lo, hi, ...sum(rs) };
  }).filter(b => b.n);
  // Quién acierta más, con las mismas recomendaciones: el modelo solo, la casa sin margen o la mezcla que enseña la app
  const both = rows.filter(r => r.pModel != null && r.pMarket != null);
  const briers = [['El modelo solo', brier(both, r => r.pModel)], ['La casa, sin su margen', brier(both, r => r.pMarket)], ['Lo que enseña la app', brier(both, r => r.p)]] as const;
  // La cuota entre la primera y la última vez que se recomendó: si baja, el mercado se movió hacia lo que decía el modelo
  const moved = rows.filter(r => r.firstPrice && r.price !== r.firstPrice);
  const down = moved.filter(r => r.price < r.firstPrice).length;

  const groups: Record<GroupF, { label: string; rows: (Sum & { key: string })[] }> = {
    league: { label: 'Competición', rows: groupRows(rows, r => (sport === 'all' ? `${SPORT_NAME[r.sport] ?? r.sport} · ` : '') + leagueName(r.league)) },
    market: { label: 'Mercado', rows: groupRows(rows, r => (sport === 'all' ? `${SPORT_NAME[r.sport] ?? r.sport} · ` : '') + r.group) },
    price: { label: 'Cuota', rows: bands(rows, PRICE_BANDS, r => r.price) },
    ev: { label: 'Valor que veía', rows: bands(rows, EV_BANDS, r => r.ev) },
    book: { label: 'Casa', rows: groupRows(rows, r => r.book || 'Sin casa') },
    sport: { label: 'Deporte', rows: groupRows(rows, r => SPORT_NAME[r.sport] ?? r.sport) }
  };

  return (
    <>
      {toolbar}

      <section className={cn(panel, 'mb-4 grid overflow-hidden 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')} aria-label="Resumen">
        <div className="flex flex-col gap-3 border-b border-zinc-800 p-5 2xl:border-b-0 2xl:border-r">
          <div className="label-data text-zinc-400">Acierto</div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={cn('font-score text-5xl font-semibold leading-none tracking-tight tnum', offTone(S.hit, S.said, S.decided))}>{pct(S.hit)}</span>
            <span className="text-sm text-zinc-400">esperaba <span className="text-zinc-200 tnum">{pct(S.said)}</span></span>
          </div>
          <HitBar hit={S.hit} said={S.said} band={m} tall />
          <p className="text-[13px] leading-5 text-zinc-300">{verdict}</p>
        </div>
        <div className="grid grid-cols-1 divide-y divide-zinc-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Metric label="Resueltas" value={S.n.toLocaleString('es-ES')}
            sub={<><span className="text-emerald-400">{nWon} ganadas</span> · <span className="text-rose-400">{nLost} perdidas</span>{nVoid ? ` · ${nVoid} nulas` : ''}</>}>
            <SplitBar won={nWon} lost={nLost} none={nVoid} />
          </Metric>
          <Metric label="A 1 unidad cada una" value={units(S.pl)} valueClass={tone(S.pl)} sub={<>ROI <span className={tone(S.roi)}>{signedPct(S.roi)}</span> · esperaba {signedPct(S.ev)}</>} />
          <Metric label="Movimiento de la cuota" value={clvAvg == null ? '–' : signedPct(clvAvg)} valueClass={clvAvg == null ? undefined : tone(clvAvg)}
            sub={clvBeat == null ? 'sin datos' : `bajó en el ${pct(clvBeat)} · cuota media ${odd(rows.reduce((s, r) => s + r.price, 0) / rows.length)}`} />
        </div>
      </section>
      {S.decided < 100 && <p className="-mt-2 mb-4 text-xs text-zinc-500">Con menos de 100 resueltas, las cifras se mueven mucho de un día a otro: míralas como orientación.</p>}

      <ProfitCurve rows={rows} />

      <div className="mb-4 grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <Panel title="¿Cuando dice X %, sale X %?" aside="Calibración">
          <div className="flex flex-col gap-3 p-4">
            {buckets.map(b => (
              <div key={b.lo} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-xs text-zinc-400 tnum">{Math.round(b.lo * 100)}-{Math.min(100, Math.round(b.hi * 100))} %</span>
                <HitBar hit={b.hit} said={b.said} band={margin(b.said, b.decided)} />
                <span className="w-[104px] text-right text-xs tnum">
                  <span className={cn('font-semibold', offTone(b.hit, b.said, b.decided))}>{pct(b.hit)}</span>
                  <span className="text-zinc-500"> · {b.decided}</span>
                </span>
              </div>
            ))}
            <Legend>
              <span><i className="mr-1.5 inline-block h-2 w-3 rounded-sm bg-zinc-400 align-middle" />lo que salió</span>
              <span><i className="mr-1.5 inline-block h-3 w-0.5 bg-amber-400 align-middle" />lo que decía</span>
              <span><i className="mr-1.5 inline-block h-2 w-3 rounded-sm bg-zinc-700 align-middle" />margen por azar</span>
              <span>verde o rojo: fuera del margen · el número pequeño son los casos</span>
            </Legend>
          </div>
        </Panel>

        <Panel title="¿Quién acierta más?" aside="Brier: más bajo, mejor">
          <div className="flex flex-col gap-3 p-4">
            {both.length < 20 ? <p className="text-[13px] text-zinc-400">Hacen falta al menos 20 recomendaciones con la probabilidad de la casa para compararlas.</p> : (
              <>
                {briers.map(([label, v]) => {
                  const best = v != null && v === Math.min(...briers.map(([, x]) => x ?? 9));
                  return (
                    <div key={label} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className={best ? 'text-zinc-100' : 'text-zinc-400'}>{label}</span>
                        <span className={cn('font-semibold tnum', best ? 'text-emerald-400' : 'text-zinc-100')}>{v?.toFixed(4).replace('.', ',')}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-800">
                        <div className={cn('h-full rounded-full', best ? 'bg-emerald-500/80' : 'bg-zinc-500')} style={{ width: `${Math.min(100, ((v ?? 0) / 0.3) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs leading-5 text-zinc-500">Sobre las mismas {both.length} {scope === 'lines' ? 'líneas' : 'recomendaciones'}; 0,25 es decir siempre 50 %. Para decidir cuánto debe pesar el modelo, mira «Todas las líneas»: en las recomendadas, que son justo en las que no está de acuerdo con la casa, la casa sale siempre mejor.</p>
                {moved.length >= 10 && (
                  <p className="border-t border-zinc-800/70 pt-3 text-xs leading-5 text-zinc-400">
                    La cuota bajó en el <span className="font-semibold text-zinc-100">{Math.round((down / moved.length) * 100)} %</span> de las {moved.length} que se movieron mientras se recomendaban: si es más de la mitad, el mercado tiende a ir hacia lo que decía el modelo.
                  </p>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>

      <Breakdown groups={groups} sportAll={sport === 'all'} />
      <RecentResolved rows={rows} />
    </>
  );
}

// Una cifra de la cabecera
function Metric({ label, value, sub, valueClass, children }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1.5 p-5">
      <div className="label-data text-zinc-400">{label}</div>
      <div className={cn('whitespace-nowrap font-score text-[26px] font-semibold leading-8 tracking-tight tnum text-zinc-50', valueClass)}>{value}</div>
      {children}
      {sub && <div className="text-xs leading-5 text-zinc-500">{sub}</div>}
    </div>
  );
}

// Lo que salió (barra), lo que decía (raya del acento) y el margen por azar alrededor de lo que decía (franja)
function HitBar({ hit, said, band, tall }: { hit: number; said: number; band: number; tall?: boolean }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`;
  return (
    <div className={cn('relative rounded-full bg-zinc-800/80', tall ? 'h-3' : 'h-2')}>
      <div className="absolute inset-y-0 rounded-full bg-zinc-700" style={{ left: at(said - band), width: `calc(${at(said + band)} - ${at(said - band)})` }} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-zinc-400" style={{ width: at(hit) }} />
      <div className={cn('absolute w-0.5 rounded-full bg-amber-400', tall ? '-inset-y-1' : '-inset-y-0.5')} style={{ left: `calc(${at(said)} - 1px)` }} />
    </div>
  );
}

// Ganadas, perdidas y nulas en una barra
function SplitBar({ won: w, lost: l, none: v }: { won: number; lost: number; none: number }) {
  const t = w + l + v || 1;
  return (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      <div className="bg-emerald-500/80" style={{ width: `${(w / t) * 100}%` }} />
      <div className="bg-rose-500/80" style={{ width: `${(l / t) * 100}%` }} />
      {v > 0 && <div className="bg-zinc-600" style={{ width: `${(v / t) * 100}%` }} />}
    </div>
  );
}

const Legend = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-800/70 pt-3 text-[11px] text-zinc-500">{children}</div>;

// Desglose en un solo panel: competición, mercado, cuota, valor, casa y deporte
function Breakdown({ groups, sportAll }: { groups: Record<GroupF, { label: string; rows: (Sum & { key: string })[] }>; sportAll: boolean }) {
  const [by, setBy] = useState<GroupF>('league');
  const keys = (Object.keys(groups) as GroupF[]).filter(k => k !== 'sport' || sportAll);
  const cur = keys.includes(by) ? by : 'league';
  const list = groups[cur].rows;
  return (
    <Panel title="Desglose" aside={`${list.length} grupo${list.length === 1 ? '' : 's'}`} className="mb-4">
      <div className="border-b border-zinc-800/70 px-4 py-3">
        <TvTabs value={cur} onChange={setBy} items={keys.map(k => ({ value: k, label: groups[k].label }))} />
      </div>
      <div className="hidden grid-cols-[minmax(0,2fr)_64px_minmax(0,1.6fr)_88px_64px] gap-4 px-4 pt-3 text-[11px] text-zinc-500 sm:grid">
        <span /><span className="text-right">Casos</span><span>Acierto · esperaba</span><span className="text-right">A 1 unidad</span><span className="text-right">ROI</span>
      </div>
      <ul className="divide-y divide-zinc-800/60">
        {list.map(r => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_64px_minmax(0,1.6fr)_88px_64px]">
            <span className="truncate text-[13px] text-zinc-100" title={r.key}>{r.key}</span>
            <span className="hidden text-right text-[13px] text-zinc-400 tnum sm:block">{r.n.toLocaleString('es-ES')}</span>
            <div className="order-3 col-span-2 flex items-center gap-3 sm:order-none sm:col-span-1">
              <div className="min-w-0 flex-1"><HitBar hit={r.hit} said={r.said} band={margin(r.said, r.decided)} /></div>
              <span className="shrink-0 text-xs tnum"><span className={cn('font-semibold', offTone(r.hit, r.said, r.decided))}>{pct(r.hit)}</span><span className="text-zinc-500"> · {pct(r.said)}</span></span>
            </div>
            <span className={cn('text-right text-[13px] font-semibold tnum', tone(r.pl))}>{units(r.pl)}<span className="font-normal text-zinc-500 sm:hidden"> · {r.n}</span></span>
            <span className={cn('hidden text-right text-[13px] tnum sm:block', tone(r.roi))}>{signedPct(r.roi)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type ResultF = 'all' | 'won' | 'lost';
type OrderF = 'recent' | 'high' | 'low';
const PAGE = 15;

// Últimas resueltas, con filtro por resultado y orden por cuota (las de cuota alta ganadas son las que más pesan en el beneficio)
function RecentResolved({ rows }: { rows: PredictionRow[] }) {
  const [result, setResult] = useState<ResultF>('all');
  const [order, setOrder] = useState<OrderF>('recent');
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => {
    const xs = rows.filter(r => result === 'all' || r.status === result);
    // Las filas llegan de la más reciente a la más antigua; a igual cuota, se queda ese orden
    if (order === 'recent') return xs;
    return [...xs].sort((a, b) => (order === 'high' ? b.price - a.price : a.price - b.price));
  }, [rows, result, order]);
  const pick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setShown(PAGE); };
  return (
    <Panel title="Últimas resueltas" aside={`${list.length.toLocaleString('es-ES')} en total`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/70 px-4 py-3">
        {([['all', 'Todas'], ['won', 'Ganadas'], ['lost', 'Perdidas']] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => pick(setResult)(v)} aria-pressed={result === v} className={chip(result === v)}>{l}</button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-zinc-800 sm:block" />
        {([['recent', 'Más recientes'], ['high', 'Más cuota'], ['low', 'Menos cuota']] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => pick(setOrder)(v)} aria-pressed={order === v} className={chip(order === v)}>{l}</button>
        ))}
      </div>
      {!list.length ? <p className="px-4 py-5 text-[13px] text-zinc-400">No hay {result === 'won' ? 'ganadas' : 'perdidas'} con estos filtros.</p> : (
        <ul className="divide-y divide-zinc-800/60">
          {list.slice(0, shown).map((r, i) => (
            <li key={i} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="line-clamp-2 text-[13px] font-medium text-zinc-100">{r.title}</div>
                <div className="mt-0.5 truncate text-xs text-zinc-500">
                  {new Date(r.start).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · {r.event}{r.league ? ` · ${leagueName(r.league)}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-4 text-right">
                <div className="hidden sm:block"><div className="text-[11px] text-zinc-500">decía</div><div className="text-[13px] text-zinc-300 tnum">{pct(r.p)}</div></div>
                <div><div className="text-[11px] text-zinc-500">cuota</div><div className="text-[13px] font-semibold text-zinc-100 tnum">{odd(r.price)}</div></div>
                <div className="w-24 sm:w-32">
                  <div className={cn('text-[13px] font-semibold', r.status === 'won' ? 'text-emerald-400' : r.status === 'lost' ? 'text-rose-400' : 'text-zinc-400')}>
                    {r.status === 'won' ? 'Ganada' : r.status === 'lost' ? 'Perdida' : 'Nula'}
                  </div>
                  {r.result && <div className="truncate text-[11px] text-zinc-500" title={r.result}>{r.result}</div>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.length > shown && (
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800/70 px-4 py-3">
          <span className="text-xs text-zinc-500">{shown} de {list.length.toLocaleString('es-ES')}</span>
          <Button variant="secondary" size="sm" onClick={() => setShown(s => s + PAGE)}>Ver {Math.min(PAGE, list.length - shown)} más</Button>
        </div>
      )}
    </Panel>
  );
}

// Beneficio acumulado a 1 unidad por recomendación, día a día, frente a lo que esperaba el modelo (la suma de sus EV). Si la línea
// real va muy por debajo de la esperada durante semanas, el modelo es optimista
function ProfitCurve({ rows }: { rows: PredictionRow[] }) {
  const data = useMemo(() => {
    const byDay = new Map<string, { pl: number; ev: number }>();
    for (const r of rows) {
      const d = new Date(r.start).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
      const x = byDay.get(d) ?? { pl: 0, ev: 0 };
      x.pl += profit(r); x.ev += r.ev;
      byDay.set(d, x);
    }
    let pl = 0, ev = 0;
    return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([d, x]) => {
      pl += x.pl; ev += x.ev;
      return { d: new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), pl: +pl.toFixed(2), ev: +ev.toFixed(2) };
    });
  }, [rows]);
  if (data.length < 2) return null;
  const last = data[data.length - 1];
  return (
    <Panel title="Beneficio acumulado" aside="a 1 unidad por recomendación" className="mb-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 pt-3">
        <div><div className="text-[11px] text-zinc-500">real</div><div className={cn('font-score text-lg font-semibold tnum', tone(last.pl))}>{units(last.pl)}</div></div>
        <div><div className="text-[11px] text-zinc-500">lo que esperaba el modelo</div><div className={cn('font-score text-lg font-semibold tnum', tone(last.ev))}>{units(last.ev)}</div></div>
      </div>
      <div className="h-56 px-2 pb-3 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="#2b3034" vertical={false} />
            <XAxis dataKey="d" stroke="#85948f" fontSize={10} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} width={48} />
            <ReferenceLine y={0} stroke="#52525b" />
            <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }} labelStyle={{ color: '#d4d4d8' }}
              formatter={(v, name) => [units(Number(v)), name === 'pl' ? 'Real' : 'Esperado']} />
            <Area dataKey="ev" type="monotone" stroke="#85948f" strokeDasharray="4 4" fill="none" dot={false} isAnimationActive={false} />
            <Area dataKey="pl" type="monotone" stroke="var(--acc-400)" strokeWidth={2} fill="var(--acc-400)" fillOpacity={0.08} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
