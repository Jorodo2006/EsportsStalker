// Piezas de las fichas, con el aspecto de terminal de datos del diseño: paneles planos con borde fino, cabecera con la
// marca del acento, cifras en mono y una línea fina debajo de cada comparación que se inclina hacia quien va por delante.
// El acento sale de --tv-mark (index.css), según la app.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/format';
import { Mark, chip } from './ui';

export const panel = 'rounded-xl border border-zinc-800 bg-[var(--tv-bg)]';
export const tdc = 'px-3 py-1.5 text-[13px]';

// Cabecera de sección: marca, título y, a la derecha, un dato de contexto
export function TvBand({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-800/70 px-4 py-2.5">
      <Mark className="bg-[var(--tv-mark)]" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-50">{children}</span>
      {aside && <span className="label-data hidden shrink-0 text-zinc-500 sm:block">{aside}</span>}
    </div>
  );
}

export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn(panel, 'overflow-hidden', className)}>
      {(title || aside) && <TvBand aside={aside}>{title}</TvBand>}
      {children}
    </section>
  );
}

export function TvFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn(panel, 'overflow-hidden', className)}>{children}</section>;
}

// Cabecera de la ficha: título grande a la izquierda y lo que toque a la derecha
export function TvHeader({ title, sub, media, children }: { title: ReactNode; sub?: ReactNode; media?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-zinc-800/70 bg-zinc-900/60 px-4 py-3.5 shadow-[inset_3px_0_0_var(--tv-mark)]">
      {media}
      <div className="min-w-0 flex-1 basis-56">
        <div className="truncate text-2xl font-bold leading-tight tracking-tight text-zinc-50">{title}</div>
        {sub && <div className="label-data mt-1 truncate text-zinc-400">{sub}</div>}
      </div>
      {children}
    </header>
  );
}

export function TvStat({ label, value, sub, title }: { label: string; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div title={title} className="min-w-0 border-l border-zinc-700 pl-3 first:border-0 first:pl-0">
      <div className="label-data text-zinc-500">{label}</div>
      <div className="mt-0.5 font-score text-xl font-semibold leading-6 text-zinc-50 tnum">{value}</div>
      {sub != null && sub !== '' && <div className="font-mono text-[11px] text-zinc-500 tnum">{sub}</div>}
    </div>
  );
}

