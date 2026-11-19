// Lo que elige el usuario para el plan, en pasos cortos: cuánto, a qué cuota, cuándo empiezan los partidos, qué deportes (y qué
// competiciones de cada uno) y si quiere una combinada o una sencilla. Cada paso enseña al momento qué supone lo elegido
import type { ReactNode } from 'react';
import { useCurrency } from '@/lib/app-context';
import { cn, money, odd } from '@/lib/format';
import { leagueKey, WINDOWS, type PlanMode, type PlanSport } from '@/lib/plan';
import { chip, Input, panelCls, seg, segWrap } from '@/components/ui';

export interface PlanInputs { budget: string; odds: string; mode: PlanMode; sports: PlanSport[]; hours: number; skipLeagues: string[] }

export const PLAN_SPORTS: { id: PlanSport; label: string }[] = [
  { id: 'basket', label: 'Baloncesto' }, { id: 'tennis', label: 'Tenis' }, { id: 'football', label: 'Fútbol' }, { id: 'mma', label: 'MMA' }
];
// Cuotas de un toque; «Otra» deja escribirla
export const QUICK_ODDS = [1.5, 1.75, 2, 3];
const QUICK_MONEY = [10, 20, 50, 100];
const MODES: { value: PlanMode; label: string; hint: string }[] = [
  { value: 'combo', label: 'Combinada', hint: 'Varios partidos en una apuesta: la más probable de las que llegan a la cuota.' },
  { value: 'single', label: 'Simple', hint: 'Un solo partido: la apuesta más probable que paga la cuota o más.' }
];
const hoursLabel = (h: number) => (h === 48 ? '48 h' : h === 24 ? '24 h' : `${h} h`);

