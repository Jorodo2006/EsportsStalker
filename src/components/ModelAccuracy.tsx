// Acierto del modelo, de los cinco deportes: las recomendaciones que ha hecho la app (se apostaran o no), ya resueltas, frente
// a lo que decía. ¿Cuando dice 60 % sale un 60 %? ¿Daría dinero apostar 1 unidad a cada una? ¿En qué deportes, mercados y
// casas? ¿Acierta más el modelo o la casa? ¿Se mueve la cuota hacia lo que decía (CLV)? Las guarda bets.predictions
// (server/services/bets/predictions.js).
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { cn, odd, pct, tone } from '@/lib/format';
import { verdictOf } from '@/lib/value';
import type { PredictionRow, Sport } from '@/lib/types';
import { Card, Empty, ErrorBox, Loading, Stat, Tabs, td, th } from './ui';

type SportF = 'all' | Sport;
type RangeF = '30' | '90' | 'all';
type ScopeF = 'picks' | 'lines';

// De baloncesto se guardan todas las líneas que calcula el modelo; recomendadas son las que la app enseña como de valor
// (hasValue en basket-picks.ts). De tenis y fútbol sólo se guardan las que enseña
const isPick = (r: PredictionRow) => r.sport !== 'basket' || verdictOf(r.ev, r.rel ?? 0) === 'BET';