// Cifras clave en una tira
export type Kpi = { label: string; value: ReactNode; sub?: ReactNode; title?: string };
export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={cn('grid [grid-template-columns:repeat(var(--kpi-sm),minmax(0,1fr))] sm:[grid-template-columns:repeat(var(--kpi),minmax(0,1fr))]', className)} style={{ '--kpi': items.length, '--kpi-sm': items.length > 4 ? 3 : items.length } as CSSProperties}>
      {items.map(k => (
        <div key={k.label} title={k.title} className="min-w-0 border-b border-l border-zinc-800 px-3 py-2 text-center first:border-l-0 sm:border-b-0">
          <div className="label-data truncate text-zinc-500">{k.label}</div>
          <div className="mt-0.5 truncate font-score text-lg font-semibold leading-tight text-zinc-50 tnum">{k.value}</div>
          {k.sub != null && k.sub !== '' && <div className="truncate font-mono text-[11px] text-zinc-500 tnum">{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// Selector de la barra de filtros: píldoras con contorno, la elegida teñida del acento
export function TvTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; disabled?: boolean; title?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(it => (
        <button key={it.value} onClick={() => onChange(it.value)} disabled={it.disabled} title={it.title} aria-pressed={value === it.value}
          className={chip(value === it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// Una estadística entre dos: a a la izquierda y b a la derecha. La línea parte del centro y se va hacia quien va por delante;
// spread es la diferencia que la lleva al tope, porque cada dato se mueve en un rango distinto (6 puntos de primer saque es
// muchísimo y 6 de juegos al resto, normal). muted: b es sólo una referencia (la media), no un rival al que resaltar.
// aMark y bMark: el color de la línea cuando va por delante cada uno (por ejemplo, el de su equipo).
export function TvRow({ label, a, b, aText, bText, better, spread, muted, dim, title, aMark, bMark }: {
  label: string; a: number | null; b: number | null; aText: string; bText: string; better?: 'low'; spread?: number; muted?: boolean; dim?: boolean; title?: string; aMark?: string; bMark?: string;
}) {
  const ok = a != null && b != null;
  const lead = ok ? (better === 'low' ? b! - a! : a! - b!) : 0;
  const top = spread ?? (Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0)) * 0.5 || 1);
  const size = Math.min(1, Math.abs(lead) / top);
  const aTop = lead > 0, bTop = lead < 0;
  return (
    <div tabIndex={0} title={title ?? `${label}: ${aText} / ${bText}`} className={cn('px-4 py-0.5 outline-none transition hover:bg-zinc-900 focus-visible:bg-zinc-900', dim && 'opacity-50')}>
      <div className="grid h-[25px] grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
        <span className={cn('font-mono text-[14px] tnum', aTop ? 'font-bold text-zinc-50' : 'font-medium text-zinc-400')}>{aText}</span>
        <span className="truncate text-center font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400">{label}</span>
        <span className={cn('text-right font-mono text-[14px] tnum', bTop && !muted ? 'font-bold text-zinc-50' : 'font-medium text-zinc-400')}>{bText}</span>
      </div>
      <div className="relative h-[3px] rounded-full bg-zinc-800">
        {!!size && <span className={cn('absolute top-0 h-full rounded-full', bTop && muted ? 'bg-zinc-500' : 'bg-[var(--tv-mark)]')} style={{ ...(aTop ? { right: '50%' } : { left: '50%' }), width: `${Math.max(size, 0.04) * 50}%`, ...(aTop && aMark ? { background: aMark } : bTop && bMark ? { background: bMark } : {}) }} />}
        <span className="absolute -top-[2px] left-1/2 h-[6px] w-px bg-zinc-500" />
      </div>
    </div>
  );
}

// Un escudo negro no se vería sobre un fondo oscuro: este halo lo separa sin notarse en los demás
export const logoGlow = 'drop-shadow-[0_0_4px_rgb(255_255_255_/_.4)]';

const split = (name: string) => { const [first, ...rest] = name.split(' '); return rest.length ? { first, last: rest.join(' ') } : { first: '', last: first }; };
export const surname = (name: string) => split(name).last;

// Columna del jugador: la foto se funde con el fondo y debajo van el nombre en vertical y la cifra grande.
// Sin foto, las iniciales. logo: la imagen es un escudo y se ve entera.
export function TvPortrait({ name, photo, logo, side, heroLabel, hero, lead, heroTitle }: {
  name: string; photo?: string; logo?: boolean; side: 'left' | 'right'; heroLabel: string; hero: ReactNode; lead?: boolean; heroTitle?: string;
}) {
  const [broken, setBroken] = useState(false);
  const { first, last } = split(name);
  const right = side === 'right';
  const vertical = (
    <div className="shrink-0 rotate-180 uppercase leading-none text-zinc-50 [writing-mode:vertical-rl]">
      <div className="font-mono text-[11px] font-medium tracking-wider text-zinc-400">{first}</div>
      <div className="max-h-44 truncate text-[22px] font-bold tracking-tight">{last}</div>
    </div>
  );
  return (
    <div className={cn('relative hidden min-h-80 overflow-hidden bg-zinc-900 md:block', right ? 'border-l' : 'border-r', 'border-zinc-800')}
      style={{ backgroundColor: 'color-mix(in oklab, var(--tv-glow, var(--color-zinc-900)) 22%, var(--color-zinc-900))' }}>
      {photo && !broken ? (
        <img src={photo} alt="" onError={() => setBroken(true)}
          className={cn('absolute inset-x-0 top-0 w-full', logo ? `h-[58%] object-contain p-9 ${logoGlow}` : 'h-[74%] object-cover object-top')}
          style={logo ? undefined : { maskImage: 'linear-gradient(to bottom, #000 66%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, #000 66%, transparent 100%)' }} />
      ) : (
        <div className="absolute inset-x-0 top-10 text-center font-mono text-[72px] font-bold uppercase leading-none text-zinc-800">{(first[0] ?? '') + (last[0] ?? '')}</div>
      )}
      <div className={cn('absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-3', right && 'flex-row-reverse')}>
        {vertical}
        <div className={cn('min-w-0 flex-1', right && 'text-right')} title={heroTitle}>
          <div className={cn('label-data', lead ? 'text-[var(--tv-mark)]' : 'text-zinc-400')}>{heroLabel}</div>
          <div className={cn('text-[46px] font-bold leading-[48px] tracking-tight tnum', lead ? 'text-[var(--tv-mark)]' : 'text-zinc-50')}>{hero}</div>
        </div>
      </div>
    </div>
  );
}

// Últimos resultados en cuadritos: el texto G o P evita depender sólo del color
export function FormChips({ list }: { list: { win: boolean; title?: string }[] }) {
  return (
    <span className="flex gap-0.5">
      {list.map((m, i) => <span key={i} title={m.title} className={cn('grid h-[18px] w-[18px] place-items-center rounded-md font-mono text-[10px] font-bold', m.win ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300')}>{m.win ? 'G' : 'P'}</span>)}
    </span>
  );
}
