// Componentes base de la interfaz (estilo shadcn, hechos a mano con Tailwind)
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-sm shadow-amber-500/20',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700/60',
  ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
  danger: 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30',
  success: 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30'
};

export function Button({ variant = 'primary', size = 'md', className, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon' }) {
  return (
    <button
      {...p}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : size === 'icon' ? 'h-8 w-8' : 'h-9 px-3.5 text-sm',
        VARIANTS[variant], className
      )}
    />
  );
}

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

const BADGE: Record<string, string> = {
  neutral: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  live: 'bg-rose-500 text-white border-rose-400 animate-pulse',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  danger: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30'
};
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof BADGE; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', BADGE[tone], className)}>{children}</span>;
}

export const inputCls = 'h-9 w-full rounded-lg border border-zinc-700/70 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/20';

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputCls, className)} />;
}
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cn(inputCls, 'pr-8', className)} />;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, valueClass, icon }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-900/40 p-4">
      <div className="flex items-center justify-between text-xs font-medium text-zinc-400">{label}<span className="text-zinc-600">{icon}</span></div>
      <div className={cn('mt-1.5 text-2xl font-bold tabular-nums tracking-tight', valueClass)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6 pt-14 backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={cn('relative w-full rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50', wide ? 'max-w-5xl' : 'max-w-2xl')}>
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4">
          <div className="min-w-0 flex-1 text-base font-semibold">{title}</div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X size={18} /></Button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 px-6 py-10 text-center text-sm text-zinc-500">
      {icon && <div className="text-zinc-600">{icon}</div>}
      {children}
    </div>
  );
}

export function ErrorBox({ error, children }: { error: unknown; children?: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-400" />
      <div>
        <div>{error instanceof Error ? error.message : String(error)}</div>
        {children && <div className="mt-1 text-rose-300/70">{children}</div>}
      </div>
    </div>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return <div className="flex items-center gap-2 py-8 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin" />{label}</div>;
}

export function TeamLogo({ src, name, size = 32 }: { src?: string; name: string; size?: number }) {
  if (src) return <img src={src} alt="" width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} />;
  return (
    <div className="grid shrink-0 place-items-center rounded-md bg-zinc-800 text-[10px] font-bold text-zinc-400" style={{ width: size, height: size }}>
      {name.slice(0, 3).toUpperCase()}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
      {items.map(it => (
        <button key={it.value} onClick={() => onChange(it.value)}
          className={cn('cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition', value === it.value ? 'bg-zinc-700 text-zinc-50 shadow' : 'text-zinc-400 hover:text-zinc-200')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export const th = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500';
export const td = 'px-3 py-2.5 text-sm';
