// Piezas de las fichas, con el aspecto de los rótulos de una retransmisión: banda de color, filas con el dato a cada lado y
// una línea fina debajo que se inclina hacia quien va por delante. Los colores salen de --tv-* (index.css), según la app.
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/format';

export const panel = 'rounded-lg border border-white/10 bg-[var(--tv-bg)]';
export const tdc = 'px-3 py-1.5 text-[13px]';

// Banda de sección, centrada y a todo el ancho
export function TvBand({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="relative bg-gradient-to-r from-[var(--tv-band-2)] via-[var(--tv-band)] to-[var(--tv-band-2)] px-3 py-[3px] text-center font-score text-[13px] font-bold uppercase leading-[18px] tracking-[.08em] text-white">
      {children}
      {aside && <span className="absolute right-3 top-1/2 hidden -translate-y-1/2 text-[11px] font-medium normal-case tracking-normal text-white/75 sm:block">{aside}</span>}
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
  return <section className={cn(panel, 'overflow-hidden shadow-xl shadow-black/30', className)}>{children}</section>;
}

// Cabecera del rótulo: título grande a la izquierda y lo que toque a la derecha
export function TvHeader({ title, sub, media, children }: { title: ReactNode; sub?: ReactNode; media?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t-2 border-[var(--tv-mark)] bg-gradient-to-r from-[var(--tv-band)] to-[var(--tv-band-2)] px-4 py-2.5 text-white">
      {media}
      <div className="min-w-0 flex-1 basis-56">
        <div className="truncate font-score text-[28px] font-bold uppercase leading-none tracking-wide">{title}</div>
        {sub && <div className="mt-1 truncate font-score text-[13px] font-medium uppercase tracking-wider text-white/80">{sub}</div>}
      </div>
      {children}
    </header>
  );
}

export function TvStat({ label, value, sub, title }: { label: string; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div title={title} className="min-w-0 border-l border-white/25 pl-3 first:border-0 first:pl-0">
      <div className="font-score text-[11px] font-semibold uppercase tracking-wider text-white/75">{label}</div>
      <div className="font-score text-[24px] font-bold leading-[26px] tnum">{value}</div>
      {sub != null && sub !== '' && <div className="font-score text-[12px] font-medium text-white/75 tnum">{sub}</div>}
    </div>
  );
}

// Cifras clave en una tira
export type Kpi = { label: string; value: ReactNode; sub?: ReactNode; title?: string };
export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={cn('grid divide-x divide-white/10', className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(k => (
        <div key={k.label} title={k.title} className="min-w-0 px-3 py-1.5 text-center">
          <div className="truncate font-score text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{k.label}</div>
          <div className="truncate font-score text-[22px] font-bold leading-tight text-white tnum">{k.value}</div>
          {k.sub != null && k.sub !== '' && <div className="truncate font-score text-[12px] text-zinc-400 tnum">{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// Selector cuadrado de la barra de filtros
export function TvTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; disabled?: boolean; title?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(it => (
        <button key={it.value} onClick={() => onChange(it.value)} disabled={it.disabled} title={it.title} aria-pressed={value === it.value}
          className={cn('flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 font-score text-[13px] font-semibold uppercase tracking-wide transition disabled:cursor-default disabled:opacity-35',
            value === it.value ? 'bg-[var(--tv-mark)] text-black' : 'bg-white/[.06] text-zinc-200 hover:bg-white/[.12]')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// Una estadística entre dos: a a la izquierda y b a la derecha. La línea parte del centro y se va hacia quien va por delante;
// spread es la diferencia que la lleva al tope, porque cada dato se mueve en un rango distinto (6 puntos de primer saque es
// muchísimo y 6 de juegos al resto, normal). muted: b es sólo una referencia (la media), no un rival al que resaltar.
export function TvRow({ label, a, b, aText, bText, better, spread, muted, dim, title }: {
  label: string; a: number | null; b: number | null; aText: string; bText: string; better?: 'low'; spread?: number; muted?: boolean; dim?: boolean; title?: string;
}) {
  const ok = a != null && b != null;
  const lead = ok ? (better === 'low' ? b! - a! : a! - b!) : 0;
  const top = spread ?? (Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0)) * 0.5 || 1);
  const size = Math.min(1, Math.abs(lead) / top);
  const aTop = lead > 0, bTop = lead < 0;
  return (
    <div tabIndex={0} title={title ?? `${label}: ${aText} / ${bText}`} className={cn('px-3 outline-none transition hover:bg-white/[.04] focus-visible:bg-white/[.06]', dim && 'opacity-50')}>
      <div className="grid h-[25px] grid-cols-[4rem_minmax(0,1fr)_4rem] items-center gap-2">
        <span className={cn('font-score text-[18px] tnum', aTop ? 'font-bold text-white' : 'font-medium text-zinc-300')}>{aText}</span>
        <span className="truncate text-center font-score text-[13px] font-semibold uppercase tracking-wide text-zinc-100">{label}</span>
        <span className={cn('text-right font-score text-[18px] tnum', bTop && !muted ? 'font-bold text-white' : 'font-medium text-zinc-300')}>{bText}</span>
      </div>
      <div className="relative h-[2px] bg-white/15">
        {!!size && <span className={cn('absolute top-0 h-full', bTop && muted ? 'bg-zinc-400' : 'bg-[var(--tv-mark)]')} style={aTop ? { right: '50%', width: `${Math.max(size, 0.04) * 50}%` } : { left: '50%', width: `${Math.max(size, 0.04) * 50}%` }} />}
        <span className="absolute -top-[2px] left-1/2 h-[6px] w-px bg-white/40" />
      </div>
    </div>
  );
}

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
    <div className="shrink-0 rotate-180 font-score uppercase leading-none text-white [writing-mode:vertical-rl]">
      <div className="text-[12px] font-medium tracking-wider text-zinc-300">{first}</div>
      <div className="max-h-44 truncate text-[25px] font-bold tracking-wide">{last}</div>
    </div>
  );
  return (
    <div className="relative hidden min-h-80 overflow-hidden md:block" style={{ background: `radial-gradient(90% 55% at 50% 26%, color-mix(in oklab, var(--tv-band) 42%, transparent), transparent)` }}>
      {photo && !broken ? (
        <img src={photo} alt="" onError={() => setBroken(true)}
          className={cn('absolute inset-x-0 top-0 w-full', logo ? 'h-[58%] object-contain p-9' : 'h-[74%] object-cover object-top')}
          style={logo ? undefined : { maskImage: 'linear-gradient(to bottom, #000 66%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, #000 66%, transparent 100%)' }} />
      ) : (
        <div className="absolute inset-x-0 top-10 text-center font-score text-[84px] font-bold uppercase leading-none text-white/10">{(first[0] ?? '') + (last[0] ?? '')}</div>
      )}
      <div className={cn('absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-3', right && 'flex-row-reverse')}>
        {vertical}
        <div className={cn('min-w-0 flex-1', right && 'text-right')} title={heroTitle}>
          <div className={cn('font-score text-[11px] font-semibold uppercase leading-[13px] tracking-wider', lead ? 'text-[var(--tv-mark)]' : 'text-zinc-200')}>{heroLabel}</div>
          <div className={cn('font-score text-[52px] font-bold leading-[50px] tnum', lead ? 'text-[var(--tv-mark)]' : 'text-white')}>{hero}</div>
        </div>
      </div>
    </div>
  );
}

// Últimos resultados en cuadritos: el texto G o P evita depender sólo del color
export function FormChips({ list }: { list: { win: boolean; title?: string }[] }) {
  return (
    <span className="flex gap-0.5">
      {list.map((m, i) => <span key={i} title={m.title} className={cn('grid h-[18px] w-[18px] place-items-center rounded-[3px] font-score text-[11px] font-bold', m.win ? 'bg-emerald-500/25 text-emerald-200' : 'bg-rose-500/25 text-rose-200')}>{m.win ? 'G' : 'P'}</span>)}
    </span>
  );
}
