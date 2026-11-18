import { useMemo, useState } from 'react';
import { useCurrency, useWallet } from '@/lib/app-context';
import { buildPlan, parseEuros, poolStats } from '@/lib/plan';
import { money } from '@/lib/format';
import { Button, Empty, Field, Input, Loading, PageHeader, PlayNotice } from '@/components/ui';
import { usePlanPool } from '@/components/plan/usePlanPool';
import { WindowNotice } from '@/components/plan/WindowNotice';
import { RiskPanel } from '@/components/plan/RiskPanel';
import { TicketCard } from '@/components/plan/TicketCard';

const KEY = 'plan-inputs';

// Las dos últimas cifras, sólo en este navegador
function saved(): { budget: string; target: string } {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { budget: typeof o.budget === 'string' ? o.budget : '', target: typeof o.target === 'string' ? o.target : '' };
  } catch { return { budget: '', target: '' }; }
}

// Plan por objetivo: dinero inicial y beneficio aproximado → entre qué apuestas repartirlo, con su índice de riesgo.
// Es una pantalla de cálculo: no apunta apuestas ni toca la cartera
export default function PlanView() {
  const cur = useCurrency();
  const wallet = useWallet();
  const init = useState(saved)[0];
  const [budgetText, setBudgetText] = useState(init.budget);
  const [targetText, setTargetText] = useState(init.target);
  const { pool, sports, updatedAt } = usePlanPool();
  const [now] = useState(() => Date.now());

  const set = (b: string, t: string) => {
    setBudgetText(b); setTargetText(t);
    try { localStorage.setItem(KEY, JSON.stringify({ budget: b, target: t })); } catch { /* sin almacenamiento */ }
  };
  const budget = parseEuros(budgetText);
  const target = parseEuros(targetText);
  const stats = useMemo(() => poolStats(pool, now), [pool, now]);
  const plan = useMemo(() => (budget && target ? buildPlan(pool, budget, target) : null), [pool, budget, target]);
  const loading = Object.values(sports).some(s => s.loading);
  const overWallet = !!budget && wallet.balance >= 0 && budget > wallet.balance;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Plan" subtitle="Pon el dinero que tienes y el beneficio al que aspiras: te decimos entre qué apuestas repartirlo y con qué riesgo." />
      <WindowNotice stats={stats} sports={sports} updatedAt={updatedAt} now={now} />

      <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => e.preventDefault()}>
        <Field label={`Dinero inicial (${cur})`} hint={wallet.balance > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => set(String(Math.floor(wallet.balance * 100) / 100), targetText)}>Usar mi cartera ({money(wallet.balance, cur)})</Button>
        ) : undefined}>
          <Input inputMode="decimal" value={budgetText} onChange={e => set(e.target.value, targetText)} placeholder="100" autoComplete="off" aria-invalid={!!budgetText.trim() && budget === null} />
          {!!budgetText.trim() && budget === null && <span className="text-xs text-rose-300" role="alert">Pon una cantidad mayor que 0, con 2 decimales como mucho.</span>}
          {overWallet && <span className="text-xs text-amber-300">Es más de lo que tienes en la cartera ({money(wallet.balance, cur)}).</span>}
        </Field>
        <Field label={`Beneficio aproximado (${cur})`}>
          <Input inputMode="decimal" value={targetText} onChange={e => set(budgetText, e.target.value)} placeholder="20" autoComplete="off" aria-invalid={!!targetText.trim() && target === null} />
          {!!targetText.trim() && target === null && <span className="text-xs text-rose-300" role="alert">Pon una cantidad mayor que 0, con 2 decimales como mucho.</span>}
        </Field>
      </form>

      {plan && loading && !pool.length && <Loading label="Buscando apuestas…" />}
      {plan && !(loading && !pool.length) && (plan.tickets.length ? (
        <>
          <RiskPanel plan={plan} />
          <div className="grid gap-3 2xl:grid-cols-2">
            {plan.tickets.map((t, i) => <TicketCard key={t.legs.map(l => l.id).join('+')} ticket={t} index={i} />)}
          </div>
          <div className="text-xs text-zinc-500">
            {plan.tickets.length} apuesta{plan.tickets.length === 1 ? '' : 's'} con {plan.tickets.reduce((s, t) => s + t.legs.length, 0)} selecciones, de {plan.eligible} que cumplen los requisitos.
          </div>
        </>
      ) : (
        <Empty>
          <span>No hay apuestas para armar un plan ahora mismo.</span>
          <span className="mt-1 text-xs text-zinc-500">Sólo entran partidos de las próximas 48 horas con cuotas, fiabilidad suficiente y una cuota entre 1,10 y 15.</span>
        </Empty>
      ))}
      {!plan && <Empty>Pon el dinero y el beneficio para ver el plan.</Empty>}
      <PlayNotice />
    </div>
  );
}
