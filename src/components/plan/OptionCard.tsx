// Una opción del plan (combinada o sencilla): sus selecciones con cuándo empieza cada partido, la cuota total, lo que se cobra y la
// probabilidad, y un botón para llevarla al cupón. La primera va destacada y con el riesgo (BestCard); las demás, más compactas
import type { ReactNode } from 'react';
import { Plus, TrendingDown } from 'lucide-react';
import { useApp, useCurrency } from '@/lib/app-context';
import { cn, money, odd, pct } from '@/lib/format';
import type { Plan, PlanSport, RiskLevel, Ticket } from '@/lib/plan';
import { Badge, Button, panelCls } from '@/components/ui';

const SPORT: Record<PlanSport, string> = { tennis: 'Tenis', football: 'Fútbol', mma: 'MMA', basket: 'Baloncesto' };
const TONE: Record<RiskLevel, 'success' | 'info' | 'warning' | 'danger'> = { 'bajo': 'success', 'medio': 'info', 'alto': 'warning', 'muy alto': 'danger' };

// «hoy 21:00 · en 3 h», «mañana 02:30 · en 9 h»
function whenOf(iso: string, now = Date.now()) {
  const d = new Date(iso), tz = { timeZone: 'Europe/Madrid' } as const;
  const day = (t: number) => new Date(t).toLocaleDateString('sv-SE', tz);
  const label = day(+d) === day(now) ? 'hoy' : day(+d) === day(now + 864e5) ? 'mañana' : d.toLocaleDateString('es-ES', { ...tz, weekday: 'short' });
  const mins = Math.max(0, Math.round((+d - now) / 60e3));
  const left = mins < 60 ? `en ${mins} min` : `en ${Math.floor(mins / 60)} h${mins % 60 >= 10 && mins < 600 ? ` ${mins % 60} min` : ''}`;
  return `${label} ${d.toLocaleTimeString('es-ES', { ...tz, hour: '2-digit', minute: '2-digit' })} · ${left}`;
}

// Lleva las selecciones al cupón (las que ya estén no se tocan: pulsar una que ya está la quitaría)
function useToCoupon() {
  const { addToSlip, slip, toast } = useApp();
  return (t: Ticket) => {
    const has = (event: string, market: string, selection: string) => slip.some(x => x.event === event && x.market === market && x.selection === selection);
    let n = 0;
    for (const l of t.legs) {
      const market = l.market || l.title, selection = l.selection || l.title;
      if (has(l.event, market, selection)) continue;
      addToSlip({ sport: l.sport, league: l.league, event: l.event, market, selection, odds: l.price, bookmaker: l.book, status: 'pending' });
      n++;
    }
    toast(!n ? 'Ya estaban en el cupón' : t.legs.length > 1 ? `En el cupón: elige «Combinada» y pon el importe` : 'En el cupón: pon el importe');
  };
}

function Legs({ ticket }: { ticket: Ticket }) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-800/70">
      {ticket.legs.map(l => (
        <li key={l.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-zinc-50">{l.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-400">
              <Badge>{SPORT[l.sport]}</Badge>
              <span className="truncate text-zinc-300">{l.event}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">{whenOf(l.start)}{l.league ? ` · ${l.league}` : ''}{l.book ? ` · ${l.book}` : ''}</div>
          </div>
          <span className="shrink-0 font-score text-base font-semibold text-zinc-100 tnum">{odd(l.price)}</span>
        </li>
      ))}
    </ul>
  );
}

function Figures({ ticket, big }: { ticket: Ticket; big?: boolean }) {
  const cur = useCurrency();
  const n = (label: string, value: ReactNode, cls?: string) => (
    <div className="min-w-0"><div className="text-[11px] text-zinc-500">{label}</div><div className={cn('font-score font-semibold tnum', big ? 'text-xl' : 'text-[15px]', cls)}>{value}</div></div>
  );
  return (
    <div className="grid grid-cols-3 gap-3">
      {n('Probabilidad', pct(ticket.p), big ? 'text-[var(--tv-mark)]' : 'text-zinc-50')}
      {n('Cuota total', odd(ticket.price), 'text-zinc-50')}
      {n('Cobras si sale', money(ticket.toReturn, cur), 'text-emerald-400')}
    </div>
  );
}

// La probabilidad en una barra: se ve de un vistazo lo lejos que está de «seguro»
const Bar = ({ p }: { p: number }) => (
  <div className="h-1.5 rounded-full bg-zinc-800" role="img" aria-label={`Probabilidad ${pct(p)}`}>
    <div className="h-full rounded-full bg-[var(--tv-mark)]" style={{ width: `${Math.max(2, Math.min(100, p * 100))}%` }} />
  </div>
);

export function BestCard({ plan, ticket, tag }: { plan: Plan; ticket: Ticket; tag?: string }) {
  const cur = useCurrency();
  const toCoupon = useToCoupon();
  const { risk, budget } = plan;
  const per100 = budget > 0 ? (risk.expectedReturn / budget) * 100 : 0;
  const combo = ticket.legs.length > 1;
  return (
    <section className={cn(panelCls, 'flex flex-col gap-4 p-4 sm:p-5')} aria-label="La mejor opción">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold text-zinc-50">La más probable · {combo ? `combinada de ${ticket.legs.length}` : 'sencilla'}</h2>
          {tag && <Badge tone="success">{tag}</Badge>}
        </div>
        <Badge tone={TONE[risk.level]}>Riesgo {risk.level}</Badge>
      </header>
      <Figures ticket={ticket} big />
      <Bar p={ticket.p} />
      <Legs ticket={ticket} />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => toCoupon(ticket)}><Plus size={15} />Añadir al cupón</Button>
        <span className="text-xs text-zinc-500">con {money(budget, cur)}: si sale, cobras {money(ticket.toReturn, cur)}</span>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-3 text-[13px]">
        <p className="text-zinc-300">{risk.message}</p>
        {risk.expectedReturn < budget && (
          <p className="flex items-start gap-1.5 text-rose-300"><TrendingDown size={14} className="mt-0.5 shrink-0" />De media devuelve {money(per100, cur)} por cada 100 {cur}: a la larga se pierde dinero.</p>
        )}
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer text-zinc-400">Avisos y cómo se calcula</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {plan.warnings.filter(w => !/pierde dinero/.test(w)).map((w, i) => <li key={i}>{w}</li>)}
            <li>Cada selección lleva la probabilidad del modelo de su deporte, que ya tiene en cuenta la casa; en una combinada se multiplican cuotas y probabilidades, con un partido por selección.</li>
          </ul>
        </details>
      </div>
    </section>
  );
}

export function OptionCard({ ticket, index, tag }: { ticket: Ticket; index: number; tag?: string }) {
  const toCoupon = useToCoupon();
  const combo = ticket.legs.length > 1;
  return (
    <article className={cn(panelCls, 'flex flex-col gap-3 p-4')}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">Opción {index + 1} <span className="font-normal text-zinc-500">· {combo ? `combinada de ${ticket.legs.length}` : 'sencilla'}</span>{tag && <Badge tone="success">{tag}</Badge>}</h3>
        <Button size="sm" variant="secondary" onClick={() => toCoupon(ticket)}><Plus size={14} />Al cupón</Button>
      </header>
      <Figures ticket={ticket} />
      <Legs ticket={ticket} />
    </article>
  );
}
