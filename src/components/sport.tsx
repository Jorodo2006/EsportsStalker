// Piezas comunes de las dos apps (LoL y baloncesto) para ver partidos: tira de días, filtro por estado,
// bloque de competición, fila de partido y el marcador grande del partido abierto.
import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, odd } from '@/lib/format';
import { TeamLogo } from './ui';

export type MatchState = 'pre' | 'live' | 'post';

// ---------- días ----------
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
export const today = () => isoDay(new Date());

// Tira de días: la semana alrededor del día elegido, con cuántos partidos hay y si alguno está en juego
export function DayStrip({ value, onChange, counts, span = 7 }: {
  value: string; onChange: (d: string) => void; counts?: Record<string, { total: number; live: number }>; span?: number;
}) {
  const half = Math.floor(span / 2);
  const days = Array.from({ length: span }, (_, i) => addDays(value, i - half));
  const now = today();
  return (
    <div className="flex items-stretch gap-1">
      <button className="grid w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" onClick={() => onChange(addDays(value, -span))} aria-label="Semana anterior"><ChevronLeft size={16} /></button>
      <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}>
        {days.map(d => {
          const dt = new Date(d + 'T12:00:00');
          const c = counts?.[d];
          const sel = d === value;
          return (
            <button key={d} onClick={() => onChange(d)} aria-pressed={sel}
              className={cn('relative flex cursor-pointer flex-col items-center rounded-xl px-1 py-2 transition',
                sel ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}>
              <span className="text-[11px] font-medium first-letter:uppercase">{d === now ? 'Hoy' : dt.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}</span>
              <span className="font-score text-2xl leading-none font-semibold">{dt.getDate()}</span>
              <span className={cn('mt-0.5 text-[10px] tnum', sel ? 'text-zinc-900/70' : 'text-zinc-600')}>{c ? (c.total ? `${c.total} partidos` : 'sin partidos') : ' '}</span>
              {!!c?.live && <span className="absolute right-2 top-2 h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" title={`${c.live} en juego`} />}
            </button>
          );
        })}
      </div>
      <button className="grid w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" onClick={() => onChange(addDays(value, span))} aria-label="Semana siguiente"><ChevronRight size={16} /></button>
    </div>
  );
}

// ---------- filtros ----------
export type StateFilter = 'all' | MatchState;
export function StateFilterBar({ value, onChange, counts, children }: {
  value: StateFilter; onChange: (v: StateFilter) => void; counts: Record<StateFilter, number>; children?: ReactNode;
}) {
  const items: [StateFilter, string][] = [['all', 'Todos'], ['live', 'En juego'], ['pre', 'Próximos'], ['post', 'Terminados']];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} disabled={v !== 'all' && !counts[v]}
          className={cn('flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition disabled:cursor-default disabled:opacity-35',
            value === v ? 'border-zinc-200 bg-zinc-100 text-zinc-950' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100')}>
          {v === 'live' && <span className={cn('h-1.5 w-1.5 rounded-full', counts.live ? 'animate-pulse bg-rose-400' : 'bg-zinc-600')} />}
          {label}<span className={cn('tnum text-xs', value === v ? 'text-zinc-600' : 'text-zinc-600')}>{counts[v]}</span>
        </button>
      ))}
      <div className="ml-auto flex items-center gap-3">{children}</div>
    </div>
  );
}

