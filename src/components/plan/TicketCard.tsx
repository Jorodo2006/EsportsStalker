import type { PlanSport, Ticket } from '@/lib/plan';
import { Badge, panelCls } from '@/components/ui';
import { money, odd, pct } from '@/lib/format';
import { useCurrency } from '@/lib/app-context';

const SPORT: Record<PlanSport, string> = { tennis: 'Tenis', football: 'Fútbol', mma: 'MMA', basket: 'Baloncesto' };

// Una apuesta del plan: sus selecciones con la cuota, cuánto poner y cuánto se cobra si sale
export function TicketCard({ ticket, index }: { ticket: Ticket; index: number }) {
  const cur = useCurrency();
  const combo = ticket.legs.length > 1;
  return (
    <article className={`${panelCls} flex flex-col gap-3 p-4`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">Apuesta {index + 1} · {combo ? `Combinada de ${ticket.legs.length}` : 'Sencilla'}</h3>
        <span className="text-xs text-zinc-500 tnum">Probabilidad {pct(ticket.p)}</span>
      </header>
      <ul className="flex flex-col divide-y divide-zinc-800/70">
        {ticket.legs.map(l => (
          <li key={l.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Badge>{SPORT[l.sport]}</Badge><span className="truncate text-[13px] text-zinc-200">{l.event}</span></div>
              <div className="mt-1 text-[13px] text-zinc-400">{l.title} {l.book && <span className="text-zinc-600">· {l.book}</span>}</div>
            </div>
            <span className="shrink-0 text-sm font-medium text-zinc-100 tnum">{odd(l.price)}</span>
          </li>
        ))}
      </ul>
      <footer className="grid grid-cols-3 gap-3 border-t border-zinc-800 pt-3">
        <div><div className="text-xs text-zinc-500">Poner</div><div className="text-sm font-semibold text-zinc-50 tnum">{money(ticket.stake, cur)}</div></div>
        <div><div className="text-xs text-zinc-500">Cuota total</div><div className="text-sm font-medium text-zinc-100 tnum">{odd(ticket.price)}</div></div>
        <div><div className="text-xs text-zinc-500">Se cobra si sale</div><div className="text-sm font-medium text-zinc-100 tnum">{money(ticket.toReturn, cur)}</div></div>
      </footer>
    </article>
  );
}
