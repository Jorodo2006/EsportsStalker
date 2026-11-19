import { useMemo, useState, type ReactNode } from 'react';
import { useCurrency, useWallet } from '@/lib/app-context';
import { buildPlan, parseEuros, parseOdds, poolStats, targetOf, TARGET_ODDS, veryReliable, VERY_RELIABLE, type Join, type PlanMode, type PlanSport } from '@/lib/plan';
import { money, odd, pct } from '@/lib/format';
import { Button, chip, Empty, Field, Input, Loading, PageHeader, panelCls, PlayNotice, Tabs } from '@/components/ui';
import { usePlanPool } from '@/components/plan/usePlanPool';
import { WindowNotice } from '@/components/plan/WindowNotice';
import { RiskPanel } from '@/components/plan/RiskPanel';
import { TicketCard } from '@/components/plan/TicketCard';

const KEY = 'plan-inputs';
const SPORTS: { id: PlanSport; label: string }[] = [{ id: 'basket', label: 'Baloncesto' }, { id: 'tennis', label: 'Tenis' }, { id: 'football', label: 'Fútbol' }, { id: 'mma', label: 'MMA' }];
const MODES: { value: PlanMode; label: string }[] = [{ value: 'combo', label: 'Combinada' }, { value: 'single', label: 'Simple' }];

interface Inputs { budget: string; odds: string; mode: PlanMode; sports: PlanSport[] }
const DEFAULTS: Inputs = { budget: '', odds: '2', mode: 'combo', sports: SPORTS.map(s => s.id) };

// Grupo de botones con su rótulo. No es Field: Field es una <label>, y pulsar el rótulo activaría el primer botón
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-zinc-400">{label}</legend>
      {children}
    </fieldset>
  );
}

// Las muy fiables juntas: cuánto sube la cuota y cuánto baja la probabilidad, para que el usuario lo vea antes de probarlo
function JoinCard({ join }: { join: Join }) {
  const cur = useCurrency();
  const n = join.of.map(i => i + 1);
  const names = `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`;
  const t = join.ticket;
  return (
    <section className={`${panelCls} flex flex-col gap-2 p-4`} aria-label="Juntar las muy fiables">
      <h3 className="text-sm font-semibold text-zinc-100">Las opciones {names} son muy fiables</h3>
      <p className="text-[13px] text-zinc-300">
        Todas sus selecciones tienen una fiabilidad de {VERY_RELIABLE} o más. Si las juntas en una combinada de {t.legs.length}, la cuota sube a <span className="font-medium text-zinc-50 tnum">{odd(t.price)}</span> (se cobrarían {money(t.toReturn, cur)}), pero la probabilidad baja a <span className="font-medium text-zinc-50 tnum">{pct(t.p)}</span>: tienen que salir todas a la vez.
      </p>
      <p className="text-xs text-zinc-500">Fiable quiere decir que el cálculo tiene buenos datos, no que vaya a salir.</p>
    </section>
  );
}

// Lo último que se eligió, sólo en este navegador
function saved(): Inputs {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    const sports = Array.isArray(o.sports) ? SPORTS.map(s => s.id).filter(id => o.sports.includes(id)) : [];
    return {
      budget: typeof o.budget === 'string' ? o.budget : '',
      odds: typeof o.odds === 'string' ? o.odds : DEFAULTS.odds,
      mode: MODES.some(m => m.value === o.mode) ? o.mode : DEFAULTS.mode,
      sports: sports.length ? sports : DEFAULTS.sports
    };
  } catch { return DEFAULTS; }
}

