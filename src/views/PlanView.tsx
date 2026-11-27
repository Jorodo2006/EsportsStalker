import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useApp, useCurrency, useWallet } from '@/lib/app-context';
import { buildPlan, leagueKey, leaguesOf, parseEuros, parseOdds, poolStats, targetOf, veryReliable, VERY_RELIABLE, WINDOWS, type Join, type PlanMode, type PlanSport } from '@/lib/plan';
import { money, odd, pct } from '@/lib/format';
import { Empty, Loading, PageHeader, panelCls, PlayNotice, Tabs } from '@/components/ui';
import { Surebets } from '@/components/plan/Surebets';
import { usePlanPool } from '@/components/plan/usePlanPool';
import { PlanSetup, PLAN_SPORTS, QUICK_ODDS, type PlanInputs } from '@/components/plan/PlanSetup';
import { BestCard, OptionCard } from '@/components/plan/OptionCard';

const KEY = 'plan-inputs';
const MODES: PlanMode[] = ['combo', 'single'];
const DEFAULTS: PlanInputs = { budget: '', odds: '2', mode: 'combo', sports: PLAN_SPORTS.map(s => s.id), hours: 48, skipLeagues: [] };

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
        Todas sus selecciones tienen una fiabilidad de {VERY_RELIABLE} o más. Juntas en una combinada de {t.legs.length}, la cuota sube a <span className="font-medium text-zinc-50 tnum">{odd(t.price)}</span> (se cobrarían {money(t.toReturn, cur)}), pero la probabilidad baja a <span className="font-medium text-zinc-50 tnum">{pct(t.p)}</span>: tienen que salir todas a la vez.
      </p>
      <p className="text-xs text-zinc-500">Fiable quiere decir que el cálculo tiene buenos datos, no que vaya a salir.</p>
    </section>
  );
}

// Lo último que se eligió, sólo en este navegador
function saved(): PlanInputs {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    const sports = Array.isArray(o.sports) ? PLAN_SPORTS.map(s => s.id).filter(id => o.sports.includes(id)) : [];
    return {
      budget: typeof o.budget === 'string' ? o.budget : '',
      odds: typeof o.odds === 'string' ? o.odds : DEFAULTS.odds,
      mode: MODES.includes(o.mode) ? o.mode : DEFAULTS.mode,
      sports: sports.length ? sports : DEFAULTS.sports,
      hours: (WINDOWS as readonly number[]).includes(o.hours) ? o.hours : DEFAULTS.hours,
      skipLeagues: Array.isArray(o.skipLeagues) ? o.skipLeagues.filter((x: unknown) => typeof x === 'string').slice(0, 60) : []
    };
  } catch { return DEFAULTS; }
}

// Plan por objetivo: cuánto, a qué cuota, cuándo empiezan los partidos, qué deportes y competiciones, y combinada o sencilla →
// la apuesta más probable para llegar, otras opciones y su riesgo. Es una pantalla de cálculo: no apunta apuestas ni lee cuotas
// (se pueden llevar al cupón, y allí se apuntan)
export default function PlanView() {
  // Plan o Surebets (components/plan/Surebets.tsx): las dos son pantallas de cálculo. Surebets tiene su dirección (/surebets, la
  // de sus avisos), así que la pestaña sale de la ruta
  const { viewParam, go } = useApp();
  const tab: 'plan' | 'sure' = viewParam === 'surebets' ? 'sure' : 'plan';
  const setTab = (v: 'plan' | 'sure') => go('plan', v === 'sure' ? 'surebets' : undefined);
  const tabs = <Tabs value={tab} onChange={setTab} items={[{ value: 'plan', label: 'Plan' }, { value: 'sure', label: 'Surebets' }]} />;
  if (tab === 'sure') return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Surebets" subtitle="Winamax y Betway no están de acuerdo: apostando a todo, se gana salga lo que salga." />
      <div className="-mt-3">{tabs}</div>
      <Surebets />
    </div>
  );
  return <PlanScreen tabs={tabs} />;
}

