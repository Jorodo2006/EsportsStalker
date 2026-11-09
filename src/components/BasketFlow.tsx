// Cómo fue el partido (baloncesto): la ventaja de cada equipo en cada momento, con el visitante por encima de la línea del
// empate y el local por debajo, cada uno en su color; los cuartos marcados; y arriba la mayor ventaja de cada uno, los
// cambios de líder, los empates y el mayor parcial. Sale de las jugadas de ESPN (GET /api/basket/flow/:id); en directo se
// refresca sola. La Euroliga no da jugada a jugada: no sale
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BasketGame } from '@/lib/types';
import { Panel } from './viz';

const perName = (p: number) => (p <= 4 ? `${p}.º cuarto` : p === 5 ? 'prórroga' : `${p - 4}.ª prórroga`);
const perShort = (p: number) => (p <= 4 ? `Q${p}` : p === 5 ? 'Pr' : `Pr${p - 4}`);

export function BasketFlow({ game, colorA, colorB }: { game: BasketGame; colorA: string; colorB: string }) {
  const live = game.state === 'in';
  const q = useQuery({
    queryKey: ['basket', 'flow', game.id], queryFn: () => window.api.basket.flow(game.id), retry: false,
    refetchInterval: live ? 30_000 : false, staleTime: game.state === 'post' ? 3600e3 : 15_000
  });
  const f = q.data;
  if (!f?.available || !f.points || f.points.length < 3) return null;
  const len = f.periodLen ?? 12, periods = f.periods ?? 4;
  const startOf = (p: number) => (p <= 4 ? (p - 1) * len : 4 * len + (p - 5) * 5);
  const end = startOf(periods + 1);
  // Escalón: cada punto vale hasta la siguiente canasta. up: ventaja del visitante; down: la del local (en negativo)
  const data = f.points.map(x => ({ ...x, up: Math.max(0, x.a - x.b), down: Math.min(0, x.a - x.b) }));
  if (game.state === 'post') data.push({ ...data[data.length - 1], t: end });
  const top = Math.max(5, ...data.map(x => Math.abs(x.a - x.b)));
  const M = Math.ceil(top / 5) * 5;
  const A = game.away.abbr, B = game.home.abbr;
  const bounds = Array.from({ length: periods - 1 }, (_, i) => startOf(i + 2));
  const mids = Array.from({ length: periods }, (_, i) => (startOf(i + 1) + startOf(i + 2)) / 2);
  const chip = (label: string, value: string) => (
    <div className="rounded-lg bg-zinc-900 px-3 py-2">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-100 tnum">{value}</div>
    </div>
  );
  return (
    <Panel title="Cómo fue el partido" aside={live ? 'En directo' : undefined}>
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {chip('Mayor ventaja', `${A} +${f.maxLead?.a ?? 0} · ${B} +${f.maxLead?.b ?? 0}`)}
          {chip('Cambios de líder', String(f.leadChanges ?? 0))}
          {chip('Empates', String(f.ties ?? 0))}
          {chip('Mayor parcial', [f.runs?.a.pts ? `${A} ${f.runs.a.pts}-0 (${perShort(f.runs.a.per)})` : '', f.runs?.b.pts ? `${B} ${f.runs.b.pts}-0 (${perShort(f.runs.b.per)})` : ''].filter(Boolean).join(' · ') || '–')}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-zinc-300"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorA }} />{A} por delante (arriba)</span>
          <span className="flex items-center gap-1.5 text-zinc-300"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorB }} />{B} por delante (abajo)</span>
        </div>
        <div className="h-56 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#27272a" vertical={false} />
              <XAxis dataKey="t" type="number" domain={[0, end]} ticks={mids} tickFormatter={v => perShort(mids.indexOf(v) + 1)} stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis domain={[-M, M]} tickFormatter={v => String(Math.abs(v))} stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              {bounds.map(x => <ReferenceLine key={x} x={x} stroke="#3f3f46" strokeDasharray="3 3" />)}
              <ReferenceLine y={0} stroke="#71717a" />
              <Tooltip cursor={{ stroke: '#a1a1aa', strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  const p = active && payload?.[0]?.payload as (typeof data)[number] | undefined;
                  if (!p) return null;
                  const min = Math.floor(p.t - startOf(p.per));
                  return (
                    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow">
                      <div className="text-zinc-400">{perName(p.per)}, minuto {min + 1}</div>
                      <div className="font-semibold text-zinc-50 tnum">{A} {p.a} - {p.b} {B}</div>
                    </div>
                  );
                }} />
              <Area type="stepAfter" dataKey="up" stroke={colorA} fill={colorA} fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
              <Area type="stepAfter" dataKey="down" stroke={colorB} fill={colorB} fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Panel>
  );
}
