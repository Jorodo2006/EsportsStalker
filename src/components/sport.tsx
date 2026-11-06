// Piezas comunes de las tres apps (LoL, baloncesto y tenis) para ver partidos: título, tira de días, filtro por estado,
// bloque de competición con sus tarjetas, la sección En directo y el marcador grande del partido abierto.
import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, odd } from '@/lib/format';
import { Mark, TeamLogo, chip, oddBtn, panelCls, seg, segWrap } from './ui';

export type MatchState = 'pre' | 'live' | 'post';

// Punto rojo de "en juego"
export const LiveDot = ({ className }: { className?: string }) => <span aria-hidden className={cn('inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-rose-400', className)} />;

// ---------- días ----------
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
export const today = () => isoDay(new Date());
// "Hoy", "Ayer", "Mañana" o "sáb 7"
export const dayName = (iso: string) => {
  const now = today();
  if (iso === now) return 'Hoy';
  if (iso === addDays(now, -1)) return 'Ayer';
  if (iso === addDays(now, 1)) return 'Mañana';
  const d = new Date(iso + 'T12:00:00');
  return `${d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')} ${d.getDate()}`;
};

// Título de la lista de partidos con el día elegido en largo
export function MatchesTitle({ date }: { date: string }) {
  const long = new Date(date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><Mark className="h-6" />Partidos</h1>
      <p className="mt-1 text-sm text-zinc-400 first-letter:uppercase">{long}</p>
    </div>
  );
}

// Tira de días en píldoras: la semana alrededor del día elegido, con cuántos partidos hay y si alguno está en juego.
// El día elegido va relleno del acento. En el móvil se desliza de lado
export function DayStrip({ value, onChange, counts, span = 7 }: {
  value: string; onChange: (d: string) => void; counts?: Record<string, { total: number; live: number }>; span?: number;
}) {
  const half = Math.floor(span / 2);
  const days = Array.from({ length: span }, (_, i) => addDays(value, i - half));
  const selRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [value]);
  const arrow = 'grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-zinc-900 text-zinc-400 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-800 hover:text-zinc-100';
  return (
    <div className="flex items-center gap-2">
      <button className={arrow} onClick={() => onChange(addDays(value, -span))} aria-label="Semana anterior"><ChevronLeft size={16} /></button>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto no-scrollbar">
        {days.map(d => {
          const c = counts?.[d];
          const sel = d === value;
          return (
            <button key={d} ref={sel ? selRef : undefined} onClick={() => onChange(d)} aria-pressed={sel}
              className={cn('relative flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium transition',
                sel ? 'bg-amber-500 font-semibold text-zinc-950 shadow-md shadow-amber-500/15' : 'bg-zinc-900 text-zinc-300 ring-1 ring-inset ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-50')}>
              <span className="first-letter:uppercase">{dayName(d)}</span>
              {!!c?.total && <span className={cn('font-mono text-xs tnum', sel ? 'text-zinc-950/70' : 'text-zinc-500')}>{c.total}</span>}
              {!!c?.live && <LiveDot className={cn('absolute right-2 top-1.5', sel && 'bg-zinc-950')} />}
            </button>
          );
        })}
      </div>
      <button className={arrow} onClick={() => onChange(addDays(value, span))} aria-label="Semana siguiente"><ChevronRight size={16} /></button>
    </div>
  );
}

// ---------- filtros ----------
export type StateFilter = 'all' | MatchState;

