// Piezas comunes del análisis de valor (LoL y NBA): veredicto, fiabilidad y panel con probabilidades,
// valor esperado, ventaja y stake. Mismo aspecto en las dos secciones.
import { AlertTriangle, Plus } from 'lucide-react';
import { useCurrency } from '@/lib/app-context';
import { cn, money, odd, pct } from '@/lib/format';
import { SIDE_LABEL, VERDICT_LABEL, type Reliability, type Side, type SideValue, type ValueData, type VerdictCode } from '@/lib/value';
import { Button } from './ui';

const VERDICT_TONE: Record<VerdictCode, string> = {
  BET: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  LEAN: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  PASS: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
  NOODDS: 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
};

export function VerdictBadge({ code, className }: { code: VerdictCode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', VERDICT_TONE[code], className)}>{VERDICT_LABEL[code]}</span>;
}

const relColor = (s: number) => (s >= 70 ? 'bg-emerald-400' : s >= 50 ? 'bg-amber-400' : 'bg-rose-400');

// Barra de fiabilidad 0-100; compacta para las tablas
export function ReliabilityMeter({ rel, compact }: { rel: Reliability; compact?: boolean }) {
  const tip = [...rel.factors.map(f => `${f.label}: ${f.score.toFixed(0)}/${f.max} (${f.note})`), ...rel.warnings.map(w => `⚠ ${w}`)].join('\n');
  return (
    <div className={cn('flex items-center gap-2', compact && 'justify-center')} title={tip}>
      <div className={cn('h-1.5 overflow-hidden rounded-full bg-zinc-800', compact ? 'w-10' : 'w-full')}>
        <div className={cn('h-full rounded-full', relColor(rel.score))} style={{ width: `${rel.score}%` }} />
      </div>
      <span className="text-xs tabular-nums text-zinc-300">{rel.score}</span>
    </div>
  );
}

// Panel completo. onSlip (u onBet) añade el lado elegido al cupón, donde se pone el stake y se registra.
export function ValuePanel({ v, bank, onBet, onSlip }: {
  v: ValueData; bank?: number; onBet?: (s: SideValue) => void; onSlip?: (s: SideValue) => void;
}) {
  const cur = useCurrency();
  const { verdict: vd } = v;
  const best = vd.best;
  const stake = best && (vd.code === 'BET' || vd.code === 'LEAN') ? best.kelly : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3', VERDICT_TONE[vd.code])}>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">{VERDICT_LABEL[vd.code]}</div>
          <div className="text-lg font-bold text-zinc-50">{vd.title}</div>
          <div className="text-sm text-zinc-400">{vd.text}</div>
        </div>
        {stake > 0 && (
          <div className="text-right">
            <div className="text-xs text-zinc-400">Stake orientativo (¼ Kelly)</div>
            <div className="text-lg font-bold tabular-nums text-zinc-50">{pct(stake)} del bank</div>
            {!!bank && bank > 0 && <div className="text-xs text-zinc-400">{money(bank * stake, cur)}</div>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(['over', 'under'] as Side[]).map(side => {
          const s = v.sides.find(x => x.side === side);
          const p = side === 'over' ? v.pOver : v.pUnder, fair = side === 'over' ? v.fairOver : v.fairUnder;
          const good = !!s && s.ev >= 0.015;
          return (
            <div key={side} className={cn('rounded-xl border bg-zinc-900/60 p-3', good ? 'border-emerald-500/40' : 'border-zinc-800')}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">{SIDE_LABEL[side]} de {v.line}</span>
                <span className="text-xl font-bold tabular-nums">{pct(p)}</span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">Cuota justa <span className="tabular-nums text-zinc-300">{odd(fair)}</span></div>
              {s && Math.abs(s.p - p) >= 0.005 && <div className="mt-0.5 text-xs text-zinc-500" title="Mezcla del modelo con la probabilidad de la casa sin margen. Con ella se calcula el valor.">Con la casa <span className="tabular-nums text-zinc-300">{pct(s.p)}</span></div>}
              {s ? <>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-zinc-500">Cuota{s.book ? ` ${s.book}` : ''}</div><div className="font-semibold tabular-nums">{odd(s.price)}</div></div>
                  <div><div className="text-zinc-500">Valor (EV)</div><div className={cn('font-semibold tabular-nums', s.ev >= 0.015 ? 'text-emerald-400' : s.ev < 0 ? 'text-rose-400' : 'text-zinc-300')}>{s.ev > 0 ? '+' : ''}{pct(s.ev)}</div></div>
                  <div title="Probabilidad estimada menos la de la casa sin margen"><div className="text-zinc-500">Ventaja</div><div className="font-semibold tabular-nums">{s.edge == null ? '–' : `${s.edge > 0 ? '+' : ''}${pct(s.edge)}`}</div></div>
                </div>
                {(onBet || onSlip) && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant={good ? 'primary' : 'secondary'} onClick={() => (onSlip ?? onBet)!(s)}><Plus size={13} />Añadir al cupón</Button>
                  </div>
                )}
              </> : <div className="mt-2 text-xs text-zinc-600">Sin cuota</div>}
            </div>
          );
        })}
      </div>
      <div className="text-xs text-zinc-500">
        {v.pPush > 0.001 && <>Nula (línea exacta): {pct(v.pPush)} · </>}
        {v.margin != null && <>Margen de la casa {pct(v.margin)} ({v.exact ? 'exacto, con las dos cuotas' : 'estimado, sólo hay una cuota'})</>}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">Fiabilidad</span>
          <span className="text-sm"><span className="text-xl font-bold tabular-nums">{v.rel.score}</span><span className="text-zinc-500">/100 · {v.rel.label}</span></span>
        </div>
        <div className="flex flex-col gap-2">
          {v.rel.factors.map(f => (
            <div key={f.label} className="grid grid-cols-[150px_1fr_48px] items-center gap-3 text-xs" title={f.note}>
              <span className="text-zinc-400">{f.label}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className={cn('h-full rounded-full', relColor((f.score / f.max) * 100))} style={{ width: `${(f.score / f.max) * 100}%` }} /></div>
              <span className="text-right tabular-nums text-zinc-500">{f.score.toFixed(0)}/{f.max}</span>
            </div>
          ))}
        </div>
        {!!v.rel.warnings.length && (
          <div className="mt-3 flex flex-col gap-1">
            {v.rel.warnings.map(w => <div key={w} className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle size={12} />{w}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