// Interruptor pequeño (por ejemplo, "Cuotas")
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
      <span className={cn('relative h-5 w-9 rounded-full transition', on ? 'bg-amber-500' : 'bg-zinc-800')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-zinc-50 shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

// ---------- competición y fila de partido ----------
export function CompetitionBlock({ name, sub, logo, count, live, open, onToggle, children }: {
  name: string; sub?: string; logo?: string; count: number; live?: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-900">
        {logo ? <img src={logo} alt="" className="h-6 w-6 object-contain" /> : <span className="grid h-6 w-6 place-items-center rounded-md bg-zinc-800 text-[10px] font-bold text-zinc-400">{name.slice(0, 2)}</span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-100">{name}</div>
          {sub && <div className="truncate text-xs text-zinc-500">{sub}</div>}
        </div>
        {!!live && <span className="flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />{live}</span>}
        <span className="text-xs tnum text-zinc-500">{count}</span>
        <ChevronDown size={15} className={cn('text-zinc-500 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="divide-y divide-zinc-800/60 border-t border-zinc-800/60">{children}</div>}
    </section>
  );
}

export interface RowTeam { name: string; short?: string; logo?: string; score?: string | number | null; win?: boolean; lose?: boolean }

// Fila de partido: hora o estado a la izquierda, los dos equipos uno encima de otro con su marcador,
// y la mejor cuota de cada uno si se piden
export function MatchRow({ state, time, status, a, b, odds, active, onClick, tag }: {
  state: MatchState; time: string; status?: string; a: RowTeam; b: RowTeam; odds?: { a: number; b: number } | null;
  active?: boolean; onClick: () => void; tag?: string;
}) {
  const team = (t: RowTeam) => (
    <div className="flex h-6 min-w-0 items-center gap-2.5">
      <TeamLogo src={t.logo} name={t.short || t.name} size={20} />
      <span className={cn('truncate text-sm', t.win ? 'font-semibold text-zinc-50' : t.lose ? 'text-zinc-500' : 'text-zinc-200')} title={t.name}>{t.name}</span>
    </div>
  );
  const score = (t: RowTeam) => <span className={cn('h-6 font-score text-lg leading-6 font-semibold tnum', t.lose ? 'text-zinc-500' : state === 'live' ? 'text-rose-300' : 'text-zinc-50')}>{t.score ?? ''}</span>;
  return (
    <button onClick={onClick} aria-current={active}
      className={cn('grid w-full cursor-pointer grid-cols-[64px_1fr_auto] items-center gap-3 px-4 py-2 text-left transition',
        active ? 'bg-amber-500/10 shadow-[inset_3px_0_0_var(--acc-500)]' : 'hover:bg-zinc-800/30')}>
      <div className="flex flex-col items-start leading-tight">
        <span className={cn('text-xs tnum', state === 'live' ? 'font-semibold text-rose-300' : 'text-zinc-400')}>{time}</span>
        {status && <span className={cn('truncate text-[11px]', state === 'live' ? 'text-rose-300/80' : 'text-zinc-600')}>{status}</span>}
      </div>
      <div className="flex min-w-0 flex-col gap-1">{team(a)}{team(b)}</div>
      <div className="flex items-center gap-3">
        {tag && <span className="hidden text-[11px] text-zinc-500 xl:inline">{tag}</span>}
        {odds && (
          <div className="flex flex-col gap-1">
            {[odds.a, odds.b].map((o, i) => (
              <span key={i} className={cn('h-6 w-12 rounded-md text-center text-xs leading-6 font-semibold tnum',
                o && o <= Math.min(odds.a || 99, odds.b || 99) ? 'bg-amber-500/15 text-amber-300' : 'bg-zinc-800/70 text-zinc-300')}>{odd(o)}</span>
            ))}
          </div>
        )}
        {state !== 'pre' && <div className="flex w-8 flex-col items-end gap-1">{score(a)}{score(b)}</div>}
      </div>
    </button>
  );
}

// ---------- marcador grande ----------
// El marcador del partido abierto, con cifras condensadas de videomarcador y una línea de acento bajo el que va ganando.
// Es una sola franja: lo importante de la ficha son los datos que hay debajo
export function Scoreboard({ competition, detail, a, b, state, center, centerSub, children }: {
  competition: string; detail?: string; a: RowTeam; b: RowTeam; state: MatchState; center?: ReactNode; centerSub?: string; children?: ReactNode;
}) {
  const sa = Number(a.score), sb = Number(b.score);
  const lead = state !== 'pre' && isFinite(sa) && isFinite(sb) && sa !== sb ? (sa > sb ? 'a' : 'b') : null;
  const side = (t: RowTeam, which: 'a' | 'b') => (
    <div className={cn('flex min-w-0 items-center gap-2.5', which === 'a' ? 'flex-row-reverse justify-self-end text-right' : 'justify-self-start')}>
      <TeamLogo src={t.logo} name={t.short || t.name} size={34} />
      <div className="min-w-0 truncate text-lg font-semibold" title={t.name}>{t.name}</div>
    </div>
  );
  const num = (t: RowTeam, which: 'a' | 'b') => (
    <span className={cn('relative font-score text-[40px] leading-none font-bold tnum', lead && lead !== which ? 'text-zinc-500' : state === 'live' ? 'text-zinc-50' : 'text-zinc-100')}>
      {t.score ?? 0}
      {lead === which && <span className="absolute -bottom-1 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-amber-500" />}
    </span>
  );
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/50">
      <div className="flex items-center justify-center gap-2 px-4 pt-2 text-[11px] text-zinc-500">
        <span className="font-medium text-zinc-300">{competition}</span>
        {detail && <span>{detail}</span>}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-5 px-4 pb-2.5 pt-1">
        {side(a, 'a')}
        <div className="flex flex-col items-center gap-1">
          {state === 'pre'
            ? <span className="font-score text-[32px] font-semibold leading-none tnum text-zinc-100">{center}</span>
            : <div className="flex items-center gap-3">{num(a, 'a')}<span className="font-score text-2xl text-zinc-700">–</span>{num(b, 'b')}</div>}
          <span className={cn('rounded-full px-2 py-px text-[11px] font-medium', state === 'live' ? 'bg-rose-500/15 text-rose-300' : 'bg-zinc-800/80 text-zinc-400')}>
            {state === 'live' && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400 align-middle" />}{centerSub}
          </span>
        </div>
        {side(b, 'b')}
      </div>
      {children}
    </div>
  );
}

// Pestañas bajo el marcador
export function SheetTabs<T extends string>({ value, onChange, items, right }: { value: T; onChange: (v: T) => void; items: [T, string][]; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-zinc-800/70 px-3">
      {items.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={cn('-mb-px cursor-pointer border-b-2 px-3 py-3 text-sm font-medium transition',
            value === v ? 'border-amber-500 text-zinc-50' : 'border-transparent text-zinc-400 hover:text-zinc-200')}>{label}</button>
      ))}
      {right && <div className="ml-auto flex gap-2 py-2">{right}</div>}
    </div>
  );
}
