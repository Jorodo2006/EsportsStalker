import { Check, CircleSlash, Pencil, Send, X } from 'lucide-react';
import { STATUS_LABEL, STATUS_TONE, betProfit, decEs, money, odd, tone } from '@/lib/format';
import { useCurrency } from '@/lib/app-context';
import type { Bet, BetStatus } from '@/lib/types';
import { Badge, Button } from '@/components/ui';
import { RowMenu } from '@/components/bets/RowMenu';
import { AutoMark } from '@/views/bets/AutoMark';
import { ProfitText } from '@/views/bets/Profit';

// Una apuesta del historial: lo importante en la fila y las acciones a la derecha, sin tabla ni scroll lateral.
// Pulsar la fila abre la edición; los botones no (stopPropagation)
export function BetRow({ bet: b, onEdit, onSettle, onShare }: {
  bet: Bet; onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void; onShare: (b: Bet) => void;
}) {
  const cur = useCurrency();
  const combo = !!b.legs?.length;
  const pending = b.status === 'pending';
  const done = combo ? b.legs!.filter(l => l.status !== 'pending').length : 0;
  const profit = betProfit(b);
  const sub = [
    combo ? `Combinada ×${b.legs!.length} · ${done} de ${b.legs!.length} resueltas` : [b.event, decEs(b.market)].filter(Boolean).join(' · '),
    b.bookmaker, `${money(b.stake, cur)} a ${odd(b.odds)}`
  ].filter(Boolean).join(' · ');
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); fn(); };
  // La nula (se devuelve lo apostado) sólo estaba dentro de Editar y no se veía: va en el menú, con ganada y perdida a la vista
  const menu = [
    ...(pending && !combo ? [{ label: 'Nula: devolver lo apostado', icon: CircleSlash, onClick: () => onSettle(b, 'void') }] : []),
    { label: 'Pasar a un amigo', icon: Send, onClick: () => onShare(b) }, { label: 'Editar', icon: Pencil, onClick: () => onEdit(b) }
  ];

  return (
    <div className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-zinc-900/40" onClick={() => onEdit(b)}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {b.league && <span className="shrink-0 rounded bg-zinc-800 px-1.5 text-[11px] leading-5 text-zinc-400">{b.league}</span>}
          <span className="line-clamp-2 break-words text-sm font-semibold sm:line-clamp-1" title={decEs(b.selection)}>{decEs(b.selection)}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500" title={sub}>{sub}</div>
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
        <AutoMark bet={b} />
      </div>
      <div className="shrink-0 text-right">
        <div className={'whitespace-nowrap text-sm font-semibold tabular-nums ' + (pending ? 'text-zinc-500' : tone(profit))}>
          <ProfitText value={pending ? b.stake * (b.odds - 1) : profit} stacked />
        </div>
        <div className="text-[11px] text-zinc-500 sm:hidden">{STATUS_LABEL[b.status]}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {pending && !combo && <>
          <Button size="icon" variant="success" className="h-8 w-8" title="Ganada" aria-label="Ganada" onClick={stop(() => onSettle(b, 'won'))}><Check size={15} /></Button>
          <Button size="icon" variant="danger" className="h-8 w-8" title="Perdida" aria-label="Perdida" onClick={stop(() => onSettle(b, 'lost'))}><X size={15} /></Button>
        </>}
        <RowMenu items={menu} />
      </div>
    </div>
  );
}
