import { useMemo, useState } from 'react';
import { TvTabs } from '@/components/viz';
import { Card, Empty } from '@/components/ui';
import { edgeOf, marketKind, oddsBand, oddsBandOrder } from '@/lib/bet-stats';
import { cn, groupBy, pct, summarize, tone } from '@/lib/format';
import type { Bet } from '@/lib/types';
import { ProfitText } from '@/views/bets/Profit';

// Desglose de Mis apuestas en un solo panel: por liga, cuota, tipo de mercado, casa y simples/combinadas. Antes eran cinco tablas
// de siete columnas que en el móvil había que deslizar de lado y no dejaban ver de un vistazo dónde se gana: ahora cada grupo es
// una fila con una barra del beneficio desde el cero (verde a la derecha si se gana, roja a la izquierda si se pierde), a la misma
// escala en todas las filas.

type By = 'sport' | 'league' | 'odds' | 'market' | 'book' | 'kind';
const SPORT_NAME: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA', mix: 'Combinadas de varios deportes' };
const BY: { value: By; label: string; key: (b: Bet) => string; order?: (a: string, b: string) => number }[] = [
  { value: 'sport', label: 'Deporte', key: b => SPORT_NAME[b.sport || 'lol'] ?? 'Otros' },
  { value: 'league', label: 'Liga', key: b => b.league || 'Sin liga' },
  { value: 'odds', label: 'Cuota', key: b => oddsBand(b.odds), order: (a, b) => oddsBandOrder(a) - oddsBandOrder(b) },
  { value: 'market', label: 'Mercado', key: marketKind },
  { value: 'book', label: 'Casa', key: b => b.bookmaker || 'Sin casa' },
  { value: 'kind', label: 'Simples y combinadas', key: b => (b.legs?.length ? 'Combinadas' : 'Simples') }
];
const FIRST = 8; // con muchas ligas, las 8 primeras y «Ver todas»

// bySport: con «Todo» (los cinco deportes juntos), también por deporte, y se empieza por ahí
export function Breakdown({ bets, bySport }: { bets: Bet[]; bySport?: boolean }) {
  const [pick, setBy] = useState<By | null>(null);
  const [all, setAll] = useState(false);
  const tabs = BY.filter(x => x.value !== 'sport' || bySport);
  const by = pick && tabs.some(x => x.value === pick) ? pick : bySport ? 'sport' : 'league';
  const cfg = tabs.find(x => x.value === by)!;
  const rows = useMemo(() => [...groupBy(bets, cfg.key)].map(([k, l]) => ({ k, ...summarize(l), edge: edgeOf(l) }))
    .sort((a, b) => (cfg.order ? cfg.order(a.k, b.k) : b.profit - a.profit || b.count - a.count)), [bets, cfg]);
  const max = Math.max(...rows.map(r => Math.abs(r.profit)), 0.01);
  const shown = all ? rows : rows.slice(0, FIRST);
  const up = rows.filter(r => r.settled && r.profit > 0).length;

  return (
    <Card title="Dónde ganas y dónde pierdes" className="my-5 overflow-hidden"
      action={rows.length > 1 ? <span className="text-xs text-zinc-500 tnum">{up} de {rows.length} en positivo</span> : undefined}>
      <div className="-mx-5 -mt-2 mb-1 border-b border-zinc-800/70 px-5 pb-3">
        <TvTabs value={by} onChange={v => { setBy(v); setAll(false); }} items={tabs.map(x => ({ value: x.value, label: x.label }))} />
      </div>
      {!rows.length ? <Empty>Sin datos todavía</Empty> : (
        <ul className="-mx-5 -mb-5 divide-y divide-zinc-800/60">
          {shown.map(r => {
            const w = r.settled ? (Math.abs(r.profit) / max) * 50 : 0;
            const pos = r.profit >= 0;
            return (
              <li key={r.k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 md:grid-cols-[minmax(0,1fr)_200px_136px]">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-zinc-100" title={r.k}>{r.k}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {r.count} apuesta{r.count === 1 ? '' : 's'}{r.pendingCount ? ` · ${r.pendingCount} en juego` : ''}
                  </div>
                  {r.edge.n > 0 && <div className="text-xs text-zinc-500"><span className="whitespace-nowrap">aciertas <span className={tone(r.edge.diff)}>{pct(r.edge.hit)}</span></span> · <span className="whitespace-nowrap">hace falta {pct(r.edge.breakEven)}</span></div>}
                </div>
                <div className="order-3 col-span-2 md:order-none md:col-span-1">
                  <div className="relative h-2 rounded bg-zinc-800/60" role="img"
                    aria-label={r.settled ? `${pos ? 'Ganas' : 'Pierdes'} ${pct(Math.abs(r.roi))} de lo apostado` : 'Sin apuestas resueltas'}>
                    <span className="absolute inset-y-[-3px] left-1/2 w-px bg-zinc-600" />
                    {w > 0 && <span className={cn('absolute inset-y-0', pos ? 'left-1/2 rounded-r bg-emerald-400' : 'right-1/2 rounded-l bg-rose-400')}
                      style={{ width: `${Math.max(w, 1.5)}%` }} />}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn('whitespace-nowrap text-[13px] font-semibold tnum', r.settled ? tone(r.profit) : 'text-zinc-500')}>
                    {r.settled ? <ProfitText value={r.profit} /> : '—'}
                  </div>
                  <div className={cn('text-xs tnum', r.settled ? tone(r.roi) : 'text-zinc-500')}>{r.settled ? `ROI ${pct(r.roi)}` : 'pendientes'}</div>
                </div>
              </li>
            );
          })}
          {rows.length > FIRST && (
            <li className="px-5 py-2.5">
              <button type="button" className="text-xs font-medium text-zinc-400 hover:text-zinc-200" onClick={() => setAll(!all)}>
                {all ? 'Ver menos' : `Ver todas (${rows.length})`}
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