function PlanScreen({ tabs }: { tabs: ReactNode }) {
  const wallet = useWallet();
  const cur = useCurrency();
  const [inp, setInp] = useState(saved);
  const [custom, setCustom] = useState(() => !QUICK_ODDS.some(o => String(o) === inp.odds));
  const { pool, sports, updatedAt } = usePlanPool(inp.sports);
  const [now] = useState(() => Date.now());

  const set = (patch: Partial<PlanInputs>) => setInp(prev => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
    return next;
  });
  const budget = parseEuros(inp.budget);
  const odds = parseOdds(inp.odds);
  const target = budget && odds ? targetOf(budget, odds) : null;
  // Recuentos y competiciones de la ventana elegida, sin las competiciones quitadas (para los números de cada deporte)
  const kept = useMemo(() => pool.filter(p => !inp.skipLeagues.includes(leagueKey(p))), [pool, inp.skipLeagues]);
  const counts = useMemo(() => poolStats(kept, now, inp.hours), [kept, now, inp.hours]);
  const leagues = useMemo(() => leaguesOf(pool, now, inp.hours), [pool, now, inp.hours]);
  const plan = useMemo(() => (budget && target ? buildPlan(pool, budget, target, Date.now(), {
    mode: inp.mode, sports: inp.sports, odds: odds ?? undefined, hours: inp.hours, skipLeagues: inp.skipLeagues
  }) : null), [pool, budget, target, odds, inp.mode, inp.sports, inp.hours, inp.skipLeagues]);
  const loading = Object.fromEntries(PLAN_SPORTS.map(s => [s.id, inp.sports.includes(s.id) && sports[s.id].loading])) as Record<PlanSport, boolean>;
  const anyLoading = Object.values(loading).some(Boolean);
  const mins = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 60_000)) : null;
  const best = plan?.options[0] ?? null;
  const errors = PLAN_SPORTS.filter(s => inp.sports.includes(s.id) && sports[s.id].error).map(s => s.label);

  const result = !plan ? (
    <Empty>Pon cuánto quieres apostar y verás aquí la apuesta más probable para llegar a la cuota.</Empty>
  ) : anyLoading && !pool.length ? (
    <Loading label="Buscando apuestas…" />
  ) : plan.options.length ? (
    <>
      <BestCard plan={plan} ticket={plan.options[0]} tag={veryReliable(plan.options[0]) ? 'Muy fiable' : undefined} />
      {plan.options.length > 1 && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Otras opciones</h2>
            <p className="text-xs text-zinc-500">Alternativas a la de arriba, de más a menos probable y sin partidos en común: elige una, no las juegues todas.</p>
          </div>
          <div className="grid gap-3">
            {plan.options.slice(1).map((t, i) => <OptionCard key={t.legs.map(l => l.id).join('+')} ticket={t} index={i + 1} tag={veryReliable(t) ? 'Muy fiable' : undefined} />)}
          </div>
        </div>
      )}
      {plan.join && <JoinCard join={plan.join} />}
    </>
  ) : (
    <Empty>
      <span>{plan.warnings[0] ?? 'No hay apuestas para armar un plan ahora mismo.'}</span>
      <span className="mt-1 block text-xs text-zinc-500">Entran partidos con cuotas leídas, fiabilidad suficiente y cuota entre 1,10 y 15. Prueba con más horas, otra cuota u otro deporte.</span>
    </Empty>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Plan" subtitle="Elige cuánto, a qué cuota y cuándo: te damos la apuesta más probable para llegar." />
      <div className="-mt-3">{tabs}</div>
      {best && (
        <button type="button" onClick={() => document.getElementById('plan-resultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className={`${panelCls} -mt-2 flex cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-900 xl:hidden`}>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-zinc-500">Tu mejor apuesta ahora</span>
            <span className="block truncate text-sm font-semibold text-zinc-50">
              <span className="text-[var(--tv-mark)] tnum">{pct(best.p)}</span> · cuota <span className="tnum">{odd(best.price)}</span> · cobras <span className="text-emerald-400 tnum">{money(best.toReturn, cur)}</span>
            </span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-zinc-400" />
        </button>
      )}
      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start">
        <div className="flex flex-col gap-2">
          <PlanSetup inp={inp} set={set} custom={custom} setCustom={setCustom} balance={wallet.balance}
            target={target} toReturn={budget && target !== null ? budget + target : null} counts={counts} leagues={leagues} loading={loading} />
          <p className="px-1 text-[11px] text-zinc-500">
            Con las cuotas ya leídas{mins !== null ? `, de hace ${mins} min` : ''}. LoL no entra: no tiene recomendaciones.{errors.length ? ` No se pudo cargar: ${errors.join(', ')}.` : ''}
          </p>
        </div>
        <div id="plan-resultado" className="flex min-w-0 scroll-mt-24 flex-col gap-4">
          {result}
          <PlayNotice />
        </div>
      </div>
    </div>
  );
}