// Plan por objetivo: dinero inicial, deportes, tipo de apuesta y cuota a la que se quiere llegar → entre qué apuestas repartirlo,
// con su índice de riesgo. Es una pantalla de cálculo: no apunta apuestas ni toca la cartera
export default function PlanView() {
  const cur = useCurrency();
  const wallet = useWallet();
  const [inp, setInp] = useState(saved);
  const [custom, setCustom] = useState(() => !TARGET_ODDS.some(o => String(o) === inp.odds));
  const { pool, sports, updatedAt } = usePlanPool(inp.sports);
  const [now] = useState(() => Date.now());

  const set = (patch: Partial<Inputs>) => setInp(prev => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
    return next;
  });
  // Al menos un deporte: quitar el último no hace nada
  const toggleSport = (id: PlanSport) => {
    const on = inp.sports.includes(id);
    if (on && inp.sports.length === 1) return;
    set({ sports: on ? inp.sports.filter(s => s !== id) : SPORTS.map(s => s.id).filter(s => s === id || inp.sports.includes(s)) });
  };
  const budget = parseEuros(inp.budget);
  const odds = parseOdds(inp.odds);
  const target = budget && odds ? targetOf(budget, odds) : null;
  const stats = useMemo(() => poolStats(pool, now), [pool, now]);
  const plan = useMemo(() => (budget && target ? buildPlan(pool, budget, target, Date.now(), { mode: inp.mode, sports: inp.sports, odds: odds ?? undefined }) : null),
    [pool, budget, target, odds, inp.mode, inp.sports]);
  const loading = inp.sports.some(s => sports[s].loading);
  const legs = plan ? plan.tickets.reduce((s, t) => s + t.legs.length, 0) : 0;
  const overWallet =!!budget && wallet.balance >= 0 && budget > wallet.balance;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Plan" subtitle="Pon el dinero que tienes y la cuota a la que quieres llegar: te decimos entre qué apuestas repartirlo y con qué riesgo." />
      <WindowNotice stats={stats} sports={sports} updatedAt={updatedAt} now={now} />

      <form className="flex flex-col gap-4" onSubmit={e => e.preventDefault()}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Dinero inicial (${cur})`} hint={wallet.balance > 0 ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => set({ budget: String(Math.floor(wallet.balance * 100) / 100) })}>Usar mi cartera ({money(wallet.balance, cur)})</Button>
          ) : undefined}>
            <Input inputMode="decimal" value={inp.budget} onChange={e => set({ budget: e.target.value })} placeholder="100" autoComplete="off" aria-invalid={!!inp.budget.trim() && budget === null} />
            {!!inp.budget.trim() && budget === null && <span className="text-xs text-rose-300" role="alert">Pon una cantidad mayor que 0, con 2 decimales como mucho.</span>}
            {overWallet && <span className="text-xs text-amber-300">Es más de lo que tienes en la cartera ({money(wallet.balance, cur)}).</span>}
          </Field>
          <Group label="Cuota a la que quieres llegar">
            <div className="flex flex-wrap items-center gap-2">
              {TARGET_ODDS.map(o => (
                <button key={o} type="button" className={chip(!custom && odds === o)} aria-pressed={!custom && odds === o} onClick={() => { setCustom(false); set({ odds: String(o) }); }}>{odd(o)}</button>
              ))}
              <button type="button" className={chip(custom)} aria-pressed={custom} onClick={() => { setCustom(true); set({ odds: inp.odds.replace('.', ',') }); }}>Otra</button>
              {custom && <Input className="h-9 w-24 sm:h-8" inputMode="decimal" value={inp.odds} onChange={e => set({ odds: e.target.value })} placeholder="2,50" autoComplete="off" aria-label="Cuota" aria-invalid={!!inp.odds.trim() && odds === null} />}
            </div>
            {custom && !!inp.odds.trim() && odds === null && <span className="text-xs text-rose-300" role="alert">Pon una cuota mayor que 1 (como mucho 50), con 2 decimales como mucho.</span>}
            {target !== null && <span className="text-xs text-zinc-400">Beneficio si se llega: <span className="text-zinc-200 tnum">+{money(target, cur)}</span></span>}
          </Group>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Group label="Deportes">
            <div className="flex flex-wrap gap-2">
              {SPORTS.map(s => {
                const on = inp.sports.includes(s.id);
                return <button key={s.id} type="button" className={chip(on)} aria-pressed={on} onClick={() => toggleSport(s.id)}>{s.label}</button>;
              })}
            </div>
          </Group>
          <Group label="Tipo de apuesta">
            <Tabs value={inp.mode} onChange={mode => set({ mode })} items={MODES} />
            <span className="text-xs text-zinc-500">{inp.mode === 'combo' ? 'Una combinada con todo el dinero: la más probable de las que llegan a la cuota, con un partido por selección.' : 'Una sola apuesta con todo el dinero: la más probable de las que pagan la cuota o más.'}</span>
          </Group>
        </div>
      </form>

      {plan && loading && !pool.length && <Loading label="Buscando apuestas…" />}
      {plan && !(loading && !pool.length) && (plan.tickets.length ? (
        <>
          <RiskPanel plan={plan} />
          {plan.options.length ? (
            <>
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold text-zinc-100">{plan.options.length === 1 ? 'La opción para esta cuota' : `${plan.options.length} opciones para esta cuota`}</h2>
                {plan.options.length > 1 && <p className="text-xs text-zinc-500">Son alternativas, cada una con todo el dinero: elige una, no las juegues todas. Van de más a menos probable y no comparten partido. El riesgo de arriba es el de la opción 1.</p>}
              </div>
              <div className="grid gap-3 2xl:grid-cols-2">
                {plan.options.map((t, i) => <TicketCard key={t.legs.map(l => l.id).join('+')} ticket={t} index={i} title={`Opción ${i + 1}`} tag={veryReliable(t) ? 'Muy fiable' : undefined} />)}
              </div>
              {plan.join && <JoinCard join={plan.join} />}
            </>
          ) : (
            <div className="grid gap-3 2xl:grid-cols-2">
              {plan.tickets.map((t, i) => <TicketCard key={t.legs.map(l => l.id).join('+')} ticket={t} index={i} />)}
            </div>
          )}
          <div className="text-xs text-zinc-500">
            {plan.options.length ? `${plan.eligible} apuestas cumplen los requisitos.` : `${plan.tickets.length} apuesta${plan.tickets.length === 1 ? '' : 's'} con ${legs} ${legs === 1 ? 'selección' : 'selecciones'}, de ${plan.eligible} que cumplen los requisitos.`}
          </div>
        </>
      ) : (
        <Empty>
          <span>{plan.warnings[0] ?? 'No hay apuestas para armar un plan ahora mismo.'}</span>
          <span className="mt-1 text-xs text-zinc-500">Sólo entran partidos de las próximas 48 horas con cuotas, fiabilidad suficiente y una cuota entre 1,10 y 15.</span>
        </Empty>
      ))}
      {!plan && <Empty>Pon el dinero y la cuota para ver el plan.</Empty>}
      <PlayNotice />
    </div>
  );
}
