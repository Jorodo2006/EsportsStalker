import { useCallback, useRef, useState } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui';
import { useDismiss } from '@/components/bets/useDismiss';

// Menú «⋯» de una fila: las acciones que no caben a la vista
export function RowMenu({ items }: { items: { label: string; icon: LucideIcon; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box);
  return (
    <div ref={box} className="relative" onClick={e => e.stopPropagation()}>
      <Button type="button" variant="ghost" size="icon" aria-label="Más acciones" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}><MoreHorizontal size={16} /></Button>
      {open && (
        <ul role="menu" className="absolute right-0 top-full z-20 mt-1 w-48 rounded-[10px] border border-zinc-700 bg-surface p-1 shadow-xl shadow-black/40">
          {items.map(({ label, icon: Icon, onClick }) => (
            <li key={label} role="none">
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onClick(); }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-zinc-200 transition hover:bg-zinc-800">
                <Icon size={14} className="text-zinc-400" />{label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
