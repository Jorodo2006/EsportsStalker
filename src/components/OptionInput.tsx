// Campo de texto con lista de opciones agrupadas. A diferencia de <datalist>, al abrirlo enseña TODAS las
// opciones aunque el campo ya tenga algo escrito; sólo filtra cuando el usuario empieza a escribir.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/format';
import { inputCls } from './ui';

export type Option = { value: string; group?: string };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function OptionInput({ value, onChange, options, placeholder, required }: {
  value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false); // false: recién abierto, se ve la lista entera
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const words = typed ? norm(value).split(/\s+/).filter(Boolean) : [];
  const seen = new Set<string>();
  const items = options.filter(o => {
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    const n = norm(o.value + ' ' + (o.group || ''));
    return words.every(w => n.includes(w));
  });
  useEffect(() => setHi(-1), [value, typed]);
  useEffect(() => { list.current?.querySelector('[data-hi="1"]')?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  function choose(v: string) { onChange(v); setOpen(false); setTyped(false); }

  let lastGroup: string | undefined;
  return (
    <div ref={box} className="relative">
      <input value={value} placeholder={placeholder} required={required} className={inputCls}
        onChange={e => { onChange(e.target.value); setTyped(true); setOpen(true); }}
        onFocus={() => { setTyped(false); setOpen(true); }} onClick={() => setOpen(true)}
        onKeyDown={e => {
          if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && items[hi]) { e.preventDefault(); choose(items[hi].value); }
          else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
          else if (e.key === 'Tab') setOpen(false);
        }} />
      {open && items.length > 0 && (
        <div ref={list} className="absolute left-0 top-full z-40 mt-1.5 max-h-80 w-full min-w-[18rem] overflow-y-auto rounded-xl border border-zinc-700/70 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60">
          {items.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <div key={o.value}>
                {head && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{head}</div>}
                <button type="button" data-hi={i === hi ? '1' : undefined} onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(o.value); }}
                  className={cn('flex w-full cursor-pointer rounded-lg px-3 py-1.5 text-left text-sm', i === hi ? 'bg-zinc-800/80' : 'hover:bg-zinc-900',
                    o.value === value && 'text-amber-300')}>
                  <span className="truncate">{o.value}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