export function StateFilterBar({ value, onChange, counts, children }: {
  value: StateFilter; onChange: (v: StateFilter) => void; counts: Record<StateFilter, number>; children?: ReactNode;
}) {
  const items: [StateFilter, string][] = [['all', 'Todos'], ['live', 'En juego'], ['pre', 'Próximos'], ['post', 'Terminados']];
  // En el móvil las píldoras se deslizan de lado en vez de partirse en dos líneas
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="-mx-3 flex min-w-0 max-w-[calc(100%+1.5rem)] gap-1.5 overflow-x-auto px-3 no-scrollbar sm:mx-0 sm:max-w-none sm:px-0">
        {items.map(([v, label]) => (
          <button key={v} onClick={() => onChange(v)} disabled={v !== 'all' && !counts[v]} aria-pressed={value === v} className={chip(value === v)}>
            {v === 'live' && (counts.live ? <LiveDot /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />)}
            {label}
            <span className={cn('font-mono font-semibold tnum', v === 'live' && counts.live ? 'text-rose-300' : value === v ? 'text-amber-200' : 'text-zinc-500')}>{counts[v]}</span>
          </button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// Interruptor (por ejemplo, "Cuotas"): pista redonda con su bola, para que no se confunda con un botón
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="flex h-8 cursor-pointer items-center gap-2 rounded-full px-1.5 text-xs font-medium text-zinc-300 transition hover:text-zinc-50">
      <span className={cn('relative h-5 w-9 rounded-full transition', on ? 'bg-amber-500' : 'bg-zinc-700')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full shadow transition-all', on ? 'left-[18px] bg-zinc-950' : 'left-0.5 bg-zinc-300')} />
      </span>
      {label}
    </button>
  );
}

// ---------- competición y tarjeta de partido ----------
// Una competición: cabecera (se pliega al pulsarla) y sus partidos en una cuadrícula de tarjetas.
// id: el ancla para el menú lateral
export function CompetitionBlock({ id, name, sub, logo, count, live, open, onToggle, children }: {
  id?: string; name: string; sub?: string; logo?: string; count: number; live?: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <button onClick={onToggle} aria-expanded={open} className="mb-3 flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-1 py-1 text-left transition hover:bg-zinc-900/60">
        <Mark />
        {logo ? <img src={logo} alt="" className="h-6 w-6 object-contain" /> : <span className="grid h-6 w-6 place-items-center rounded-lg bg-zinc-800 font-mono text-[9px] font-bold text-zinc-300">{name.slice(0, 2).toUpperCase()}</span>}
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate text-[15px] font-semibold text-zinc-50">{name}</span>
          {sub && <span className="label-data truncate text-zinc-500">{sub}</span>}
        </div>
        {!!live && <span className="flex items-center gap-1 rounded-full bg-[#93000a] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-rose-200">{live} en juego</span>}
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-zinc-800 px-1.5 font-mono text-[11px] text-zinc-300 tnum">{count}</span>
        <ChevronDown size={16} className={cn('text-zinc-500 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">{children}</div>}
    </section>
  );
}

// Los partidos en juego, destacados arriba en tarjetas grandes
export function LiveSection({ count, children }: { count: number; children: ReactNode }) {
  return (
    <section id="comp-en-directo" className="scroll-mt-4">
      <div className="mb-3 flex items-center gap-2.5 px-1 py-1">
        <LiveDot className="h-2 w-2" />
        <span className="text-[15px] font-semibold text-zinc-50">En directo</span>
        <span className="label-data text-zinc-500">{count} {count === 1 ? 'partido' : 'partidos'}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

// games y points: los juegos del set y los puntos del juego en curso (tenis en juego); serving: saca él; color: el del equipo, de fondo en el marcador grande; plate: su escudo necesita una placa clara para verse
export interface RowTeam { name: string; short?: string; logo?: string; score?: string | number | null; win?: boolean; lose?: boolean; games?: number | null; points?: string | null; serving?: boolean; color?: string; plate?: boolean }

// Rótulo de la ficha de cuota: el código del equipo (G2, LAL) o, si el "corto" no es un código (en tenis es el país),
// el apellido del jugador
const oddsTag = (t: RowTeam) => (t.short && t.short.length <= 4 ? t.short : t.name.replace(/\s*\(\d+\)$/, '').split(' ').pop() || t.name);

// Tarjeta de partido: estado y hora arriba, los dos equipos con su marcador y, si se piden, las cuotas de ganador en dos
// fichas (la del favorito teñida del acento). featured: más grande, para "En directo", con la competición en la cabecera.
// En tenis en juego, tras los sets van los juegos del set y los puntos del juego.
// items-stretch: un <button> flex alinea al principio por defecto y la cabecera crecía con el texto en vez de recortarlo
export function MatchCard({ state, time, status, a, b, odds, active, onClick, tag, competition, featured }: {
  state: MatchState; time: string; status?: string; a: RowTeam; b: RowTeam; odds?: { a: number; b: number } | null;
  active?: boolean; onClick: () => void; tag?: string; competition?: string; featured?: boolean;
}) {
  const games = state === 'live' && (a.games != null || b.games != null), points = state === 'live' && (a.points != null || b.points != null);
  const team = (t: RowTeam) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <TeamLogo src={t.logo} name={t.short || t.name} size={featured ? 36 : 26} />
      <span className={cn('min-w-0 flex-1 truncate', featured ? 'text-base' : 'text-sm', t.win ? 'font-semibold text-zinc-50' : t.lose ? 'text-zinc-500' : 'font-medium text-zinc-100')} title={t.name}>{t.name}</span>
      {t.serving && <span title="Saca" aria-label="Saca" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
      {state !== 'pre' && <span className={cn('font-score font-semibold tnum', featured ? 'text-2xl' : 'text-lg', t.lose ? 'text-zinc-500' : games ? 'text-zinc-50' : t.win || state === 'live' ? 'text-amber-400' : 'text-zinc-50')} title={games ? 'Sets' : undefined}>{t.score ?? ''}</span>}
      {games && <span className={cn('w-5 text-right font-score tnum text-zinc-400', featured ? 'text-xl' : 'text-base')} title="Juegos de este set">{t.games ?? ''}</span>}
      {points && <span className={cn('w-7 text-right font-score font-semibold tnum text-amber-400', featured ? 'text-xl' : 'text-base')} title="Puntos del juego">{t.points ?? ''}</span>}
    </div>
  );
  // Se resalta el favorito (la cuota más baja), como antes
  const best = odds ? Math.min(odds.a || 99, odds.b || 99) : 0;
  const oddChip = (o: number, t: RowTeam) => (
    <span className={cn(oddBtn(!!o && o === best), 'flex h-10 items-center justify-between gap-2 px-3 text-sm', !o && 'bg-zinc-900 text-zinc-600')}>
      <span className="min-w-0 truncate font-mono text-[11px] font-medium opacity-75">{oddsTag(t)}</span>
      <span>{o ? odd(o) : '–'}</span>
    </span>
  );
  const info = [competition, status].filter(Boolean).join(' · ');
  return (
    <button onClick={onClick} aria-current={active}
      className={cn('flex h-full w-full cursor-pointer flex-col items-stretch gap-3 rounded-2xl border bg-surface text-left transition hover:-translate-y-px hover:bg-zinc-900/60',
        featured ? 'p-5' : 'p-4', active ? 'border-amber-500/60' : state === 'live' ? 'border-rose-500/30 hover:border-rose-500/50' : 'border-zinc-800 hover:border-zinc-600')}>
      <div className="flex min-w-0 items-center gap-2">
        {state === 'live'
          ? <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-rose-300"><LiveDot />{time}</span>
          : state === 'pre'
            ? <span className="shrink-0 font-mono text-[13px] font-semibold text-zinc-100 tnum">{time}</span>
            : <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">{time}</span>}
        {info && <span className="min-w-0 truncate font-mono text-[11px] text-zinc-500">{info}</span>}
        {tag && <span className="ml-auto shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">{tag}</span>}
      </div>
      <div className={cn('flex flex-col', featured ? 'gap-3' : 'gap-2')}>{team(a)}{team(b)}</div>
      {odds && <div className="mt-auto grid grid-cols-2 gap-2 pt-1">{oddChip(odds.a, a)}{oddChip(odds.b, b)}</div>}
    </button>
  );
}

// ---------- marcador grande ----------
// El marcador del partido abierto: la competición y el estado arriba, los dos equipos a los lados y el resultado en
// grande en el centro, con el acento en quien va por delante. Lo importante de la ficha son los datos que hay debajo
// Colores de los equipos en el marcador grande: cada mitad, plana, teñida del suyo
const tint = (x?: string, y?: string) => (x || y ? {
  background: `linear-gradient(90deg, ${x ? `color-mix(in oklab, ${x} 30%, transparent)` : 'transparent'} 0 50%, ${y ? `color-mix(in oklab, ${y} 30%, transparent)` : 'transparent'} 50% 100%)`
} : undefined);

export function Scoreboard({ competition, detail, a, b, state, center, centerSub, children }: {
  competition: string; detail?: string; a: RowTeam; b: RowTeam; state: MatchState; center?: ReactNode; centerSub?: string; children?: ReactNode;
}) {
  const sa = Number(a.score), sb = Number(b.score);
  const lead = state !== 'pre' && isFinite(sa) && isFinite(sb) && sa !== sb ? (sa > sb ? 'a' : 'b') : null;
  const side = (t: RowTeam, which: 'a' | 'b') => (
    <div className={cn('flex w-full min-w-0 flex-col items-center gap-1.5 text-center sm:w-auto sm:flex-row sm:gap-3', which === 'a' ? 'sm:flex-row sm:justify-self-start sm:text-left' : 'sm:flex-row-reverse sm:justify-self-end sm:text-right')}>
      <span className={cn('shrink-0', t.plate && 'rounded-lg bg-white/90 p-1')}><TeamLogo src={t.logo} name={t.short || t.name} size={44} /></span>
      <div className="min-w-0 max-w-full">
        <div className="truncate text-sm font-semibold tracking-tight sm:text-xl" title={t.name}>{t.name}</div>
        {t.short && t.short !== t.name && <div className="hidden font-mono text-[11px] uppercase tracking-wider text-zinc-500 sm:block">{t.short}</div>}
      </div>
    </div>
  );
  const num = (t: RowTeam, which: 'a' | 'b') => (
    <span className={cn('text-4xl font-bold leading-none tracking-tight tnum sm:text-5xl', lead === which ? 'text-amber-400' : lead ? 'text-zinc-500' : 'text-zinc-50')}>{t.score ?? 0}</span>
  );
  return (
    <div className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 sm:px-5">
        <Mark />
        <span className="text-sm font-semibold text-zinc-100">{competition}</span>
        {detail && <span className="font-mono text-[11px] text-zinc-500">· {detail}</span>}
        {centerSub && (
          <span className={cn('ml-auto flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
            state === 'live' ? 'bg-rose-500/15 text-rose-300' : 'bg-zinc-800 text-zinc-300')}>
            {state === 'live' && <LiveDot />}{centerSub}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-5 sm:gap-6 sm:px-5" style={tint(a.color, b.color)}>
        {side(a, 'a')}
        <div className="flex flex-col items-center gap-1.5">
          {state === 'pre'
            ? <span className="rounded-xl bg-zinc-900 px-4 py-2 font-score text-3xl font-semibold leading-none tnum text-zinc-100">{center}</span>
            : <div className="flex items-center gap-3 rounded-xl bg-zinc-900 px-4 py-2 sm:gap-4">{num(a, 'a')}<span className="text-2xl font-light text-zinc-700">–</span>{num(b, 'b')}</div>}
        </div>
        {side(b, 'b')}
      </div>
      {children}
    </div>
  );
}

// Pestañas bajo el marcador: selector segmentado (la elegida en blanco) y, a la derecha, las acciones
export function SheetTabs<T extends string>({ value, onChange, items, right }: { value: T; onChange: (v: T) => void; items: [T, string][]; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/70 px-3 py-3 sm:px-4">
      <div className={segWrap}>
        {items.map(([v, label]) => (
          <button key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={seg(value === v)}>{label}</button>
        ))}
      </div>
      {right && <div className="ml-auto flex flex-wrap gap-2">{right}</div>}
    </div>
  );
}