function Step({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-zinc-100"><span className="mr-1.5 text-zinc-500 tnum">{n}</span>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function PlanSetup({ inp, set, custom, setCustom, balance, target, toReturn, counts, leagues, loading, className }: {
  inp: PlanInputs;
  set: (p: Partial<PlanInputs>) => void;
  custom: boolean; setCustom: (v: boolean) => void;
  balance: number;
  target: number | null; toReturn: number | null;
  // Cuántos partidos hay de cada deporte elegido en la ventana, y sus competiciones
  counts: Record<PlanSport, { matches: number; picks: number }>;
  leagues: Record<PlanSport, { league: string; picks: number }[]>;
  loading: Record<PlanSport, boolean>;
  className?: string;
}) {
  const cur = useCurrency();
  const budgetNum = Number(inp.budget.replace(',', '.'));
  const badBudget = !!inp.budget.trim() && !(budgetNum > 0);
  const oddsNum = Number(inp.odds.replace(',', '.'));
  const badOdds = custom && !!inp.odds.trim() && !(oddsNum > 1 && oddsNum <= 50);

  const toggleSport = (id: PlanSport) => {
    const on = inp.sports.includes(id);
    if (on && inp.sports.length === 1) return; // al menos uno
    set({ sports: on ? inp.sports.filter(s => s !== id) : PLAN_SPORTS.map(s => s.id).filter(s => s === id || inp.sports.includes(s)) });
  };
  // Las competiciones se quitan (skipLeagues): así una nueva entra sola. Con todas puestas, tocar una deja sólo esa (un toque en
  // «NBA» y es sólo NBA); luego cada toque pone o quita, sin quedarse en ninguna. «Todas» lo deja como al principio
  const offOf = (sport: PlanSport) => inp.skipLeagues.filter(k => k.startsWith(`${sport}:`));
  const toggleLeague = (sport: PlanSport, league: string) => {
    const k = leagueKey({ sport, league });
    const off = inp.skipLeagues.includes(k);
    if (!offOf(sport).length) {
      set({ skipLeagues: [...inp.skipLeagues, ...leagues[sport].filter(l => l.league !== league).map(l => leagueKey({ sport, league: l.league }))] });
      return;
    }
    if (!off && leagues[sport].filter(l => !inp.skipLeagues.includes(leagueKey({ sport, league: l.league }))).length === 1) return;
    set({ skipLeagues: off ? inp.skipLeagues.filter(x => x !== k) : [...inp.skipLeagues, k] });
  };
  const allLeagues = (sport: PlanSport) => set({ skipLeagues: inp.skipLeagues.filter(k => !k.startsWith(`${sport}:`)) });

  const chosen = PLAN_SPORTS.filter(s => inp.sports.includes(s.id));
  const anyLoading = chosen.some(s => loading[s.id]);
  const total = chosen.reduce((a, s) => a + counts[s.id].matches, 0);

  return (
    <div className={cn(panelCls, 'flex flex-col divide-y divide-zinc-800/80', className)}>
      <Step n={1} title="Cuánto apuestas">
        <div className="relative">
          <Input inputMode="decimal" value={inp.budget} onChange={e => set({ budget: e.target.value })} placeholder="20" autoComplete="off"
            aria-label={`Dinero (${cur})`} aria-invalid={badBudget} className="pr-9 text-lg font-semibold tnum lg:text-base" />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-zinc-500">{cur}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_MONEY.map(v => <button key={v} type="button" className={chip(budgetNum === v)} aria-pressed={budgetNum === v} onClick={() => set({ budget: String(v) })}>{v} {cur}</button>)}
          {balance > 0 && <button type="button" className={chip(false)} onClick={() => set({ budget: String(Math.floor(balance * 100) / 100) })}>Mi cartera</button>}
        </div>
        {badBudget && <span className="text-xs text-rose-300" role="alert">Pon una cantidad mayor que 0, con 2 decimales como mucho.</span>}
        {budgetNum > 0 && balance > 0 && budgetNum > balance && <span className="text-xs text-amber-300">Es más de lo que tienes en la cartera ({money(balance, cur)}).</span>}
      </Step>

      <Step n={2} title="A qué cuota quieres llegar">
        <div className={cn(segWrap, 'w-full')}>
          {QUICK_ODDS.map(o => {
            const on = !custom && oddsNum === o;
            return <button key={o} type="button" aria-pressed={on} className={cn(seg(on), 'flex-1')} onClick={() => { setCustom(false); set({ odds: String(o) }); }}>{odd(o)}</button>;
          })}
          <button type="button" aria-pressed={custom} className={cn(seg(custom), 'flex-1')} onClick={() => setCustom(true)}>Otra</button>
        </div>
        {custom && <Input inputMode="decimal" value={inp.odds} onChange={e => set({ odds: e.target.value })} placeholder="2,50" autoComplete="off" aria-label="Cuota" aria-invalid={badOdds} />}
        {badOdds && <span className="text-xs text-rose-300" role="alert">Pon una cuota mayor que 1 (como mucho 50).</span>}
        {target !== null && toReturn !== null && (
          <p className="text-xs text-zinc-400">Si sale, cobras <span className="font-semibold text-zinc-100 tnum">{money(toReturn, cur)}</span> <span className="text-emerald-400 tnum">(+{money(target, cur)})</span></p>
        )}
      </Step>

      <Step n={3} title="Cuándo empiezan" aside={<span className="text-[11px] text-zinc-500">{anyLoading ? 'buscando…' : `${total} partido${total === 1 ? '' : 's'}`}</span>}>
        <div className={cn(segWrap, 'w-full')}>
          {WINDOWS.map(h => <button key={h} type="button" aria-pressed={inp.hours === h} className={cn(seg(inp.hours === h), 'flex-1')} onClick={() => set({ hours: h })}>{hoursLabel(h)}</button>)}
        </div>
        <p className="text-xs text-zinc-500">Partidos que empiezan en las próximas {inp.hours} horas. {inp.hours === 48 ? 'Más allá todavía no hay cuotas.' : 'Cuanto menos tiempo, más al día van las cuotas.'}</p>
      </Step>

      <Step n={4} title="Deportes y competiciones">
        <div className="flex flex-wrap gap-1.5">
          {PLAN_SPORTS.map(s => {
            const on = inp.sports.includes(s.id);
            const n = counts[s.id].matches;
            return (
              <button key={s.id} type="button" className={chip(on)} aria-pressed={on} onClick={() => toggleSport(s.id)}>
                {s.label}{on && <span className={cn('tnum', n ? 'text-amber-200/80' : 'text-zinc-500')}>{loading[s.id] ? '…' : n}</span>}
              </button>
            );
          })}
        </div>
        {chosen.filter(s => leagues[s.id].length > 1).map(s => (
          <div key={s.id} className="flex flex-col gap-1.5 rounded-lg bg-zinc-900/60 px-3 py-2.5">
            <div className="text-[11px] text-zinc-400">{s.label}{offOf(s.id).length ? '' : ': toca una para quedarte sólo con ella'}</div>
            <div className="flex flex-wrap gap-1.5">
              {leagues[s.id].map(l => {
                const on = !!offOf(s.id).length && !inp.skipLeagues.includes(leagueKey({ sport: s.id, league: l.league }));
                return (
                  <button key={l.league} type="button" className={cn(chip(on), 'h-8 sm:h-7')} aria-pressed={on} onClick={() => toggleLeague(s.id, l.league)}>
                    {l.league}<span className="text-zinc-500 tnum">{l.picks}</span>
                  </button>
                );
              })}
              <button type="button" className={cn(chip(!offOf(s.id).length), 'h-8 sm:h-7')} aria-pressed={!offOf(s.id).length} onClick={() => allLeagues(s.id)}>Todas</button>
            </div>
          </div>
        ))}
      </Step>

      <Step n={5} title="Cómo">
        <div className={cn(segWrap, 'w-full')}>
          {MODES.map(m => <button key={m.value} type="button" aria-pressed={inp.mode === m.value} className={cn(seg(inp.mode === m.value), 'flex-1')} onClick={() => set({ mode: m.value })}>{m.label}</button>)}
        </div>
        <p className="text-xs text-zinc-500">{MODES.find(m => m.value === inp.mode)!.hint}</p>
      </Step>
    </div>
  );
}