const SPORT_NAME: Record<string, string> = { basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA', lol: 'LoL' };
const SPORT_ORDER: Sport[] = ['basket', 'tennis', 'football', 'mma', 'lol'];
// Movimiento de la cuota desde la primera vez que se recomendó hasta la última antes de empezar (CLV): +5 % es que la
// cuota bajó un 5 %, es decir, que el mercado fue hacia lo que decía el modelo. La última es la que se vio por última vez en la
// app antes del partido, que suele estar cerca del cierre, pero no siempre
const clv = (r: PredictionRow) => (r.firstPrice > 1 && r.price > 1 ? r.firstPrice / r.price - 1 : null);
const decided = (r: PredictionRow) => r.status !== 'void';
const won = (r: PredictionRow) => r.status === 'won';
// Beneficio de apostar 1 unidad: la nula devuelve lo apostado
const profit = (r: PredictionRow) => (r.status === 'won' ? r.price - 1 : r.status === 'lost' ? -1 : 0);

// Resumen de un grupo: cuántas, acierto real frente al que esperaba y beneficio a 1 unidad
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
const units = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')} u`;

export function ModelAccuracy() {
  const q = useQuery({ queryKey: ['predictions'], queryFn: () => window.api.bets.predictions(), staleTime: 60e3 });
  const [sport, setSport] = useState<SportF>('all');
  const [range, setRange] = useState<RangeF>('all');
  const [scope, setScope] = useState<ScopeF>('picks');
  const rows = useMemo(() => {
    const since = range === 'all' ? 0 : Date.now() - Number(range) * 864e5;
    return (q.data?.rows ?? []).filter(r => (sport === 'all' || r.sport === sport) && +new Date(r.start) >= since && (scope === 'lines' || isPick(r)));
  }, [q.data, sport, range, scope]);
  // Sólo los deportes que ya tienen alguna resuelta
  const sports = useMemo(() => SPORT_ORDER.filter(s => (q.data?.rows ?? []).some(r => r.sport === s)), [q.data]);

  if (q.isLoading) return <Loading label="Cargando las recomendaciones resueltas…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const data = q.data!;

  const filters = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Tabs value={sport} onChange={setSport} items={[{ value: 'all' as SportF, label: 'Todo' }, ...sports.map(s => ({ value: s as SportF, label: SPORT_NAME[s] }))]} />
      <Tabs value={range} onChange={setRange} items={[{ value: '30', label: '30 días' }, { value: '90', label: '90 días' }, { value: 'all', label: 'Todo' }]} />
      <Tabs value={scope} onChange={setScope} items={[{ value: 'picks', label: 'Recomendadas' }, { value: 'lines', label: 'Todas las líneas' }]} />
      <span className="text-xs text-zinc-500">{data.pending} por resolver{data.since ? ` · registro desde el ${new Date(data.since).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}` : ''}</span>
    </div>
  );
  if (!rows.length) return (
    <>
      {filters}
      <Empty>
        Todavía no hay recomendaciones resueltas{sport !== 'all' ? ` de ${SPORT_NAME[sport].toLowerCase()}` : ''}. Se guardan todas las líneas que calcula el modelo de baloncesto y
        las recomendaciones de tenis, fútbol y MMA mientras las ves en la app (Recomendaciones, la ficha de cada partido), las apuestes o no; cuando
        acaban sus partidos se resuelven solas y salen aquí. Hacen falta unas cuantas decenas para que las cifras digan algo.
      </Empty>
    </>
  );

  const S = sum(rows);
  const nWon = rows.filter(won).length, nLost = S.decided - nWon;
  const few = S.decided < 100;
  // Calibración por tramos de probabilidad
  const buckets = [[0, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
    const rs = rows.filter(r => decided(r) && r.p >= lo && r.p < hi);
    return { lo, hi, ...sum(rs) };
  }).filter(b => b.n);
  const byGroup = groupRows(rows, r => `${SPORT_NAME[r.sport] ?? r.sport} · ${r.group}`);
  const bySport = groupRows(rows, r => SPORT_NAME[r.sport] ?? r.sport);
  const clvs = rows.map(clv).filter((v): v is number => v != null);
  const clvAvg = clvs.length ? clvs.reduce((a, v) => a + v, 0) / clvs.length : null;
  const clvBeat = clvs.length ? clvs.filter(v => v > 0).length / clvs.length : null;
  const byBook = groupRows(rows, r => r.book || 'Sin casa');
  const byEv = [[-99, 0, 'EV negativo (las más fiables de tenis)'], [0, 0.05, 'EV hasta 5 %'], [0.05, 0.1, '5-10 %'], [0.1, 0.2, '10-20 %'], [0.2, 99, 'Más de 20 %']].map(([lo, hi, label]) => ({ key: label as string, ...sum(rows.filter(r => r.ev >= (lo as number) && r.ev < (hi as number))) })).filter(x => x.n);
  // Quién acierta más, con las mismas recomendaciones: el modelo solo, la casa sin margen o la mezcla que enseña la app
  const both = rows.filter(r => r.pModel != null && r.pMarket != null);
  const bModel = brier(both, r => r.pModel), bMarket = brier(both, r => r.pMarket), bMix = brier(both, r => r.p);
  // La cuota entre la primera y la última vez que se recomendó: si baja, el mercado se movió hacia lo que decía el modelo
  const moved = rows.filter(r => r.firstPrice && r.price !== r.firstPrice);
  const down = moved.filter(r => r.price < r.firstPrice).length;

  return (
    <>
      {filters}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Recomendaciones resueltas" value={S.n} sub={`${nWon} ganada${nWon === 1 ? '' : 's'} · ${nLost} perdida${nLost === 1 ? '' : 's'}`} />
        <Stat label="Acierto" value={pct(S.hit)} valueClass={Math.abs(S.hit - S.said) > margin(S.said, S.decided) ? tone(S.hit - S.said) : undefined} sub={`esperaba ${pct(S.said)} (±${pct(margin(S.said, S.decided))} por azar)`} />
        <Stat label="A 1 unidad cada una" value={units(S.pl)} valueClass={tone(S.pl)} sub={`ROI ${pct(S.roi)} · esperaba ${pct(S.ev)}`} />
        <Stat label="Movimiento de la cuota (CLV)" value={clvAvg == null ? '–' : `${clvAvg >= 0 ? '+' : ''}${pct(clvAvg)}`} valueClass={clvAvg == null ? undefined : tone(clvAvg)}
          sub={clvBeat == null ? 'sin datos' : `bajó en ${pct(clvBeat)} · cuota media ${odd(rows.reduce((s, r) => s + r.price, 0) / rows.length)}`} />
      </div>
      {few && <p className="-mt-2 mb-4 text-xs text-zinc-500">Con menos de 100 resueltas, las cifras se mueven mucho de un día a otro: míralas como orientación.</p>}

      <ProfitCurve rows={rows} />
      {sport === 'all' && bySport.length > 1 && <div className="mb-5"><GroupTable title="Por deporte" rows={bySport} /></div>}

      <div className="mb-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <Card title="¿Cuando dice X %, sale X %?" action={<span className="text-[11px] text-zinc-500">Calibración</span>}>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="bg-zinc-900/60"><tr>
                <th className={th}>Decía</th><th className={th + ' text-right'}>Casos</th><th className={th + ' text-right'}>Esperaba</th><th className={th + ' text-right'}>Salió</th><th className={th}></th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-800/60">
                {buckets.map(b => {
                  const off = b.hit - b.said, m = margin(b.said, b.decided);
                  return (
                    <tr key={b.lo}>
                      <td className={td + ' tnum text-zinc-400'}>{Math.round(b.lo * 100)}-{Math.min(100, Math.round(b.hi * 100))} %</td>
                      <td className={td + ' text-right tnum text-zinc-400'}>{b.decided}</td>
                      <td className={td + ' text-right tnum'}>{pct(b.said)}</td>
                      <td className={cn(td, 'text-right font-semibold tnum', Math.abs(off) > m ? (off > 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-100')}>{pct(b.hit)}</td>
                      <td className={td + ' w-[38%]'}><CalBar said={b.said} got={b.hit} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-zinc-500">En verde o rojo, cuando la diferencia es mayor que lo que se explica por azar con esos casos. La raya es lo que decía; la barra, lo que salió.</p>
        </Card>

        <Card title="¿Quién acierta más?" action={<span className="text-[11px] text-zinc-500">Brier: más bajo, mejor</span>}>
          {both.length < 20 ? <p className="text-[13px] text-zinc-400">Hacen falta al menos 20 recomendaciones con la probabilidad de la casa para compararlas.</p> : (
            <div className="flex flex-col gap-2.5 text-[13px]">
              {([['El modelo solo', bModel], ['La casa, sin su margen', bMarket], ['Lo que enseña la app (la mezcla)', bMix]] as const).map(([l, v]) => {
                const best = v != null && v === Math.min(bModel ?? 9, bMarket ?? 9, bMix ?? 9);
                return <div key={l} className="flex items-center justify-between gap-3"><span className="text-zinc-400">{l}</span><span className={cn('font-semibold tnum', best ? 'text-emerald-400' : 'text-zinc-100')}>{v?.toFixed(4).replace('.', ',')}</span></div>;
              })}
              <p className="text-xs text-zinc-500">Sobre las mismas {both.length} {scope === 'lines' ? 'líneas' : 'recomendaciones'}. Para decidir cuánto debe pesar el modelo, mira «Todas las líneas»: en las recomendadas, que son justo en las que no está de acuerdo con la casa, la casa sale siempre mejor.</p>
              {moved.length >= 10 && (
                <p className="border-t border-zinc-800/60 pt-2.5 text-xs text-zinc-400">
                  La cuota bajó en <span className="font-semibold text-zinc-100">{Math.round((down / moved.length) * 100)} %</span> de las {moved.length} que se movieron mientras se recomendaban: si es más de la mitad, el mercado tiende a ir hacia lo que decía el modelo.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <GroupTable title="Por mercado" rows={byGroup} />
        <div className="flex flex-col gap-5">
          <GroupTable title="Por valor que veía (EV)" rows={byEv} />
          <GroupTable title="Por casa" rows={byBook} />
        </div>
      </div>

      <Card title="Últimas resueltas">
        <div className="-mx-5 -mb-2 overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="bg-zinc-900/60"><tr><th className={th}>Recomendación</th><th className={th + ' text-right'}>Decía</th><th className={th + ' text-right'}>Cuota</th><th className={th}>Resultado</th></tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.slice(0, 15).map((r, i) => (
                <tr key={i}>
                  <td className={td}><div className="font-medium text-zinc-100">{r.title}</div><div className="text-xs text-zinc-500">{new Date(r.start).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · {r.event}</div></td>
                  <td className={td + ' text-right tnum'}>{pct(r.p)}</td>
                  <td className={td + ' text-right tnum'}>{odd(r.price)}</td>
                  <td className={td}><span className={cn('font-medium', r.status === 'won' ? 'text-emerald-400' : r.status === 'lost' ? 'text-rose-400' : 'text-zinc-400')}>{r.status === 'won' ? 'Ganada' : r.status === 'lost' ? 'Perdida' : 'Nula'}</span>{r.result && <div className="text-xs text-zinc-500">{r.result}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function groupRows(rows: PredictionRow[], key: (r: PredictionRow) => string) {
  const m = new Map<string, PredictionRow[]>();
  for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
  return [...m].map(([k, rs]) => ({ key: k, ...sum(rs) })).sort((a, b) => b.n - a.n);
}

function GroupTable({ title, rows }: { title: string; rows: (ReturnType<typeof sum> & { key: string })[] }) {
  return (
    <Card title={title}>
      <div className="-mx-5 -mb-2 overflow-x-auto">
        <table className="w-full min-w-[440px]">
          <thead className="bg-zinc-900/60"><tr>
            <th className={th}></th><th className={th + ' text-right'}>Casos</th><th className={th + ' text-right'}>Acierto</th><th className={th + ' text-right'}>Esperaba</th><th className={th + ' text-right'}>A 1 u.</th><th className={th + ' text-right'}>ROI</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {rows.map(r => (
              <tr key={r.key}>
                <td className={td + ' text-zinc-200'}>{r.key}</td>
                <td className={td + ' text-right tnum text-zinc-400'}>{r.n}</td>
                <td className={td + ' text-right tnum'}>{pct(r.hit)}</td>
                <td className={td + ' text-right tnum text-zinc-400'}>{pct(r.said)}</td>
                <td className={cn(td, 'text-right font-semibold tnum', tone(r.pl))}>{units(r.pl)}</td>
                <td className={cn(td, 'text-right tnum', tone(r.roi))}>{pct(r.roi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Barra de lo que salió con una raya en lo que decía
function CalBar({ said, got }: { said: number; got: number }) {
  return (
    <div className="relative h-2.5 rounded-sm bg-zinc-800">
      <div className="absolute inset-y-0 left-0 rounded-sm bg-zinc-500" style={{ width: `${Math.min(100, got * 100)}%` }} />
      <div className="absolute -inset-y-1 w-0.5 bg-amber-400" style={{ left: `calc(${Math.min(100, said * 100)}% - 1px)` }} />
    </div>
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
  return (
    <Card title="Beneficio acumulado" action={<span className="text-[11px] text-zinc-500">a 1 unidad por recomendación</span>} className="mb-5">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#2b3034" vertical={false} />
            <XAxis dataKey="d" stroke="#85948f" fontSize={10} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis stroke="#85948f" fontSize={11} tickLine={false} axisLine={false} />
            <ReferenceLine y={0} stroke="#52525b" />
            <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }} labelStyle={{ color: '#d4d4d8' }}
              formatter={(v, name) => [units(Number(v)), name === 'pl' ? 'Real' : 'Esperado']} />
            <Line dataKey="ev" stroke="#85948f" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line dataKey="pl" stroke="var(--acc-400)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-zinc-500">
        <span><span className="text-amber-400">—</span> real</span><span><span className="text-zinc-300">- -</span> lo que esperaba el modelo</span>
      </div>
    </Card>
  );
}
