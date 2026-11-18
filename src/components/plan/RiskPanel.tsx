import type { Plan, RiskLevel } from '@/lib/plan';
import { Badge, panelCls } from '@/components/ui';
import { cn, money, pct } from '@/lib/format';
import { useCurrency } from '@/lib/app-context';

const TONE: Record<RiskLevel, 'success' | 'info' | 'warning' | 'danger'> = { 'bajo': 'success', 'medio': 'info', 'alto': 'warning', 'muy alto': 'danger' };

// Lo primero que se ve del plan: la probabilidad de llegar al objetivo y el nivel de riesgo, en texto y con color (nunca sólo color)
export function RiskPanel({ plan }: { plan: Plan }) {
  const cur = useCurrency();
  const { risk, budget, target } = plan;
  const per100 = budget > 0 ? (risk.expectedReturn / budget) * 100 : 0;
  const losing = risk.expectedReturn < budget;
  return (
    <section className={`${panelCls} flex flex-col gap-4 p-4`} aria-label="Riesgo del plan">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-3xl font-semibold tracking-tight text-zinc-50 tnum">{pct(risk.pReach)}</div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">probabilidad de llegar a +{money(target, cur)}</span>
          <Badge tone={TONE[risk.level]} className="w-fit">Riesgo {risk.level}</Badge>
        </div>
      </div>
      <p className="text-sm text-zinc-300">{risk.message}</p>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><dt className="text-xs text-zinc-500">Acabar en beneficio</dt><dd className="text-base font-medium text-zinc-100 tnum">{pct(risk.pProfit)}</dd></div>
        <div><dt className="text-xs text-zinc-500">Perder todo lo apostado</dt><dd className="text-base font-medium text-zinc-100 tnum">{pct(risk.pLoseAll)}</dd></div>
        <div>
          <dt className="text-xs text-zinc-500">De media, por cada 100 {cur} puestos</dt>
          <dd className={cn('text-base font-medium tnum', losing ? 'text-rose-300' : 'text-zinc-100')}>devuelve {money(per100, cur)}</dd>
        </div>
      </dl>

      <ul className="flex flex-col gap-2">
        {plan.warnings.map((w, i) => (
          <li key={i} className={cn('rounded-md px-3 py-2 text-[13px]', /pierde dinero/.test(w) ? 'bg-rose-500/10 text-rose-300' : 'bg-zinc-800/60 text-zinc-300')}>{w}</li>
        ))}
      </ul>

      <details className="text-[13px] text-zinc-400">
        <summary className="cursor-pointer text-zinc-300">Cómo se calcula</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>Cada apuesta lleva la probabilidad que le da el modelo de su deporte; el modelo se equivoca.</li>
          <li>Se usa un solo partido por apuesta, así que se tratan como independientes entre sí.</li>
          <li>En una combinada se multiplican las cuotas y las probabilidades de sus selecciones.</li>
          <li>El reparto prueba muchas formas de dividir el dinero y se queda con la que más probabilidad tiene de llegar al objetivo, aunque ese objetivo sea poco realista.</li>
        </ul>
      </details>
    </section>
  );
}
