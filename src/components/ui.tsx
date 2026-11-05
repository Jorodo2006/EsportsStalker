// Componentes base de la interfaz, con el diseño de Stitch suavizado: superficies oscuras con esquinas redondeadas y
// cada tipo de control con su forma propia para que se distinga a simple vista:
//   - acción principal: píldora rellena del acento (Button primary)
//   - acción secundaria: píldora gris rellena (Button secondary)
//   - pestañas: selector segmentado, la elegida en blanco (segWrap + seg)
//   - filtros: píldora con contorno, la elegida teñida del acento (chip)
//   - cuotas: ficha rellena con la cifra en mono, la mejor teñida del acento (oddBtn)
// Nada es rectangular: paneles a 16 px, cajas internas a 14 px y fichas y campos a 12 px (radios en index.css).
// Lo que no se pulsa (etiquetas, rótulos de cifras) va en mono pequeña y mayúsculas.
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/format';

// ---------- estilos compartidos ----------
export const panelCls = 'rounded-2xl border border-zinc-800 bg-surface';
export const chip = (on: boolean) => cn('inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition disabled:cursor-default disabled:opacity-35',
  on ? 'border-amber-500/50 bg-amber-500/15 text-amber-300' : 'border-zinc-700/70 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-100');
export const segWrap = 'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-zinc-900 p-1 ring-1 ring-inset ring-zinc-800 no-scrollbar';
export const seg = (on: boolean) => cn('shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition disabled:cursor-default disabled:opacity-35',
  on ? 'bg-zinc-100 font-semibold text-zinc-950 shadow-sm' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100');
export const oddBtn = (best?: boolean) => cn('cursor-pointer rounded-lg font-mono font-bold tnum transition active:scale-[.97] disabled:cursor-default',
  best ? 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/50 hover:bg-amber-500/25' : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-amber-500 font-semibold text-zinc-950 shadow-md shadow-amber-500/15 hover:bg-amber-400',
  secondary: 'bg-zinc-800 text-zinc-100 ring-1 ring-inset ring-white/5 hover:bg-zinc-700',
  ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
  danger: 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
  success: 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
};

export function Button({ variant = 'primary', size = 'md', className, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon' }) {
  return (
    <button
      {...p}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-medium transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-8 px-3.5 text-xs' : size === 'icon' ? 'h-9 w-9' : 'h-10 px-5 text-sm',
        VARIANTS[variant], className
      )}
    />
  );
}

// Marca de sección: la barrita de color del acento que abre cada título
export function Mark({ className }: { className?: string }) {
  return <span aria-hidden className={cn('h-4 w-1 shrink-0 rounded-full bg-amber-500', className)} />;
}

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn(panelCls, className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-zinc-50">{title && <Mark />}{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

const BADGE: Record<string, string> = {
  neutral: 'bg-zinc-800 text-zinc-300',
  live: 'bg-[#93000a] text-rose-200',
  success: 'bg-emerald-500/15 text-emerald-300',
  danger: 'bg-rose-500/15 text-rose-300',
  warning: 'bg-amber-500/15 text-amber-300',
  info: 'bg-sky-500/15 text-sky-300'
};
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof BADGE; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider', BADGE[tone], className)}>{children}</span>;
}

// 16 px en el móvil: con menos, el iPhone amplía la página al tocar el campo
export const inputCls = 'h-10 w-full rounded-lg border border-zinc-700/70 bg-zinc-900 px-3 text-base text-zinc-100 lg:h-9 lg:text-sm placeholder:text-zinc-500 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20';

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputCls, className)} />;
}
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cn(inputCls, 'cursor-pointer pr-8', className)} />;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

// Cifra clave: etiqueta en mono arriba, el número grande en mono y una línea de contexto
export function Stat({ label, value, sub, valueClass, icon }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string; icon?: ReactNode }) {
  return (
    <div className={cn(panelCls, 'px-4 py-3.5')}>
      <div className="label-data flex items-center justify-between gap-2 text-zinc-400">{label}<span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-800 text-zinc-400 empty:hidden">{icon}</span></div>
      <div className={cn('mt-2 font-score text-[22px] font-semibold leading-7 tracking-tight tnum', valueClass)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-2 pt-4 sm:p-6 sm:pt-14" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={cn('relative w-full rounded-2xl border border-zinc-700/70 bg-surface shadow-2xl shadow-black/60', wide ? 'max-w-5xl' : 'max-w-2xl')}>
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold"><Mark />{title}</div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X size={18} /></Button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700/80 px-6 py-10 text-center text-sm text-zinc-400">
      {icon && <div className="grid h-11 w-11 place-items-center rounded-full bg-zinc-900 text-zinc-500">{icon}</div>}
      <div className="flex flex-col items-center">{children}</div>
    </div>
  );
}

export function ErrorBox({ error, children }: { error: unknown; children?: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-200">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-400" />
      <div>
        <div>{error instanceof Error ? error.message : String(error)}</div>
        {children && <div className="mt-1 text-rose-300/70">{children}</div>}
      </div>
    </div>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return <div className="flex items-center gap-2 py-8 font-mono text-xs text-zinc-500"><Loader2 size={14} className="animate-spin" />{label}</div>;
}

// Escudo del equipo o, si no hay imagen, su código en una placa mono
export function TeamLogo({ src, name, size = 32 }: { src?: string; name: string; size?: number }) {
  if (src) return <img src={src} alt="" width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} />;
  return (
    <div className="grid shrink-0 place-items-center rounded-md bg-zinc-800 font-mono font-bold text-zinc-200"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.32)) }}>
      {name.slice(0, 3).toUpperCase()}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><Mark className="h-6" />{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// Selector segmentado: la opción elegida en blanco, para que se distinga de los botones de acción (del acento)
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className={segWrap}>
      {items.map(it => (
        <button key={it.value} onClick={() => onChange(it.value)} aria-pressed={value === it.value} className={cn(seg(value === it.value), 'px-3 py-1 text-xs')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export const th = 'px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500';
export const td = 'px-3 py-2.5 text-[13px]';
